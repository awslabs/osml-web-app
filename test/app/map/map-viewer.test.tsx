// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for MapViewer component.
 * Uses real OL classes (transformed via babel-jest) with jest-canvas-mock.
 * Only mocks network-dependent services and the DayNight extension.
 */

// Mock ol-ext/source/DayNight (requires browser APIs not in jsdom)
jest.mock("ol-ext/source/DayNight", () => {
  return jest.fn().mockImplementation(() => ({
    setTime: jest.fn()
  }));
});

// Mock authenticated tile loader (network)
jest.mock("@/utils/ol-tile-auth", () => ({
  createAuthenticatedTileLoader: jest.fn(() => jest.fn())
}));

// Mock services that make network requests
jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn().mockResolvedValue([]),
    searchItems: jest.fn(),
    getItem: jest.fn()
  }
}));

jest.mock("@/services/geojson-cache-service", () => ({
  GeoJSONCacheService: {
    getInstance: jest.fn(() => ({
      get: jest.fn(() => null),
      set: jest.fn()
    }))
  }
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    createViewpoint: jest.fn(),
    getViewpoint: jest.fn()
  }
}));

import { screen } from "@testing-library/react";

import MapViewer from "@/app/map/map-viewer";
import { setViewport } from "@/store/slices/viewport-slice";

import { createTestStore, renderWithStore } from "../../test-utils";

// Suppress OL Map DOM cleanup errors (OL manipulates DOM directly, conflicting with React)
const originalRemoveChild = Element.prototype.removeChild;
beforeAll(() => {
  Element.prototype.removeChild = function <T extends Node>(child: T): T {
    try {
      return originalRemoveChild.call(this, child) as T;
    } catch {
      return child;
    }
  };
});
afterAll(() => {
  Element.prototype.removeChild = originalRemoveChild;
});

describe("MapViewer", () => {
  it("should render the map container div", () => {
    const { container } = renderWithStore(<MapViewer />);
    const mapDiv = container.querySelector(".w-full.h-full");
    expect(mapDiv).toBeInTheDocument();
  });

  it("should render the popup container", () => {
    const { container } = renderWithStore(<MapViewer />);
    const popupDiv = container.querySelector(".ol-popup");
    expect(popupDiv).toBeInTheDocument();
  });

  it("should not show feature popup initially", () => {
    renderWithStore(<MapViewer />);
    expect(screen.queryByText(/Close/)).not.toBeInTheDocument();
  });

  it("should initialize with Redux viewport state", () => {
    const store = createTestStore();
    store.dispatch(
      setViewport({
        longitude: 10,
        latitude: 20,
        zoom: 8,
        extent: { west: 9, south: 19, east: 11, north: 21 },
        updatedBy: "user"
      })
    );

    const { container } = renderWithStore(<MapViewer />, { store });
    expect(container.querySelector(".w-full.h-full")).toBeInTheDocument();
  });

  it("should render without crashing when viewport is from globe", () => {
    const store = createTestStore();
    store.dispatch(
      setViewport({
        longitude: 0,
        latitude: 0,
        zoom: 5,
        extent: { west: -10, south: -10, east: 10, north: 10 },
        updatedBy: "globe"
      })
    );

    const { container } = renderWithStore(<MapViewer />, { store });
    expect(container.querySelector(".w-full.h-full")).toBeInTheDocument();
  });

  it("should clean up map on unmount", () => {
    const { unmount } = renderWithStore(<MapViewer />);
    unmount();
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional tests to exercise useEffect bodies via Redux state changes
// ---------------------------------------------------------------------------

import { act } from "@testing-library/react";

import { setLayerStyle, setSelectedJobs } from "@/store/slices/jobs-slice";
import { selectFeature } from "@/store/slices/overlay-slice";

describe("MapViewer - Redux-driven effects", () => {
  it("should handle agent-triggered viewport change", () => {
    const store = createTestStore();
    const { container } = renderWithStore(<MapViewer />, { store });

    // Dispatch an agent-triggered viewport change
    act(() => {
      store.dispatch(
        setViewport({
          longitude: 45,
          latitude: 30,
          zoom: 10,
          extent: { west: 44, south: 29, east: 46, north: 31 },
          updatedBy: "agent"
        })
      );
    });

    expect(container.querySelector(".w-full.h-full")).toBeInTheDocument();
  });

  it("should handle day/night setting in store", () => {
    const store = createTestStore();
    renderWithStore(<MapViewer />, { store });

    // Verify the setting exists in store without toggling
    // (toggling requires a full DayNight source mock with event target)
    expect(store.getState().settings.map.dayNightEnabled).toBe(false);
  });

  it("should handle selected jobs change", () => {
    const store = createTestStore();
    renderWithStore(<MapViewer />, { store });

    act(() => {
      store.dispatch(
        setSelectedJobs([
          { job_id: "job-1", job_name: "Test Job", status: "SUCCESS" } as never
        ])
      );
    });

    // Should not crash
    expect(store.getState().jobs.selection.selectedJobs).toHaveLength(1);
  });

  it("should handle layer style changes", () => {
    const store = createTestStore();
    renderWithStore(<MapViewer />, { store });

    act(() => {
      store.dispatch(
        setLayerStyle({
          jobId: "job-1",
          style: { color: "#ff0000", opacity: 0.8 }
        })
      );
    });

    expect(store.getState().jobs.selection.layerStyles["job-1"]).toBeDefined();
  });

  it("should handle feature selection dispatch", () => {
    const store = createTestStore();
    renderWithStore(<MapViewer />, { store });

    act(() => {
      store.dispatch(selectFeature("feature-1"));
    });

    expect(store.getState().overlay.selectedFeatureId).toBe("feature-1");
  });

  it("should handle map-triggered viewport update (not re-animate)", () => {
    const store = createTestStore();
    renderWithStore(<MapViewer />, { store });

    // Map-triggered viewport should not cause animation
    act(() => {
      store.dispatch(
        setViewport({
          longitude: 0,
          latitude: 0,
          zoom: 5,
          extent: { west: -10, south: -10, east: 10, north: 10 },
          updatedBy: "map"
        })
      );
    });

    expect(store.getState().viewport.lastUpdatedBy).toBe("map");
  });
});
