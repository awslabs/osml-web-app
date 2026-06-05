// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Viewpoint, ViewpointExtent } from "@/types/viewpoint";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ViewpointData {
  jobId: string;
  viewpoint: Viewpoint;
  extent?: ViewpointExtent;
  loaded: boolean;
  error?: string;
  isPolling?: boolean;
  pollStartTime?: number;
}

export interface ImageryState {
  viewpointData: Record<string, ViewpointData>;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: ImageryState = {
  viewpointData: {}
};

// ─── Slice ───────────────────────────────────────────────────────────────────

export const imagerySlice = createSlice({
  name: "imagery",
  initialState,
  reducers: {
    setViewpointData: (state, action: PayloadAction<ViewpointData>) => {
      state.viewpointData[action.payload.jobId] = action.payload;
    },
    setViewpointExtent: (
      state,
      action: PayloadAction<{ jobId: string; extent: ViewpointExtent }>
    ) => {
      if (state.viewpointData[action.payload.jobId]) {
        state.viewpointData[action.payload.jobId].extent =
          action.payload.extent;
      }
    },
    setViewpointError: (
      state,
      action: PayloadAction<{ jobId: string; error: string }>
    ) => {
      state.viewpointData[action.payload.jobId] = {
        jobId: action.payload.jobId,
        viewpoint: {
          viewpoint_id: action.payload.jobId,
          viewpoint_name: "",
          viewpoint_status: "ERROR",
          bucket_name: "",
          object_key: "",
          tile_size: 0,
          range_adjustment: "",
          local_object_path: "",
          error_message: action.payload.error,
          expire_time: 0
        },
        loaded: true,
        isPolling: false,
        error: action.payload.error
      };
    },
    removeViewpointData: (state, action: PayloadAction<{ jobId: string }>) => {
      delete state.viewpointData[action.payload.jobId];
    },
    clearAllViewpointData: (state) => {
      state.viewpointData = {};
    }
  }
});

// ─── Action Creators ─────────────────────────────────────────────────────────

export const {
  setViewpointData,
  setViewpointExtent,
  setViewpointError,
  removeViewpointData,
  clearAllViewpointData
} = imagerySlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

// Use a local state shape to avoid circular import with store.ts
interface StateWithImagery {
  imagery: ImageryState;
}

export const selectViewpointData = (state: StateWithImagery) =>
  state.imagery.viewpointData;

export const selectViewpointForJob = (state: StateWithImagery, jobId: string) =>
  state.imagery.viewpointData[jobId] as ViewpointData | undefined;

export const selectReadyViewpoints = (
  state: StateWithImagery
): ViewpointData[] =>
  Object.values(state.imagery.viewpointData).filter(
    (vp) => vp.loaded && vp.viewpoint.viewpoint_status === "READY"
  );

// ─── Default Export ──────────────────────────────────────────────────────────

export default imagerySlice.reducer;
