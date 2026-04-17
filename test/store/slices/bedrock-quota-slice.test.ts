// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for bedrock-quota-slice.ts.
 * Covers quota CRUD, timer decrement, polling state, helper functions,
 * and selectors.
 */

import { configureStore } from "@reduxjs/toolkit";

import bedrockQuotaReducer, {
  clearAllQuotas,
  clearQuota,
  decrementResetTimers,
  getHighestUsagePercent,
  getQuotaStatusColor,
  selectAllQuotas,
  selectQuotaForModel,
  setPolling,
  setPollingConfig,
  updateQuota
} from "@/store/slices/bedrock-quota-slice";

const createStore = () =>
  configureStore({ reducer: { bedrockQuota: bedrockQuotaReducer } });

const sampleQuota = {
  has_limits: true,
  model_id: "model-a",
  limits: { requests_per_minute: 100, tokens_per_minute: 500000 },
  usage: { requests_used: 50, tokens_used: 250000, window_start: Date.now() },
  remaining: { requests: 50, tokens: 250000 },
  usage_percent: { requests: 50, tokens: 50 },
  reset_in_seconds: 45
};

describe("bedrock-quota-slice", () => {
  describe("updateQuota", () => {
    it("should store quota info for a model with last_updated timestamp", () => {
      const store = createStore();
      const before = Date.now();

      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );

      const quota = selectQuotaForModel(store.getState(), "model-a");
      expect(quota).not.toBeNull();
      expect(quota!.has_limits).toBe(true);
      expect(quota!.limits!.requests_per_minute).toBe(100);
      expect(quota!.last_updated).toBeGreaterThanOrEqual(before);
    });

    it("should overwrite existing quota for same model", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );
      store.dispatch(
        updateQuota({
          modelId: "model-a",
          quotaInfo: {
            ...sampleQuota,
            usage_percent: { requests: 90, tokens: 80 }
          }
        })
      );

      const quota = selectQuotaForModel(store.getState(), "model-a");
      expect(quota!.usage_percent!.requests).toBe(90);
    });
  });

  describe("clearQuota / clearAllQuotas", () => {
    it("should clear quota for a specific model", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );
      store.dispatch(clearQuota("model-a"));
      expect(selectQuotaForModel(store.getState(), "model-a")).toBeNull();
    });

    it("should clear all quotas", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );
      store.dispatch(
        updateQuota({
          modelId: "model-b",
          quotaInfo: { ...sampleQuota, model_id: "model-b" }
        })
      );
      store.dispatch(clearAllQuotas());
      expect(selectAllQuotas(store.getState())).toHaveLength(0);
    });
  });

  describe("decrementResetTimers", () => {
    it("should decrement reset_in_seconds by 1", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );

      store.dispatch(decrementResetTimers());

      const quota = selectQuotaForModel(store.getState(), "model-a");
      expect(quota!.reset_in_seconds).toBe(44);
    });

    it("should not go below 0", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({
          modelId: "model-a",
          quotaInfo: { ...sampleQuota, reset_in_seconds: 0 }
        })
      );

      store.dispatch(decrementResetTimers());

      const quota = selectQuotaForModel(store.getState(), "model-a");
      expect(quota!.reset_in_seconds).toBe(0);
    });

    it("should handle undefined reset_in_seconds gracefully", () => {
      const store = createStore();
      const { ...noReset } = sampleQuota;
      delete (noReset as Record<string, unknown>).reset_in_seconds;
      store.dispatch(
        updateQuota({
          modelId: "model-a",
          quotaInfo: noReset as typeof sampleQuota
        })
      );

      expect(() => store.dispatch(decrementResetTimers())).not.toThrow();
    });

    it("should decrement across multiple models", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({
          modelId: "model-a",
          quotaInfo: { ...sampleQuota, reset_in_seconds: 10 }
        })
      );
      store.dispatch(
        updateQuota({
          modelId: "model-b",
          quotaInfo: {
            ...sampleQuota,
            model_id: "model-b",
            reset_in_seconds: 5
          }
        })
      );

      store.dispatch(decrementResetTimers());

      expect(
        selectQuotaForModel(store.getState(), "model-a")!.reset_in_seconds
      ).toBe(9);
      expect(
        selectQuotaForModel(store.getState(), "model-b")!.reset_in_seconds
      ).toBe(4);
    });
  });

  describe("polling state", () => {
    it("setPolling should update isPolling", () => {
      const store = createStore();
      store.dispatch(setPolling(true));
      expect(store.getState().bedrockQuota.isPolling).toBe(true);

      store.dispatch(setPolling(false));
      expect(store.getState().bedrockQuota.isPolling).toBe(false);
    });

    it("setPollingConfig should update interval and reason", () => {
      const store = createStore();
      store.dispatch(
        setPollingConfig({ interval: 5000, reason: "active_chat" })
      );

      expect(store.getState().bedrockQuota.currentPollingInterval).toBe(5000);
      expect(store.getState().bedrockQuota.pollingReason).toBe("active_chat");
    });
  });

  describe("selectors", () => {
    it("selectQuotaForModel should return null for unknown model", () => {
      const store = createStore();
      expect(selectQuotaForModel(store.getState(), "unknown")).toBeNull();
    });

    it("selectAllQuotas should return all quota entries", () => {
      const store = createStore();
      store.dispatch(
        updateQuota({ modelId: "model-a", quotaInfo: sampleQuota })
      );
      store.dispatch(
        updateQuota({
          modelId: "model-b",
          quotaInfo: { ...sampleQuota, model_id: "model-b" }
        })
      );

      expect(selectAllQuotas(store.getState())).toHaveLength(2);
    });
  });

  describe("getQuotaStatusColor", () => {
    it("should return 'success' for usage < 60%", () => {
      expect(getQuotaStatusColor(0)).toBe("success");
      expect(getQuotaStatusColor(59)).toBe("success");
    });

    it("should return 'warning' for usage 60-79%", () => {
      expect(getQuotaStatusColor(60)).toBe("warning");
      expect(getQuotaStatusColor(79)).toBe("warning");
    });

    it("should return 'danger' for usage >= 80%", () => {
      expect(getQuotaStatusColor(80)).toBe("danger");
      expect(getQuotaStatusColor(100)).toBe("danger");
    });
  });

  describe("getHighestUsagePercent", () => {
    it("should return 0 for null quota", () => {
      expect(getHighestUsagePercent(null)).toBe(0);
    });

    it("should return 0 when usage_percent is undefined", () => {
      expect(
        getHighestUsagePercent({
          has_limits: true,
          model_id: "m",
          last_updated: 0
        })
      ).toBe(0);
    });

    it("should return the higher of requests or tokens usage", () => {
      expect(
        getHighestUsagePercent({
          has_limits: true,
          model_id: "m",
          last_updated: 0,
          usage_percent: { requests: 30, tokens: 70 }
        })
      ).toBe(70);

      expect(
        getHighestUsagePercent({
          has_limits: true,
          model_id: "m",
          last_updated: 0,
          usage_percent: { requests: 90, tokens: 40 }
        })
      ).toBe(90);
    });
  });
});
