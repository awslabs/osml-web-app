// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import {
  AnalyticsFilter,
  AnalyticsState,
  ColorMode
} from "@/utils/analytics/types";

const initialState: AnalyticsState = {
  colorMode: "layer",
  activeFilters: [],
  selectedLayerIds: [],
  confidenceThreshold: 0
};

const analyticsSlice = createSlice({
  name: "analytics",
  initialState,
  reducers: {
    setColorMode(state, action: PayloadAction<ColorMode>) {
      state.colorMode = action.payload;
    },
    addFilter(state, action: PayloadAction<AnalyticsFilter>) {
      const exists = state.activeFilters.some(
        (f) => f.id === action.payload.id
      );
      if (!exists) {
        state.activeFilters.push(action.payload);
      }
    },
    removeFilter(state, action: PayloadAction<string>) {
      state.activeFilters = state.activeFilters.filter(
        (f) => f.id !== action.payload
      );
    },
    clearFilters(state) {
      state.activeFilters = [];
    },
    toggleLayerSelection(state, action: PayloadAction<string>) {
      const idx = state.selectedLayerIds.indexOf(action.payload);
      if (idx >= 0) {
        state.selectedLayerIds.splice(idx, 1);
      } else if (state.selectedLayerIds.length < 2) {
        state.selectedLayerIds.push(action.payload);
      } else {
        // Replace oldest (first) entry
        state.selectedLayerIds.shift();
        state.selectedLayerIds.push(action.payload);
      }
    },
    setConfidenceThreshold(state, action: PayloadAction<number>) {
      state.confidenceThreshold = Math.max(0, Math.min(1, action.payload));
    }
  }
});

export const {
  setColorMode,
  addFilter,
  removeFilter,
  clearFilters,
  toggleLayerSelection,
  setConfidenceThreshold
} = analyticsSlice.actions;

export default analyticsSlice.reducer;
