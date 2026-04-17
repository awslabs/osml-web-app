// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Single source of truth for Tile Server (viewpoint) defaults.
 *
 * Consumers: CreateViewpointModal, stac-viewpoint-utils.
 */

export const DEFAULT_TILE_SIZE = 256;
export const DEFAULT_RANGE_ADJUSTMENT: "NONE" | "MINMAX" | "DRA" = "DRA";
