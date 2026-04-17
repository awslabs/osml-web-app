// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit and property-based tests for analytics MCP tools.
 *
 * Covers get_detection_analytics, set_analytics_display, and filter_detections.
 */

import { configureStore, Store } from "@reduxjs/toolkit";
import * as fc from "fast-check";
import type { Feature, FeatureCollection } from "geojson";

import {
  FilterDetectionsResponse,
  filterDetectionsTool,
  GetDetectionAnalyticsResponse,
  getDetectionAnalyticsTool,
  SetAnalyticsDisplayResponse,
  setAnalyticsDisplayTool
} from "@/mcp/local-server/analytics-tools";
import analyticsReducer, {
  addFilter,
  toggleLayerSelection
} from "@/store/slices/analytics-slice";
import overlayReducer, { addLayer } from "@/store/slices/overlay-slice";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock cache that satisfies the GeoJSONCacheService interface. */
function createMockCache(entries: Record<string, FeatureCollection> = {}) {
  return {
    get(layerId: string) {
      return entries[layerId] ?? undefined;
    }
  };
}

/** Build a feature with optional confidence / classification properties. */
function makeFeature(
  id: string,
  confidence?: number,
  classification?: string
): Feature {
  const props: Record<string, unknown> = {};
  if (confidence !== undefined) props.confidence = confidence;
  if (classification !== undefined) props.classification = classification;
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: props
  };
}

/** Create a Redux store with analytics + overlay slices. */
function createTestStore() {
  return configureStore({
    reducer: {
      analytics: analyticsReducer,
      overlay: overlayReducer
    }
  });
}

/** Add a detection layer to the store's overlay slice. */
function addDetectionLayer(store: Store, id: string, name: string) {
  store.dispatch(
    addLayer({
      id,
      name,
      source: "detection",
      visible: true,
      zIndex: 1,
      featureCount: 0
    })
  );
}

// ---------------------------------------------------------------------------
// Unit tests — get_detection_analytics
// ---------------------------------------------------------------------------

describe("get_detection_analytics", () => {
  it("returns current analytics state and per-layer stats", () => {
    const store = createTestStore();
    addDetectionLayer(store, "layer-1", "Layer 1");

    const cache = createMockCache({
      "layer-1": {
        type: "FeatureCollection",
        features: [
          makeFeature("f1", 0.9, "building"),
          makeFeature("f2", 0.4, "vehicle"),
          makeFeature("f3", undefined, "building")
        ]
      }
    });

    const result = getDetectionAnalyticsTool.handler(
      { _cacheService: cache },
      store
    ) as GetDetectionAnalyticsResponse;

    expect(result.success).toBe(true);
    expect(result.color_mode).toBe("layer");
    expect(result.confidence_threshold).toBe(0);
    expect(result.active_filters).toEqual([]);
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].layer_id).toBe("layer-1");
    expect(result.layers![0].stats!.totalCount).toBe(3);
  });

  it("returns error for non-existent layer_id", () => {
    const store = createTestStore();
    addDetectionLayer(store, "layer-1", "Layer 1");

    const result = getDetectionAnalyticsTool.handler(
      { layer_id: "no-such-layer", _cacheService: createMockCache() },
      store
    ) as GetDetectionAnalyticsResponse;

    expect(result.success).toBe(false);
    expect(result.error).toContain("no-such-layer");
  });

  it("returns stats for a single layer when layer_id is provided", () => {
    const store = createTestStore();
    addDetectionLayer(store, "layer-1", "Layer 1");
    addDetectionLayer(store, "layer-2", "Layer 2");

    const cache = createMockCache({
      "layer-1": {
        type: "FeatureCollection",
        features: [makeFeature("f1", 0.5)]
      },
      "layer-2": {
        type: "FeatureCollection",
        features: [makeFeature("f2", 0.8), makeFeature("f3", 0.3)]
      }
    });

    const result = getDetectionAnalyticsTool.handler(
      { layer_id: "layer-2", _cacheService: cache },
      store
    ) as GetDetectionAnalyticsResponse;

    expect(result.success).toBe(true);
    expect(result.layers).toHaveLength(1);
    expect(result.layers![0].layer_id).toBe("layer-2");
    expect(result.layers![0].stats!.totalCount).toBe(2);
  });

  it("returns comparison result when two layers are selected", () => {
    const store = createTestStore();
    addDetectionLayer(store, "layer-a", "Layer A");
    addDetectionLayer(store, "layer-b", "Layer B");
    store.dispatch(toggleLayerSelection("layer-a"));
    store.dispatch(toggleLayerSelection("layer-b"));

    const cache = createMockCache({
      "layer-a": {
        type: "FeatureCollection",
        features: [makeFeature("fa1", 0.9, "building")]
      },
      "layer-b": {
        type: "FeatureCollection",
        features: [makeFeature("fb1", 0.8, "vehicle")]
      }
    });

    const result = getDetectionAnalyticsTool.handler(
      { _cacheService: cache },
      store
    ) as GetDetectionAnalyticsResponse;

    expect(result.success).toBe(true);
    expect(result.comparison).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — set_analytics_display
// ---------------------------------------------------------------------------

describe("set_analytics_display", () => {
  it("updates state with valid params and returns updated state", () => {
    const store = createTestStore();

    const result = setAnalyticsDisplayTool.handler(
      { color_mode: "confidence", confidence_threshold: 0.5 },
      store
    ) as SetAnalyticsDisplayResponse;

    expect(result.success).toBe(true);
    expect(result.color_mode).toBe("confidence");
    expect(result.confidence_threshold).toBe(0.5);
  });

  it("returns error for invalid color_mode", () => {
    const store = createTestStore();

    const result = setAnalyticsDisplayTool.handler(
      { color_mode: "invalid-mode" },
      store
    ) as SetAnalyticsDisplayResponse;

    expect(result.success).toBe(false);
    expect(result.error).toContain("color_mode");
  });

  it("updates selected_layer_ids", () => {
    const store = createTestStore();

    const result = setAnalyticsDisplayTool.handler(
      { selected_layer_ids: ["a", "b"] },
      store
    ) as SetAnalyticsDisplayResponse;

    expect(result.success).toBe(true);
    expect(result.selected_layer_ids).toEqual(["a", "b"]);
  });

  it("caps selected_layer_ids at 2", () => {
    const store = createTestStore();

    const result = setAnalyticsDisplayTool.handler(
      { selected_layer_ids: ["a", "b", "c"] },
      store
    ) as SetAnalyticsDisplayResponse;

    expect(result.success).toBe(true);
    // Should only keep first 2
    expect(result.selected_layer_ids!.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — filter_detections
// ---------------------------------------------------------------------------

describe("filter_detections", () => {
  it("validates that filters is an array", () => {
    const store = createTestStore();

    const result = filterDetectionsTool.handler(
      {},
      store
    ) as FilterDetectionsResponse;

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("adds filters to state", () => {
    const store = createTestStore();

    const result = filterDetectionsTool.handler(
      {
        filters: [
          {
            id: "cls-building",
            type: "classification",
            label: "Building",
            value: "building"
          }
        ]
      },
      store
    ) as FilterDetectionsResponse;

    expect(result.success).toBe(true);
    expect(result.active_filters).toHaveLength(1);
    expect(result.active_filters![0].id).toBe("cls-building");
  });

  it("clears existing filters before adding when clear is true", () => {
    const store = createTestStore();
    // Pre-populate a filter
    store.dispatch(
      addFilter({
        id: "old-filter",
        type: "classification",
        label: "Old",
        value: "old"
      })
    );

    const result = filterDetectionsTool.handler(
      {
        clear: true,
        filters: [
          {
            id: "new-filter",
            type: "classification",
            label: "New",
            value: "new"
          }
        ]
      },
      store
    ) as FilterDetectionsResponse;

    expect(result.success).toBe(true);
    expect(result.active_filters).toHaveLength(1);
    expect(result.active_filters![0].id).toBe("new-filter");
  });

  it("appends filters without clearing when clear is false", () => {
    const store = createTestStore();
    store.dispatch(
      addFilter({
        id: "existing",
        type: "classification",
        label: "Existing",
        value: "existing"
      })
    );

    const result = filterDetectionsTool.handler(
      {
        clear: false,
        filters: [
          {
            id: "added",
            type: "classification",
            label: "Added",
            value: "added"
          }
        ]
      },
      store
    ) as FilterDetectionsResponse;

    expect(result.success).toBe(true);
    expect(result.active_filters).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Property test: set_analytics_display dispatches correct actions
// ---------------------------------------------------------------------------

describe("Property: set_analytics_display dispatches correct actions", () => {
  it("updates analytics state to reflect provided parameters", () => {
    fc.assert(
      fc.property(
        fc.record({
          color_mode: fc.constantFrom(
            "layer" as const,
            "confidence" as const,
            "classification" as const
          ),
          confidence_threshold: fc.double({ min: 0, max: 1, noNaN: true }),
          selected_layer_ids: fc.array(
            fc.string({ minLength: 1, maxLength: 10 }),
            {
              minLength: 0,
              maxLength: 2
            }
          )
        }),
        (params) => {
          const store = createTestStore();

          const result = setAnalyticsDisplayTool.handler(
            params,
            store
          ) as SetAnalyticsDisplayResponse;

          expect(result.success).toBe(true);
          expect(result.color_mode).toBe(params.color_mode);

          // Threshold is clamped to [0, 1]
          const clamped = Math.max(0, Math.min(1, params.confidence_threshold));
          expect(result.confidence_threshold).toBeCloseTo(clamped, 10);

          // Selected layer IDs capped at 2
          expect(result.selected_layer_ids!.length).toBeLessThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property test: filter_detections clear-then-add semantics
// ---------------------------------------------------------------------------

describe("Property: filter_detections clear-then-add semantics", () => {
  const filterArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    type: fc.constantFrom(
      "classification" as const,
      "confidence-range" as const
    ),
    label: fc.string({ minLength: 1, maxLength: 20 }),
    value: fc.string({ minLength: 1, maxLength: 20 })
  });

  it("with clear=true, resulting filters contain only the newly provided filters", () => {
    fc.assert(
      fc.property(
        fc.array(filterArb, { minLength: 0, maxLength: 5 }),
        fc.array(filterArb, { minLength: 0, maxLength: 5 }),
        (preExisting, newFilters) => {
          const store = createTestStore();

          // Add pre-existing filters
          for (const f of preExisting) {
            store.dispatch(addFilter(f));
          }

          const result = filterDetectionsTool.handler(
            { clear: true, filters: newFilters },
            store
          ) as FilterDetectionsResponse;

          expect(result.success).toBe(true);

          // After clear + add, only new filters should be present (respecting uniqueness)
          const seenIds = new Set<string>();
          const uniqueNewIds: string[] = [];
          for (const f of newFilters) {
            if (!seenIds.has(f.id)) {
              seenIds.add(f.id);
              uniqueNewIds.push(f.id);
            }
          }
          expect(result.active_filters!.length).toBe(uniqueNewIds.length);

          // No pre-existing filter IDs should remain (unless they share an ID with a new filter)
          for (const f of result.active_filters!) {
            expect(uniqueNewIds).toContain(f.id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("with clear=false, resulting filters include both pre-existing and new (unique by id)", () => {
    fc.assert(
      fc.property(
        fc.array(filterArb, { minLength: 0, maxLength: 5 }),
        fc.array(filterArb, { minLength: 0, maxLength: 5 }),
        (preExisting, newFilters) => {
          const store = createTestStore();

          for (const f of preExisting) {
            store.dispatch(addFilter(f));
          }
          const preCount = (
            store.getState() as { analytics: { activeFilters: unknown[] } }
          ).analytics.activeFilters.length;

          const result = filterDetectionsTool.handler(
            { clear: false, filters: newFilters },
            store
          ) as FilterDetectionsResponse;

          expect(result.success).toBe(true);

          // Result should have at least as many as pre-existing (new ones may be dupes)
          expect(result.active_filters!.length).toBeGreaterThanOrEqual(
            preCount
          );

          // No duplicate IDs
          const ids = result.active_filters!.map((f: { id: string }) => f.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
