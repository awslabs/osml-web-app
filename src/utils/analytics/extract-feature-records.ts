// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Extracts feature records from a GeoJSON cache for analytics computation.
 *
 * Reads the FeatureCollection for a given layer ID from the cache,
 * converts each feature's properties using extractConfidence and
 * extractClassification, and returns an array of FeatureRecord objects.
 */

import type { FeatureCollection } from "geojson";

import { extractClassification } from "./extract-classification";
import { extractConfidence } from "./extract-confidence";
import { FeatureRecord } from "./types";

/**
 * Minimal cache interface: stores GeoJSON FeatureCollections keyed
 * by overlay layer ID.
 */
export interface GeoJSONCacheService {
  get(layerId: string): FeatureCollection | null;
}

/**
 * Extract analytics feature records from cached GeoJSON data.
 *
 * @param layerId - The detection layer ID to look up in the cache.
 * @param cache - The GeoJSON cache service instance.
 * @returns An array of FeatureRecord objects, or an empty array if the
 *          cache has no entry for the given layer ID.
 */
export function extractFeatureRecords(
  layerId: string,
  cache: GeoJSONCacheService
): FeatureRecord[] {
  const collection = cache.get(layerId);
  if (!collection) {
    return [];
  }

  const records: FeatureRecord[] = [];

  for (const feature of collection.features) {
    if (!feature.properties || !feature.geometry) {
      continue;
    }

    const featureId =
      feature.id != null ? String(feature.id) : String(records.length);

    records.push({
      featureId,
      confidence: extractConfidence(feature.properties),
      classification: extractClassification(feature.properties),
      visible: true
    });
  }

  return records;
}
