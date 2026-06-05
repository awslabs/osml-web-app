// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for bedrock-throttle-slice.ts.
 * Covers throttle state transitions, per-model tracking, expiration clearing,
 * and selectors.
 */

import { configureStore } from "@reduxjs/toolkit";

import bedrockThrottleReducer, {
  clearExpiredThrottles,
  clearThrottle,
  selectThrottleForModel,
  setThrottled
} from "@/store/slices/bedrock-throttle-slice";

const createStore = () =>
  configureStore({ reducer: { bedrockThrottle: bedrockThrottleReducer } });

describe("bedrock-throttle-slice", () => {
  describe("setThrottled", () => {
    it("should set throttle info for a model", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "model-a",
          errorType: "rate_limit",
          message: "Too many requests",
          retryAfterSeconds: 30,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      const throttle = selectThrottleForModel(store.getState(), "model-a");
      expect(throttle).not.toBeNull();
      expect(throttle!.isThrottled).toBe(true);
      expect(throttle!.errorType).toBe("rate_limit");
      expect(throttle!.retryAfterSeconds).toBe(30);
      expect(throttle!.retryAt).toBeGreaterThan(Date.now() - 1000);
    });

    it("should support service_unavailable error type", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "model-b",
          errorType: "service_unavailable",
          message: "Service down",
          retryAfterSeconds: 60,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      const throttle = selectThrottleForModel(store.getState(), "model-b");
      expect(throttle!.errorType).toBe("service_unavailable");
    });

    it("should overwrite existing throttle for same model", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "model-a",
          errorType: "rate_limit",
          message: "First",
          retryAfterSeconds: 10,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );
      store.dispatch(
        setThrottled({
          modelId: "model-a",
          errorType: "service_unavailable",
          message: "Second",
          retryAfterSeconds: 60,
          timestamp: "2025-01-01T00:01:00Z"
        })
      );

      const throttle = selectThrottleForModel(store.getState(), "model-a");
      expect(throttle!.message).toBe("Second");
      expect(throttle!.errorType).toBe("service_unavailable");
    });
  });

  describe("clearThrottle", () => {
    it("should clear throttle for a specific model", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "model-a",
          errorType: "rate_limit",
          message: "Throttled",
          retryAfterSeconds: 30,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      store.dispatch(clearThrottle("model-a"));
      expect(selectThrottleForModel(store.getState(), "model-a")).toBeNull();
    });

    it("should not affect other models", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "model-a",
          errorType: "rate_limit",
          message: "A",
          retryAfterSeconds: 30,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );
      store.dispatch(
        setThrottled({
          modelId: "model-b",
          errorType: "rate_limit",
          message: "B",
          retryAfterSeconds: 30,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      store.dispatch(clearThrottle("model-a"));
      expect(selectThrottleForModel(store.getState(), "model-a")).toBeNull();
      expect(
        selectThrottleForModel(store.getState(), "model-b")
      ).not.toBeNull();
    });

    it("should be a no-op for non-existent model", () => {
      const store = createStore();
      expect(() => store.dispatch(clearThrottle("nonexistent"))).not.toThrow();
    });
  });

  describe("clearExpiredThrottles", () => {
    it("should clear throttles whose retryAt is in the past", () => {
      const store = createStore();
      // Set a throttle with 0 seconds (already expired)
      store.dispatch(
        setThrottled({
          modelId: "expired",
          errorType: "rate_limit",
          message: "Expired",
          retryAfterSeconds: 0,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      store.dispatch(clearExpiredThrottles());
      expect(selectThrottleForModel(store.getState(), "expired")).toBeNull();
    });

    it("should keep throttles that have not expired", () => {
      const store = createStore();
      store.dispatch(
        setThrottled({
          modelId: "active",
          errorType: "rate_limit",
          message: "Active",
          retryAfterSeconds: 9999,
          timestamp: "2025-01-01T00:00:00Z"
        })
      );

      store.dispatch(clearExpiredThrottles());
      expect(selectThrottleForModel(store.getState(), "active")).not.toBeNull();
    });
  });

  describe("selectors", () => {
    it("selectThrottleForModel should return null for unknown model", () => {
      const store = createStore();
      expect(selectThrottleForModel(store.getState(), "unknown")).toBeNull();
    });
  });
});
