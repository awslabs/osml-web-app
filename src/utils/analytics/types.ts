// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared type definitions for the Detection Analytics Panel.
 *
 * These types are used across analytics utilities, the Redux slice,
 * UI components, and MCP tools.
 */

/** A single feature's extracted analytics data. */
export interface FeatureRecord {
  featureId: string;
  confidence: number | undefined;
  classification: string | undefined;
  visible: boolean;
}

/** Aggregated statistics for a single detection layer. */
export interface LayerStats {
  totalCount: number;
  visibleCount: number;
  classificationCounts: Record<string, number>;
  /** 10 bins: [0,0.1), [0.1,0.2), …, [0.9,1.0] */
  confidenceHistogram: number[];
  avgConfidence: number | undefined;
  unknownConfidenceCount: number;
  unclassifiedCount: number;
}

/** Axis-aligned bounding box in geographic coordinates. */
export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** A geometry entry extracted from a GeoJSON feature for spatial comparison. */
export type GeometryEntry =
  | { type: "polygon"; featureId: string; ring: [number, number][]; bbox: BBox }
  | { type: "point"; featureId: string; position: [number, number]; bbox: BBox }
  | {
      type: "linestring";
      featureId: string;
      path: [number, number][];
      bbox: BBox;
    };

/** Result of comparing two detection layers spatially. */
export interface ComparisonResult {
  uniqueToA: string[];
  uniqueToB: string[];
  overlapping: Array<{ featureIdA: string; featureIdB: string }>;
}

/** A user-created filter applied to detection features. */
export interface AnalyticsFilter {
  id: string;
  type: "classification" | "confidence-range";
  label: string;
  value: string | { min: number; max: number };
}

/** Controls how detection features are color-coded on the renderer. */
export type ColorMode = "layer" | "confidence" | "classification";

/** Root state shape for the analytics Redux slice. */
export interface AnalyticsState {
  colorMode: ColorMode;
  activeFilters: AnalyticsFilter[];
  selectedLayerIds: string[];
  confidenceThreshold: number;
}

/** Shared 10-color palette for classification coloring across chart and renderers. */
export const CLASSIFICATION_PALETTE = [
  "#ffaa00",
  "#44ff44",
  "#00ffff",
  "#ff00ff",
  "#ff4444",
  "#aa44ff",
  "#ffff00",
  "#ff69b4",
  "#00ff88",
  "#4488ff"
];
