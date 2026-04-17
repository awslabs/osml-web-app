// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Analytics MCP Tools
 *
 * Provides tools for the AI agent to read and control the frontend
 * detection analytics panel: query per-layer statistics, change
 * color mode / confidence threshold, and manage detection filters.
 *
 * These tools control frontend visual analytics (real-time exploration
 * of loaded detection data). For heavyweight spatial analysis that
 * produces new derived datasets (correlation, clustering, filtering
 * by query expression, buffering), use the backend geo-agents MCP
 * server tools instead.
 */

import { Store } from "@reduxjs/toolkit";
import type { Feature, FeatureCollection } from "geojson";

import {
  addFilter,
  clearFilters,
  setColorMode,
  setConfidenceThreshold,
  toggleLayerSelection
} from "@/store/slices/analytics-slice";
import {
  computeLayerStats,
  computeSpatialOverlap,
  extractFeatureRecords,
  extractGeometry
} from "@/utils/analytics";
import type { AnalyticsFilter, ColorMode } from "@/utils/analytics/types";

import { LocalMcpTool, ToolArgs } from "./types";

// ---------------------------------------------------------------------------
// Response Interfaces
// ---------------------------------------------------------------------------

export interface GetDetectionAnalyticsResponse {
  success: boolean;
  color_mode?: ColorMode;
  confidence_threshold?: number;
  active_filters?: AnalyticsFilter[];
  selected_layer_ids?: string[];
  layers?: Array<{
    layer_id: string;
    layer_name: string;
    stats: ReturnType<typeof computeLayerStats> | null;
  }>;
  comparison?: unknown;
  error?: string;
}

export interface SetAnalyticsDisplayResponse {
  success: boolean;
  color_mode?: ColorMode;
  confidence_threshold?: number;
  active_filters?: AnalyticsFilter[];
  selected_layer_ids?: string[];
  error?: string;
}

export interface FilterDetectionsResponse {
  success: boolean;
  active_filters?: AnalyticsFilter[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_COLOR_MODES: ColorMode[] = [
  "layer",
  "confidence",
  "classification"
];

/** Read analytics + overlay state from the store. */
function readState(store: Store) {
  const root = store.getState() as {
    analytics: {
      colorMode: ColorMode;
      confidenceThreshold: number;
      activeFilters: AnalyticsFilter[];
      selectedLayerIds: string[];
    };
    overlay: {
      layers: Record<string, { id: string; name: string; source: string }>;
      layerOrder: string[];
    };
  };
  return {
    analytics: root.analytics,
    overlay: root.overlay
  };
}

/** Get detection layer IDs from the overlay slice. */
function getDetectionLayerIds(store: Store): string[] {
  const { overlay } = readState(store);
  return overlay.layerOrder.filter(
    (id) => overlay.layers[id]?.source === "detection"
  );
}

// ---------------------------------------------------------------------------
// Tool 1: get_detection_analytics
// ---------------------------------------------------------------------------

export const getDetectionAnalyticsTool: LocalMcpTool = {
  name: "get_detection_analytics",
  description:
    "Return the current detection analytics state including color mode, confidence threshold, " +
    "active filters, and per-layer statistics (feature count, average confidence, top " +
    "classifications, confidence histogram). Accepts an optional layer_id to return stats " +
    "for a single layer. Returns comparison result when two layers are selected. " +
    "This tool controls frontend visual analytics. For backend spatial analysis " +
    "(correlation, clustering, etc.) use the geo-agents MCP server.",
  schema: {
    type: "object",
    properties: {
      layer_id: {
        type: "string",
        description:
          "Optional detection layer ID. When provided, returns stats for only that layer."
      },
      _cacheService: {
        description: "Internal: injected cache service for testing."
      }
    },
    additionalProperties: false
  },
  handler: (
    args: ToolArgs & {
      layer_id?: string;
      _cacheService?: {
        get(id: string): FeatureCollection | null;
      };
    },
    store: Store
  ): GetDetectionAnalyticsResponse => {
    const { analytics, overlay } = readState(store);
    const cache = args._cacheService;

    // Determine which layers to report on
    let targetLayerIds = getDetectionLayerIds(store);

    if (args.layer_id) {
      if (!targetLayerIds.includes(args.layer_id as string)) {
        return {
          success: false,
          error: `Detection layer not found: "${args.layer_id}". Available detection layers: ${targetLayerIds.join(", ") || "(none)"}`
        };
      }
      targetLayerIds = [args.layer_id as string];
    }

    // Compute per-layer stats
    const layers = targetLayerIds.map((layerId) => {
      const layerMeta = overlay.layers[layerId];
      let stats = null;
      if (cache) {
        const records = extractFeatureRecords(layerId, cache);
        stats = computeLayerStats(records, analytics.confidenceThreshold);
      }
      return {
        layer_id: layerId,
        layer_name: layerMeta?.name ?? layerId,
        stats
      };
    });

    // Comparison result when exactly 2 layers are selected
    let comparison = null;
    if (analytics.selectedLayerIds.length === 2 && cache) {
      try {
        const [idA, idB] = analytics.selectedLayerIds;
        const cacheA = cache.get(idA);
        const cacheB = cache.get(idB);
        if (cacheA && cacheB) {
          const geoA = cacheA.features.flatMap((f: Feature) =>
            extractGeometry(f)
          );
          const geoB = cacheB.features.flatMap((f: Feature) =>
            extractGeometry(f)
          );
          comparison = computeSpatialOverlap(geoA, geoB);
        }
      } catch {
        // Gracefully skip comparison on error
      }
    }

    return {
      success: true,
      color_mode: analytics.colorMode,
      confidence_threshold: analytics.confidenceThreshold,
      active_filters: analytics.activeFilters,
      selected_layer_ids: analytics.selectedLayerIds,
      layers,
      comparison
    };
  }
};

// ---------------------------------------------------------------------------
// Tool 2: set_analytics_display
// ---------------------------------------------------------------------------

export const setAnalyticsDisplayTool: LocalMcpTool = {
  name: "set_analytics_display",
  description:
    "Update the detection analytics display settings. Accepts optional color_mode " +
    '("layer", "confidence", "classification"), confidence_threshold (0–1), and ' +
    "selected_layer_ids (array of 0–2 layer IDs for comparison). Returns the " +
    "updated analytics state. This tool controls frontend visual analytics. " +
    "For backend spatial analysis use the geo-agents MCP server.",
  schema: {
    type: "object",
    properties: {
      color_mode: {
        type: "string",
        enum: ["layer", "confidence", "classification"],
        description: "Color mode for detection features."
      },
      confidence_threshold: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Global confidence threshold (0–1)."
      },
      selected_layer_ids: {
        type: "array",
        items: { type: "string" },
        maxItems: 2,
        description: "Layer IDs to select for comparison (max 2)."
      }
    },
    additionalProperties: false
  },
  handler: (
    args: {
      color_mode?: string;
      confidence_threshold?: number;
      selected_layer_ids?: string[];
    },
    store: Store
  ): SetAnalyticsDisplayResponse => {
    // Validate color_mode
    if (
      args.color_mode !== undefined &&
      !VALID_COLOR_MODES.includes(args.color_mode as ColorMode)
    ) {
      return {
        success: false,
        error: `Invalid color_mode: "${args.color_mode}". Must be one of: ${VALID_COLOR_MODES.join(", ")}`
      };
    }

    // Dispatch actions
    if (args.color_mode !== undefined) {
      store.dispatch(setColorMode(args.color_mode as ColorMode));
    }

    if (args.confidence_threshold !== undefined) {
      store.dispatch(setConfidenceThreshold(args.confidence_threshold));
    }

    if (args.selected_layer_ids !== undefined) {
      // Reset current selection then toggle desired IDs (max 2)
      const { analytics } = readState(store);
      // Remove currently selected layers
      for (const id of Array.from(analytics.selectedLayerIds)) {
        store.dispatch(toggleLayerSelection(id));
      }
      // Add new selections (cap at 2)
      const idsToSelect = args.selected_layer_ids.slice(0, 2);
      for (const id of idsToSelect) {
        store.dispatch(toggleLayerSelection(id));
      }
    }

    // Return updated state
    const updated = readState(store).analytics;
    return {
      success: true,
      color_mode: updated.colorMode,
      confidence_threshold: updated.confidenceThreshold,
      active_filters: updated.activeFilters,
      selected_layer_ids: updated.selectedLayerIds
    };
  }
};

// ---------------------------------------------------------------------------
// Tool 3: filter_detections
// ---------------------------------------------------------------------------

export const filterDetectionsTool: LocalMcpTool = {
  name: "filter_detections",
  description:
    "Apply detection filters to the analytics panel. Accepts a filters array " +
    '(each with type "classification" or "confidence-range" and corresponding ' +
    "value fields) and an optional clear boolean. When clear is true, all " +
    "existing filters are removed before applying new ones. Returns the " +
    "updated active filters list. This tool controls frontend visual analytics. " +
    "For backend spatial analysis use the geo-agents MCP server.",
  schema: {
    type: "object",
    properties: {
      filters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: ["classification", "confidence-range"]
            },
            label: { type: "string" },
            value: {}
          },
          required: ["id", "type", "label", "value"]
        },
        description: "Array of filter objects to apply."
      },
      clear: {
        type: "boolean",
        default: false,
        description:
          "If true, clear all existing filters before adding new ones."
      }
    },
    required: ["filters"],
    additionalProperties: false
  },
  handler: (
    args: { filters?: AnalyticsFilter[]; clear?: boolean },
    store: Store
  ): FilterDetectionsResponse => {
    if (!Array.isArray(args.filters)) {
      return {
        success: false,
        error:
          "Missing or invalid 'filters' parameter. Expected an array of filter objects."
      };
    }

    // Clear existing filters if requested
    if (args.clear) {
      store.dispatch(clearFilters());
    }

    // Add each filter
    for (const filter of args.filters) {
      store.dispatch(addFilter(filter));
    }

    // Return updated state
    const updated = readState(store).analytics;
    return {
      success: true,
      active_filters: updated.activeFilters
    };
  }
};
