// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { BedrockModel, bedrockModelsService } from "@/services/bedrock-service";

export interface BedrockModelState {
  availableModels: BedrockModel[];
  selectedModel: BedrockModel | null;
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
  connectionStatus: "disconnected" | "connecting" | "connected" | "failed";
}

const initialState: BedrockModelState = {
  availableModels: [],
  selectedModel: null,
  isLoading: false,
  error: null,
  lastFetched: null,
  connectionStatus: "disconnected"
};

// Async thunk to fetch available models
export const fetchAvailableModels = createAsyncThunk(
  "bedrockModel/fetchAvailableModels",
  async (_, { rejectWithValue }) => {
    try {
      const models = await bedrockModelsService.getAvailableModels();

      return models;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch models"
      );
    }
  }
);

const bedrockModelSlice = createSlice({
  name: "bedrockModel",
  initialState,
  reducers: {
    setSelectedModel: (state, action: PayloadAction<BedrockModel | null>) => {
      state.selectedModel = action.payload;
      // Reset connection status when model changes
      if (action.payload) {
        state.connectionStatus = "disconnected";
      }
    },
    clearError: (state) => {
      state.error = null;
    },
    // Connection status management
    setConnectionStatus: (
      state,
      action: PayloadAction<
        "disconnected" | "connecting" | "connected" | "failed"
      >
    ) => {
      state.connectionStatus = action.payload;
    },
    // Clear models and selected model (useful on logout)
    clearModels: (state) => {
      state.availableModels = [];
      state.selectedModel = null;
      state.lastFetched = null;
      state.error = null;
      state.isLoading = false;
      state.connectionStatus = "disconnected";
    },
    // Set default model (typically Claude Opus 4.6 if available)
    setDefaultModel: (state) => {
      if (state.availableModels.length > 0 && !state.selectedModel) {
        // Prefer Claude Opus 4.6 if available
        const claudeOpus46 = state.availableModels.find((model) =>
          model.modelId.includes("claude-opus-4-6")
        );

        if (claudeOpus46) {
          state.selectedModel = claudeOpus46;
        } else {
          // Fallback to first Claude model, then first available model
          const claudeModel = state.availableModels.find((model) =>
            model.modelId.includes("claude")
          );

          state.selectedModel = claudeModel || state.availableModels[0];
        }
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAvailableModels.pending, (state) => {
        state.isLoading = true;
        state.error = null;
        // Don't clear selected model during loading - preserve user's selection
      })
      .addCase(fetchAvailableModels.fulfilled, (state, action) => {
        state.isLoading = false;
        state.availableModels = action.payload;
        state.lastFetched = Date.now();
        state.error = null;

        // Auto-select default model if none selected
        if (action.payload.length > 0 && !state.selectedModel) {
          // Prefer Claude Opus 4.6 if available
          const claudeOpus46 = action.payload.find((model) =>
            model.modelId.includes("claude-opus-4-6")
          );

          if (claudeOpus46) {
            state.selectedModel = claudeOpus46;
          } else {
            // Fallback to first Claude model, then first available model
            const claudeModel = action.payload.find((model) =>
              model.modelId.includes("claude")
            );

            state.selectedModel = claudeModel || action.payload[0];
          }
        }
      })
      .addCase(fetchAvailableModels.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });
  }
});

export const {
  setSelectedModel,
  clearError,
  clearModels,
  setDefaultModel,
  setConnectionStatus
} = bedrockModelSlice.actions;

export default bedrockModelSlice.reducer;
