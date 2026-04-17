// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Model Runner MCP Tools
 *
 * This module provides MCP tools for interacting with the OSML Model Runner service,
 * enabling AI agents to invoke image processing and display detection results.
 */

import { Store } from "@reduxjs/toolkit";

import {
  DEFAULT_RANGE_ADJUSTMENT,
  DEFAULT_TILE_FORMAT,
  DEFAULT_TILE_OVERLAP,
  DEFAULT_TILE_SIZE
} from "@/config/model-runner-defaults";
import {
  deleteJob,
  fetchAllJobs,
  fetchJobStatus,
  isJobSuccessful
} from "@/services/job-management";
import { submitJob } from "@/services/job-submission";
import { s3Service } from "@/services/s3-service";
import { sagemakerService } from "@/services/sagemaker-service";
import {
  JobSnapshot,
  removeJobOptimistically,
  restoreJob,
  setLayerStyle,
  setSelectedJobs,
  VectorStyle
} from "@/store/slices/jobs-slice";
import { setGroupVisibility } from "@/store/slices/overlay-slice";
import { setViewport } from "@/store/slices/viewport-slice";
import { AppDispatch, RootState } from "@/store/store";

import { LocalMcpTool, ToolArgs } from "./types";

// ============================================================================
// Tool Argument Interfaces
// ============================================================================

interface SubmitJobArgs {
  job_name: string;
  image_url: string;
  model_endpoint_name: string;
  output_bucket: string;
  tile_size?: number;
  tile_overlap?: number;
  tile_format?: string;
  range_adjustment?: string;
  text_prompt?: string;
  image_read_role?: string;
  model_invoke_role?: string;
  region_of_interest?: string;
  feature_properties?: string;
}

interface GetJobStatusArgs {
  job_id: string;
}

interface DisplayResultsArgs {
  job_id: string;
  color?: string;
  opacity?: number;
}

interface DeleteJobArgs {
  job_id: string;
}

// ============================================================================
// Response Interfaces
// ============================================================================

export interface ListModelEndpointsResponse {
  success: boolean;
  endpoints?: Array<{
    name: string;
    status: string;
    available: boolean;
  }>;
  message: string;
  error?: string;
}

export interface ListAvailableImagesArgs {
  bucket_name?: string;
  max_objects_per_bucket?: number;
}

export interface ListAvailableImagesResponse {
  success: boolean;
  buckets?: Array<{
    bucket_name: string;
    object_count: number;
    objects: Array<{
      key: string;
      size?: number;
      last_modified?: string;
    }>;
    truncated: boolean;
  }>;
  total_buckets: number;
  total_objects: number;
  message: string;
  error?: string;
}

export interface SubmitJobResponse {
  success: boolean;
  job_id?: string;
  job_name?: string;
  status?: string;
  message: string;
  error?: string;
}

export interface GetJobStatusResponse {
  success: boolean;
  job?: {
    job_id: string;
    job_name: string;
    status: string;
    image_status?: string;
    processing_duration?: number;
    output_bucket?: string;
    results_ready: boolean;
  };
  message: string;
  error?: string;
}

export interface ListJobsResponse {
  success: boolean;
  jobs?: Array<{
    job_id: string;
    job_name: string;
    status: string;
    image_status?: string;
    updated_at: string;
  }>;
  total_count: number;
  message: string;
  error?: string;
}

export interface DisplayResultsResponse {
  success: boolean;
  job_id?: string;
  feature_count?: number;
  viewpoint_status?: string;
  extent?: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
  message: string;
  error?: string;
}

export interface DeleteJobToolResponse {
  success: boolean;
  job_id?: string;
  message: string;
  error?: string;
  partial_failures?: {
    viewpoint?: string;
    s3?: string;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate zoom level from extent
 */
function calculateZoomFromExtent(extent: {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}): number {
  const lonDiff = extent.maxLon - extent.minLon;
  const latDiff = extent.maxLat - extent.minLat;
  const maxDiff = Math.max(lonDiff, latDiff);

  // Approximate zoom level based on extent size
  if (maxDiff > 90) return 2;
  if (maxDiff > 45) return 3;
  if (maxDiff > 22) return 4;
  if (maxDiff > 11) return 5;
  if (maxDiff > 5) return 6;
  if (maxDiff > 2.5) return 7;
  if (maxDiff > 1) return 8;
  if (maxDiff > 0.5) return 9;
  if (maxDiff > 0.25) return 10;
  if (maxDiff > 0.1) return 11;
  if (maxDiff > 0.05) return 12;
  if (maxDiff > 0.02) return 13;
  if (maxDiff > 0.01) return 14;
  if (maxDiff > 0.005) return 15;
  return 16;
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Tool 1: List available ML model endpoints
 */
export const listModelEndpointsTool: LocalMcpTool = {
  name: "list_model_endpoints",
  description:
    "List all available SageMaker ML model endpoints that can be used for image processing. Returns endpoint names, status, and availability.",
  schema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  handler: async (): Promise<ListModelEndpointsResponse> => {
    try {
      const endpoints = await sagemakerService.getEndpoints();

      if (endpoints.length === 0) {
        return {
          success: true,
          endpoints: [],
          message:
            "No SageMaker endpoints found. Please ensure ML models are deployed."
        };
      }

      const mappedEndpoints = endpoints.map((endpoint) => ({
        name: endpoint.name,
        status: endpoint.status,
        available: endpoint.status === "InService"
      }));

      return {
        success: true,
        endpoints: mappedEndpoints,
        message: `Found ${endpoints.length} SageMaker endpoint(s)`
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        message: "Failed to list SageMaker endpoints"
      };
    }
  }
};

/**
 * Tool 2: List available images for processing from S3 buckets
 */
export const listAvailableImagesTool: LocalMcpTool = {
  name: "list_available_images",
  description:
    "List available images from S3 buckets that can be processed by the Model Runner. Returns bucket names and object keys. Use bucket_name to filter to a specific bucket.",
  schema: {
    type: "object",
    properties: {
      bucket_name: {
        type: "string",
        description:
          "Optional: Filter to a specific S3 bucket name. If not provided, lists objects from all buckets."
      },
      max_objects_per_bucket: {
        type: "integer",
        default: 50,
        description:
          "Maximum number of objects to return per bucket (default: 50, max: 100)"
      }
    },
    additionalProperties: false
  },
  handler: async (args: ToolArgs): Promise<ListAvailableImagesResponse> => {
    try {
      const { bucket_name, max_objects_per_bucket: rawMaxObjects } =
        args as ListAvailableImagesArgs;
      const maxObjectsPerBucket = Math.min(rawMaxObjects ?? 50, 100);

      // If a specific bucket is requested, only fetch that one
      if (bucket_name) {
        const objects = await s3Service.getBucketContents(bucket_name);
        const truncated = objects.length > maxObjectsPerBucket;
        const limitedObjects = objects
          .slice(0, maxObjectsPerBucket)
          .map((obj) => ({
            key: obj.key,
            size: obj.size,
            last_modified: obj.lastModified
          }));

        return {
          success: true,
          buckets: [
            {
              bucket_name: bucket_name,
              object_count: objects.length,
              objects: limitedObjects,
              truncated
            }
          ],
          total_buckets: 1,
          total_objects: objects.length,
          message: truncated
            ? `Found ${objects.length} object(s) in bucket '${bucket_name}'. Showing first ${maxObjectsPerBucket}.`
            : `Found ${objects.length} object(s) in bucket '${bucket_name}'.`
        };
      }

      // Fetch all buckets
      const buckets = await s3Service.getBuckets();

      if (buckets.length === 0) {
        return {
          success: true,
          buckets: [],
          total_buckets: 0,
          total_objects: 0,
          message: "No S3 buckets found."
        };
      }

      // Fetch objects from each bucket (in parallel for efficiency)
      const bucketResults = await Promise.all(
        buckets.map(async (bucket) => {
          try {
            const objects = await s3Service.getBucketContents(bucket.name);
            const truncated = objects.length > maxObjectsPerBucket;
            const limitedObjects = objects
              .slice(0, maxObjectsPerBucket)
              .map((obj) => ({
                key: obj.key,
                size: obj.size,
                last_modified: obj.lastModified
              }));

            return {
              bucket_name: bucket.name,
              object_count: objects.length,
              objects: limitedObjects,
              truncated,
              error: undefined as string | undefined
            };
          } catch (error) {
            // If we can't access a bucket, include it with an error
            return {
              bucket_name: bucket.name,
              object_count: 0,
              objects: [],
              truncated: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to list objects"
            };
          }
        })
      );

      // Filter out buckets with errors and calculate totals
      const successfulBuckets = bucketResults.filter((b) => !b.error);
      const totalObjects = successfulBuckets.reduce(
        (sum, b) => sum + b.object_count,
        0
      );

      // Remove error field from successful results
      const cleanedBuckets = successfulBuckets.map((b) => ({
        bucket_name: b.bucket_name,
        object_count: b.object_count,
        objects: b.objects,
        truncated: b.truncated
      }));

      const truncatedBuckets = cleanedBuckets.filter((b) => b.truncated);
      let message = `Found ${totalObjects} object(s) across ${successfulBuckets.length} bucket(s).`;
      if (truncatedBuckets.length > 0) {
        message += ` ${truncatedBuckets.length} bucket(s) have more objects than shown (limited to ${maxObjectsPerBucket} per bucket).`;
      }

      return {
        success: true,
        buckets: cleanedBuckets,
        total_buckets: successfulBuckets.length,
        total_objects: totalObjects,
        message
      };
    } catch (error) {
      return {
        success: false,
        total_buckets: 0,
        total_objects: 0,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        message: "Failed to list available images from S3"
      };
    }
  }
};

/**
 * Tool 3: Submit image processing job
 */
export const submitImageProcessingJobTool: LocalMcpTool = {
  name: "submit_image_processing_job",
  description:
    "Submit an image processing job to the Model Runner service. Processes a geospatial image using a specified ML model endpoint and stores results in S3.",
  schema: {
    type: "object",
    properties: {
      job_name: {
        type: "string",
        description: "Name for the image processing job"
      },
      image_url: {
        type: "string",
        description:
          "S3 URI of the image to process (e.g., s3://bucket/path/image.tif)"
      },
      model_endpoint_name: {
        type: "string",
        description: "Name of the SageMaker endpoint to use for processing"
      },
      output_bucket: {
        type: "string",
        description:
          "S3 bucket name for storing processing results. Optional — defaults to the configured detection bridge bucket, or falls back to 'mr-bucket-sink-*' if available."
      },
      tile_size: {
        type: "integer",
        default: DEFAULT_TILE_SIZE,
        description: "Tile size in pixels for image processing"
      },
      tile_overlap: {
        type: "integer",
        default: DEFAULT_TILE_OVERLAP,
        description: "Overlap between tiles in pixels"
      },
      tile_format: {
        type: "string",
        enum: ["GTIFF", "NITF", "PNG", "JPEG"],
        default: DEFAULT_TILE_FORMAT,
        description: "Format for image tiles"
      },
      range_adjustment: {
        type: "string",
        enum: ["NONE", "MINMAX", "DRA"],
        default: DEFAULT_RANGE_ADJUSTMENT,
        description: "Range adjustment method for image display"
      },
      text_prompt: {
        type: "string",
        description:
          "Text prompt for SAM3 models (e.g., 'vehicles', 'buildings')"
      },
      image_read_role: {
        type: "string",
        description:
          "IAM role ARN for reading the source image from S3 (cross-account access)"
      },
      model_invoke_role: {
        type: "string",
        description:
          "IAM role ARN for invoking the model endpoint (cross-account access)"
      },
      region_of_interest: {
        type: "string",
        description:
          "WKT geometry to limit the processing area, e.g. POLYGON((lon1 lat1, lon2 lat2, ...))"
      },
      feature_properties: {
        type: "string",
        description:
          "JSON string of additional feature properties to include in output"
      }
    },
    required: ["job_name", "image_url", "model_endpoint_name"],
    additionalProperties: false
  },
  handler: async (args: ToolArgs, store: Store): Promise<SubmitJobResponse> => {
    const {
      job_name,
      image_url,
      model_endpoint_name,
      output_bucket,
      tile_size,
      tile_overlap,
      tile_format,
      range_adjustment,
      text_prompt,
      image_read_role,
      model_invoke_role,
      region_of_interest,
      feature_properties
    } = args as unknown as SubmitJobArgs;
    const result = await submitJob(
      {
        jobName: job_name,
        imageUrl: image_url,
        modelEndpointName: model_endpoint_name,
        outputBucket: output_bucket || undefined,
        tileSize: tile_size,
        tileOverlap: tile_overlap,
        tileFormat: tile_format,
        rangeAdjustment: range_adjustment as
          | "NONE"
          | "MINMAX"
          | "DRA"
          | undefined,
        textPrompt: text_prompt,
        imageReadRole: image_read_role,
        modelInvokeRole: model_invoke_role,
        regionOfInterest: region_of_interest,
        featureProperties: feature_properties
      },
      store.dispatch as AppDispatch
    );

    return {
      success: result.success,
      job_id: result.jobId,
      job_name: result.jobName,
      status: result.status,
      message: result.success
        ? `Image processing job '${job_name}' submitted successfully`
        : result.error || "Failed to submit image processing job",
      error: result.error
    };
  }
};

/**
 * Tool 4: Get job status
 */
export const getJobStatusTool: LocalMcpTool = {
  name: "get_job_status",
  description:
    "Get the current status of an image processing job. Returns job details including status, processing duration, and whether results are ready.",
  schema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The unique identifier of the job to check"
      }
    },
    required: ["job_id"],
    additionalProperties: false
  },
  handler: async (args: ToolArgs): Promise<GetJobStatusResponse> => {
    const { job_id } = args as unknown as GetJobStatusArgs;
    if (!job_id) {
      return {
        success: false,
        error: "Missing required parameter: job_id",
        message: "Validation failed"
      };
    }

    try {
      const result = await fetchJobStatus(job_id);

      if (result.error || !result.job) {
        return {
          success: false,
          error: result.error || `Job not found: ${job_id}`,
          message: "The specified job does not exist"
        };
      }

      const job = result.job;
      const resultsReady = isJobSuccessful(job.status);

      return {
        success: true,
        job: {
          job_id: job.job_id,
          job_name: job.job_name || "",
          status: job.status,
          image_status: job.image_status,
          processing_duration: job.processing_duration,
          output_bucket: job.output_bucket,
          results_ready: resultsReady
        },
        message: resultsReady
          ? `Job '${job.job_name || job.job_id}' completed. Results are ready for display.`
          : `Job '${job.job_name || job.job_id}' status: ${job.status}`
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        message: "Failed to get job status"
      };
    }
  }
};

/**
 * Tool 5: List image processing jobs
 */
export const listImageProcessingJobsTool: LocalMcpTool = {
  name: "list_image_processing_jobs",
  description:
    "List all image processing jobs with their status. Jobs are sorted by most recently updated first.",
  schema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  handler: async (): Promise<ListJobsResponse> => {
    try {
      const result = await fetchAllJobs();

      if (result.error) {
        return {
          success: false,
          error: result.error,
          total_count: 0,
          message: "Failed to list image processing jobs"
        };
      }

      if (result.jobs.length === 0) {
        return {
          success: true,
          jobs: [],
          total_count: 0,
          message:
            "No image processing jobs found. Submit a job to get started."
        };
      }

      const mappedJobs = result.jobs.map((job) => ({
        job_id: job.job_id,
        job_name: job.job_name || "",
        status: job.status,
        image_status: job.image_status,
        updated_at: job.updated_at
      }));

      return {
        success: true,
        jobs: mappedJobs,
        total_count: mappedJobs.length,
        message: `Found ${mappedJobs.length} image processing job(s)`
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        total_count: 0,
        message: "Failed to list image processing jobs"
      };
    }
  }
};

/**
 * Tool 6: Display detection results on map
 */
export const displayDetectionResultsTool: LocalMcpTool = {
  name: "display_detection_results",
  description:
    "Display detection results from a completed image processing job on the map. Fetches GeoJSON results and zooms to the detection extent.",
  schema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The job ID whose results should be displayed"
      },
      color: {
        type: "string",
        default: "#ffff00",
        description: "Color for detection results (hex format)"
      },
      opacity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0.5,
        description: "Opacity for detection results (0-1)"
      }
    },
    required: ["job_id"],
    additionalProperties: false
  },
  handler: async (
    args: ToolArgs,
    store: Store
  ): Promise<DisplayResultsResponse> => {
    const {
      job_id,
      opacity: rawOpacity,
      color: rawColor
    } = args as unknown as DisplayResultsArgs;
    if (!job_id) {
      return {
        success: false,
        error: "Missing required parameter: job_id",
        message: "Validation failed"
      };
    }

    try {
      // Fetch job status
      const result = await fetchJobStatus(job_id);

      if (result.error || !result.job) {
        return {
          success: false,
          error: result.error || `Job not found: ${job_id}`,
          message: "The specified job does not exist"
        };
      }

      const job = result.job;

      // Validate job is complete
      if (!isJobSuccessful(job.status)) {
        return {
          success: false,
          error: `Job status is '${job.status}'. Results are only available for completed jobs.`,
          message: "Results are not yet available"
        };
      }

      // Apply defaults for optional parameters
      const color = rawColor ?? "#ffff00";
      const opacity = rawOpacity ?? 0.5;

      // Dispatch setLayerStyle FIRST to configure display style
      store.dispatch(
        setLayerStyle({
          jobId: job_id,
          style: { color, opacity }
        })
      );

      // Dispatch setSelectedJobs to trigger fetchDataMiddleware
      // This will fetch both GeoJSON results and viewpoint data
      store.dispatch(setSelectedJobs([job]));

      // Wait for viewpoint extent to be available (poll for up to 10 seconds)
      let extent:
        | { minLon: number; minLat: number; maxLon: number; maxLat: number }
        | undefined;
      let viewpointStatus: string | undefined;
      const maxWaitTime = 10000;
      const pollInterval = 500;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const state = store.getState() as RootState;
        const viewpointData = state.imagery.viewpointData[job_id];

        if (viewpointData?.loaded) {
          viewpointStatus = viewpointData.viewpoint?.viewpoint_status;
          if (viewpointData.extent) {
            extent = viewpointData.extent;
            break;
          }
          if (viewpointData.error) {
            // Viewpoint failed but we can still show results
            break;
          }
        }
      }

      // Zoom to extent if available
      if (extent) {
        const centerLon = (extent.minLon + extent.maxLon) / 2;
        const centerLat = (extent.minLat + extent.maxLat) / 2;
        const zoom = calculateZoomFromExtent(extent);

        store.dispatch(
          setViewport({
            longitude: centerLon,
            latitude: centerLat,
            zoom,
            extent: {
              west: extent.minLon,
              south: extent.minLat,
              east: extent.maxLon,
              north: extent.maxLat
            },
            updatedBy: "agent"
          })
        );
      }

      // Get feature count from GeoJSON data
      let featureCount: number | undefined;
      const state = store.getState() as RootState;
      // Detection GeoJSON is stored in the overlay cache.
      // Feature count is available from the overlay layer metadata.
      const detectionLayer = state.overlay?.layers[`detection-${job_id}`];
      if (detectionLayer?.featureCount) {
        featureCount = detectionLayer.featureCount;
      }

      // Ensure the detection overlay layer is visible
      store.dispatch(
        setGroupVisibility({
          groupId: `job-${job_id}`,
          visible: true
        })
      );

      return {
        success: true,
        job_id: job_id,
        feature_count: featureCount,
        viewpoint_status: viewpointStatus,
        extent,
        message: extent
          ? `Detection results displayed and map zoomed to extent${featureCount !== undefined ? `. Found ${featureCount} features.` : "."}`
          : `Detection results displayed${featureCount !== undefined ? `. Found ${featureCount} features.` : "."}`
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        message: "Failed to display detection results"
      };
    }
  }
};

/**
 * Tool 7: Delete image processing job
 */
export const deleteImageProcessingJobTool: LocalMcpTool = {
  name: "delete_image_processing_job",
  description:
    "Delete an image processing job and all associated resources (viewpoint, S3 outputs, backend record). Updates the UI to reflect the deletion.",
  schema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description: "The unique identifier of the job to delete"
      }
    },
    required: ["job_id"],
    additionalProperties: false
  },
  handler: async (
    args: ToolArgs,
    store: Store
  ): Promise<DeleteJobToolResponse> => {
    const { job_id } = args as unknown as DeleteJobArgs;
    // Validate required parameter
    if (!job_id) {
      return {
        success: false,
        error: "Missing required parameter: job_id",
        message: "Validation failed"
      };
    }

    try {
      // Get current state to find the job and create a snapshot for potential rollback
      const state = store.getState() as RootState;
      const jobs = state.jobs.jobsList.jobs;
      const job = jobs.find((j) => j.job_id === job_id);

      if (!job) {
        return {
          success: false,
          error: `Job not found: ${job_id}`,
          message: "The specified job does not exist"
        };
      }

      // Create snapshot for potential rollback
      const orderIndex = state.jobs.jobsList.customOrder.indexOf(job_id);
      const wasSelected = state.jobs.selection.selectedJobs.some(
        (j) => j.job_id === job_id
      );
      const layerStyle: VectorStyle | undefined =
        state.jobs.selection.layerStyles[job_id];

      const snapshot: JobSnapshot = {
        job,
        orderIndex: orderIndex >= 0 ? orderIndex : jobs.indexOf(job),
        wasSelected,
        layerStyle
      };

      // Optimistically remove job from Redux state
      store.dispatch(removeJobOptimistically({ jobId: job_id }));

      // Call the backend delete service
      const result = await deleteJob(job_id, job.output_bucket);

      if (!result.success) {
        // Rollback: restore the job to its previous state
        store.dispatch(restoreJob(snapshot));

        return {
          success: false,
          job_id: job_id,
          error: result.error || "Failed to delete job",
          message: "Job deletion failed"
        };
      }

      // Build response with partial failure information if any
      const response: DeleteJobToolResponse = {
        success: true,
        job_id: job_id,
        message: `Job '${job.job_name || job_id}' deleted successfully`
      };

      if (result.partialFailures) {
        response.partial_failures = {};
        if (result.partialFailures.viewpoint) {
          response.partial_failures.viewpoint =
            result.partialFailures.viewpoint;
        }
        if (result.partialFailures.s3) {
          response.partial_failures.s3 = result.partialFailures.s3;
        }
        if (Object.keys(response.partial_failures).length > 0) {
          response.message = `Job '${job.job_name || job_id}' deleted with some cleanup warnings`;
        }
      }

      return response;
    } catch (error) {
      return {
        success: false,
        job_id: job_id,
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
        message: "Failed to delete image processing job"
      };
    }
  }
};
