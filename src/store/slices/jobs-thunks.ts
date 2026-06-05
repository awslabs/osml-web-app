// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Async thunks and data-fetching thunks for the jobs feature.
 *
 * Split out of `jobs-slice.ts`:
 *  - `fetchJobs` / `deleteJob` are the `createAsyncThunk`s the slice's
 *    `extraReducers` respond to.
 *  - `fetchGeoJSONData` / `fetchViewpointStatus` are the data-fetching thunks
 *    the `fetchDataMiddleware` dispatches in response to selection changes.
 *
 * These have no dependency on the slice itself (they only dispatch
 * overlay/imagery actions and call services), which keeps the module graph
 * acyclic: the slice imports the thunks for its extraReducers, never the
 * other way around.
 */
import { createAsyncThunk } from "@reduxjs/toolkit";
import type { FeatureCollection } from "geojson";

import {
  dataCatalogService,
  StacSearchResponse
} from "@/services/data-catalog-service.ts";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import {
  deleteJob as deleteJobFromBackend,
  DeleteJobResult,
  fetchAllJobs
} from "@/services/job-management";
import { ImageProcessingJob } from "@/services/model-runner-service.ts";
import { s3Service } from "@/services/s3-service.ts";
import { viewpointService } from "@/services/viewpoint-service.ts";
import { AppDispatch, RootState } from "@/store/store.ts";

import { setViewpointData, setViewpointError } from "./imagery-slice";
import { addLayer, updateLayerMetadata } from "./overlay-slice";

// ─── Constants ───────────────────────────────────────────────────────────────

export const DETECTION_POLL_INTERVAL = 5000; // 5 seconds
export const DETECTION_MAX_POLL_DURATION = 300000; // 5 minutes
export const DETECTION_COLLECTION = "model-runner-detections";
const VIEWPOINT_POLL_INTERVAL = 5000; // 5 seconds

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Data-Fetching Thunks ────────────────────────────────────────────────────

/**
 * Fetch detection GeoJSON for a job and register the corresponding overlay
 * layer. Uses the cache as a fast path for jobs that were previously
 * fetched, making deselect/reselect toggles instant with no network cost.
 *
 * The thunk is triggered exclusively by the fetchDataMiddleware in response
 * to a job being added to `state.jobs.selection.selectedJobs`. Teardown on
 * deselection is handled by the middleware.
 */
export const fetchGeoJSONData =
  (job: ImageProcessingJob) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const layerId = `detection-${job.job_id}`;
    const cache = GeoJSONCacheService.getInstance();

    // Fast path: cached data from a prior selection. Re-register the overlay
    // layer from the cache without any network call.
    if (cache.has(layerId)) {
      const cached = cache.get(layerId);
      const featureCount = cached?.features.length ?? 0;
      dispatch(
        addLayer({
          id: layerId,
          name: `Detection: ${job.job_id}`,
          source: "detection",
          zIndex: 10,
          featureCount,
          metadata: {
            jobId: job.job_id,
            loading: false,
            layerType: "vector"
          }
        })
      );
      return;
    }

    // Create layer in loading state
    dispatch(
      addLayer({
        id: layerId,
        name: `Detection: ${job.job_id}`,
        source: "detection",
        zIndex: 10,
        featureCount: 0,
        metadata: {
          jobId: job.job_id,
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

        // Exit polling quietly if the job is no longer selected. The
        // middleware handles overlay/cache cleanup on deselection; we just
        // need to stop doing more work.
        const currentState = getState();
        const stillSelected = currentState.jobs.selection.selectedJobs.some(
          (j) => j.job_id === job.job_id
        );
        if (!stillSelected) {
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

/**
 * Fetch viewpoint metadata for a job and, when the viewpoint is READY,
 * register an imagery overlay layer. The imagery layer is created
 * unconditionally (no coupling to the detection layer's state) — presence
 * in `overlay.layers` is the sole rendering signal.
 *
 * Uses already-loaded viewpoint data in `state.imagery.viewpointData` as a
 * fast path to avoid redundant network calls across deselect/reselect.
 */
export const fetchViewpointStatus =
  (jobId: string) =>
  async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const existingData = state.imagery.viewpointData[jobId];

    // Fast path: if viewpoint is already READY with extent, re-register the
    // imagery layer from cached data. Useful after a deselect/reselect.
    if (
      existingData?.loaded &&
      existingData.viewpoint?.viewpoint_status === "READY" &&
      existingData.extent
    ) {
      const imageryLayerId = `imagery-${jobId}`;
      if (!state.overlay?.layers[imageryLayerId]) {
        dispatch(
          addLayer({
            id: imageryLayerId,
            name: `Imagery: ${jobId}`,
            source: "detection", // reuse source type for now
            zIndex: 5,
            featureCount: 0,
            metadata: {
              jobId,
              layerType: "imagery"
            }
          })
        );
      }
      return;
    }

    // If already loaded with an error, don't retry
    if (existingData?.loaded && existingData.error) {
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
            // Exit polling if the job is no longer selected. Middleware
            // handles cleanup of viewpointData on deselection/deletion.
            const current = getState();
            const stillSelected = current.jobs.selection.selectedJobs.some(
              (j) => j.job_id === jobId
            );
            if (stillSelected) {
              dispatch(fetchViewpointStatus(jobId));
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

            // Register imagery layer in overlay-slice. Presence in
            // overlay.layers = renders; middleware tears it down on
            // deselection/deletion.
            if (extent) {
              const imageryLayerId = `imagery-${jobId}`;
              const currentState = getState();
              if (!currentState.overlay?.layers[imageryLayerId]) {
                dispatch(
                  addLayer({
                    id: imageryLayerId,
                    name: `Imagery: ${jobId}`,
                    source: "detection", // reuse source type for now
                    zIndex: 5,
                    featureCount: 0,
                    metadata: {
                      jobId,
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
