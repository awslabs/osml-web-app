// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Single source of truth for Model Runner image processing job defaults.
 *
 * Consumers: CreateJobModal, MCP submit_image_processing_job tool, submitJob().
 */

import { FeatureDistillation } from "@/services/model-runner-service";

// ─── Tile defaults ───────────────────────────────────────────────────────────

export const DEFAULT_TILE_SIZE = 512;
export const DEFAULT_TILE_OVERLAP = 128;
export const DEFAULT_TILE_FORMAT = "GTIFF";
export const DEFAULT_TILE_COMPRESSION = "NONE";

// ─── Processing defaults ─────────────────────────────────────────────────────

export const DEFAULT_RANGE_ADJUSTMENT: "NONE" | "MINMAX" | "DRA" = "DRA";
export const DEFAULT_MODEL_TYPE = "SM_ENDPOINT";
export const DEFAULT_INCLUDE_KINESIS_OUTPUT = true;

// ─── Result-style defaults ───────────────────────────────────────────────────

export const DEFAULT_RESULT_OPACITY = 0.5;

// ─── Post-processing defaults ────────────────────────────────────────────────

export const DEFAULT_IOU_THRESHOLD = 0.75;
export const DEFAULT_SOFT_NMS_SKIP_BOX_THRESHOLD = 0.0001;
export const DEFAULT_SOFT_NMS_SIGMA = 0.1;

export const DEFAULT_POST_PROCESSING: FeatureDistillation[] = [
  {
    step: "FEATURE_DISTILLATION",
    algorithm: { algorithm_type: "NMS", iouThreshold: DEFAULT_IOU_THRESHOLD }
  }
];
