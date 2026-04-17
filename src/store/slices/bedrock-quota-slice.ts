// Copyright Amazon.com, Inc. or its affiliates.
import { createSelector, createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface QuotaLimits {
  requests_per_minute: number;
  tokens_per_minute: number; // Effective token limit (backend applies 5x burndown for output tokens)
}

export interface QuotaUsage {
  requests_used: number;
  tokens_used: number; // Effective tokens with burndown rate already applied by backend
  window_start: number;
}

export interface QuotaRemaining {
  requests: number;
  tokens: number;
}

export interface QuotaUsagePercent {
  requests: number;
  tokens: number;
}

export interface ModelQuotaInfo {
  has_limits: boolean;
  model_id: string;
  limits?: QuotaLimits;
  usage?: QuotaUsage;
  remaining?: QuotaRemaining;
  usage_percent?: QuotaUsagePercent;
  reset_in_seconds?: number;
  last_updated: number; // Local timestamp
}

export interface BedrockQuotaState {
  quotaByModel: {
    [modelId: string]: ModelQuotaInfo;
  };
  isPolling: boolean;
  currentPollingInterval: number;
  pollingReason: string;
}

const initialState: BedrockQuotaState = {
  quotaByModel: {},
  isPolling: false,
  currentPollingInterval: 0,
  pollingReason: "not_started"
};

const bedrockQuotaSlice = createSlice({
  name: "bedrockQuota",
  initialState,
  reducers: {
    updateQuota: (
      state,
      action: PayloadAction<{
        modelId: string;
        quotaInfo: Omit<ModelQuotaInfo, "last_updated">;
      }>
    ) => {
      const { modelId, quotaInfo } = action.payload;

      state.quotaByModel[modelId] = {
        ...quotaInfo,
        last_updated: Date.now()
      };
    },

    clearQuota: (state, action: PayloadAction<string>) => {
      const modelId = action.payload;

      if (state.quotaByModel[modelId]) {
        delete state.quotaByModel[modelId];
      }
    },

    clearAllQuotas: (state) => {
      state.quotaByModel = {};
    },

    // Decrease reset_in_seconds for UI countdown (called by interval)
    decrementResetTimers: (state) => {
      Object.keys(state.quotaByModel).forEach((modelId) => {
        const quota = state.quotaByModel[modelId];

        if (
          quota.reset_in_seconds !== undefined &&
          quota.reset_in_seconds > 0
        ) {
          quota.reset_in_seconds = Math.max(0, quota.reset_in_seconds - 1);
        }
      });
    },

    setPolling: (state, action: PayloadAction<boolean>) => {
      state.isPolling = action.payload;
    },

    setPollingConfig: (
      state,
      action: PayloadAction<{ interval: number; reason: string }>
    ) => {
      state.currentPollingInterval = action.payload.interval;
      state.pollingReason = action.payload.reason;
    }
  }
});

export const {
  updateQuota,
  clearQuota,
  clearAllQuotas,
  decrementResetTimers,
  setPolling,
  setPollingConfig
} = bedrockQuotaSlice.actions;

// Selectors
export const selectQuotaForModel = (
  state: { bedrockQuota: BedrockQuotaState },
  modelId: string
): ModelQuotaInfo | null => {
  return state.bedrockQuota.quotaByModel[modelId] || null;
};

export const selectAllQuotas = createSelector(
  [
    (state: { bedrockQuota: BedrockQuotaState }) =>
      state.bedrockQuota.quotaByModel
  ],
  (quotaByModel): ModelQuotaInfo[] => Object.values(quotaByModel)
);

// Helper to determine quota status color
export const getQuotaStatusColor = (
  usagePercent: number
): "success" | "warning" | "danger" => {
  if (usagePercent >= 80) return "danger";
  if (usagePercent >= 60) return "warning";

  return "success";
};

// Helper to get the highest usage percent (requests or tokens)
export const getHighestUsagePercent = (
  quota: ModelQuotaInfo | null
): number => {
  if (!quota?.usage_percent) return 0;

  return Math.max(
    quota.usage_percent.requests || 0,
    quota.usage_percent.tokens || 0
  );
};

export default bedrockQuotaSlice.reducer;
