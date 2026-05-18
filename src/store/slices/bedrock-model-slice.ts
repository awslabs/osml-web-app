// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { BedrockModel, bedrockModelsService } from "@/services/bedrock-service";
import type { RootState } from "@/store/store";

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

/**
 * Pick the default Bedrock model from a list. When `preferredModelId` is
 * present in `models`, returns that model; otherwise returns `models[0]`.
 * Returns `null` when `models` is empty.
 */
export function selectDefaultBedrockModel(
  models: BedrockModel[],
  preferredModelId?: string | null
): BedrockModel | null {
  if (models.length === 0) return null;

  if (preferredModelId) {
    const preferred = models.find((m) => m.modelId === preferredModelId);
    if (preferred) return preferred;
  }

  return models[0];
}

export const fetchAvailableModels = createAsyncThunk<
  { models: BedrockModel[]; preferredModelId: string | null },
  void,
  { state: RootState; rejectValue: string }
>(
  "bedrockModel/fetchAvailableModels",
  async (_, { getState, rejectWithValue }) => {
    try {
      const models = await bedrockModelsService.getAvailableModels();
      const preferredModelId =
        getState().settings.preferredModel?.modelId ?? null;
      return { models, preferredModelId };
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
    setConnectionStatus: (
      state,
      action: PayloadAction<
        "disconnected" | "connecting" | "connected" | "failed"
      >
    ) => {
      state.connectionStatus = action.payload;
    },
    clearModels: (state) => {
      state.availableModels = [];
      state.selectedModel = null;
      state.lastFetched = null;
      state.error = null;
      state.isLoading = false;
      state.connectionStatus = "disconnected";
    },
    /**
     * Seed `selectedModel` from `availableModels[0]` when nothing is
     * selected. Does not consult the user preference; that path runs
     * through `fetchAvailableModels.fulfilled`.
     */
    setDefaultModel: (state) => {
      if (state.selectedModel) return;
      state.selectedModel = selectDefaultBedrockModel(state.availableModels);
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
        const { models, preferredModelId } = action.payload;
        state.isLoading = false;
        state.availableModels = models;
        state.lastFetched = Date.now();
        state.error = null;

        if (!state.selectedModel) {
          state.selectedModel = selectDefaultBedrockModel(
            models,
            preferredModelId
          );
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
