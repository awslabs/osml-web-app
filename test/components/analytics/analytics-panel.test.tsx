// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { AnalyticsPanel } from "@/components/analytics/analytics-panel";
import { GeoJSONCacheService } from "@/services/geojson-cache-service";
import analyticsReducer from "@/store/slices/analytics-slice";
import type { OverlayLayer } from "@/store/slices/overlay-slice";
import overlayReducer from "@/store/slices/overlay-slice";
import type { AnalyticsState } from "@/utils/analytics/types";

// ---------------------------------------------------------------------------
// Mock GeoJSONCacheService singleton
// ---------------------------------------------------------------------------

jest.mock("@/services/geojson-cache-service");

let mockCacheEntries: Record<string, unknown> = {};

(GeoJSONCacheService.getInstance as jest.Mock).mockReturnValue({
  get(layerId: string) {
    return mockCacheEntries[layerId] ?? null;
  }
});

function setMockCache(entries: Record<string, unknown>) {
  mockCacheEntries = entries;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

interface TestFeatureCollection {
  type: "FeatureCollection";
  features: TestFeature[];
}

function makeFeatureCollection(
  count: number,
  options?: { confidence?: number; classification?: string }
): TestFeatureCollection {
  const features: TestFeature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      type: "Feature",
      id: `f-${i}`,
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: {
        ...(options?.confidence !== undefined
          ? { confidence: options.confidence }
          : {}),
        ...(options?.classification !== undefined
          ? { classification: options.classification }
          : {})
      }
    });
  }
  return { type: "FeatureCollection", features };
}

function makeDetectionLayer(
  id: string,
  name: string,
  featureCount: number
): OverlayLayer {
  return {
    id,
    name,
    source: "detection",
    zIndex: 1,
    featureCount,
    metadata: { layerType: "vector" }
  };
}

function createStore(
  layers: OverlayLayer[] = [],
  analyticsOverrides?: Partial<AnalyticsState>
) {
  const layersMap: Record<string, OverlayLayer> = {};
  const layerOrder: string[] = [];
  for (const l of layers) {
    layersMap[l.id] = l;
    layerOrder.push(l.id);
  }

  return configureStore({
    reducer: { overlay: overlayReducer, analytics: analyticsReducer },
    preloadedState: {
      overlay: {
        layers: layersMap,
        layerOrder,
        inlineFeatures: {},
        selectedFeatureId: undefined,
        lastUpdatedBy: "initial" as const
      },
      analytics: {
        colorMode: "layer" as const,
        activeFilters: [],
        selectedLayerIds: [],
        confidenceThreshold: 0,
        ...analyticsOverrides
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AnalyticsPanel", () => {
  beforeEach(() => {
    setMockCache({});
  });

  it("shows empty state message when no detection layers are loaded", () => {
    const store = createStore([]);
    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );
    expect(screen.getByText(/detection data/i)).toBeInTheDocument();
  });

  it("shows empty state when layers exist but none are detection source", () => {
    const userLayer: OverlayLayer = {
      id: "user-1",
      name: "User Layer",
      source: "user",
      zIndex: 1,
      featureCount: 5
    };
    const store = createStore([userLayer]);
    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );
    expect(screen.getByText(/detection data/i)).toBeInTheDocument();
  });

  it("renders a summary card per detection layer with layer name and feature count", () => {
    setMockCache({
      "det-1": makeFeatureCollection(10, {
        confidence: 0.85,
        classification: "building"
      }),
      "det-2": makeFeatureCollection(5, {
        confidence: 0.6,
        classification: "vehicle"
      })
    });
    const store = createStore([
      makeDetectionLayer("det-1", "Model A Detections", 10),
      makeDetectionLayer("det-2", "Model B Detections", 5)
    ]);

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    expect(screen.getByText("Model A Detections")).toBeInTheDocument();
    expect(screen.getByText("Model B Detections")).toBeInTheDocument();
    expect(screen.getByText(/10/)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it("renders ColorModeSelector and ConfidenceSlider controls", () => {
    setMockCache({
      "det-1": makeFeatureCollection(3, { confidence: 0.5 })
    });
    const store = createStore([makeDetectionLayer("det-1", "Detections", 3)]);

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    // Verify the HeroUI Select trigger button is present (ColorModeSelector)
    expect(document.querySelector('[aria-label="Color mode"]')).not.toBeNull();
    // Verify the HeroUI Slider group is present (ConfidenceSlider)
    expect(
      document.querySelector('[aria-label="Confidence Threshold"]')
    ).not.toBeNull();
  });

  it("renders ComparisonView when exactly 2 layers are selected", () => {
    setMockCache({
      "det-1": makeFeatureCollection(4, {
        confidence: 0.9,
        classification: "building"
      }),
      "det-2": makeFeatureCollection(6, {
        confidence: 0.7,
        classification: "vehicle"
      })
    });
    const store = createStore(
      [
        makeDetectionLayer("det-1", "Layer A", 4),
        makeDetectionLayer("det-2", "Layer B", 6)
      ],
      { selectedLayerIds: ["det-1", "det-2"] }
    );

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    expect(screen.getByText("Total Detections")).toBeInTheDocument();
    expect(screen.getByText("Avg Confidence")).toBeInTheDocument();
  });

  it("does not render ComparisonView when fewer than 2 layers are selected", () => {
    setMockCache({
      "det-1": makeFeatureCollection(4, { confidence: 0.9 })
    });
    const store = createStore([makeDetectionLayer("det-1", "Layer A", 4)], {
      selectedLayerIds: ["det-1"]
    });

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    expect(screen.queryByText("Total Detections")).not.toBeInTheDocument();
  });

  it("renders layer selection checkboxes for comparison", () => {
    setMockCache({
      "det-1": makeFeatureCollection(2),
      "det-2": makeFeatureCollection(3)
    });
    const store = createStore([
      makeDetectionLayer("det-1", "Layer A", 2),
      makeDetectionLayer("det-2", "Layer B", 3)
    ]);

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
  });

  it("dispatches toggleLayerSelection when a layer checkbox is clicked", () => {
    setMockCache({ "det-1": makeFeatureCollection(2) });
    const store = createStore([makeDetectionLayer("det-1", "Layer A", 2)]);

    render(
      <Provider store={store}>
        <AnalyticsPanel />
      </Provider>
    );

    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);
    expect(store.getState().analytics.selectedLayerIds).toContain("det-1");
  });
});
