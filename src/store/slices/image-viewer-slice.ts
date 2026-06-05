// Copyright Amazon.com, Inc. or its affiliates.
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { viewpointService } from "@/services/viewpoint-service.ts";
import { LoadingStatus } from "@/types/loading-status";
import {
  CreateViewpointForm,
  CreateViewpointRequest,
  SelectedViewpoint,
  Viewpoint,
  ViewpointBounds,
  ViewpointInfo,
  ViewpointMetadata,
  ViewpointStatistics
} from "@/types/viewpoint";
import {
  clampAdjustment,
  DEFAULT_ADJUSTMENTS,
  ImageAdjustments
} from "@/utils/image-adjustments";

export interface ImageViewerState {
  selectedViewpoint: SelectedViewpoint | null;
  viewpointsStatus: LoadingStatus;
  viewpointsError: string | null;
  viewpoints: Viewpoint[];
  viewpointBoundsStatus: LoadingStatus;
  viewpointBoundsError: string | null;
  viewpointBounds: ViewpointBounds;
  viewpointMetadataStatus: LoadingStatus;
  viewpointMetadataError: string | null;
  viewpointMetadata: ViewpointMetadata;
  viewpointInfoStatus: LoadingStatus;
  viewpointInfoError: string | null;
  viewpointInfo: ViewpointInfo;
  viewpointStatisticsStatus: LoadingStatus;
  viewpointStatisticsError: string | null;
  viewpointStatistics: ViewpointStatistics;
  // Image adjustment state
  currentAdjustments: ImageAdjustments;
  adjustmentsByViewpoint: Record<string, ImageAdjustments>;
}

// Action payload types
export interface SetAdjustmentPayload {
  key: keyof ImageAdjustments;
  value: number;
}

const initialState: ImageViewerState = {
  selectedViewpoint: null,
  viewpointsStatus: LoadingStatus.Success,
  viewpointsError: null,
  viewpoints: [],
  viewpointBoundsStatus: LoadingStatus.Success,
  viewpointBoundsError: null,
  viewpointBounds: { bounds: [] },
  viewpointMetadataStatus: LoadingStatus.Success,
  viewpointMetadataError: null,
  viewpointMetadata: { metadata: null },
  viewpointInfoStatus: LoadingStatus.Success,
  viewpointInfoError: null,
  viewpointInfo: { type: "", features: [] },
  viewpointStatisticsStatus: LoadingStatus.Success,
  viewpointStatisticsError: null,
  viewpointStatistics: { image_statistics: null },
  // Image adjustment state
  currentAdjustments: { ...DEFAULT_ADJUSTMENTS },
  adjustmentsByViewpoint: {}
};

export const fetchViewpoints = createAsyncThunk(
  "imageViewer/fetchViewpoints",
  async () => await viewpointService.getViewpoints()
);

export const fetchViewpointBounds = createAsyncThunk(
  "imageViewer/fetchViewpointBounds",
  async (viewpointId: string) =>
    await viewpointService.getViewpointBounds(viewpointId)
);

export const fetchViewpointMetadata = createAsyncThunk(
  "imageViewer/fetchViewpointMetadata",
  async (viewpointId: string) =>
    await viewpointService.getViewpointMetadata(viewpointId)
);

export const fetchViewpointInfo = createAsyncThunk(
  "imageViewer/fetchViewpointInfo",
  async (viewpointId: string) =>
    await viewpointService.getViewpointInfo(viewpointId)
);

export const fetchViewpointStatistics = createAsyncThunk(
  "imageViewer/fetchViewpointStatistics",
  async (viewpointId: string) =>
    await viewpointService.getViewpointStatistics(viewpointId)
);

export const deleteViewpoint = createAsyncThunk(
  "imageViewer/deleteViewpoint",
  async (viewpointId: string) => {
    await viewpointService.deleteViewpoint(viewpointId);

    return viewpointId;
  }
);

export const createViewpoint = createAsyncThunk(
  "imageViewer/createViewpoint",
  async (formData: CreateViewpointForm) => {
    // Transform the form data to match the API's expected format
    const requestData: CreateViewpointRequest = {
      viewpoint_name: formData.viewpointName,
      viewpoint_id: formData.viewpointId,
      bucket_name: formData.bucketName,
      object_key: formData.objectKey,
      tile_size: formData.tileSize,
      range_adjustment: formData.rangeAdjustment
    };

    return await viewpointService.createViewpoint(requestData);
  }
);

const imageViewerSlice = createSlice({
  name: "imageViewer",
  initialState,
  reducers: {
    setSelectedViewpoint: (
      state,
      action: PayloadAction<SelectedViewpoint | null>
    ) => {
      state.selectedViewpoint = action.payload;
    },
    /**
     * Updates a single adjustment value, clamping it to valid range.
     * Requirements: 2.1, 3.1, 4.1, 5.1, 6.1
     */
    setAdjustment: (state, action: PayloadAction<SetAdjustmentPayload>) => {
      const { key, value } = action.payload;
      state.currentAdjustments[key] = clampAdjustment(key, value);
    },
    /**
     * Updates all adjustment values at once, clamping each to valid range.
     * Requirements: 2.1, 3.1, 4.1, 5.1, 6.1
     */
    setAllAdjustments: (state, action: PayloadAction<ImageAdjustments>) => {
      const adjustments = action.payload;
      (Object.keys(adjustments) as (keyof ImageAdjustments)[]).forEach(
        (key) => {
          state.currentAdjustments[key] = clampAdjustment(
            key,
            adjustments[key]
          );
        }
      );
    },
    /**
     * Resets all adjustments to their default values.
     * Requirements: 7.1
     */
    resetAdjustments: (state) => {
      state.currentAdjustments = { ...DEFAULT_ADJUSTMENTS };
    },
    /**
     * Saves current adjustments for a specific viewpoint.
     * Requirements: 9.4
     */
    saveViewpointAdjustments: (state, action: PayloadAction<string>) => {
      const viewpointId = action.payload;
      state.adjustmentsByViewpoint[viewpointId] = {
        ...state.currentAdjustments
      };
    },
    /**
     * Loads saved adjustments for a specific viewpoint, or defaults if none exist.
     * Requirements: 9.5, 9.6
     */
    loadViewpointAdjustments: (state, action: PayloadAction<string>) => {
      const viewpointId = action.payload;
      // Use Object.hasOwn to avoid prototype pollution issues with keys like "constructor"
      if (Object.hasOwn(state.adjustmentsByViewpoint, viewpointId)) {
        state.currentAdjustments = {
          ...state.adjustmentsByViewpoint[viewpointId]
        };
      } else {
        state.currentAdjustments = { ...DEFAULT_ADJUSTMENTS };
      }
    },
    /**
     * Clears saved adjustments for a specific viewpoint.
     * Requirements: 9.8
     */
    clearViewpointAdjustments: (state, action: PayloadAction<string>) => {
      const viewpointId = action.payload;
      delete state.adjustmentsByViewpoint[viewpointId];
    }
  },
  extraReducers: (builder) => {
    builder
      // Viewpoints
      .addCase(fetchViewpoints.pending, (state) => {
        state.viewpointsStatus = LoadingStatus.Loading;
      })
      .addCase(fetchViewpoints.fulfilled, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Success;
        state.viewpoints = action.payload;
      })
      .addCase(fetchViewpoints.rejected, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Error;
        state.viewpointsError =
          action.error.message || "Failed to fetch viewpoints";
      })
      // Bounds
      .addCase(fetchViewpointBounds.pending, (state) => {
        state.viewpointBoundsStatus = LoadingStatus.Loading;
      })
      .addCase(fetchViewpointBounds.fulfilled, (state, action) => {
        state.viewpointBoundsStatus = LoadingStatus.Success;
        state.viewpointBounds = action.payload;
      })
      .addCase(fetchViewpointBounds.rejected, (state, action) => {
        state.viewpointBoundsStatus = LoadingStatus.Error;
        state.viewpointBoundsError =
          action.error.message || "Failed to fetch viewpoint bounds";
      })
      // Metadata
      .addCase(fetchViewpointMetadata.pending, (state) => {
        state.viewpointMetadataStatus = LoadingStatus.Loading;
      })
      .addCase(fetchViewpointMetadata.fulfilled, (state, action) => {
        state.viewpointMetadataStatus = LoadingStatus.Success;
        state.viewpointMetadata = action.payload;
      })
      .addCase(fetchViewpointMetadata.rejected, (state, action) => {
        state.viewpointMetadataStatus = LoadingStatus.Error;
        state.viewpointMetadataError =
          action.error.message || "Failed to fetch viewpoint metadata";
      })
      // Info
      .addCase(fetchViewpointInfo.pending, (state) => {
        state.viewpointInfoStatus = LoadingStatus.Loading;
      })
      .addCase(fetchViewpointInfo.fulfilled, (state, action) => {
        state.viewpointInfoStatus = LoadingStatus.Success;
        state.viewpointInfo = action.payload;
      })
      .addCase(fetchViewpointInfo.rejected, (state, action) => {
        state.viewpointInfoStatus = LoadingStatus.Error;
        state.viewpointInfoError =
          action.error.message || "Failed to fetch viewpoint info";
      })
      // Statistics
      .addCase(fetchViewpointStatistics.pending, (state) => {
        state.viewpointStatisticsStatus = LoadingStatus.Loading;
      })
      .addCase(fetchViewpointStatistics.fulfilled, (state, action) => {
        state.viewpointStatisticsStatus = LoadingStatus.Success;
        state.viewpointStatistics = action.payload;
      })
      .addCase(fetchViewpointStatistics.rejected, (state, action) => {
        state.viewpointStatisticsStatus = LoadingStatus.Error;
        state.viewpointStatisticsError =
          action.error.message || "Failed to fetch viewpoint statistics";
      })
      // Delete Viewpoint
      .addCase(deleteViewpoint.pending, (state) => {
        state.viewpointsStatus = LoadingStatus.Loading;
      })
      .addCase(deleteViewpoint.fulfilled, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Success;
        state.viewpoints = state.viewpoints.filter(
          (v) => v.viewpoint_id !== action.payload
        );
        // Clean up saved adjustments for the deleted viewpoint (Requirement 9.8)
        delete state.adjustmentsByViewpoint[action.payload];
      })
      .addCase(deleteViewpoint.rejected, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Error;
        state.viewpointsError =
          action.error.message || "Failed to delete viewpoint";
      })
      // Create Viewpoint
      .addCase(createViewpoint.pending, (state) => {
        state.viewpointsStatus = LoadingStatus.Loading;
      })
      .addCase(createViewpoint.fulfilled, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Success;
        state.viewpoints.push(action.payload);
      })
      .addCase(createViewpoint.rejected, (state, action) => {
        state.viewpointsStatus = LoadingStatus.Error;
        state.viewpointsError =
          action.error.message || "Failed to create viewpoint";
      });
  }
});

export const {
  setSelectedViewpoint,
  setAdjustment,
  setAllAdjustments,
  resetAdjustments,
  saveViewpointAdjustments,
  loadViewpointAdjustments,
  clearViewpointAdjustments
} = imageViewerSlice.actions;
export default imageViewerSlice.reducer;
