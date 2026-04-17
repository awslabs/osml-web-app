// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Map Page overlay consumption.
 *
 * The Map Page is a complex component with OpenLayers, which is hard to
 * unit test in jsdom. Instead of testing the full component render, these
 * tests verify the DATA FLOW logic:
 *
 * 1. Detection layer data is read from GeoJSONCacheService when overlay layer exists
 * 2. Agent features are read from state.overlay.inlineFeatures["agent-features"]
 * 3. Layers with visible: false are not included in rendering data
 * 4. Missing cache entries (null) don't cause errors
 *
 * We test the useOverlayLayerData hook directly using renderHook.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6
 */

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { useOverlayLayerData } from "@/hooks/use-overlay-layer-data";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import overlayReducer, {
  addFeature,
  addLayer,
  GeoJSONFeature,
  OverlayLayer,
  setLayerVisibility
} from "@/store/slices/overlay-slice";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Redux store with just the overlay slice for testing. */
function createTestStore() {
  return configureStore({
    reducer: { overlay: overlayReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware()
  });
}

/** Wrapper component that provides the Redux store to hooks. */
function createWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  };
}

/** Sample detection FeatureCollection for cache tests. */
const sampleDetectionData = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0]
          ]
        ]
      },
      properties: { score: 0.95 }
    },
    {
      type: "Feature" as const,
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [2, 2],
            [3, 2],
            [3, 3],
            [2, 3],
            [2, 2]
          ]
        ]
      },
      properties: { score: 0.87 }
    }
  ]
};

/** Sample agent feature. */
const sampleAgentFeature: GeoJSONFeature = {
  type: "Feature",
  id: "agent-feat-1",
  geometry: { type: "Point", coordinates: [10, 20] },
  properties: {
    createdBy: "agent",
    createdAt: "2025-01-01T00:00:00.000Z",
    description: "Test agent feature"
  }
};

/** Sample detection overlay layer. */
const sampleDetectionLayer: OverlayLayer = {
  id: "detection-job-123",
  name: "Detection: job-123",
  source: "detection",
  visible: true,
  zIndex: 10,
  featureCount: 2,
  metadata: { jobId: "job-123", loading: false }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Map Page overlay consumption (useOverlayLayerData)", () => {
  beforeEach(() => {
    GeoJSONCacheService.resetInstance();
  });

  // =========================================================================
  // Test 1: Detection layer data is read from GeoJSONCacheService
  // Validates: Requirements 5.1, 5.2
  // =========================================================================

  describe("detection layer data from cache", () => {
    it("returns FeatureCollection from GeoJSONCacheService when overlay layer exists", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      // Set up: add detection layer to overlay state and data to cache
      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-job-123", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();
      expect(result.current!.type).toBe("FeatureCollection");
      expect(result.current!.features).toHaveLength(2);
      expect(result.current!.features).toEqual(sampleDetectionData.features);
    });

    it("re-renders when cache data changes for a detection layer", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      // Initially null (no cache data yet)
      expect(result.current).toBeNull();

      // Set cache data — hook should re-render with the data
      act(() => {
        cache.set("detection-job-123", sampleDetectionData);
      });

      expect(result.current).not.toBeNull();
      expect(result.current!.features).toHaveLength(2);
    });
  });

  // =========================================================================
  // Test 2: Agent features are read from inlineFeatures["agent-features"]
  // Validates: Requirements 5.1, 5.3
  // =========================================================================

  describe("agent features from inline features", () => {
    it("returns FeatureCollection built from inlineFeatures['agent-features']", () => {
      const store = createTestStore();

      // Add an agent feature — this auto-creates the "agent-features" layer
      store.dispatch(
        addFeature({ feature: sampleAgentFeature, updatedBy: "agent" })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();
      expect(result.current!.type).toBe("FeatureCollection");
      expect(result.current!.features).toHaveLength(1);
      expect(result.current!.features[0].id).toBe("agent-feat-1");
    });

    it("returns null when agent-features layer has no features", () => {
      const store = createTestStore();

      // Create the layer but with no features
      store.dispatch(
        addLayer({
          id: "agent-features",
          name: "Agent Features",
          source: "agent",
          visible: true,
          zIndex: 100,
          featureCount: 0
        })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("updates when new agent features are added", () => {
      const store = createTestStore();

      store.dispatch(
        addFeature({ feature: sampleAgentFeature, updatedBy: "agent" })
      );

      const { result } = renderHook(
        () => useOverlayLayerData("agent-features"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current!.features).toHaveLength(1);

      // Add another feature
      const secondFeature: GeoJSONFeature = {
        ...sampleAgentFeature,
        id: "agent-feat-2",
        properties: {
          ...sampleAgentFeature.properties,
          description: "Second feature"
        }
      };

      act(() => {
        store.dispatch(
          addFeature({ feature: secondFeature, updatedBy: "agent" })
        );
      });

      expect(result.current!.features).toHaveLength(2);
    });
  });

  // =========================================================================
  // Test 3: Layers with visible: false are not included in rendering data
  // Validates: Requirements 5.4
  // =========================================================================

  describe("layer visibility filtering", () => {
    it("detection layer data is still returned by hook even when visible is false (view handles visibility)", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      // Add a hidden detection layer
      store.dispatch(addLayer({ ...sampleDetectionLayer, visible: false }));
      cache.set("detection-job-123", sampleDetectionData);

      // The hook returns data regardless — the VIEW is responsible for
      // checking layer.visible before rendering. We verify the view can
      // check visibility from the overlay state.
      const { result } = renderHook(
        () => ({
          data: useOverlayLayerData("detection-job-123"),
          layer: store.getState().overlay.layers["detection-job-123"]
        }),
        { wrapper: createWrapper(store) }
      );

      // Data is available
      expect(result.current.data).not.toBeNull();
      // But the layer is marked as not visible
      expect(result.current.layer.visible).toBe(false);
    });

    it("view can derive which layers to skip based on visible flag", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      // Add two detection layers — one visible, one hidden
      store.dispatch(addLayer(sampleDetectionLayer));
      store.dispatch(
        addLayer({
          ...sampleDetectionLayer,
          id: "detection-job-456",
          name: "Detection: job-456",
          visible: false,
          metadata: { jobId: "job-456", loading: false }
        })
      );

      cache.set("detection-job-123", sampleDetectionData);
      cache.set("detection-job-456", {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [5, 5] },
            properties: {}
          }
        ]
      });

      const state = store.getState().overlay;
      const visibleLayerIds = state.layerOrder.filter(
        (id) => state.layers[id]?.visible
      );

      expect(visibleLayerIds).toContain("detection-job-123");
      expect(visibleLayerIds).not.toContain("detection-job-456");
    });

    it("toggling visibility updates the layer state", () => {
      const store = createTestStore();

      store.dispatch(addLayer(sampleDetectionLayer));
      expect(store.getState().overlay.layers["detection-job-123"].visible).toBe(
        true
      );

      store.dispatch(
        setLayerVisibility({ layerId: "detection-job-123", visible: false })
      );
      expect(store.getState().overlay.layers["detection-job-123"].visible).toBe(
        false
      );
    });
  });

  // =========================================================================
  // Test 4: Missing cache entries (null) don't cause errors
  // Validates: Requirements 5.6
  // =========================================================================

  describe("missing cache entries", () => {
    it("returns null when detection layer exists but cache has no data", () => {
      const store = createTestStore();

      // Add detection layer to overlay state but DON'T put data in cache
      store.dispatch(addLayer(sampleDetectionLayer));

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null for a layer ID that doesn't exist at all", () => {
      const store = createTestStore();

      const { result } = renderHook(
        () => useOverlayLayerData("nonexistent-layer"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).toBeNull();
    });

    it("returns null after cache entry is deleted", () => {
      const store = createTestStore();
      const cache = GeoJSONCacheService.getInstance();

      store.dispatch(addLayer(sampleDetectionLayer));
      cache.set("detection-job-123", sampleDetectionData);

      const { result } = renderHook(
        () => useOverlayLayerData("detection-job-123"),
        { wrapper: createWrapper(store) }
      );

      expect(result.current).not.toBeNull();

      // Delete cache entry
      act(() => {
        cache.delete("detection-job-123");
      });

      expect(result.current).toBeNull();
    });
  });
});
