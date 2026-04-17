// Copyright Amazon.com, Inc. or its affiliates.
export enum LoadingStatus {
  Success = "Success",
  Loading = "Loading",
  Error = "Error"
}

// Image Adjustment Types
export interface ImageAdjustments {
  exposure: number; // -1 to 1, default 0
  contrast: number; // -1 to 1, default 0
  saturation: number; // -1 to 1, default 0
  gamma: number; // 0.1 to 3.0, default 1.0
  redGain: number; // 0 to 2, default 1.0
  greenGain: number; // 0 to 2, default 1.0
  blueGain: number; // 0 to 2, default 1.0
}

export interface AdjustmentConstraints {
  min: number;
  max: number;
  default: number;
}

export const ADJUSTMENT_CONSTRAINTS: Record<
  keyof ImageAdjustments,
  AdjustmentConstraints
> = {
  exposure: { min: -1, max: 1, default: 0 },
  contrast: { min: -1, max: 1, default: 0 },
  saturation: { min: -1, max: 1, default: 0 },
  gamma: { min: 0.1, max: 3.0, default: 1.0 },
  redGain: { min: 0, max: 2, default: 1.0 },
  greenGain: { min: 0, max: 2, default: 1.0 },
  blueGain: { min: 0, max: 2, default: 1.0 }
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  exposure: ADJUSTMENT_CONSTRAINTS.exposure.default,
  contrast: ADJUSTMENT_CONSTRAINTS.contrast.default,
  saturation: ADJUSTMENT_CONSTRAINTS.saturation.default,
  gamma: ADJUSTMENT_CONSTRAINTS.gamma.default,
  redGain: ADJUSTMENT_CONSTRAINTS.redGain.default,
  greenGain: ADJUSTMENT_CONSTRAINTS.greenGain.default,
  blueGain: ADJUSTMENT_CONSTRAINTS.blueGain.default
};

/**
 * Clamps an adjustment value to its valid range.
 * @param key - The adjustment key (exposure, contrast, etc.)
 * @param value - The value to clamp
 * @returns The clamped value within the valid range
 */
export function clampAdjustment(
  key: keyof ImageAdjustments,
  value: number
): number {
  const constraints = ADJUSTMENT_CONSTRAINTS[key];
  return Math.max(constraints.min, Math.min(constraints.max, value));
}

/**
 * Checks if an adjustment value is within its valid range.
 * @param key - The adjustment key (exposure, contrast, etc.)
 * @param value - The value to validate
 * @returns True if the value is within the valid range
 */
export function isValidAdjustment(
  key: keyof ImageAdjustments,
  value: number
): boolean {
  const constraints = ADJUSTMENT_CONSTRAINTS[key];
  return value >= constraints.min && value <= constraints.max;
}

export interface NavbarState {
  drawerOpen: boolean;
  currentRoute: string;
  isChatWidgetExpanded: boolean;
}

export interface Viewpoint {
  viewpoint_id: string;
  viewpoint_name: string;
  viewpoint_status: string;
  bucket_name: string;
  object_key: string;
  tile_size: number;
  range_adjustment: string;
  local_object_path: string;
  error_message: string;
  expire_time: number;
}

export interface ViewpointMetadata {
  metadata: Record<string, unknown> | null;
}

export interface ViewpointBounds {
  bounds: number[];
}

export interface ViewpointInfo {
  type: string;
  features: Record<string, unknown>[];
}

export interface ViewpointStatistics {
  image_statistics: Record<string, unknown> | null;
}

export interface ViewpointExtent {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface SelectedViewpoint {
  viewpointId: string;
  viewpointTileSize: number;
}

export interface CreateViewpointForm {
  viewpointName: string;
  viewpointId: string;
  bucketName: string;
  objectKey: string;
  tileSize: number;
  rangeAdjustment: "NONE" | "MINMAX" | "DRA";
}

// Create a corresponding type for the API request
export interface CreateViewpointRequest {
  viewpoint_name: string;
  viewpoint_id: string;
  bucket_name: string;
  object_key: string;
  tile_size: number;
  range_adjustment: "NONE" | "MINMAX" | "DRA";
}

// Helper function to convert camelCase to snake_case for the API
export function viewpointToSnakeCase(
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

export interface S3Bucket {
  name: string;
  creationDate: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

export interface S3State {
  buckets: S3Bucket[];
  selectedBucket: string | null;
  bucketObjects: S3Object[];
  bucketsStatus: LoadingStatus;
  bucketsError: string | null;
  objectsStatus: LoadingStatus;
  objectsError: string | null;
}

// export interface RootState {
//   // router: RouterState;
//   navbar: NavbarState;
//   imageViewer: ImageViewerState;
//   s3: S3State;
// }

// Helper type for async thunk responses
export interface ApiResponse<T> {
  data: T;
  status: LoadingStatus;
  error?: string;
}

// SageMaker Endpoint types
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
