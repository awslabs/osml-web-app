// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-mcp.ts hooks.
 * Covers useToolApproval (auto-approval logic, approval flow) and
 * useMultipleMcp (tool aggregation, callTool routing, auth interceptor).
 */

import { act } from "@testing-library/react";

// Mock the external use-mcp library
jest.mock("use-mcp/react", () => ({
  useMcp: jest.fn(() => ({
    tools: [],
    callTool: jest.fn(),
    state: "ready"
  }))
}));

// Mock auth interceptor
jest.mock("@/utils/mcp-auth-interceptor", () => ({
  initMcpAuthInterceptor: jest.fn(),
  updateMcpServerUrls: jest.fn(),
  cleanupMcpAuthInterceptor: jest.fn()
}));

import { useMultipleMcp, useToolApproval } from "@/hooks/use-mcp";

import { renderHookWithStore } from "../test-utils";

describe("useToolApproval", () => {
  const defaultPreferences = {
    enabledServers: [
      {
        id: "srv-1",
        name: "Test Server",
        url: "https://test.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: ["get_viewport"],
        disabledTools: [] as string[]
      }
    ],
    overrideAllApprovals: false
  };

  const toolToServerMap = new Map([
    ["get_viewport", "Test Server"],
    ["draw_feature", "Test Server"]
  ]);

  it("checkAutoApproval should return true for auto-approved tools", () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );
    expect(result.current.checkAutoApproval("get_viewport")).toBe(true);
  });

  it("checkAutoApproval should return false for non-auto-approved tools", () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );
    expect(result.current.checkAutoApproval("draw_feature")).toBe(false);
  });

  it("checkAutoApproval should return true when overrideAllApprovals is true", () => {
    const prefs = { ...defaultPreferences, overrideAllApprovals: true };
    const { result } = renderHookWithStore(() =>
      useToolApproval(prefs, toolToServerMap)
    );
    expect(result.current.checkAutoApproval("draw_feature")).toBe(true);
  });

  it("checkAutoApproval should return false for unknown tools", () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );
    expect(result.current.checkAutoApproval("nonexistent_tool")).toBe(false);
  });

  it("requestToolApproval should auto-resolve for auto-approved tools", async () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );

    let approved: boolean | undefined;
    await act(async () => {
      approved = await result.current.requestToolApproval({
        name: "get_viewport",
        args: {}
      });
    });
    expect(approved).toBe(true);
  });

  it("requestToolApproval should show modal for non-auto-approved tools", async () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );

    // Start approval request (will pend)
    let approvalPromise: Promise<boolean>;
    act(() => {
      approvalPromise = result.current.requestToolApproval({
        name: "draw_feature",
        args: { wkt: "POINT(0 0)" }
      });
    });

    // Modal should be visible
    expect(result.current.toolApprovalModal).not.toBeNull();
    expect(result.current.toolApprovalModal?.visible).toBe(true);
    expect(result.current.toolApprovalModal?.tool.name).toBe("draw_feature");

    // Approve it
    act(() => {
      result.current.handleToolApproval();
    });

    const approved = await approvalPromise!;
    expect(approved).toBe(true);
    expect(result.current.toolApprovalModal).toBeNull();
  });

  it("handleToolRejection should reject the pending approval", async () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );

    let approvalPromise: Promise<boolean>;
    act(() => {
      approvalPromise = result.current.requestToolApproval({
        name: "draw_feature",
        args: {}
      });
    });

    act(() => {
      result.current.handleToolRejection();
    });

    await expect(approvalPromise!).rejects.toThrow("cancelled by user");
  });
});

describe("useMultipleMcp", () => {
  const servers = [
    {
      id: "local",
      name: "Local Viewport Server",
      url: "local://viewport",
      enabled: true,
      connectionStatus: "active" as const,
      autoApprovedTools: [] as string[],
      disabledTools: [] as string[]
    }
  ];
  const preferences = { enabledServers: servers, overrideAllApprovals: false };

  it("should return tools array", () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );
    // Local tools should be available even without authentication
    expect(Array.isArray(result.current.tools)).toBe(true);
  });

  it("should return callTool function", () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );
    expect(typeof result.current.callTool).toBe("function");
  });

  it("should return toolToServerMap", () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );
    expect(result.current.toolToServerMap).toBeInstanceOf(Map);
  });

  it("callTool should route local tools to local server", async () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );

    let toolResult: unknown;
    await act(async () => {
      toolResult = await result.current.callTool("get_viewport", {});
    });

    expect(toolResult).toHaveProperty("longitude");
  });

  it("callTool should throw for unknown tools", async () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );

    await act(async () => {
      await expect(
        result.current.callTool("nonexistent_tool", {})
      ).rejects.toThrow(/not found/);
    });
  });

  it("should not create external connections when not authenticated", () => {
    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );
    // McpConnections should be empty when not authenticated
    expect(result.current.McpConnections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for McpConnection and useMultipleMcp branches
// ---------------------------------------------------------------------------

describe("useMultipleMcp - additional branch coverage", () => {
  it("should filter out local:// servers from external connections", () => {
    const servers = [
      {
        id: "local",
        name: "Local Viewport Server",
        url: "local://viewport",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      },
      {
        id: "remote",
        name: "Remote Server",
        url: "https://remote.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );

    // McpConnections should be empty when not authenticated
    expect(result.current.McpConnections).toHaveLength(0);
  });

  it("should create McpConnections when authenticated with remote servers", () => {
    const servers = [
      {
        id: "remote",
        name: "Remote Server",
        url: "https://remote.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, true)
    );

    // Should create connection elements when authenticated
    expect(result.current.McpConnections).toHaveLength(1);
  });

  it("should not create connections for disabled servers", () => {
    const servers = [
      {
        id: "remote",
        name: "Remote Server",
        url: "https://remote.com/mcp",
        enabled: false,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, true)
    );

    expect(result.current.McpConnections).toHaveLength(0);
  });

  it("should not create connections for failed servers", () => {
    const servers = [
      {
        id: "remote",
        name: "Remote Server",
        url: "https://remote.com/mcp",
        enabled: true,
        connectionStatus: "failed" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, true)
    );

    expect(result.current.McpConnections).toHaveLength(0);
  });

  it("callTool should throw for external tool without connection", async () => {
    const servers = [
      {
        id: "local",
        name: "Local Viewport Server",
        url: "local://viewport",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );

    await act(async () => {
      await expect(
        result.current.callTool("external_tool", {})
      ).rejects.toThrow(/not found/);
    });
  });

  it("should return connectionStatesMap", () => {
    const servers = [
      {
        id: "local",
        name: "Local Viewport Server",
        url: "local://viewport",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const preferences = {
      enabledServers: servers,
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useMultipleMcp(servers, preferences, undefined, false)
    );

    expect(result.current.connectionStatesMap).toBeInstanceOf(Map);
  });
});

describe("useToolApproval - additional branch coverage", () => {
  const defaultPreferences = {
    enabledServers: [
      {
        id: "srv-1",
        name: "Test Server",
        url: "https://test.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: ["get_viewport"],
        disabledTools: [] as string[]
      }
    ],
    overrideAllApprovals: false
  };

  const toolToServerMap = new Map([
    ["get_viewport", "Test Server"],
    ["draw_feature", "Test Server"]
  ]);

  it("handleToolApproval should do nothing when no modal is open", () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );

    // No pending approval — should not throw
    act(() => {
      result.current.handleToolApproval();
    });

    expect(result.current.toolApprovalModal).toBeNull();
  });

  it("handleToolRejection should do nothing when no modal is open", () => {
    const { result } = renderHookWithStore(() =>
      useToolApproval(defaultPreferences, toolToServerMap)
    );

    act(() => {
      result.current.handleToolRejection();
    });

    expect(result.current.toolApprovalModal).toBeNull();
  });

  it("checkAutoApproval should return false when server has no auto-approved tools", () => {
    const prefs = {
      enabledServers: [
        {
          id: "srv-1",
          name: "Test Server",
          url: "https://test.com/mcp",
          enabled: true,
          connectionStatus: "active" as const,
          autoApprovedTools: [] as string[],
          disabledTools: [] as string[]
        }
      ],
      overrideAllApprovals: false
    };

    const { result } = renderHookWithStore(() =>
      useToolApproval(prefs, toolToServerMap)
    );

    expect(result.current.checkAutoApproval("get_viewport")).toBe(false);
  });
});
