// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-quota-usage hook.
 * Covers fetchQuotaUsage, fetchQuotaForModel, and currentModelId.
 */

import { act } from "@testing-library/react";

import { useQuotaUsage } from "@/hooks/use-quota-usage";

// Mock the bedrock service
jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn() },
  bedrockQuotaService: {
    getModelQuota: jest.fn()
  },
  bedrockService: {
    getModelDisplayName: jest.fn((m: { modelName: string }) => m.modelName),
    getAvailableModels: jest.fn(),
    sendChatMessage: jest.fn(),
    testConnection: jest.fn(),
    getModelQuota: jest.fn(),
    getQuotas: jest.fn()
  }
}));

import { bedrockQuotaService } from "@/services/bedrock-service";

import { renderHookWithStore } from "../test-utils";

const mockGetModelQuota = bedrockQuotaService.getModelQuota as jest.Mock;

describe("useQuotaUsage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return null currentModelId when no model selected", () => {
    const { result } = renderHookWithStore(() => useQuotaUsage());
    expect(result.current.currentModelId).toBeNull();
  });

  it("fetchQuotaUsage should do nothing when no model selected", async () => {
    const { result } = renderHookWithStore(() => useQuotaUsage());

    await act(async () => {
      await result.current.fetchQuotaUsage();
    });

    expect(mockGetModelQuota).not.toHaveBeenCalled();
  });

  it("fetchQuotaForModel should fetch and dispatch quota for specific model", async () => {
    const mockQuota = {
      has_limits: true,
      model_id: "model-a",
      usage_percent: { requests: 50, tokens: 30 }
    };
    mockGetModelQuota.mockResolvedValue(mockQuota);

    const { result, store } = renderHookWithStore(() => useQuotaUsage());

    let response: unknown;
    await act(async () => {
      response = await result.current.fetchQuotaForModel("model-a");
    });

    expect(mockGetModelQuota).toHaveBeenCalledWith("model-a");
    expect(response).toEqual(mockQuota);

    // Verify quota was dispatched to store
    const state = store.getState();
    expect(state.bedrockQuota.quotaByModel["model-a"]).toBeDefined();
    expect(state.bedrockQuota.quotaByModel["model-a"].has_limits).toBe(true);
  });
});
