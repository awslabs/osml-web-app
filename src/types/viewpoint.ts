// Copyright Amazon.com, Inc. or its affiliates.
/** Viewpoint domain types shared across the imagery/image-viewer slices,
 *  viewpoint service, and viewpoint-creation flow. */

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
