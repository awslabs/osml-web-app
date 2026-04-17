// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-chat-generation hook.
 * Covers message preparation, successful generation, throttle detection,
 * error handling, and stop generation.
 */

import { act } from "@testing-library/react";

import { useChatGeneration } from "@/hooks/use-chat-generation";
import { ChatMessage, MessageType } from "@/types/chat";

// Mock bedrock service
jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn() },
  bedrockChatService: { sendChatMessage: jest.fn() },
  bedrockQuotaService: { getModelQuota: jest.fn().mockResolvedValue({}) },
  bedrockService: {
    getModelDisplayName: jest.fn(),
    getAvailableModels: jest.fn(),
    sendChatMessage: jest.fn(),
    testConnection: jest.fn(),
    getModelQuota: jest.fn(),
    getQuotas: jest.fn()
  }
}));

import { bedrockChatService } from "@/services/bedrock-service";
import { setSelectedModel } from "@/store/slices/bedrock-model-slice";
import { addMessage } from "@/store/slices/chat-session-slice";

import { createTestStore, renderHookWithStore } from "../test-utils";

const mockSendChat = bedrockChatService.sendChatMessage as jest.Mock;

const testModel = {
  modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  modelName: "Claude Sonnet 4.5",
  providerName: "Anthropic",
  inputModalities: ["TEXT"],
  outputModalities: ["TEXT"],
  supportsStreaming: true,
  supportsToolUse: true,
  modelLifecycle: "ACTIVE",
  customizationsSupported: [],
  inferenceTypesSupported: []
};

function createStoreWithModel() {
  const store = createTestStore();
  store.dispatch(setSelectedModel(testModel));
  // Add a user message so the conversation is valid
  store.dispatch(
    addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Hello" }))
  );
  return store;
}

describe("useChatGeneration", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should start with isRunning false", () => {
    const store = createStoreWithModel();
    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );
    expect(result.current.isRunning).toBe(false);
  });

  it("should throw when no model is selected", async () => {
    const store = createTestStore(); // no model selected
    store.dispatch(
      addMessage(new ChatMessage({ type: MessageType.HUMAN, content: "Hi" }))
    );

    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );

    await act(async () => {
      await expect(result.current.generateResponse()).rejects.toThrow(
        "No model selected"
      );
    });
  });

  it("should generate response and add AI message to store", async () => {
    const store = createStoreWithModel();
    mockSendChat.mockResolvedValue({
      message: "Hello! How can I help?",
      usage: { inputTokens: 10, outputTokens: 20 }
    });

    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );

    await act(async () => {
      await result.current.generateResponse();
    });

    expect(mockSendChat).toHaveBeenCalledTimes(1);
    const state = store.getState();
    const history = state.chatSession.history;
    // Should have user message + AI response
    expect(history.length).toBe(2);
    expect(history[1].type).toBe(MessageType.AI);
    expect(history[1].content).toBe("Hello! How can I help?");
  });

  it("should include tool calls in AI message when present", async () => {
    const store = createStoreWithModel();
    mockSendChat.mockResolvedValue({
      message: "Let me check that.",
      toolCalls: [{ toolUseId: "tc-1", name: "get_viewport", input: {} }],
      requiresToolExecution: true
    });

    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [{ type: "function" }] }),
      { store }
    );

    await act(async () => {
      await result.current.generateResponse();
    });

    const history = store.getState().chatSession.history;
    expect(history[1].toolCalls).toHaveLength(1);
    expect(history[1].toolCalls![0].name).toBe("get_viewport");
  });

  it("should handle throttle errors (429) with throttle state", async () => {
    const store = createStoreWithModel();
    const throttleError = new Error("HTTP error! status: 429") as Error & {
      status: number;
      data: Record<string, unknown>;
    };
    throttleError.status = 429;
    throttleError.data = {
      detail: {
        error: "throttled",
        error_type: "rate_limit",
        message: "Rate limit exceeded",
        retry_after_seconds: 30,
        model_id: testModel.modelId,
        timestamp: new Date().toISOString()
      }
    };
    mockSendChat.mockRejectedValue(throttleError);

    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );

    await act(async () => {
      await result.current.generateResponse();
    });

    // Should have dispatched throttle state
    const throttleState = store.getState().bedrockThrottle;
    expect(throttleState.throttleByModel[testModel.modelId]).toBeDefined();
    expect(throttleState.throttleByModel[testModel.modelId].isThrottled).toBe(
      true
    );

    // Should have added error message with canRetry
    const history = store.getState().chatSession.history;
    const errorMsg = history[history.length - 1];
    expect(errorMsg.error).toBe("throttled");
    expect(errorMsg.canRetry).toBe(true);
  });

  it("should handle generic errors", async () => {
    const store = createStoreWithModel();
    mockSendChat.mockRejectedValue(new Error("Network failure"));

    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );

    await act(async () => {
      await result.current.generateResponse();
    });

    const history = store.getState().chatSession.history;
    const errorMsg = history[history.length - 1];
    expect(errorMsg.content).toContain("Network failure");
    expect(errorMsg.canRetry).toBe(true);
  });

  it("stopGeneration should set isRunning to false", () => {
    const store = createStoreWithModel();
    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );

    act(() => {
      result.current.stopGeneration();
    });

    expect(result.current.isRunning).toBe(false);
  });

  it("should return null throttleInfo when no model selected", () => {
    const store = createTestStore();
    const { result } = renderHookWithStore(
      () => useChatGeneration({ openAiTools: [] }),
      { store }
    );
    expect(result.current.throttleInfo).toBeNull();
  });
});
