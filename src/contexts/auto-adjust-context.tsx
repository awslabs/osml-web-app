// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { Extent, getArea, getIntersectionArea } from "ol/extent";
import WebGLTileLayer from "ol/layer/WebGLTile";
import Map from "ol/Map";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef
} from "react";

import { DEFAULT_ADJUSTMENTS } from "@/store/types";
import {
  AutoAdjustResult,
  calculateOptimalAdjustments,
  computeHistogram,
  HistogramData,
  MIN_PIXELS_FOR_AUTO_ADJUST,
  sampleTilePixels
} from "@/utils/auto-adjust";
import { adjustmentsToStyleVariables } from "@/utils/webgl";

/**
 * Threshold for view change detection.
 * If the overlap between current and baseline extents is less than this ratio,
 * the baseline histogram is invalidated and recaptured.
 * 0.5 = 50% overlap required to keep baseline
 */
const VIEW_OVERLAP_THRESHOLD = 0.5;

/**
 * Threshold for zoom level change detection.
 * If the resolution ratio changes by more than this factor, baseline is invalidated.
 * 2.0 = 2x zoom in or out triggers recapture
 */
const ZOOM_CHANGE_THRESHOLD = 2.0;

/**
 * Delay in ms to wait for WebGL layer to re-render after resetting adjustments.
 */
const RENDER_DELAY_MS = 100;

/**
 * Stored view state when baseline histogram was captured.
 */
interface BaselineViewState {
  extent: Extent;
  resolution: number;
}

/**
 * Context for providing auto-adjust functionality from the image page
 * to child components like ImageAdjustmentControls.
 */
interface AutoAdjustContextType {
  /** Performs auto-adjust asynchronously and returns the result */
  performAutoAdjust: () => Promise<AutoAdjustResult | null>;
  /** Registers the map and layer for auto-adjust */
  registerMapAndLayer: (map: Map | null, layer: WebGLTileLayer | null) => void;
  /** Captures the baseline histogram from the current view (call when adjustments are at defaults) */
  captureBaselineHistogram: () => boolean;
  /** Clears the cached baseline histogram (call when viewpoint changes) */
  clearBaselineHistogram: () => void;
  /** Returns whether a baseline histogram is cached */
  hasBaselineHistogram: () => boolean;
}

const AutoAdjustContext = createContext<AutoAdjustContextType | null>(null);

export interface AutoAdjustProviderProps {
  children: ReactNode;
}

/**
 * Provider component that manages auto-adjust state and provides
 * the performAutoAdjust function to child components.
 *
 * Uses cached baseline histogram to ensure deterministic auto-adjust results.
 * The baseline is view-aware: it's invalidated when the user pans/zooms
 * significantly to ensure auto-adjust adapts to the current view area.
 *
 * When recapturing baseline, temporarily resets WebGL adjustments to defaults
 * to sample the unaltered image data.
 */
export function AutoAdjustProvider({ children }: AutoAdjustProviderProps) {
  const mapRef = useRef<Map | null>(null);
  const layerRef = useRef<WebGLTileLayer | null>(null);
  const baselineHistogramRef = useRef<HistogramData | null>(null);
  const baselineViewStateRef = useRef<BaselineViewState | null>(null);

  const registerMapAndLayer = useCallback(
    (map: Map | null, layer: WebGLTileLayer | null) => {
      mapRef.current = map;
      layerRef.current = layer;
      // Clear baseline when map/layer changes
      baselineHistogramRef.current = null;
      baselineViewStateRef.current = null;
    },
    []
  );

  /**
   * Gets the current view state from the map.
   */
  const getCurrentViewState = useCallback((): BaselineViewState | null => {
    if (!mapRef.current) {
      return null;
    }

    const view = mapRef.current.getView();
    if (!view) {
      return null;
    }

    const extent = view.calculateExtent(mapRef.current.getSize());
    const resolution = view.getResolution();

    if (!extent || resolution === undefined) {
      return null;
    }

    return { extent, resolution };
  }, []);

  /**
   * Checks if the current view has changed significantly from the baseline view.
   * Returns true if the baseline should be invalidated.
   */
  const hasViewChangedSignificantly = useCallback((): boolean => {
    if (!baselineViewStateRef.current) {
      return true; // No baseline, need to capture
    }

    const currentView = getCurrentViewState();
    if (!currentView) {
      return false; // Can't determine, keep baseline
    }

    const baselineView = baselineViewStateRef.current;

    // Check zoom level change
    const resolutionRatio = currentView.resolution / baselineView.resolution;
    if (
      resolutionRatio > ZOOM_CHANGE_THRESHOLD ||
      resolutionRatio < 1 / ZOOM_CHANGE_THRESHOLD
    ) {
      return true; // Significant zoom change
    }

    // Check pan/extent overlap
    const baselineArea = getArea(baselineView.extent);
    const currentArea = getArea(currentView.extent);

    if (baselineArea === 0 || currentArea === 0) {
      return true; // Invalid extents
    }

    // Calculate overlap ratio
    const intersectionArea = getIntersectionArea(
      baselineView.extent,
      currentView.extent
    );
    const smallerArea = Math.min(baselineArea, currentArea);
    const overlapRatio = intersectionArea / smallerArea;

    // If overlap is less than threshold, view has changed significantly
    return overlapRatio < VIEW_OVERLAP_THRESHOLD;
  }, [getCurrentViewState]);

  /**
   * Captures the baseline histogram from the current rendered view.
   * Also stores the view state for later comparison.
   */
  const captureBaselineHistogram = useCallback((): boolean => {
    if (!mapRef.current || !layerRef.current) {
      return false;
    }

    try {
      const samples = sampleTilePixels(mapRef.current);
      const histogram = computeHistogram(samples);

      if (histogram.totalPixels >= MIN_PIXELS_FOR_AUTO_ADJUST) {
        baselineHistogramRef.current = histogram;
        baselineViewStateRef.current = getCurrentViewState();
        return true;
      }
    } catch {
      // Ignore errors during capture
    }

    return false;
  }, [getCurrentViewState]);

  /**
   * Clears the cached baseline histogram.
   * Should be called when the viewpoint changes.
   */
  const clearBaselineHistogram = useCallback(() => {
    baselineHistogramRef.current = null;
    baselineViewStateRef.current = null;
  }, []);

  /**
   * Returns whether a baseline histogram is currently cached.
   */
  const hasBaselineHistogram = useCallback((): boolean => {
    return baselineHistogramRef.current !== null;
  }, []);

  /**
   * Samples the canvas with default adjustments applied.
   * Temporarily resets WebGL style variables, waits for render, samples, then restores.
   */
  const sampleWithDefaultAdjustments =
    useCallback(async (): Promise<HistogramData | null> => {
      if (!mapRef.current || !layerRef.current) {
        return null;
      }

      const layer = layerRef.current;
      const defaultStyleVars = adjustmentsToStyleVariables(DEFAULT_ADJUSTMENTS);

      try {
        // Apply default adjustments to get unaltered image
        layer.updateStyleVariables(defaultStyleVars);

        // Wait for the layer to re-render
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            setTimeout(resolve, RENDER_DELAY_MS);
          });
        });

        // Sample the canvas with default adjustments
        const samples = sampleTilePixels(mapRef.current!);
        const histogram = computeHistogram(samples);

        return histogram;
      } catch {
        return null;
      }
    }, []);

  /**
   * Performs auto-adjust using the cached baseline histogram if the view
   * hasn't changed significantly, otherwise samples from the current view
   * with default adjustments applied.
   *
   * This ensures:
   * 1. Clicking Auto multiple times at the same view produces identical results
   * 2. Panning/zooming to a different area recaptures for that area's characteristics
   * 3. Baseline is always captured from unaltered image data (default adjustments)
   */
  const handlePerformAutoAdjust =
    useCallback(async (): Promise<AutoAdjustResult | null> => {
      if (!mapRef.current || !layerRef.current) {
        return null;
      }

      try {
        let histogram: HistogramData;

        // Check if we have a valid baseline for the current view
        const viewChanged = hasViewChangedSignificantly();

        if (!viewChanged && baselineHistogramRef.current) {
          // View hasn't changed significantly, use cached baseline
          histogram = baselineHistogramRef.current;
        } else {
          // View changed or no baseline - sample with default adjustments
          const sampledHistogram = await sampleWithDefaultAdjustments();

          if (!sampledHistogram) {
            return {
              success: false,
              error: "Unable to analyze image data"
            };
          }

          histogram = sampledHistogram;

          // Cache this as the baseline for future auto-adjust calls
          if (histogram.totalPixels >= MIN_PIXELS_FOR_AUTO_ADJUST) {
            baselineHistogramRef.current = histogram;
            baselineViewStateRef.current = getCurrentViewState();
          }
        }

        // Check if we have enough pixel data
        if (histogram.totalPixels < MIN_PIXELS_FOR_AUTO_ADJUST) {
          return {
            success: false,
            error: "Please zoom in or wait for tiles to load"
          };
        }

        // Calculate optimal adjustments from the baseline histogram
        const adjustments = calculateOptimalAdjustments(histogram);

        return {
          success: true,
          adjustments
        };
      } catch {
        return {
          success: false,
          error: "Unable to analyze image data"
        };
      }
    }, [
      getCurrentViewState,
      hasViewChangedSignificantly,
      sampleWithDefaultAdjustments
    ]);

  return (
    <AutoAdjustContext.Provider
      value={{
        performAutoAdjust: handlePerformAutoAdjust,
        registerMapAndLayer,
        captureBaselineHistogram,
        clearBaselineHistogram,
        hasBaselineHistogram
      }}
    >
      {children}
    </AutoAdjustContext.Provider>
  );
}

/**
 * Hook to access the auto-adjust context.
 * Returns null if used outside of AutoAdjustProvider.
 */
export function useAutoAdjust(): AutoAdjustContextType | null {
  return useContext(AutoAdjustContext);
}
