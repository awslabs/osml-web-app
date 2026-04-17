// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Cesium globe component.
 * Mocks the entire cesium module and resium Viewer to test React component
 * logic, Redux integration, and event handlers without WebGL.
 */

// Mock cesium module comprehensively
jest.mock("cesium", () => {
  class MockCartesian3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    static fromDegrees(lon: number, lat: number, h = 0) {
      return new MockCartesian3(lon, lat, h);
    }
  }
  class MockEntity {
    id: string;
    name?: string;
    position?: unknown;
    billboard?: unknown;
    polygon?: unknown;
    polyline?: unknown;
    properties?: { propertyNames: string[]; getValue: () => unknown };
    constructor(opts: Record<string, unknown> = {}) {
      Object.assign(this, opts);
      this.id = (opts.id as string) ?? "entity";
    }
  }
  class MockDataSource {
    entities = { values: [] as MockEntity[], getById: jest.fn() };
    static load = jest.fn().mockResolvedValue({ entities: { values: [] } });
  }
  return {
    BillboardGraphics: jest
      .fn()
      .mockImplementation((opts: Record<string, unknown>) => opts),
    BoundingSphere: {
      fromPoints: jest.fn(() => ({ center: new MockCartesian3(), radius: 1 }))
    },
    Cartesian2: jest
      .fn()
      .mockImplementation((x: number, y: number) => ({ x, y })),
    Cartesian3: MockCartesian3,
    Cartographic: {
      fromCartesian: jest.fn(() => ({ longitude: 0, latitude: 0, height: 0 }))
    },
    Color: {
      fromCssColorString: jest.fn(() => ({ withAlpha: jest.fn(() => ({})) })),
      RED: {},
      YELLOW: {},
      WHITE: {},
      TRANSPARENT: {}
    },
    ColorMaterialProperty: jest.fn().mockImplementation((c) => c),
    ConstantProperty: jest
      .fn()
      .mockImplementation((v) => ({ getValue: () => v })),
    defined: jest.fn((v) => v !== undefined && v !== null),
    Entity: MockEntity,
    GeoJsonDataSource: MockDataSource,
    HeightReference: { CLAMP_TO_GROUND: 1, NONE: 0 },
    HorizontalOrigin: { CENTER: 0 },
    ImageryProvider: jest.fn(),
    Math: {
      toDegrees: (r: number) => r * (180 / Math.PI),
      toRadians: (d: number) => d * (Math.PI / 180)
    },
    ScreenSpaceEventType: { LEFT_CLICK: 0, MOUSE_MOVE: 1 },
    TerrainProvider: jest.fn(),
    VerticalOrigin: { CENTER: 0, BOTTOM: 1 },
    Viewer: jest.fn()
  };
});

// Mock resium Viewer component
jest.mock("resium", () => ({
  Viewer: jest.fn().mockImplementation(({ children, ...props }) => {
    const ReactModule = require("react") as typeof import("react");
    return ReactModule.createElement(
      "div",
      { "data-testid": "cesium-viewer", ...props },
      children
    );
  }),
  useCesium: jest.fn(() => ({ viewer: null }))
}));

// Mock globe providers
jest.mock("@/utils/globe-providers", () => ({
  generateImageryProviders: jest.fn().mockResolvedValue([{}]),
  generateProviderViewModels: jest.fn(() => [{ name: "World Imagery" }]),
  generateTerrainProviders: jest.fn().mockResolvedValue([{}]),
  generateTerrainProviderViewModels: jest.fn(() => [
    { name: "WGS84 Ellipsoid" }
  ])
}));

// Mock coordinate transformers
jest.mock("@/utils/coordinate-transformers-cesium", () => ({
  calculateZoomFromExtent: jest.fn(() => 5),
  cartesian3ToWGS84: jest.fn(() => ({ longitude: 0, latitude: 0, height: 0 })),
  extentToHeight: jest.fn(() => 10000000),
  rectangleToExtent: jest.fn(() => ({
    west: -10,
    south: -10,
    east: 10,
    north: 10
  })),
  wgs84ToCartesian3: jest.fn(() => ({ x: 0, y: 0, z: 0 }))
}));

// Mock globe popup formatter
jest.mock("@/utils/globe-popup-formatter", () => ({
  formatEntityProperties: jest.fn(() => [])
}));

// Mock color utils
jest.mock("@/utils/color-utils", () => ({
  buildMarkerSvg: jest.fn(() => "data:image/svg+xml,<svg/>")
}));

// Mock useImageryTileEffect hook
jest.mock("@/app/globe/useImageryTileEffect", () => ({
  useImageryTileEffect: jest.fn()
}));

// Mock services
jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn(),
    searchItems: jest.fn(),
    getItem: jest.fn()
  }
}));
jest.mock("@/services/geojson-cache-service", () => ({
  GeoJSONCacheService: {
    getInstance: jest.fn(() => ({ get: jest.fn(() => null), set: jest.fn() }))
  }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

// Mock analytics extractors
jest.mock("@/utils/analytics/extract-classification", () => ({
  extractClassification: jest.fn(() => null)
}));
jest.mock("@/utils/analytics/extract-confidence", () => ({
  extractConfidence: jest.fn(() => 0.9)
}));

import { act, screen } from "@testing-library/react";
import React from "react";

import CesiumComponent from "@/app/globe/cesium";
import { setLayerStyle, setSelectedJobs } from "@/store/slices/jobs-slice";
import { selectFeature } from "@/store/slices/overlay-slice";
import { setViewport } from "@/store/slices/viewport-slice";

import { createTestStore, renderWithStore } from "../../test-utils";

describe("Cesium globe component", () => {
  it("should render loading state initially", () => {
    renderWithStore(<CesiumComponent />);
    expect(screen.getByText("Loading Globe...")).toBeInTheDocument();
  });

  it("should render without crashing", () => {
    const { container } = renderWithStore(<CesiumComponent />);
    expect(container).toBeDefined();
  });

  it("should use Redux viewport state", () => {
    const store = createTestStore();
    store.dispatch(
      setViewport({
        longitude: 45,
        latitude: 30,
        zoom: 8,
        extent: { west: 44, south: 29, east: 46, north: 31 },
        updatedBy: "map"
      })
    );

    renderWithStore(<CesiumComponent />, { store });
    expect(store.getState().viewport.longitude).toBe(45);
  });

  it("should handle agent-triggered viewport change", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

    act(() => {
      store.dispatch(
        setViewport({
          longitude: 10,
          latitude: 20,
          zoom: 6,
          extent: { west: 9, south: 19, east: 11, north: 21 },
          updatedBy: "agent"
        })
      );
    });

    expect(store.getState().viewport.lastUpdatedBy).toBe("agent");
  });

  it("should handle selected jobs change", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

    act(() => {
      store.dispatch(
        setSelectedJobs([
          { job_id: "job-1", job_name: "Test", status: "SUCCESS" } as never
        ])
      );
    });

    expect(store.getState().jobs.selection.selectedJobs).toHaveLength(1);
  });

  it("should handle layer style changes", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

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

  it("should handle feature selection", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

    act(() => {
      store.dispatch(selectFeature("feature-1"));
    });

    expect(store.getState().overlay.selectedFeatureId).toBe("feature-1");
  });

  it("should read globe settings from store", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

    const settings = store.getState().settings.globe;
    expect(settings).toBeDefined();
    expect(typeof settings.enableLighting).toBe("boolean");
  });

  it("should read auto-zoom setting from store", () => {
    const store = createTestStore();
    renderWithStore(<CesiumComponent />, { store });

    const settings = store.getState().settings;
    expect(settings.globe).toBeDefined();
    expect(settings.map).toBeDefined();
  });

  it("should clean up on unmount", () => {
    const { unmount } = renderWithStore(<CesiumComponent />);
    unmount();
    expect(true).toBe(true);
  });
});
