// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared job submission orchestration for Model Runner jobs.
 *
 * Both the CreateJobModal and the MCP submit_image_processing_job tool
 * need to: build a CreateJobRequest, resolve an output bucket, create a
 * viewpoint, dispatch Redux actions, and call the Model Runner API.
 * This module provides a single entry point so that logic lives in one place.
 */

import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_INCLUDE_KINESIS_OUTPUT,
  DEFAULT_MODEL_TYPE,
  DEFAULT_POST_PROCESSING,
  DEFAULT_RANGE_ADJUSTMENT,
  DEFAULT_TILE_COMPRESSION,
  DEFAULT_TILE_FORMAT,
  DEFAULT_TILE_OVERLAP,
  DEFAULT_TILE_SIZE
} from "@/config/model-runner-defaults";
import { siteConfig } from "@/config/site";
import {
  CreateJobRequest,
  FeatureDistillation,
  ImageProcessingJob,
  modelRunnerService
} from "@/services/model-runner-service";
import { s3Service } from "@/services/s3-service";
import { viewpointService } from "@/services/viewpoint-service";
import {
  addJobToOrder,
  fetchJobs,
  setLayerStyle,
  VectorStyle
} from "@/store/slices/jobs-slice";
import { S3Bucket } from "@/store/slices/s3-slice";
import type { AppDispatch } from "@/store/store";
import { CreateViewpointForm, CreateViewpointRequest } from "@/types/viewpoint";

/** Convert a camelCase viewpoint form into the snake_case API request shape. */
function viewpointToSnakeCase(
  data: CreateViewpointForm
): CreateViewpointRequest {
  return {
    viewpoint_name: data.viewpointName,
    viewpoint_id: data.viewpointId,
    bucket_name: data.bucketName,
    object_key: data.objectKey,
    tile_size: data.tileSize,
    range_adjustment: data.rangeAdjustment
  };
}

// ─── Public types ────────────────────────────────────────────────────────────

/** Parameters accepted by {@link submitJob}. All processing defaults are applied internally. */
export interface SubmitJobParams {
  /** Human-readable job name (required). */
  jobName: string;

  /** S3 URI of the source image, e.g. `s3://bucket/path/to/image.tif` (required). */
  imageUrl: string;

  /** SageMaker endpoint name (required). */
  modelEndpointName: string;

  /** Model invocation mode. @default "SM_ENDPOINT" */
  modelType?: string;

  /** S3 bucket for results. Resolved automatically when omitted. */
  outputBucket?: string;

  /** Tile size in pixels. @default 512 */
  tileSize?: number;

  /** Tile overlap in pixels. @default 128 */
  tileOverlap?: number;

  /** Tile format. @default "GTIFF" */
  tileFormat?: string;

  /** Tile compression. @default "NONE" */
  tileCompression?: string;

  /** Image range adjustment for tile rendering. @default "DRA" */
  rangeAdjustment?: "NONE" | "MINMAX" | "DRA";

  /** Text prompt for prompt-based models (e.g. SAM3). */
  textPrompt?: string;

  /** Post-processing feature distillation steps. Uses NMS 0.75 when omitted. */
  postProcessing?: FeatureDistillation[];

  /** Detection result display style (color + opacity). */
  resultStyle?: VectorStyle;

  /** Include Kinesis output sink alongside S3. @default true */
  includeKinesisOutput?: boolean;

  /** IAM role ARN for reading the source image from S3 (cross-account). */
  imageReadRole?: string;

  /** IAM role ARN for invoking the model endpoint (cross-account). */
  modelInvokeRole?: string;

  /** WKT geometry limiting the processing area, e.g. `POLYGON((lon1 lat1, ...))`. */
  regionOfInterest?: string;

  /** JSON string of additional feature properties to include in output. */
  featureProperties?: string;
}

export interface SubmitJobResult {
  success: boolean;
  jobId?: string;
  jobName?: string;
  status?: string;
  job?: ImageProcessingJob;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse an S3 URI into bucket + key. Returns undefined on invalid input. */
export function parseS3Uri(
  uri: string
): { bucket: string; key: string } | undefined {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) return undefined;
  return { bucket: match[1], key: match[2] };
}

/**
 * Resolve the output bucket from an explicit value, the configured bridge
 * bucket, or the first `mr-bucket-sink-*` bucket in the account.
 */
export async function resolveOutputBucket(
  explicit?: string
): Promise<string | undefined> {
  if (explicit) return explicit;

  // Prefer the configured detection bridge bucket
  const bridgeBucket = siteConfig.detection_bridge_bucket;
  if (bridgeBucket) return bridgeBucket;

  // Fall back to discovering a sink bucket from S3
  try {
    const buckets = await s3Service.getBuckets();
    const sink = buckets.find((b: S3Bucket) =>
      b.name.startsWith("mr-bucket-sink-")
    );
    return sink?.name ?? buckets[0]?.name;
  } catch {
    return undefined;
  }
}

// ─── Core submission function ────────────────────────────────────────────────

/**
 * Submit an image processing job to the Model Runner service.
 *
 * Handles the full orchestration:
 * 1. Resolve output bucket
 * 2. Build the CreateJobRequest with sensible defaults
 * 3. Create the viewpoint for tile rendering
 * 4. Submit the job to Model Runner
 * 5. Dispatch Redux actions (layer style, job order, refresh)
 */
export async function submitJob(
  params: SubmitJobParams,
  dispatch: AppDispatch
): Promise<SubmitJobResult> {
  // Validate required fields
  const missing: string[] = [];
  if (!params.jobName) missing.push("jobName");
  if (!params.imageUrl) missing.push("imageUrl");
  if (!params.modelEndpointName) missing.push("modelEndpointName");
  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing required parameters: ${missing.join(", ")}`
    };
  }

  // Parse S3 URI
  const s3Parts = parseS3Uri(params.imageUrl);
  if (!s3Parts) {
    return {
      success: false,
      error: "Invalid imageUrl format. Expected s3://bucket/path/to/image"
    };
  }

  // Resolve output bucket
  const outputBucket = await resolveOutputBucket(params.outputBucket);
  if (!outputBucket) {
    return {
      success: false,
      error:
        "Could not determine output bucket. Provide one explicitly or ensure an mr-bucket-sink-* bucket exists."
    };
  }

  try {
    const jobId = uuidv4();

    // Apply defaults (from @/config/job-defaults)
    const tileSize = params.tileSize ?? DEFAULT_TILE_SIZE;
    const tileOverlap = params.tileOverlap ?? DEFAULT_TILE_OVERLAP;
    const tileFormat = params.tileFormat ?? DEFAULT_TILE_FORMAT;
    const tileCompression = params.tileCompression ?? DEFAULT_TILE_COMPRESSION;
    const rangeAdjustment = params.rangeAdjustment ?? DEFAULT_RANGE_ADJUSTMENT;
    const modelType = params.modelType ?? DEFAULT_MODEL_TYPE;
    const includeKinesis =
      params.includeKinesisOutput ?? DEFAULT_INCLUDE_KINESIS_OUTPUT;

    const postProcessing: FeatureDistillation[] =
      params.postProcessing ?? DEFAULT_POST_PROCESSING;

    // Build imageProcessorParameters for SAM3 text prompts
    let imageProcessorParameters: Record<string, string> | undefined;
    if (
      params.modelEndpointName.toLowerCase().includes("sam3") &&
      params.textPrompt?.trim()
    ) {
      imageProcessorParameters = {
        CustomAttributes: `text_prompt=${params.textPrompt.trim()}`
      };
    }

    // Build outputs list
    const outputs: CreateJobRequest["outputs"] = [
      { type: "S3", bucket: outputBucket, prefix: `${jobId}/` }
    ];
    if (includeKinesis) {
      outputs.push({
        type: "Kinesis",
        stream: siteConfig.kinesis_stream_name,
        batchSize: 1000
      });
    }

    // Build the job request
    const jobRequest: CreateJobRequest = {
      jobName: params.jobName,
      jobId,
      imageUrls: [params.imageUrl],
      outputs,
      imageProcessor: {
        name: params.modelEndpointName,
        type: modelType,
        ...(params.modelInvokeRole && { assumedRole: params.modelInvokeRole })
      },
      imageProcessorTileSize: tileSize,
      imageProcessorTileOverlap: tileOverlap,
      imageProcessorTileFormat: tileFormat,
      imageProcessorTileCompression: tileCompression,
      imageProcessorParameters,
      postProcessing,
      rangeAdjustment,
      ...(params.imageReadRole && { imageReadRole: params.imageReadRole }),
      ...(params.regionOfInterest && {
        regionOfInterest: params.regionOfInterest
      }),
      ...(params.featureProperties && {
        featureProperties: params.featureProperties
      })
    };

    // Build viewpoint request
    const viewpointRequest = viewpointToSnakeCase({
      viewpointName: params.jobName,
      viewpointId: jobId,
      bucketName: s3Parts.bucket,
      objectKey: s3Parts.key,
      tileSize,
      rangeAdjustment
    });

    // Set layer style before submission so it's ready when results arrive
    if (params.resultStyle) {
      dispatch(setLayerStyle({ jobId, style: params.resultStyle }));
    }

    // Create job and viewpoint in parallel
    const [job] = await Promise.all([
      modelRunnerService.createImageProcessingJob(jobRequest),
      viewpointService.createViewpoint(viewpointRequest)
    ]);

    // Update Redux state
    dispatch(addJobToOrder({ jobId }));
    dispatch(fetchJobs({}));

    return {
      success: true,
      jobId,
      jobName: params.jobName,
      status: job.status,
      job
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
}
