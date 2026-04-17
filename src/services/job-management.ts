// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared job management module for Model Runner jobs.
 * This module provides reusable functions for fetching and managing
 * image processing jobs, used by both the UI sidebar and MCP tools.
 */

import { dataCatalogService } from "./data-catalog-service";
import {
  DeleteJobResponse,
  ImageProcessingJob,
  modelRunnerService
} from "./model-runner-service";
import { s3Service } from "./s3-service";
import { viewpointService } from "./viewpoint-service";

/**
 * Result type for job list operations
 */
export interface JobListResult {
  jobs: ImageProcessingJob[];
  error?: string;
}

/**
 * Result type for single job status operations
 */
export interface JobStatusResult {
  job: ImageProcessingJob | null;
  error?: string;
}

/**
 * Result type for job deletion operations
 */
export interface DeleteJobResult {
  success: boolean;
  error?: string;
  partialFailures?: {
    viewpoint?: string;
    s3?: string;
    stac?: string;
    backend?: string;
  };
}

/**
 * Terminal job statuses that indicate processing is complete
 */
const TERMINAL_STATUSES = ["SUCCESS", "PARTIAL", "FAILED"];

/**
 * Successful job statuses that indicate results are ready
 */
const SUCCESSFUL_STATUSES = ["SUCCESS", "COMPLETED"];

/**
 * Fetches all image processing jobs and sorts them by updated_at descending.
 * @returns JobListResult containing sorted jobs or error
 */
export async function fetchAllJobs(): Promise<JobListResult> {
  try {
    const jobs = await modelRunnerService.listImageProcessingJobs();

    // Sort by updated_at descending (most recent first)
    const sortedJobs = [...jobs].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    return { jobs: sortedJobs };
  } catch (error) {
    return {
      jobs: [],
      error: error instanceof Error ? error.message : "Failed to fetch jobs"
    };
  }
}

/**
 * Fetches the status of a single job by ID.
 * @param jobId - The unique identifier of the job
 * @returns JobStatusResult containing job data or error
 */
export async function fetchJobStatus(jobId: string): Promise<JobStatusResult> {
  try {
    const job = await modelRunnerService.getImageProcessingJob(jobId);

    return { job };
  } catch (error) {
    return {
      job: null,
      error:
        error instanceof Error ? error.message : "Failed to fetch job status"
    };
  }
}

/**
 * Checks if a job is in a terminal/complete state.
 * Terminal states are: SUCCESS, PARTIAL, FAILED
 * @param status - The job status string
 * @returns true if the job is complete (no longer processing)
 */
export function isJobComplete(status: string): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Checks if a job completed successfully with results ready.
 * Successful states are: SUCCESS, COMPLETED
 * @param status - The job status string
 * @returns true if the job has results ready for display
 */
export function isJobSuccessful(status: string): boolean {
  return SUCCESSFUL_STATUSES.includes(status);
}

/**
 * Deletes a job and all associated resources (viewpoint, S3 outputs, backend record).
 * The deletion is orchestrated to handle partial failures gracefully:
 * - Backend deletion is required for success
 * - Viewpoint and S3 cleanup failures are logged but don't fail the operation
 *
 * Note: The viewpoint associated with a job uses the same ID as the job itself.
 *
 * @param jobId - The unique identifier of the job to delete (also used as viewpoint ID)
 * @param outputBucket - Optional S3 bucket containing job outputs
 * @returns DeleteJobResult with success status and any partial failure details
 */
export async function deleteJob(
  jobId: string,
  outputBucket?: string
): Promise<DeleteJobResult> {
  const partialFailures: DeleteJobResult["partialFailures"] = {};

  // Step 1: Delete viewpoint (non-critical, continue on failure)
  // Note: Viewpoint ID is the same as job ID
  try {
    await viewpointService.deleteViewpoint(jobId);
  } catch (error) {
    partialFailures.viewpoint =
      error instanceof Error ? error.message : "Failed to delete viewpoint";
  }

  // Step 2: Delete STAC catalog items for this job (non-critical, continue on failure)
  // Detection items in the model-runner-detections collection have IDs prefixed with the job_id
  try {
    const DETECTION_COLLECTION = "model-runner-detections";
    const searchResponse = await dataCatalogService.searchItems({
      collections: [DETECTION_COLLECTION],
      limit: 100
    });

    const matchingItems =
      searchResponse.features?.filter(
        (feature) => feature.id && String(feature.id).startsWith(`${jobId}-`)
      ) ?? [];

    for (const item of matchingItems) {
      try {
        await dataCatalogService.deleteItem(DETECTION_COLLECTION, item.id);
      } catch {
        // Individual item deletion failure — continue with remaining items
      }
    }
  } catch (error) {
    partialFailures.stac =
      error instanceof Error
        ? error.message
        : "Failed to cleanup STAC catalog items";
  }

  // Step 3: Delete bridge bucket objects for this job (non-critical, continue on failure)
  // The bridge bucket stores detection geojson at {jobId}/ prefix
  if (outputBucket) {
    try {
      await s3Service.deleteByPrefix(outputBucket, `${jobId}/`);
    } catch (error) {
      partialFailures.s3 =
        error instanceof Error
          ? error.message
          : "Failed to cleanup bridge bucket objects";
    }
  }

  // Step 4: Delete backend job record (critical, failure means overall failure)
  try {
    const backendResult: DeleteJobResponse =
      await modelRunnerService.deleteImageProcessingJob(jobId);

    if (!backendResult.success) {
      return {
        success: false,
        error: backendResult.message || "Failed to delete job from backend",
        partialFailures:
          Object.keys(partialFailures).length > 0 ? partialFailures : undefined
      };
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete job record",
      partialFailures:
        Object.keys(partialFailures).length > 0 ? partialFailures : undefined
    };
  }

  return {
    success: true,
    partialFailures:
      Object.keys(partialFailures).length > 0 ? partialFailures : undefined
  };
}
