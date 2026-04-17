// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Utility functions for STAC item to viewpoint integration
 */

import type { StacAsset, StacItem } from "stac-ts";

import {
  DEFAULT_RANGE_ADJUSTMENT,
  DEFAULT_TILE_SIZE
} from "@/config/tile-server-defaults";

export interface S3Location {
  bucket: string;
  key: string;
}

/** An asset entry with its key from the assets dictionary. */
type AssetEntry = StacAsset & { key: string };

/**
 * Extract S3 bucket and key from various S3 URL formats
 */
export function extractS3Location(href: string): S3Location | null {
  if (!href) return null;

  try {
    // Format 1: s3://bucket/key
    const s3Match = href.match(/^s3:\/\/([^/]+)\/(.+)$/);

    if (s3Match) {
      return {
        bucket: s3Match[1],
        key: s3Match[2]
      };
    }

    // Format 2: https://bucket.s3[-.]region.domain.tld/key (virtual-hosted, any AWS partition)
    // Pattern: bucket.s3.region.domain OR bucket.s3-region.domain
    const virtualHostedMatch = href.match(
      /^https?:\/\/([^.]+)\.s3[.-]([^/]+)\/(.+)$/
    );

    if (virtualHostedMatch) {
      return {
        bucket: virtualHostedMatch[1],
        key: virtualHostedMatch[3]
      };
    }

    // Format 3: https://s3[-.]region.domain.tld/bucket/key (path-style, any AWS partition)
    // Pattern: s3.region.domain/bucket/key OR s3-region.domain/bucket/key
    const pathStyleMatch = href.match(
      /^https?:\/\/s3[.-]([^/]+)\/([^/]+)\/(.+)$/
    );

    if (pathStyleMatch) {
      return {
        bucket: pathStyleMatch[2],
        key: pathStyleMatch[3]
      };
    }

    return null;
  } catch {
    // Invalid URL format - return null
    return null;
  }
}

/**
 * Find the best image asset from a STAC item's assets
 * Prioritizes: 1) COG with data role, 2) GeoTIFF with data role, 3) Any image with data role, 4) Any image asset
 */
export function findImageAsset(item: StacItem): AssetEntry | null {
  if (!item?.assets) return null;

  const assets: AssetEntry[] = Object.entries(item.assets).map(
    ([key, asset]) => ({
      key,
      ...asset
    })
  );

  // Priority 1: Cloud-Optimized GeoTIFF with 'data' role
  const cogDataAsset = assets.find(
    (asset) =>
      asset.roles?.includes("data") &&
      (asset.type?.includes("cloud-optimized") || asset.type?.includes("cog"))
  );

  if (cogDataAsset) return cogDataAsset;

  // Priority 2: GeoTIFF with 'data' role
  const tiffDataAsset = assets.find(
    (asset) =>
      asset.roles?.includes("data") &&
      (asset.type?.includes("geotiff") || asset.type?.includes("tiff"))
  );

  if (tiffDataAsset) return tiffDataAsset;

  // Priority 3: Any image type with 'data' role
  const imageDataAsset = assets.find(
    (asset) => asset.roles?.includes("data") && asset.type?.startsWith("image/")
  );

  if (imageDataAsset) return imageDataAsset;

  // Priority 4: Any image asset (fallback)
  const anyImageAsset = assets.find((asset) =>
    asset.type?.startsWith("image/")
  );

  if (anyImageAsset) return anyImageAsset;

  return null;
}

/**
 * Check if a STAC item has a viewable image asset with accessible S3 location
 */
export function hasViewableImageAsset(item: StacItem): boolean {
  const imageAsset = findImageAsset(item);

  if (!imageAsset) return false;

  const s3Location = extractS3Location(imageAsset.href);

  return s3Location !== null;
}

/**
 * Generate a viewpoint ID from STAC collection and item ID
 * Format: collection--item_id (e.g., "landsat-c2-l2--LC08_L2SP_042034_20240515_20240524_02_T1")
 */
export function generateViewpointId(
  collectionId: string,
  itemId: string
): string {
  return `${collectionId}--${itemId}`;
}

/**
 * Generate a viewpoint name from STAC item
 * Uses item title if available, otherwise falls back to item ID
 */
export function generateViewpointName(item: StacItem): string {
  return item.properties?.title || item.id;
}

/**
 * Check if an asset is likely to work with the viewpoint tile server
 * Validates that it's an image format and has an accessible S3 location
 */
export function isViewpointCompatibleAsset(asset: StacAsset): boolean {
  // Check for supported image types
  const supportedTypes = [
    "image/tiff",
    "image/geotiff",
    "image/vnd.stac.geotiff",
    "image/cog",
    "image/x-geotiff",
    "image/nitf",
    "image/ntf"
  ];

  const isSupported = supportedTypes.some((type) =>
    asset.type?.toLowerCase().includes(type.toLowerCase())
  );

  if (!isSupported) return false;

  // Verify S3 location is extractable
  return extractS3Location(asset.href) !== null;
}

/**
 * Get viewpoint creation request data from a STAC item
 */
export function getViewpointRequestFromStacItem(item: StacItem): {
  viewpoint_id: string;
  viewpoint_name: string;
  bucket_name: string;
  object_key: string;
  tile_size: number;
  range_adjustment: "NONE" | "MINMAX" | "DRA";
} | null {
  const imageAsset = findImageAsset(item);

  if (!imageAsset) return null;

  const s3Location = extractS3Location(imageAsset.href);

  if (!s3Location) return null;

  return {
    viewpoint_id: generateViewpointId(item.collection ?? "", item.id),
    viewpoint_name: generateViewpointName(item),
    bucket_name: s3Location.bucket,
    object_key: s3Location.key,
    tile_size: DEFAULT_TILE_SIZE,
    range_adjustment: DEFAULT_RANGE_ADJUSTMENT
  };
}
