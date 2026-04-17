// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-smart-quota-polling hook.
 * Covers polling state, pause/resume, and forceUpdate.
 */

import { act } from "@testing-library/react";

import { useSmartQuotaPolling } from "@/hooks/use-smart-quota-polling";

// Mock bedrock service
jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn() },
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

import { renderHookWithStore } from "../test-utils";

describe("useSmartQuotaPolling", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should return initial polling state", () => {
    const { result } = renderHookWithStore(() => useSmartQuotaPolling());

    // With no chat UI visible, polling should be suspended
    expect(result.current.isPolling).toBe(false);
    expect(result.current.currentInterval).toBe(0);
    expect(result.current.pollingReason).toContain("no_chat_ui");
  });

  it("should expose pause and resume methods", () => {
    const { result } = renderHookWithStore(() => useSmartQuotaPolling());

    expect(typeof result.current.pausePolling).toBe("function");
    expect(typeof result.current.resumePolling).toBe("function");
    expect(typeof result.current.forceUpdate).toBe("function");
  });

  it("pausePolling should set polling to false", () => {
    const { result, store } = renderHookWithStore(() => useSmartQuotaPolling());

    act(() => {
      result.current.pausePolling();
    });

    expect(store.getState().bedrockQuota.isPolling).toBe(false);
  });

  it("forceUpdate should not throw", () => {
    const { result } = renderHookWithStore(() => useSmartQuotaPolling());

    act(() => {
      result.current.forceUpdate();
    });

    // Should not throw
    expect(true).toBe(true);
  });

  it("pollingConfig should include UI context info", () => {
    const { result } = renderHookWithStore(() => useSmartQuotaPolling());

    expect(result.current.pollingConfig).toHaveProperty("interval");
    expect(result.current.pollingConfig).toHaveProperty("reason");
    expect(result.current.pollingConfig).toHaveProperty("shouldPoll");
  });
});

import { updateUserActivity } from "@/store/slices/chat-session-slice";
import { setCurrentRoute } from "@/store/slices/navbar-slice";

import { createTestStore } from "../test-utils";

describe("useSmartQuotaPolling - polling lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should start polling when chat UI becomes visible", () => {
    const store = createTestStore();
    store.dispatch(setCurrentRoute("/chat"));
    store.dispatch(updateUserActivity());

    const { result } = renderHookWithStore(() => useSmartQuotaPolling(), {
      store
    });

    // With chat page active and recent activity, polling should be active
    expect(result.current.currentInterval).toBeGreaterThan(0);
    expect(result.current.isPolling).toBe(true);
  });

  it("resumePolling should restart polling with current smart interval", () => {
    const store = createTestStore();
    store.dispatch(setCurrentRoute("/chat"));
    store.dispatch(updateUserActivity());

    const { result } = renderHookWithStore(() => useSmartQuotaPolling(), {
      store
    });

    act(() => {
      result.current.pausePolling();
    });
    expect(store.getState().bedrockQuota.isPolling).toBe(false);

    act(() => {
      result.current.resumePolling();
    });
    // After resume, polling should be active again
    expect(store.getState().bedrockQuota.isPolling).toBe(true);
  });

  it("should clean up interval on unmount", () => {
    const store = createTestStore();
    store.dispatch(setCurrentRoute("/chat"));
    store.dispatch(updateUserActivity());

    const { unmount } = renderHookWithStore(() => useSmartQuotaPolling(), {
      store
    });

    // Unmount should clean up without errors
    unmount();
    expect(true).toBe(true);
  });
});
