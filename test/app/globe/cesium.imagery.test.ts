// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for Globe imagery tile rendering.
 *
 * These tests verify the globe's imagery rendering logic for viewpoint data
 * from state.imagery.viewpointData. They test the effect logic that:
 * 1. Creates UrlTemplateImageryProvider for READY viewpoints with extent
 * 2. Skips CREATING/ERROR viewpoints
 * 3. Removes imagery layers when viewpoints are removed
 * 4. Uses the correct tile URL pattern with viewpoint_id
 * 5. Sets Rectangle bounds matching WGS84 extent
 *
 * Since Cesium can't run in jsdom, we mock Cesium classes and test the
 * rendering logic via the useImageryTileEffect hook.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */

import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { Viewer as CesiumViewer } from "cesium";
import React from "react";
import { Provider } from "react-redux";

import imageryReducer, {
  removeViewpointData,
  setViewpointData,
  ViewpointData
} from "@/store/slices/imagery-slice";
import overlayReducer from "@/store/slices/overlay-slice";
import { Viewpoint, ViewpointExtent } from "@/store/types";

// ─── Cesium Mocks ────────────────────────────────────────────────────────────

jest.mock("cesium", () => {
  class MockUrlTemplateImageryProvider {
    url: string;
    rectangle: unknown;
    customHeaders: Record<string, string> | undefined;
    maximumLevel?: number;

    constructor(options: {
      url: string;
      rectangle?: unknown;
      customHeaders?: Record<string, string>;
      maximumLevel?: number;
    }) {
      this.url = options.url;
      this.rectangle = options.rectangle;
      this.customHeaders = options.customHeaders;
      this.maximumLevel = options.maximumLevel;
    }
  }

  class MockRectangle {
    west: number;
    south: number;
    east: number;
    north: number;

    constructor(west: number, south: number, east: number, north: number) {
      this.west = west;
      this.south = south;
      this.east = east;
      this.north = north;
    }

    static fromDegrees(
      west: number,
      south: number,
      east: number,
      north: number
    ) {
      return new MockRectangle(west, south, east, north);
    }
  }

  class MockImageryLayer {
    imageryProvider: unknown;
    constructor(provider: unknown) {
      this.imageryProvider = provider;
    }
  }

  class MockResource {
    url: string;
    headers: Record<string, string>;
    retryAttempts?: number;
    retryCallback?: (...args: unknown[]) => unknown;

    constructor(options: {
      url: string;
      headers?: Record<string, string>;
      retryAttempts?: number;
      retryCallback?: (...args: unknown[]) => unknown;
    }) {
      this.url = options.url;
      this.headers = options.headers ?? {};
      this.retryAttempts = options.retryAttempts;
      this.retryCallback = options.retryCallback;
    }
  }

  return {
    UrlTemplateImageryProvider: MockUrlTemplateImageryProvider,
    Rectangle: MockRectangle,
    ImageryLayer: MockImageryLayer,
    Resource: MockResource
  };
});

// Mock cesium-tile-auth
jest.mock("@/utils/cesium-tile-auth", () => ({
  fetchBearerToken: jest.fn().mockResolvedValue("mock-token"),
  createAuthenticatedResource: jest.fn().mockImplementation((url: string) => ({
    url,
    headers: { Authorization: "Bearer mock-token" }
  }))
}));

// Mock site config
jest.mock("@/config/site", () => ({
  siteConfig: {
    tile_server_base_url: "https://tiles.example.com"
  }
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeViewpoint(overrides: Partial<Viewpoint> = {}): Viewpoint {
  return {
    viewpoint_id: "vp-abc-123",
    viewpoint_name: "Test Viewpoint",
    viewpoint_status: "READY",
    bucket_name: "test-bucket",
    object_key: "test-key",
    tile_size: 256,
    range_adjustment: "NONE",
    local_object_path: "",
    error_message: "",
    expire_time: 0,
    ...overrides
  };
}

function makeViewpointData(
  overrides: Partial<ViewpointData> = {}
): ViewpointData {
  return {
    jobId: "job-1",
    viewpoint: makeViewpoint(),
    loaded: true,
    ...overrides
  };
}

const sampleExtent: ViewpointExtent = {
  minLon: -122.5,
  minLat: 37.5,
  maxLon: -122.0,
  maxLat: 38.0
};

/** Create a minimal Redux store with the imagery slice. */
function createTestStore() {
  return configureStore({
    reducer: { imagery: imageryReducer, overlay: overlayReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware()
  });
}

/** Wrapper component that provides the Redux store to hooks. */
function createWrapper(store: ReturnType<typeof createTestStore>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  };
}

/**
 * Mock Cesium viewer object simulating the viewer.imageryLayers API.
 * Tracks added/removed imagery layers for assertions.
 */
interface MockLayer {
  imageryProvider: unknown;
  _mockLayer: boolean;
}

function createMockViewer() {
  const layers: MockLayer[] = [];
  return {
    imageryLayers: {
      addImageryProvider: jest.fn((provider: unknown) => {
        const layer: MockLayer = {
          imageryProvider: provider,
          _mockLayer: true
        };
        layers.push(layer);
        return layer;
      }),
      remove: jest.fn((layer: MockLayer) => {
        const idx = layers.indexOf(layer);
        if (idx >= 0) layers.splice(idx, 1);
        return true;
      }),
      get length() {
        return layers.length;
      },
      get _layers() {
        return [...layers];
      }
    }
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Globe imagery tile rendering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Test 1: Creates UrlTemplateImageryProvider for READY viewpoint with extent
  // Validates: Requirements 3.1, 3.2
  // =========================================================================

  describe("imagery provider creation for READY viewpoints", () => {
    it("creates UrlTemplateImageryProvider for READY viewpoint with extent", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-1",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-abc-123",
          viewpoint_status: "READY"
        }),
        extent: sampleExtent,
        loaded: true
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      // Allow async operations to complete
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Verify an imagery provider was added for the READY viewpoint
      expect(mockViewer.imageryLayers.addImageryProvider).toHaveBeenCalled();
      const addedProvider = mockViewer.imageryLayers.addImageryProvider.mock
        .calls[0][0] as {
        url: { url: string };
        rectangle: { west: number; south: number; east: number; north: number };
      };
      expect(addedProvider).toBeDefined();
    });
  });

  // =========================================================================
  // Test 2: Does not create provider for CREATING or ERROR viewpoints
  // Validates: Requirements 3.2, 3.6
  // =========================================================================

  describe("skips non-READY viewpoints", () => {
    it("does not create provider for CREATING viewpoints", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-creating",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-creating",
          viewpoint_status: "CREATING"
        }),
        loaded: false,
        isPolling: true
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(
        mockViewer.imageryLayers.addImageryProvider
      ).not.toHaveBeenCalled();
    });

    it("does not create provider for ERROR viewpoints", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-error",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-error",
          viewpoint_status: "ERROR",
          error_message: "Viewpoint creation failed"
        }),
        loaded: true,
        error: "Viewpoint creation failed"
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(
        mockViewer.imageryLayers.addImageryProvider
      ).not.toHaveBeenCalled();
    });

    it("does not create provider for READY viewpoint without extent", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-no-extent",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-no-extent",
          viewpoint_status: "READY"
        }),
        loaded: true
        // extent is undefined
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(
        mockViewer.imageryLayers.addImageryProvider
      ).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 3: Removes imagery layer when viewpoint is removed from state
  // Validates: Requirement 3.6
  // =========================================================================

  describe("imagery layer removal", () => {
    it("removes imagery layer when viewpoint is removed from state", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-1",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-abc-123",
          viewpoint_status: "READY"
        }),
        extent: sampleExtent,
        loaded: true
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      // Wait for initial imagery layer to be added
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(mockViewer.imageryLayers.addImageryProvider).toHaveBeenCalledTimes(
        1
      );

      // Remove the viewpoint from state
      await act(async () => {
        store.dispatch(removeViewpointData({ jobId: "job-1" }));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // The imagery layer should have been removed
      expect(mockViewer.imageryLayers.remove).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Test 4: Uses correct tile URL pattern with viewpoint_id
  // Validates: Requirements 3.3
  // =========================================================================

  describe("tile URL pattern", () => {
    it("uses correct tile URL pattern with viewpoint_id", async () => {
      const store = createTestStore();
      const vpData = makeViewpointData({
        jobId: "job-1",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-my-viewpoint-42",
          viewpoint_status: "READY"
        }),
        extent: sampleExtent,
        loaded: true
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(mockViewer.imageryLayers.addImageryProvider).toHaveBeenCalled();
      const addedProvider = mockViewer.imageryLayers.addImageryProvider.mock
        .calls[0][0] as {
        url: { url: string };
        rectangle: { west: number; south: number; east: number; north: number };
      };

      // The URL should follow the pattern:
      // {tile_server_base_url}/latest/viewpoints/{viewpoint_id}/map/tiles/WebMercatorQuad/{z}/{reverseY}/{x}.PNG?invert_y=true
      const expectedUrl =
        "https://tiles.example.com/latest/viewpoints/vp-my-viewpoint-42/map/tiles/WebMercatorQuad/{z}/{y}/{x}.PNG?invert_y=true";
      // url is now a Resource object; check the .url property
      expect(addedProvider.url.url).toBe(expectedUrl);
    });
  });

  // =========================================================================
  // Test 5: Sets Rectangle bounds matching WGS84 extent
  // Validates: Requirements 3.4
  // =========================================================================

  describe("Rectangle bounds from WGS84 extent", () => {
    it("sets Rectangle bounds matching WGS84 extent", async () => {
      const store = createTestStore();
      const extent: ViewpointExtent = {
        minLon: -77.5,
        minLat: 38.8,
        maxLon: -76.9,
        maxLat: 39.3
      };

      const vpData = makeViewpointData({
        jobId: "job-bounds",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-bounds-test",
          viewpoint_status: "READY"
        }),
        extent,
        loaded: true
      });

      store.dispatch(setViewpointData(vpData));

      const { useImageryTileEffect } =
        require("@/app/globe/useImageryTileEffect") as typeof import("@/app/globe/useImageryTileEffect");
      const mockViewer = createMockViewer();

      renderHook(
        () => useImageryTileEffect(mockViewer as unknown as CesiumViewer),
        {
          wrapper: createWrapper(store)
        }
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(mockViewer.imageryLayers.addImageryProvider).toHaveBeenCalled();
      const addedProvider = mockViewer.imageryLayers.addImageryProvider.mock
        .calls[0][0] as {
        url: { url: string };
        rectangle: { west: number; south: number; east: number; north: number };
      };

      // Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat)
      // Our mock stores them as (west, south, east, north)
      expect(addedProvider.rectangle).toBeDefined();
      expect(addedProvider.rectangle.west).toBe(extent.minLon);
      expect(addedProvider.rectangle.south).toBe(extent.minLat);
      expect(addedProvider.rectangle.east).toBe(extent.maxLon);
      expect(addedProvider.rectangle.north).toBe(extent.maxLat);
    });
  });
});
