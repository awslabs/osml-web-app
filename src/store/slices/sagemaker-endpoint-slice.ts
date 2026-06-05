// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { sagemakerService } from "@/services/sagemaker-service";

export interface SageMakerEndpoint {
  name: string;
  status: string;
  creationTime: string | null;
}

export interface SageMakerEndpointState {
  endpoints: SageMakerEndpoint[];
  selectedEndpoint: string | null;
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
}

const initialState: SageMakerEndpointState = {
  endpoints: [],
  selectedEndpoint: null,
  isLoading: false,
  error: null,
  lastFetched: null
};

// Preferred default endpoint
const PREFERRED_DEFAULT_ENDPOINT = "sam3";

export const fetchSageMakerEndpoints = createAsyncThunk(
  "sagemakerEndpoint/fetchEndpoints",
  async (_, { rejectWithValue }) => {
    try {
      return await sagemakerService.getEndpoints();
    } catch (error) {
      return rejectWithValue(
        error instanceof Error
          ? error.message
          : "Failed to fetch SageMaker endpoints"
      );
    }
  }
);

const sagemakerEndpointSlice = createSlice({
  name: "sagemakerEndpoint",
  initialState,
  reducers: {
    setSelectedEndpoint: (state, action: PayloadAction<string | null>) => {
      state.selectedEndpoint = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
    clearEndpoints: (state) => {
      state.endpoints = [];
      state.selectedEndpoint = null;
      state.lastFetched = null;
      state.error = null;
      state.isLoading = false;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSageMakerEndpoints.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchSageMakerEndpoints.fulfilled, (state, action) => {
        state.isLoading = false;
        state.endpoints = action.payload;
        state.lastFetched = Date.now();
        state.error = null;

        // Auto-select default endpoint if none selected
        if (action.payload.length > 0 && !state.selectedEndpoint) {
          // Prefer sam3 if available
          const preferredEndpoint = action.payload.find(
            (ep) => ep.name === PREFERRED_DEFAULT_ENDPOINT
          );

          if (preferredEndpoint) {
            state.selectedEndpoint = preferredEndpoint.name;
          } else {
            // Fallback to first available endpoint
            state.selectedEndpoint = action.payload[0].name;
          }
        }
      })
      .addCase(fetchSageMakerEndpoints.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
        state.endpoints = [];
        state.selectedEndpoint = null;
      });
  }
});

export const { setSelectedEndpoint, clearError, clearEndpoints } =
  sagemakerEndpointSlice.actions;

export default sagemakerEndpointSlice.reducer;
