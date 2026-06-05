// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Engine-agnostic helpers for rendering detection features on the 2D map
 * (OpenLayers) and 3D globe (Cesium). These contain no OpenLayers/Cesium
 * runtime dependency: they decide *what* color a feature should be and
 * *whether* it should be hidden for the active color mode and confidence
 * threshold. Each viewer applies the result with its own styling primitives.
 */

import { extractClassification } from "@/utils/analytics/extract-classification";
import { extractConfidence } from "@/utils/analytics/extract-confidence";
import { ColorMode } from "@/utils/analytics/types";
import { confidenceToColor } from "@/utils/color-utils";

/** Color used when a feature lacks the data needed for the active color mode. */
export const MISSING_DATA_COLOR = "#808080";

/**
 * Create a stateful resolver that lazily assigns palette colors to
 * classification labels, cycling through `palette`. Create one resolver per
 * rendered layer so color assignment is stable within that layer.
 */
export function makeClassificationColorResolver(
  palette: string[]
): (classification: string) => string {
  const assigned = new Map<string, string>();
  let index = 0;
  return (classification: string): string => {
    const existing = assigned.get(classification);
    if (existing !== undefined) return existing;
    const color = palette[index % palette.length];
    index += 1;
    assigned.set(classification, color);
    return color;
  };
}

/**
 * Resolve the display (hex) color for a detection feature given the active
 * color mode:
 *  - "layer": the layer's base color
 *  - "confidence": red→green gradient by confidence, or gray when absent
 *  - "classification": a palette color per class, or gray when absent
 */
export function getFeatureDisplayColor(
  props: Record<string, unknown>,
  colorMode: ColorMode,
  baseColor: string,
  classificationColor: (classification: string) => string
): string {
  if (colorMode === "confidence") {
    const confidence = extractConfidence(props);
    return confidence !== undefined
      ? confidenceToColor(confidence)
      : MISSING_DATA_COLOR;
  }
  if (colorMode === "classification") {
    const classification = extractClassification(props);
    return classification
      ? classificationColor(classification)
      : MISSING_DATA_COLOR;
  }
  return baseColor;
}

/**
 * Whether a feature should be hidden by the confidence threshold. A threshold
 * of 0 (or less) disables filtering, and features without a confidence value
 * are never hidden.
 */
export function isBelowConfidenceThreshold(
  props: Record<string, unknown>,
  threshold: number
): boolean {
  if (threshold <= 0) return false;
  const confidence = extractConfidence(props);
  return confidence !== undefined && confidence < threshold;
}

/**
 * Parse a STAC item URL of the form `.../collections/<id>/items/<id>` into its
 * collection and item identifiers. Returns null when either segment (or the id
 * following it) is missing.
 */
export function parseStacItemUrl(
  url: string
): { collectionId: string; itemId: string } | null {
  const parts = url.split("/");
  const collectionIndex = parts.indexOf("collections");
  const itemsIndex = parts.indexOf("items");
  if (collectionIndex === -1 || itemsIndex === -1) return null;

  const collectionId = parts[collectionIndex + 1];
  const itemId = parts[itemsIndex + 1];
  if (!collectionId || !itemId) return null;

  return { collectionId, itemId };
}
