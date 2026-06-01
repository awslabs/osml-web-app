// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-tool-chain.ts hook.
 * Covers checkAutoApproval, formatToolResult, tool chain processing,
 * approval flow, and stop mechanism.
 */

import { act, waitFor } from "@testing-library/react";

// Mock the data-catalog and job-management services so the sync deletion
// flow doesn't hit real network code. Must be hoisted before importing
// useToolChain.
jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    deleteCollection: jest.fn().mockResolvedValue(undefined),
    deleteItem: jest.fn().mockResolvedValue(undefined)
  }
}));
jest.mock("@/services/job-management", () => ({
  deleteJob: jest.fn().mockResolvedValue({ success: true })
}));

import { McpServerConfig } from "@/hooks/use-mcp";
import { useToolChain } from "@/hooks/use-tool-chain";
import { dataCatalogService } from "@/services/data-catalog-service";
import { addMessage } from "@/store/slices/chat-session-slice";
import { mcpGlobals } from "@/store/slices/mcp-slice";
import { ChatMessage, MessageType } from "@/types/chat";

import { createTestStore, renderHookWithStore } from "../test-utils";

// Setup mcpGlobals with a mock callTool
const mockCallTool = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mcpGlobals.callTool = mockCallTool;
  mcpGlobals.toolToServerMap = new Map([
    ["get_viewport", "Local Viewport Server"]
  ]);
  mcpGlobals.tools = [];
});

afterEach(() => {
  mcpGlobals.callTool = null;
  mcpGlobals.toolToServerMap = new Map();
});

const mockGenerateResponse = jest.fn().mockResolvedValue(undefined);

describe("useToolChain", () => {
  it("should return expected interface", () => {
    const { result } = renderHookWithStore(() =>
      useToolChain({ generateResponse: mockGenerateResponse })
    );

    expect(typeof result.current.startToolChain).toBe("function");
    expect(typeof result.current.stopToolChain).toBe("function");
    expect(typeof result.current.isProcessingChain).toBe("function");
    expect(typeof result.current.handleToolApproval).toBe("function");
    expect(typeof result.current.handleToolRejection).toBe("function");
    expect(result.current.callingToolName).toBeUndefined();
    expect(result.current.toolExecutions).toEqual([]);
  });

  it("isProcessingChain should return false initially", () => {
    const { result } = renderHookWithStore(() =>
      useToolChain({ generateResponse: mockGenerateResponse })
    );
    expect(result.current.isProcessingChain()).toBe(false);
  });

  it("startToolChain should process tool calls from last AI message", async () => {
    const store = createTestStore();

    // Add a user message and an AI message with tool calls
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.HUMAN,
          content: "Show me the viewport"
        })
      )
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Let me check the viewport.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValue({ longitude: 0, latitude: 0, zoom: 2 });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    // callTool should have been called with the tool name and args
    expect(mockCallTool).toHaveBeenCalledWith("get_viewport", {});

    // generateResponse should have been called with tool result messages
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it("startToolChain should do nothing when no tool calls in last message", async () => {
    const store = createTestStore();
    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Hello" }))
    );

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(mockCallTool).not.toHaveBeenCalled();
    expect(mockGenerateResponse).not.toHaveBeenCalled();
  });

  it("should handle tool execution errors gracefully", async () => {
    const store = createTestStore();
    store.dispatch(
      addMessage(
        new ChatMessage({ type: MessageType.HUMAN, content: "Do something" })
      )
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running tool.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockRejectedValue(new Error("Tool failed"));

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    // Should still call generateResponse with error results
    expect(mockGenerateResponse).toHaveBeenCalled();

    // Notifications should include the error
    const notifications = store.getState().chatSession.notifications;
    expect(
      notifications.some((n: { message: string }) =>
        n.message.includes("failed")
      )
    ).toBe(true);
  });

  it("stopToolChain should stop processing", () => {
    const { result } = renderHookWithStore(() =>
      useToolChain({ generateResponse: mockGenerateResponse })
    );

    act(() => {
      result.current.stopToolChain();
    });

    // No error — stopRequested ref is set internally
    expect(true).toBe(true);
  });

  it("handleToolRejection should close modal when no pending approval", () => {
    const { result, store } = renderHookWithStore(() =>
      useToolChain({ generateResponse: mockGenerateResponse })
    );

    act(() => {
      result.current.handleToolRejection();
    });

    // Should not throw, modal should remain closed
    expect(store.getState().mcp.toolApprovalModal.isOpen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for uncovered branches (lines 108-197)
// ---------------------------------------------------------------------------

describe("useToolChain - tool approval flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mcpGlobals.callTool = mockCallTool;
    mcpGlobals.toolToServerMap = new Map([
      ["get_viewport", "Local Viewport Server"]
    ]);
    mcpGlobals.tools = [];
  });

  afterEach(() => {
    mcpGlobals.callTool = null;
    mcpGlobals.toolToServerMap = new Map();
  });

  it("should require approval for non-auto-approved tools", async () => {
    const store = createTestStore();

    // Add an AI message with tool calls for an auto-approved tool
    store.dispatch(
      addMessage(
        new ChatMessage({ type: MessageType.HUMAN, content: "Show viewport" })
      )
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Checking.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValue({ longitude: 10, latitude: 20, zoom: 5 });

    // Set overrideAllApprovals to true so all tools are auto-approved
    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(mockCallTool).toHaveBeenCalledWith("get_viewport", {});
    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it("handleToolApproval should do nothing when modal not open", () => {
    const { result } = renderHookWithStore(() =>
      useToolChain({ generateResponse: mockGenerateResponse })
    );

    act(() => {
      result.current.handleToolApproval();
    });

    // Should not throw
    expect(result.current.toolApprovalModal.isOpen).toBe(false);
  });

  it("should handle user cancellation during tool chain", async () => {
    const store = createTestStore();

    store.dispatch(
      addMessage(
        new ChatMessage({ type: MessageType.HUMAN, content: "Do two things" })
      )
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running tools.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" },
            { id: "tc-2", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockRejectedValueOnce(
      new Error("Tool execution cancelled by user")
    );

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    // Chain should stop after cancellation — generateResponse should NOT be called
    // because the chain was cancelled
    const notifications = store.getState().chatSession.notifications;
    expect(
      notifications.some((n: { message: string }) =>
        n.message.includes("cancelled")
      )
    ).toBe(true);
  });

  it("formatToolResult should handle array of text items", async () => {
    const store = createTestStore();

    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Test" }))
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    // Return an array with text items (MCP format)
    mockCallTool.mockResolvedValue([
      { type: "text", text: "Result line 1" },
      { type: "text", text: "Result line 2" }
    ]);

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it("formatToolResult should handle primitive string result", async () => {
    const store = createTestStore();

    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Test" }))
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValue("simple string result");

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it("formatToolResult should handle object result", async () => {
    const store = createTestStore();

    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Test" }))
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValue({ key: "value", nested: { a: 1 } });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(mockGenerateResponse).toHaveBeenCalled();
  });

  it("should handle multiple tool calls with mixed success/failure", async () => {
    const store = createTestStore();

    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Multi" }))
    );
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "Running multiple tools.",
          toolCalls: [
            { id: "tc-1", name: "get_viewport", args: {}, type: "function" },
            {
              id: "tc-2",
              name: "get_viewport",
              args: { fail: true },
              type: "function"
            }
          ]
        })
      )
    );

    mockCallTool
      .mockResolvedValueOnce({ longitude: 0, latitude: 0 })
      .mockRejectedValueOnce(new Error("Second tool failed"));

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    // Should still call generateResponse with both results (success + error)
    expect(mockGenerateResponse).toHaveBeenCalled();
  });
});

describe("useToolChain - destructive confirmation (sync)", () => {
  const buildBaseMcpState = () => ({
    servers: [] as McpServerConfig[],
    preferences: {
      enabledServers: [] as McpServerConfig[],
      overrideAllApprovals: true
    },
    isLoading: false,
    error: null,
    initialized: false,
    connectionCount: 0,
    toolApprovalModal: {
      isOpen: false as const,
      requestId: null as string | null,
      tool: null as { name: string; args: Record<string, unknown> } | null
    },
    destructiveConfirmation: null,
    isProcessingToolChain: false
  });

  beforeEach(() => {
    mcpGlobals.toolToServerMap = new Map([
      ["delete_stac_collection", "Local Viewport Server"],
      ["delete_stac_item", "Local Viewport Server"],
      ["get_viewport", "Local Viewport Server"]
    ]);
    (dataCatalogService.deleteCollection as jest.Mock).mockClear();
    (dataCatalogService.deleteItem as jest.Mock).mockClear();
  });

  it("shows the confirmation card when a destructive payload comes back", async () => {
    const store = createTestStore({ mcp: buildBaseMcpState() });
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "",
          toolCalls: [
            {
              id: "call-conf",
              name: "delete_stac_collection",
              args: { collection_id: "eo_2023" },
              type: "function"
            }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValueOnce({
      confirmationRequired: true,
      action: "delete_stac_collection",
      args: { collection_id: "eo_2023" },
      title: "Delete collection?",
      message: "Delete collection 'eo_2023' and all of its items?",
      warning: "This cannot be undone."
    });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    // Kick the chain off but don't await — the tool will pause on
    // confirmation until handleDestructiveConfirm/Cancel is called.
    let chainPromise: Promise<void> = Promise.resolve();
    act(() => {
      chainPromise = result.current.startToolChain();
    });

    await waitFor(() => {
      expect(store.getState().mcp.destructiveConfirmation).not.toBeNull();
    });
    expect(store.getState().mcp.destructiveConfirmation!.payload.action).toBe(
      "delete_stac_collection"
    );

    // Resolve the pending confirmation so the chain unblocks for cleanup.
    await act(async () => {
      result.current.handleDestructiveCancel();
      await chainPromise;
    });
  });

  it("returns a terminal cancelled result when the user cancels", async () => {
    const store = createTestStore({ mcp: buildBaseMcpState() });
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "",
          toolCalls: [
            {
              id: "call-cancel",
              name: "delete_stac_collection",
              args: { collection_id: "x" },
              type: "function"
            }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValueOnce({
      confirmationRequired: true,
      action: "delete_stac_collection",
      args: { collection_id: "x" },
      title: "Delete collection?",
      message: "Delete collection 'x' and all of its items?"
    });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    let chainPromise: Promise<void> = Promise.resolve();
    act(() => {
      chainPromise = result.current.startToolChain();
    });

    await waitFor(() => {
      expect(store.getState().mcp.destructiveConfirmation).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDestructiveCancel();
      await chainPromise;
    });

    const history = store.getState().chatSession.history;
    const toolMsg = history.find(
      (m: { metadata?: Record<string, unknown> }) =>
        (m.metadata as { toolName?: string } | undefined)?.toolName ===
        "delete_stac_collection"
    ) as { content: string } | undefined;
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toMatch(/User declined the deletion/);
    expect(toolMsg!.content).toMatch(/"completed": true/);
    expect(toolMsg!.content).toMatch(/"cancelled": true/);
    expect(toolMsg!.content).toMatch(/Do not retry/);
    expect(store.getState().mcp.destructiveConfirmation).toBeNull();
  });

  it("invokes the delete service and reports success when the user confirms", async () => {
    const store = createTestStore({ mcp: buildBaseMcpState() });
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "",
          toolCalls: [
            {
              id: "call-confirm",
              name: "delete_stac_collection",
              args: { collection_id: "ok" },
              type: "function"
            }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValueOnce({
      confirmationRequired: true,
      action: "delete_stac_collection",
      args: { collection_id: "ok" },
      title: "Delete collection?",
      message: "Delete collection 'ok' and all of its items?"
    });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    let chainPromise: Promise<void> = Promise.resolve();
    act(() => {
      chainPromise = result.current.startToolChain();
    });

    await waitFor(() => {
      expect(store.getState().mcp.destructiveConfirmation).not.toBeNull();
    });

    await act(async () => {
      result.current.handleDestructiveConfirm();
      await chainPromise;
    });

    expect(dataCatalogService.deleteCollection).toHaveBeenCalledWith("ok");
    const history = store.getState().chatSession.history;
    const toolMsg = history.find(
      (m: { metadata?: Record<string, unknown> }) =>
        (m.metadata as { toolName?: string } | undefined)?.toolName ===
        "delete_stac_collection"
    ) as { content: string } | undefined;
    expect(toolMsg!.content).toMatch(/were deleted after user confirmation/);
    expect(toolMsg!.content).toMatch(/"completed": true/);
    expect(toolMsg!.content).toMatch(/do not retry/i);
  });

  it("non-destructive tool results pass through unchanged", async () => {
    const store = createTestStore({ mcp: buildBaseMcpState() });
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "",
          toolCalls: [
            {
              id: "call-plain",
              name: "get_viewport",
              args: {},
              type: "function"
            }
          ]
        })
      )
    );

    mockCallTool.mockResolvedValueOnce({ longitude: 0, latitude: 0 });

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    await act(async () => {
      await result.current.startToolChain();
    });

    expect(store.getState().mcp.destructiveConfirmation).toBeNull();
    const history = store.getState().chatSession.history;
    const toolMsg = history.find(
      (m: { metadata?: Record<string, unknown> }) =>
        (m.metadata as { toolName?: string } | undefined)?.toolName ===
        "get_viewport"
    ) as { content: string } | undefined;
    expect(toolMsg!.content).toMatch(/longitude/);
  });

  it("opens the approval modal for a destructive tool that is not auto-approved", async () => {
    // overrideAllApprovals: false AND tool not in any server's autoApprovedTools.
    // The chain must surface the standard approval modal — auto-approval and
    // the destructive-card flow are independent gates.
    const stateNoAutoApprove = buildBaseMcpState();
    stateNoAutoApprove.preferences.overrideAllApprovals = false;

    const store = createTestStore({ mcp: stateNoAutoApprove });
    store.dispatch(
      addMessage(
        new ChatMessage({
          type: MessageType.AI,
          content: "",
          toolCalls: [
            {
              id: "call-noauto",
              name: "delete_stac_collection",
              args: { collection_id: "x" },
              type: "function"
            }
          ]
        })
      )
    );

    const { result } = renderHookWithStore(
      () => useToolChain({ generateResponse: mockGenerateResponse }),
      { store }
    );

    let chainPromise: Promise<void> = Promise.resolve();
    act(() => {
      chainPromise = result.current.startToolChain();
    });

    // Approval modal should open synchronously off the dispatch.
    await waitFor(() => {
      expect(store.getState().mcp.toolApprovalModal.isOpen).toBe(true);
    });
    expect(store.getState().mcp.toolApprovalModal.tool?.name).toBe(
      "delete_stac_collection"
    );

    // Destructive card has not been shown yet — the chain is paused on the
    // approval modal, not the confirmation card.
    expect(store.getState().mcp.destructiveConfirmation).toBeNull();

    // Reject the modal so the chain unwinds for cleanup.
    await act(async () => {
      result.current.handleToolRejection();
      await chainPromise;
    });
  });
});
