// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ThrottleInfo {
  isThrottled: boolean;
  errorType: "rate_limit" | "service_unavailable" | null;
  message: string;
  retryAfterSeconds: number;
  modelId: string;
  timestamp: string;
  retryAt: number; // Unix timestamp when retry is allowed
}

export interface BedrockThrottleState {
  throttleByModel: {
    [modelId: string]: ThrottleInfo;
  };
}

const initialState: BedrockThrottleState = {
  throttleByModel: {}
};

const bedrockThrottleSlice = createSlice({
  name: "bedrockThrottle",
  initialState,
  reducers: {
    setThrottled: (
      state,
      action: PayloadAction<{
        modelId: string;
        errorType: "rate_limit" | "service_unavailable";
        message: string;
        retryAfterSeconds: number;
        timestamp: string;
      }>
    ) => {
      const { modelId, errorType, message, retryAfterSeconds, timestamp } =
        action.payload;

      const retryAt = Date.now() + retryAfterSeconds * 1000;

      const throttleInfo: ThrottleInfo = {
        isThrottled: true,
        errorType,
        message,
        retryAfterSeconds,
        modelId,
        timestamp,
        retryAt
      };

      // Set per-model throttle
      state.throttleByModel[modelId] = throttleInfo;
    },

    clearThrottle: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;

      // Clear per-model throttle
      if (state.throttleByModel[modelId]) {
        delete state.throttleByModel[modelId];
      }
    },

    clearAllThrottles: (state) => {
      state.throttleByModel = {};
    },

    // Auto-clear expired throttles
    clearExpiredThrottles: (state) => {
      const now = Date.now();

      // Clear expired per-model throttles
      Object.keys(state.throttleByModel).forEach((modelId) => {
        if (state.throttleByModel[modelId].retryAt <= now) {
          delete state.throttleByModel[modelId];
        }
      });
    }
  }
});

export const {
  setThrottled,
  clearThrottle,
  clearAllThrottles,
  clearExpiredThrottles
} = bedrockThrottleSlice.actions;

// Selectors
export const selectThrottleForModel = (
  state: { bedrockThrottle: BedrockThrottleState },
  modelId: string
): ThrottleInfo | null => {
  // Only check model-specific throttle (no global throttle)
  return state.bedrockThrottle.throttleByModel[modelId] || null;
};

export const selectIsAnyModelThrottled = (state: {
  bedrockThrottle: BedrockThrottleState;
}): boolean => {
  return Object.values(state.bedrockThrottle.throttleByModel).some(
    (throttle) => throttle.isThrottled
  );
};

export default bedrockThrottleSlice.reducer;
