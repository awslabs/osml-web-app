// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Extracts geometry entries from a GeoJSON feature for spatial comparison.
 *
 * Supports Polygon, MultiPolygon, Point, and LineString geometries.
 * Each entry includes the coordinates and a computed bounding box.
 * Unsupported geometry types or null geometry return an empty array.
 */

import type { Feature } from "geojson";

import type { BBox, GeometryEntry } from "./types";

/**
 * Compute an axis-aligned bounding box from an array of [lng, lat] pairs.
 */
function computeBBox(coords: [number, number][]): BBox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return { minLng, minLat, maxLng, maxLat };
}

/**
 * Resolve the feature ID as a string.
 */
function resolveFeatureId(feature: Feature): string {
  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }
  return "unknown";
}

/**
 * Extract geometry entries from a GeoJSON feature.
 *
 * @param feature - A GeoJSON Feature with geometry.
 * @returns An array of GeometryEntry objects, or an empty array for
 *          unsupported geometry types or null geometry.
 */
export function extractGeometry(feature: Feature): GeometryEntry[] {
  const geometry = feature.geometry;
  if (!geometry) return [];

  const featureId = resolveFeatureId(feature);

  switch (geometry.type) {
    case "Polygon": {
      const ring = geometry.coordinates[0] as [number, number][];
      return [{ type: "polygon", featureId, ring, bbox: computeBBox(ring) }];
    }

    case "MultiPolygon": {
      return geometry.coordinates.map((polygon) => {
        const ring = polygon[0] as [number, number][];
        return {
          type: "polygon" as const,
          featureId,
          ring,
          bbox: computeBBox(ring)
        };
      });
    }

    case "Point": {
      const position = geometry.coordinates as [number, number];
      return [
        {
          type: "point",
          featureId,
          position,
          bbox: computeBBox([position])
        }
      ];
    }

    case "LineString": {
      const path = geometry.coordinates as [number, number][];
      return [{ type: "linestring", featureId, path, bbox: computeBBox(path) }];
    }

    default:
      return [];
  }
}
