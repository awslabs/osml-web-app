// Copyright Amazon.com, Inc. or its affiliates.
import {
  AnyAction,
  createAsyncThunk,
  createSlice,
  Middleware,
  PayloadAction
} from "@reduxjs/toolkit";
import type { FeatureCollection } from "geojson";

import {
  dataCatalogService,
  StacSearchResponse
} from "@/services/data-catalog-service.ts";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import {
  deleteJob as deleteJobFromBackend,
  DeleteJobResult,
  fetchAllJobs,
  isJobComplete
} from "@/services/job-management";
import { ImageProcessingJob } from "@/services/model-runner-service.ts";
import { s3Service } from "@/services/s3-service.ts";
import { viewpointService } from "@/services/viewpoint-service.ts";
import { AppDispatch, RootState } from "@/store/store.ts";
import { CLASSIFICATION_PALETTE } from "@/utils/analytics/types";

import {
  removeViewpointData,
  setViewpointData,
  setViewpointError
} from "./imagery-slice";
import { addLayer, removeLayer, updateLayerMetadata } from "./overlay-slice";

// ─── Constants ───────────────────────────────────────────────────────────────

export const JOB_POLL_INTERVAL = 10000; // 10 seconds
export const DETECTION_POLL_INTERVAL = 5000; // 5 seconds
export const DETECTION_MAX_POLL_DURATION = 300000; // 5 minutes
export const DETECTION_COLLECTION = "model-runner-detections";
const VIEWPOINT_POLL_INTERVAL = 5000; // 5 seconds

export const DEFAULT_RESULT_STYLE: VectorStyle = {
  color: CLASSIFICATION_PALETTE[0],
  opacity: 0.5
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorStyle {
  color: string; // HTML color string (e.g., '#ff0000')
  opacity: number; // 0-1 value
}

export interface JobsListState {
  jobs: ImageProcessingJob[];
  customOrder: string[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
}

export interface JobSelectionState {
  selectedJobs: ImageProcessingJob[];
  layerStyles: Record<string, VectorStyle>;
}

export interface JobsState {
  jobsList: JobsListState;
  selection: JobSelectionState;
}

export interface JobSnapshot {
  job: ImageProcessingJob;
  orderIndex: number;
  wasSelected: boolean;
  layerStyle?: VectorStyle;
}

export interface DeleteJobParams {
  jobId: string;
  outputBucket?: string;
}

// Detection polling state for STAC catalog retrieval
interface DetectionPollingState {
  isPolling: boolean;
  pollStartTime: number;
  pollInterval: number;
  maxPollDuration: number;
  attempts: number;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: JobsState = {
  jobsList: {
    jobs: [],
    customOrder: [],
    isLoading: false,
    isRefreshing: false,
    error: null
  },
  selection: {
    selectedJobs: [],
    layerStyles: {}
  }
};

// ─── Async Thunks ────────────────────────────────────────────────────────────

export const fetchJobs = createAsyncThunk(
  "jobs/fetchJobs",
  async (options: { isManualRefresh?: boolean } = {}) => {
    const result = await fetchAllJobs();
    if (result.error) {
      throw new Error(result.error);
    }
    return {
      jobs: result.jobs,
      isManualRefresh: options.isManualRefresh ?? false
    };
  }
);

export const deleteJob = createAsyncThunk<
  { jobId: string; result: DeleteJobResult },
  DeleteJobParams,
  { state: RootState; rejectValue: { jobId: string; error: string } }
>(
  "jobs/deleteJob",
  async ({ jobId, outputBucket }: DeleteJobParams, { rejectWithValue }) => {
    const result = await deleteJobFromBackend(jobId, outputBucket);

    if (!result.success) {
      return rejectWithValue({
        jobId,
        error: result.error || "Failed to delete job"
      });
    }

    return { jobId, result };
  }
);

// ─── Slice ───────────────────────────────────────────────────────────────────

export const jobsSlice = createSlice({
  name: "jobs",
  initialState,
  reducers: {
    setSelectedJobs: (state, action: PayloadAction<ImageProcessingJob[]>) => {
      // Auto-assign palette colors to newly selected jobs that don't have a style yet
      const existingStyleIds = new Set(
        Object.keys(state.selection.layerStyles)
      );
      const usedColorIndices = new Set<number>();

      // Track which palette indices are already in use
      Object.values(state.selection.layerStyles).forEach((style) => {
        const idx = CLASSIFICATION_PALETTE.indexOf(style.color);
        if (idx >= 0) usedColorIndices.add(idx);
      });

      // Find the next available palette index
      let nextIdx = 0;
      for (const job of action.payload) {
        if (!existingStyleIds.has(job.job_id)) {
          // Find next unused palette color
          while (
            usedColorIndices.has(nextIdx % CLASSIFICATION_PALETTE.length) &&
            nextIdx < CLASSIFICATION_PALETTE.length * 2
          ) {
            nextIdx++;
          }
          state.selection.layerStyles[job.job_id] = {
            color:
              CLASSIFICATION_PALETTE[nextIdx % CLASSIFICATION_PALETTE.length],
            opacity: DEFAULT_RESULT_STYLE.opacity
          };
          usedColorIndices.add(nextIdx % CLASSIFICATION_PALETTE.length);
          nextIdx++;
        }
      }

      state.selection.selectedJobs = action.payload;
    },
    setJobsCustomOrder: (state, action: PayloadAction<string[]>) => {
      state.jobsList.customOrder = action.payload;
    },
    addJobToOrder: (state, action: PayloadAction<{ jobId: string }>) => {
      if (!state.jobsList.customOrder.includes(action.payload.jobId)) {
        state.jobsList.customOrder = [
          action.payload.jobId,
          ...state.jobsList.customOrder
        ];
      }
    },
    removeJobOptimistically: (
      state,
      action: PayloadAction<{ jobId: string }>
    ) => {
      const { jobId } = action.payload;

      state.jobsList.jobs = state.jobsList.jobs.filter(
        (j) => j.job_id !== jobId
      );
      state.jobsList.customOrder = state.jobsList.customOrder.filter(
        (id) => id !== jobId
      );
      state.selection.selectedJobs = state.selection.selectedJobs.filter(
        (j) => j.job_id !== jobId
      );
      delete state.selection.layerStyles[jobId];
    },
    restoreJob: (state, action: PayloadAction<JobSnapshot>) => {
      const { job, orderIndex, wasSelected, layerStyle } = action.payload;

      // Restore job to jobs list at original position if possible
      const currentJobs = [...state.jobsList.jobs];
      if (orderIndex >= 0 && orderIndex <= currentJobs.length) {
        currentJobs.splice(orderIndex, 0, job);
      } else {
        currentJobs.push(job);
      }
      state.jobsList.jobs = currentJobs;

      // Restore to custom order at original position if possible
      const currentOrder = [...state.jobsList.customOrder];
      if (orderIndex >= 0 && orderIndex <= currentOrder.length) {
        currentOrder.splice(orderIndex, 0, job.job_id);
      } else {
        currentOrder.push(job.job_id);
      }
      state.jobsList.customOrder = currentOrder;

      // Restore selection state if it was selected
      if (wasSelected) {
        state.selection.selectedJobs = [...state.selection.selectedJobs, job];
      }

      // Restore layer style if it existed
      if (layerStyle) {
        state.selection.layerStyles[job.job_id] = layerStyle;
      }
    },
    setLayerStyle: (
      state,
      action: PayloadAction<{ jobId: string; style: VectorStyle }>
    ) => {
      state.selection.layerStyles[action.payload.jobId] = action.payload.style;
    },
    setDefaultStyle: (state, action: PayloadAction<{ jobId: string }>) => {
      // Assign next available palette color instead of static yellow
      const usedColors = new Set(
        Object.values(state.selection.layerStyles).map((s) => s.color)
      );
      let color = DEFAULT_RESULT_STYLE.color;
      for (const c of CLASSIFICATION_PALETTE) {
        if (!usedColors.has(c)) {
          color = c;
          break;
        }
      }
      state.selection.layerStyles[action.payload.jobId] = {
        color,
        opacity: DEFAULT_RESULT_STYLE.opacity
      };
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchJobs.pending, (state, action) => {
        if (action.meta.arg?.isManualRefresh) {
          state.jobsList.isRefreshing = true;
        } else if (state.jobsList.jobs.length === 0) {
          state.jobsList.isLoading = true;
        }
      })
      .addCase(fetchJobs.fulfilled, (state, action) => {
        state.jobsList.jobs = action.payload.jobs;
        state.jobsList.isLoading = false;
        state.jobsList.isRefreshing = false;
        state.jobsList.error = null;

        // Initialize custom order if empty
        if (
          state.jobsList.customOrder.length === 0 &&
          action.payload.jobs.length > 0
        ) {
          state.jobsList.customOrder = action.payload.jobs.map(
            (job) => job.job_id
          );
        }

        // Prepend any new job IDs to the existing order
        const existingIds = new Set(state.jobsList.customOrder);
        const newJobIds = action.payload.jobs
          .filter((job) => !existingIds.has(job.job_id))
          .map((job) => job.job_id);
        if (newJobIds.length > 0) {
          state.jobsList.customOrder = [
            ...newJobIds,
            ...state.jobsList.customOrder
          ];
        }

        // Auto-assign palette colors to any jobs that don't have a style yet
        // Sort oldest-first so palette colors match the job list display order
        const jobsSortedOldestFirst = [...action.payload.jobs].sort(
          (a, b) =>
            new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
        );
        for (const job of jobsSortedOldestFirst) {
          if (!state.selection.layerStyles[job.job_id]) {
            const usedColors = new Set(
              Object.values(state.selection.layerStyles).map((s) => s.color)
            );
            let color = CLASSIFICATION_PALETTE[0];
            for (const c of CLASSIFICATION_PALETTE) {
              if (!usedColors.has(c)) {
                color = c;
                break;
              }
            }
            state.selection.layerStyles[job.job_id] = {
              color,
              opacity: DEFAULT_RESULT_STYLE.opacity
            };
          }
        }
      })
      .addCase(fetchJobs.rejected, (state, action) => {
        state.jobsList.isLoading = false;
        state.jobsList.isRefreshing = false;
        state.jobsList.error = action.error.message || "Failed to load jobs";
      })
      .addCase(deleteJob.pending, (state, action) => {
        const { jobId } = action.meta.arg;

        state.jobsList.jobs = state.jobsList.jobs.filter(
          (j) => j.job_id !== jobId
        );
        state.jobsList.customOrder = state.jobsList.customOrder.filter(
          (id) => id !== jobId
        );
        state.selection.selectedJobs = state.selection.selectedJobs.filter(
          (j) => j.job_id !== jobId
        );
        delete state.selection.layerStyles[jobId];
      })
      .addCase(deleteJob.fulfilled, () => {
        // Partial failures are tracked in the result but don't affect UI state —
        // the job has been removed from the list regardless.
      })
      .addCase(deleteJob.rejected, (state, action) => {
        state.jobsList.error = action.payload?.error || "Failed to delete job";
      });
  }
});

// ─── Action Creators ─────────────────────────────────────────────────────────

export const {
  setSelectedJobs,
  setJobsCustomOrder,
  addJobToOrder,
  removeJobOptimistically,
  restoreJob,
  setLayerStyle,
  setDefaultStyle
} = jobsSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectJobs = (state: RootState) => state.jobs.jobsList.jobs;
export const selectJobsCustomOrder = (state: RootState) =>
  state.jobs.jobsList.customOrder;
export const selectJobsLoading = (state: RootState) =>
  state.jobs.jobsList.isLoading;
export const selectJobsRefreshing = (state: RootState) =>
  state.jobs.jobsList.isRefreshing;
export const selectJobsError = (state: RootState) => state.jobs.jobsList.error;
export const selectHasIncompleteJobs = (state: RootState) =>
  state.jobs.jobsList.jobs.some((job) => !isJobComplete(job.status));
export const selectSelectedJobs = (state: RootState) =>
  state.jobs.selection.selectedJobs;
export const selectLayerStyles = (state: RootState) =>
  state.jobs.selection.layerStyles;
export const selectLayerStyle = (state: RootState, jobId: string) =>
  state.jobs.selection.layerStyles[jobId];

// ─── Helper Functions ────────────────────────────────────────────────────────

export function extractBucketFromS3Uri(uri: string): string {
  const match = uri.match(/^s3:\/\/([^/]+)/);
  if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
  return match[1];
}

export function extractKeyFromS3Uri(uri: string): string {
  const match = uri.match(/^s3:\/\/[^/]+\/(.+)$/);
  if (!match) throw new Error(`Invalid S3 URI: ${uri}`);
  return match[1];
}

// ─── Data-Fetching Thunks ────────────────────────────────────────────────────

export const fetchGeoJSONData =
  (job: ImageProcessingJob) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const layerId = `detection-${job.job_id}`;
    const cache = GeoJSONCacheService.getInstance();
    const state = getState();

    // Skip if layer already exists with loading: false and no error
    const existingLayer = state.overlay?.layers[layerId];
    if (
      existingLayer &&
      !existingLayer.metadata?.loading &&
      !existingLayer.metadata?.error
    ) {
      return;
    }

    // Create layer in loading state
    dispatch(
      addLayer({
        id: layerId,
        name: `Detection: ${job.job_id}`,
        source: "detection",
        visible: false,
        zIndex: 10,
        featureCount: 0,
        metadata: {
          jobId: job.job_id,
          groupId: `job-${job.job_id}`,
          loading: true,
          layerType: "vector"
        }
      })
    );

    const pollingState: DetectionPollingState = {
      isPolling: false,
      pollStartTime: 0,
      pollInterval: DETECTION_POLL_INTERVAL,
      maxPollDuration: DETECTION_MAX_POLL_DURATION,
      attempts: 0
    };

    const queryStacForDetections = async (): Promise<void> => {
      try {
        // Query STAC catalog for items in the detection collection matching this job_id
        const response: StacSearchResponse =
          await dataCatalogService.searchItems({
            collections: [DETECTION_COLLECTION],
            limit: 100
          });

        // Filter features whose id starts with the job_id prefix
        const matchingFeatures =
          response.features?.filter(
            (feature) =>
              feature.id && String(feature.id).startsWith(`${job.job_id}-`)
          ) ?? [];

        if (matchingFeatures.length > 0) {
          // Extract GeoJSON from the STAC item's source asset
          const feature = matchingFeatures[0];
          const sourceAsset = feature.assets?.source || feature.assets?.data;
          let featureCollection: FeatureCollection;

          if (sourceAsset?.href) {
            // Download the GeoJSON from the asset's S3 URL via s3Service presigned URL
            const geojsonBlob = await s3Service.downloadFile(
              extractBucketFromS3Uri(sourceAsset.href),
              extractKeyFromS3Uri(sourceAsset.href)
            );
            const geojsonText = await geojsonBlob.text();
            featureCollection = JSON.parse(geojsonText) as FeatureCollection;
          } else {
            // If no asset link, use the feature's geometry directly as GeoJSON
            featureCollection = {
              type: "FeatureCollection",
              features: matchingFeatures
            } as FeatureCollection;
          }

          // Store in cache (NOT in Redux)
          cache.set(layerId, featureCollection);

          // Update layer metadata in Redux (lightweight)
          dispatch(
            updateLayerMetadata({
              layerId,
              featureCount: featureCollection.features.length,
              metadata: { jobId: job.job_id, loading: false }
            })
          );
          return;
        }

        // No items found — initiate or continue polling
        if (!pollingState.isPolling) {
          pollingState.isPolling = true;
          pollingState.pollStartTime = Date.now();
          pollingState.attempts = 0;
        }

        pollingState.attempts += 1;
        const elapsed = Date.now() - pollingState.pollStartTime;

        if (elapsed >= pollingState.maxPollDuration) {
          // Polling timed out — dispatch informational message
          dispatch(
            updateLayerMetadata({
              layerId,
              metadata: {
                jobId: job.job_id,
                loading: false,
                error:
                  "Detection results may still be processing. Please try again later."
              }
            })
          );
          return;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, pollingState.pollInterval)
        );

        // Check if the job still exists before continuing to poll
        const currentState = getState();
        const stillExists = currentState.jobs.jobsList.jobs.some(
          (j) => j.job_id === job.job_id
        );
        if (!stillExists) {
          // Job deleted during poll — clean up layer and cache
          dispatch(removeLayer(layerId));
          cache.delete(layerId);
          return;
        }

        await queryStacForDetections();
      } catch (error) {
        dispatch(
          updateLayerMetadata({
            layerId,
            metadata: {
              jobId: job.job_id,
              loading: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to load detection data from STAC catalog"
            }
          })
        );
      }
    };

    await queryStacForDetections();
  };

export const fetchViewpointStatus =
  (jobId: string) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const existingData = state.imagery.viewpointData[jobId];

    // If already loaded with READY status and has extent, or has error, don't poll
    if (
      existingData?.loaded &&
      (existingData.error ||
        (existingData.viewpoint?.viewpoint_status === "READY" &&
          existingData.extent))
    ) {
      return;
    }

    try {
      const viewpoint = await viewpointService.getViewpoint(jobId);

      switch (viewpoint.viewpoint_status) {
        case "CREATING":
          dispatch(
            setViewpointData({
              jobId,
              viewpoint,
              loaded: false,
              isPolling: true,
              pollStartTime: existingData?.pollStartTime || Date.now()
            })
          );

          setTimeout(() => {
            // Check if job still exists before polling
            const current = getState();
            const stillExists = current.jobs.jobsList.jobs.some(
              (j) => j.job_id === jobId
            );
            if (stillExists) {
              dispatch(fetchViewpointStatus(jobId));
            } else {
              dispatch(removeViewpointData({ jobId }));
            }
          }, VIEWPOINT_POLL_INTERVAL);
          break;

        case "READY":
          // Fetch extent when viewpoint is ready
          try {
            const extent = await viewpointService.getViewpointExtentWGS84(
              viewpoint.viewpoint_id
            );

            dispatch(
              setViewpointData({
                jobId,
                viewpoint,
                extent, // Include the extent in the viewpoint data
                loaded: true,
                isPolling: false
              })
            );

            // Register imagery layer in overlay-slice so visibility is
            // grouped with the detection layer via shared groupId
            if (extent) {
              const imageryLayerId = `imagery-${jobId}`;
              const currentState = getState();
              if (!currentState.overlay?.layers[imageryLayerId]) {
                // Match visibility of the detection layer (if it exists)
                const detectionLayer =
                  currentState.overlay?.layers[`detection-${jobId}`];
                dispatch(
                  addLayer({
                    id: imageryLayerId,
                    name: `Imagery: ${jobId}`,
                    source: "detection", // reuse source type for now
                    visible: detectionLayer?.visible ?? true,
                    zIndex: 5,
                    featureCount: 0,
                    metadata: {
                      jobId,
                      groupId: `job-${jobId}`,
                      layerType: "imagery"
                    }
                  })
                );
              }
            }
          } catch {
            dispatch(
              setViewpointData({
                jobId,
                viewpoint,
                loaded: true,
                isPolling: false
              })
            );
          }
          break;

        case "ERROR":
          dispatch(
            setViewpointError({
              jobId,
              error: viewpoint.error_message || "Viewpoint creation failed"
            })
          );
          break;

        default:
          dispatch(
            setViewpointError({
              jobId,
              error: `Unknown viewpoint status: ${viewpoint.viewpoint_status}`
            })
          );
      }
    } catch (error) {
      dispatch(
        setViewpointError({
          jobId,
          error:
            error instanceof Error ? error.message : "Failed to load viewpoint"
        })
      );
    }
  };

// ─── Middleware ───────────────────────────────────────────────────────────────

export const fetchDataMiddleware: Middleware =
  (store) => (next) => (action) => {
    const result = next(action);

    if (setSelectedJobs.match(action)) {
      (action.payload as ImageProcessingJob[]).forEach(
        (job: ImageProcessingJob) => {
          store.dispatch(fetchGeoJSONData(job) as unknown as AnyAction);
          store.dispatch(
            fetchViewpointStatus(job.job_id) as unknown as AnyAction
          );
        }
      );
    }

    return result;
  };

// ─── Polling ─────────────────────────────────────────────────────────────────

let pollingInterval: ReturnType<typeof setInterval> | null = null;

export const startJobsPolling =
  () => (dispatch: AppDispatch, getState: () => RootState) => {
    // Clear any existing interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    const poll = () => {
      const state = getState();
      const hasIncomplete = selectHasIncompleteJobs(state);

      if (hasIncomplete) {
        dispatch(fetchJobs({}));
      } else {
        // No incomplete jobs, stop polling
        if (pollingInterval) {
          clearInterval(pollingInterval);
          pollingInterval = null;
        }
      }
    };

    // Start polling
    pollingInterval = setInterval(poll, JOB_POLL_INTERVAL);
  };

export const stopJobsPolling = () => () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

// ─── Default Export ──────────────────────────────────────────────────────────

export default jobsSlice.reducer;
