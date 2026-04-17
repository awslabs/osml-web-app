// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Pure utility functions extracted from the image viewer page.
 * These functions have no OpenLayers runtime dependency and are testable in isolation.
 */

/**
 * Calculate the zoom offset for a viewpoint based on image dimensions and tile size.
 * This determines how many zoom levels are needed to cover the full image.
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @param tileSize - Tile size in pixels
 * @returns Zoom offset value
 */
export function calculateZoomOffset(
  width: number,
  height: number,
  tileSize: number
): number {
  return Math.ceil(Math.sqrt(Math.max(width, height) / tileSize));
}

/**
 * Build a tile URL from a viewpoint ID and tile coordinates.
 * The URL template uses {z}/{x}/{y} placeholders that get replaced
 * with actual tile coordinates, adjusted by the zoom offset.
 * @param baseUrl - Tile server base URL
 * @param viewpointId - Viewpoint identifier
 * @param z - Zoom level (from tile grid)
 * @param x - Tile column
 * @param y - Tile row
 * @param zoomOffset - Zoom offset to subtract from z
 * @returns Complete tile URL
 */
export function buildTileUrl(
  baseUrl: string,
  viewpointId: string,
  z: number,
  x: number,
  y: number,
  zoomOffset: number
): string {
  return `${baseUrl}/latest/viewpoints/${viewpointId}/image/tiles/${zoomOffset - z}/${x}/${y}.PNG?compression=NONE`;
}

/**
 * Build a map tile URL for Web Mercator projection tiles.
 * Used by the 2D map viewer for viewpoint imagery overlay.
 * @param baseUrl - Tile server base URL
 * @param viewpointId - Viewpoint identifier
 * @returns URL template with {z}/{y}/{x} placeholders
 */
export function buildMapTileUrlTemplate(
  baseUrl: string,
  viewpointId: string
): string {
  return `${baseUrl}/latest/viewpoints/${viewpointId}/map/tiles/WebMercatorQuad/{z}/{y}/{x}.PNG?invert_y=true`;
}

/**
 * Parse a STAC URL to extract collection ID and item ID.
 * @param stacUrl - STAC item URL (e.g., "/collections/landsat/items/scene-001")
 * @returns Object with collectionId and itemId, or null if URL format is invalid
 */
export function parseStacUrl(
  stacUrl: string
): { collectionId: string; itemId: string } | null {
  const urlParts = stacUrl.split("/");
  const collectionIndex = urlParts.indexOf("collections");
  const itemsIndex = urlParts.indexOf("items");

  if (collectionIndex !== -1 && itemsIndex !== -1) {
    return {
      collectionId: urlParts[collectionIndex + 1],
      itemId: urlParts[itemsIndex + 1]
    };
  }

  return null;
}
