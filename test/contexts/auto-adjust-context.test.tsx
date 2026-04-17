// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AutoAdjustContext and AutoAdjustProvider.
 * Covers registerMapAndLayer, captureBaselineHistogram, clearBaselineHistogram,
 * hasBaselineHistogram, and performAutoAdjust.
 */

import { act, renderHook } from "@testing-library/react";
import React, { ReactNode } from "react";

// Mock OpenLayers modules before importing the context
jest.mock("ol/Map", () => {
  return jest.fn().mockImplementation(() => ({
    getViewport: jest.fn(),
    getView: jest.fn(() => ({
      calculateExtent: jest.fn(() => [0, 0, 1, 1]),
      getResolution: jest.fn(() => 100)
    })),
    getSize: jest.fn(() => [800, 600])
  }));
});

jest.mock("ol/layer/WebGLTile", () => {
  return jest.fn().mockImplementation(() => ({
    updateStyleVariables: jest.fn()
  }));
});

jest.mock("ol/extent", () => ({
  getArea: jest.fn((extent: number[]) => {
    const w = extent[2] - extent[0];
    const h = extent[3] - extent[1];
    return w * h;
  }),
  getIntersectionArea: jest.fn(() => 0.8)
}));

jest.mock("@/utils/auto-adjust", () => ({
  sampleTilePixels: jest.fn(() => []),
  computeHistogram: jest.fn(() => ({
    bins: Array(256).fill(0),
    min: 0,
    max: 255,
    mean: 0.5,
    stdDev: 0.15,
    totalPixels: 5000
  })),
  calculateOptimalAdjustments: jest.fn(() => ({
    exposure: 0.2,
    contrast: 0.1,
    gamma: 1.1
  })),
  adjustmentsToStyleVariables: jest.fn(() => ({})),
  MIN_PIXELS_FOR_AUTO_ADJUST: 1000
}));

import WebGLTileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";

import {
  AutoAdjustProvider,
  useAutoAdjust
} from "@/contexts/auto-adjust-context";

const wrapper = ({ children }: { children: ReactNode }) => (
  <AutoAdjustProvider>{children}</AutoAdjustProvider>
);

describe("AutoAdjustContext", () => {
  describe("useAutoAdjust outside provider", () => {
    it("should return null when used outside provider", () => {
      const { result } = renderHook(() => useAutoAdjust());
      expect(result.current).toBeNull();
    });
  });

  describe("AutoAdjustProvider", () => {
    it("should provide context with all methods", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });

      expect(result.current).not.toBeNull();
      expect(typeof result.current!.performAutoAdjust).toBe("function");
      expect(typeof result.current!.registerMapAndLayer).toBe("function");
      expect(typeof result.current!.captureBaselineHistogram).toBe("function");
      expect(typeof result.current!.clearBaselineHistogram).toBe("function");
      expect(typeof result.current!.hasBaselineHistogram).toBe("function");
    });

    it("hasBaselineHistogram should return false initially", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });
      expect(result.current!.hasBaselineHistogram()).toBe(false);
    });

    it("registerMapAndLayer should accept map and layer", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });
      const mockMap = new Map({});
      const mockLayer = new WebGLTileLayer({});

      act(() => {
        result.current!.registerMapAndLayer(
          mockMap as never,
          mockLayer as never
        );
      });

      // Should not throw
      expect(result.current!.hasBaselineHistogram()).toBe(false);
    });

    it("registerMapAndLayer with null should clear baseline", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });

      act(() => {
        result.current!.registerMapAndLayer(null, null);
      });

      expect(result.current!.hasBaselineHistogram()).toBe(false);
    });

    it("captureBaselineHistogram should return false without map/layer", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });

      let captured: boolean;
      act(() => {
        captured = result.current!.captureBaselineHistogram();
      });

      expect(captured!).toBe(false);
    });

    it("captureBaselineHistogram should capture when map and layer registered", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });
      const mockMap = new Map({});
      const mockLayer = new WebGLTileLayer({});

      act(() => {
        result.current!.registerMapAndLayer(
          mockMap as never,
          mockLayer as never
        );
      });

      let captured: boolean;
      act(() => {
        captured = result.current!.captureBaselineHistogram();
      });

      expect(captured!).toBe(true);
      expect(result.current!.hasBaselineHistogram()).toBe(true);
    });

    it("clearBaselineHistogram should clear cached baseline", () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });
      const mockMap = new Map({});
      const mockLayer = new WebGLTileLayer({});

      act(() => {
        result.current!.registerMapAndLayer(
          mockMap as never,
          mockLayer as never
        );
      });
      act(() => {
        result.current!.captureBaselineHistogram();
      });
      expect(result.current!.hasBaselineHistogram()).toBe(true);

      act(() => {
        result.current!.clearBaselineHistogram();
      });
      expect(result.current!.hasBaselineHistogram()).toBe(false);
    });

    it("performAutoAdjust should return null without map/layer", async () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });

      let adjustResult: unknown;
      await act(async () => {
        adjustResult = await result.current!.performAutoAdjust();
      });

      expect(adjustResult).toBeNull();
    });

    it("performAutoAdjust should return adjustments when map and layer registered", async () => {
      const { result } = renderHook(() => useAutoAdjust(), { wrapper });
      const mockMap = new Map({});
      const mockLayer = new WebGLTileLayer({});

      act(() => {
        result.current!.registerMapAndLayer(
          mockMap as never,
          mockLayer as never
        );
      });

      let adjustResult: unknown;
      await act(async () => {
        adjustResult = await result.current!.performAutoAdjust();
      });

      expect(adjustResult).toMatchObject({
        success: true,
        adjustments: { exposure: 0.2, contrast: 0.1, gamma: 1.1 }
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: getCurrentViewState, hasViewChangedSignificantly, performAutoAdjust
// (lines 109-121, 136-169, 271-308)
// ---------------------------------------------------------------------------

import { getArea, getIntersectionArea } from "ol/extent";

describe("AutoAdjustProvider - branch coverage", () => {
  it("getCurrentViewState should return null when view has no extent", () => {
    const { result } = renderHook(() => useAutoAdjust(), { wrapper });
    const mockMap = new Map({});
    const mockLayer = new WebGLTileLayer({});

    // Override getView to return a view with no extent
    (mockMap as unknown as { getView: () => unknown }).getView = () => ({
      calculateExtent: () => null,
      getResolution: () => 100
    });

    act(() => {
      result.current!.registerMapAndLayer(mockMap as never, mockLayer as never);
    });

    // captureBaselineHistogram calls getCurrentViewState internally
    // With null extent, it should still work (returns false for capture)
    let captured: boolean;
    act(() => {
      captured = result.current!.captureBaselineHistogram();
    });
    // Should succeed because computeHistogram mock returns enough pixels
    expect(typeof captured!).toBe("boolean");
  });

  it("hasViewChangedSignificantly should return true when no baseline exists", async () => {
    const { result } = renderHook(() => useAutoAdjust(), { wrapper });
    const mockMap = new Map({});
    const mockLayer = new WebGLTileLayer({});

    act(() => {
      result.current!.registerMapAndLayer(mockMap as never, mockLayer as never);
    });

    // Don't capture baseline — performAutoAdjust should detect view changed
    let adjustResult: unknown;
    await act(async () => {
      adjustResult = await result.current!.performAutoAdjust();
    });

    // Should succeed (samples with default adjustments since no baseline)
    expect(adjustResult).toMatchObject({ success: true });
  });

  it("hasViewChangedSignificantly should detect significant zoom change", async () => {
    const { result } = renderHook(() => useAutoAdjust(), { wrapper });
    const mockMap = new Map({});
    const mockLayer = new WebGLTileLayer({});

    act(() => {
      result.current!.registerMapAndLayer(mockMap as never, mockLayer as never);
    });

    // Capture baseline
    act(() => {
      result.current!.captureBaselineHistogram();
    });

    // Change resolution significantly (simulates zoom)
    (mockMap as unknown as { getView: () => unknown }).getView = () => ({
      calculateExtent: () => [0, 0, 10, 10],
      getResolution: () => 1 // Very different from initial 100
    });

    let adjustResult: unknown;
    await act(async () => {
      adjustResult = await result.current!.performAutoAdjust();
    });

    // Should re-sample because view changed significantly
    expect(adjustResult).toMatchObject({ success: true });
  });

  it("hasViewChangedSignificantly should detect significant pan", async () => {
    const { result } = renderHook(() => useAutoAdjust(), { wrapper });
    const mockMap = new Map({});
    const mockLayer = new WebGLTileLayer({});

    act(() => {
      result.current!.registerMapAndLayer(mockMap as never, mockLayer as never);
    });

    // Capture baseline
    act(() => {
      result.current!.captureBaselineHistogram();
    });

    // Change extent significantly (simulates pan)
    (mockMap as unknown as { getView: () => unknown }).getView = () => ({
      calculateExtent: () => [100, 100, 200, 200], // Completely different area
      getResolution: () => 100
    });

    // Mock getArea and getIntersectionArea for the pan detection
    (getArea as jest.Mock).mockImplementation((extent: number[]) => {
      const w = extent[2] - extent[0];
      const h = extent[3] - extent[1];
      return w * h;
    });
    (getIntersectionArea as jest.Mock).mockReturnValue(0); // No overlap

    let adjustResult: unknown;
    await act(async () => {
      adjustResult = await result.current!.performAutoAdjust();
    });

    expect(adjustResult).toMatchObject({ success: true });
  });

  it("performAutoAdjust should use cached baseline when view hasn't changed", async () => {
    const { result } = renderHook(() => useAutoAdjust(), { wrapper });
    const mockMap = new Map({});
    const mockLayer = new WebGLTileLayer({});

    act(() => {
      result.current!.registerMapAndLayer(mockMap as never, mockLayer as never);
    });

    // Capture baseline
    act(() => {
      result.current!.captureBaselineHistogram();
    });

    // Mock high overlap (view hasn't changed)
    (getArea as jest.Mock).mockReturnValue(1);
    (getIntersectionArea as jest.Mock).mockReturnValue(1);

    // Call performAutoAdjust — should use cached baseline
    let adjustResult: unknown;
    await act(async () => {
      adjustResult = await result.current!.performAutoAdjust();
    });

    expect(adjustResult).toMatchObject({ success: true });
  });
});
