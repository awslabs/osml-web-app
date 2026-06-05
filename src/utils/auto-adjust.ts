// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Auto-adjust utilities for computing optimal image adjustments
 * based on pixel data analysis from visible tiles.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10
 */

import Map from "ol/Map";

import {
  ADJUSTMENT_CONSTRAINTS,
  clampAdjustment,
  ImageAdjustments
} from "@/utils/image-adjustments";

/**
 * Histogram data computed from pixel samples.
 * Requirements: 8.3
 */
export interface HistogramData {
  /** 256 bins for intensity values (0-255) */
  bins: number[];
  /** Minimum intensity found */
  min: number;
  /** Maximum intensity found */
  max: number;
  /** Mean intensity (0-1 normalized) */
  mean: number;
  /** Standard deviation of intensity (0-1 normalized) */
  stdDev: number;
  /** Total number of pixels sampled */
  totalPixels: number;
}

/**
 * Optimal adjustments computed from histogram analysis.
 * Note: RGB gains are not included as they are preserved from user settings.
 * Requirements: 8.4, 8.5, 8.6, 8.9
 */
export interface OptimalAdjustments {
  exposure: number;
  contrast: number;
  gamma: number;
}

/** Minimum number of pixels required for reliable auto-adjust */
export const MIN_PIXELS_FOR_AUTO_ADJUST = 1000;

/**
 * Samples pixel data from all visible tiles in the WebGL layer.
 * Uses canvas to extract pixel data from the rendered map.
 *
 * Requirements: 8.1, 8.2
 *
 * @param map - The OpenLayers map instance
 * @param layer - The WebGLTileLayer to sample from
 * @returns Array of ImageData objects from visible tiles, or empty array if sampling fails
 */
export function sampleTilePixels(map: Map): ImageData[] {
  const samples: ImageData[] = [];

  try {
    // Get the map's viewport element
    const viewport = map.getViewport();
    if (!viewport) {
      return samples;
    }

    // Find the canvas element used by the WebGL layer
    const canvases = viewport.querySelectorAll("canvas");
    if (canvases.length === 0) {
      return samples;
    }

    // Sample from each canvas (there may be multiple for different layers)
    // Convert NodeList to array for iteration compatibility
    const canvasArray = Array.from(canvases);
    for (const canvas of canvasArray) {
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          // Try WebGL context for WebGL canvases
          const webglCtx =
            canvas.getContext("webgl") ||
            canvas.getContext("webgl2") ||
            canvas.getContext("experimental-webgl");

          if (webglCtx) {
            // For WebGL context, we need to read pixels differently
            const width = canvas.width;
            const height = canvas.height;

            if (width > 0 && height > 0) {
              const pixels = new Uint8Array(width * height * 4);
              (webglCtx as WebGLRenderingContext).readPixels(
                0,
                0,
                width,
                height,
                (webglCtx as WebGLRenderingContext).RGBA,
                (webglCtx as WebGLRenderingContext).UNSIGNED_BYTE,
                pixels
              );

              // Convert to ImageData-like structure
              const imageData = new ImageData(
                new Uint8ClampedArray(pixels),
                width,
                height
              );
              samples.push(imageData);
            }
          }
          continue;
        }

        // For 2D context, use getImageData
        const width = canvas.width;
        const height = canvas.height;

        if (width > 0 && height > 0) {
          const imageData = ctx.getImageData(0, 0, width, height);
          samples.push(imageData);
        }
      } catch {
        // Skip this canvas if we can't read from it (CORS, security, etc.)
        continue;
      }
    }
  } catch {
    // Return empty array if any error occurs
    return [];
  }

  return samples;
}

/**
 * Interface for pixel data that can be used with computeHistogram.
 * Compatible with browser's ImageData and test mocks.
 */
export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Computes a histogram from aggregated pixel data samples.
 * Calculates intensity distribution and statistics across all sampled pixels.
 *
 * Requirements: 8.3
 *
 * @param samples - Array of PixelData objects from tile sampling
 * @returns HistogramData with bins and statistics
 */
export function computeHistogram(samples: PixelData[]): HistogramData {
  // Initialize 256 bins for intensity values
  const bins: number[] = Array.from({ length: 256 }, () => 0);
  let totalPixels = 0;
  let sum = 0;
  let min = 255;
  let max = 0;

  // Process each sample
  for (const sample of samples) {
    const data = sample.data;
    // Process pixels (RGBA format, 4 bytes per pixel)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // Skip fully transparent pixels
      if (a === 0) {
        continue;
      }

      // Calculate luminance (perceived brightness)
      // Using standard luminance formula: 0.299*R + 0.587*G + 0.114*B
      const intensity = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

      // Update histogram bin
      bins[intensity]++;
      totalPixels++;
      sum += intensity;

      // Track min/max
      if (intensity < min) min = intensity;
      if (intensity > max) max = intensity;
    }
  }

  // Handle edge case of no valid pixels
  if (totalPixels === 0) {
    return {
      bins,
      min: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
      totalPixels: 0
    };
  }

  // Calculate mean (normalized to 0-1)
  const mean = sum / totalPixels / 255;

  // Calculate standard deviation (normalized to 0-1)
  let varianceSum = 0;
  for (let i = 0; i < 256; i++) {
    if (bins[i] > 0) {
      const normalizedValue = i / 255;
      const diff = normalizedValue - mean;
      varianceSum += diff * diff * bins[i];
    }
  }
  const stdDev = Math.sqrt(varianceSum / totalPixels);

  return {
    bins,
    min,
    max,
    mean,
    stdDev,
    totalPixels
  };
}

/**
 * Calculates optimal image adjustments based on histogram analysis.
 * Computes exposure, contrast, and gamma values to normalize the image.
 * Uses industry-standard algorithms for deterministic, mathematically sound results.
 *
 * Requirements: 8.4, 8.5, 8.6
 *
 * @param histogram - HistogramData from computeHistogram
 * @returns OptimalAdjustments with exposure, contrast, and gamma values
 */
export function calculateOptimalAdjustments(
  histogram: HistogramData
): OptimalAdjustments {
  // Handle edge case of no pixel data
  if (histogram.totalPixels === 0) {
    return {
      exposure: ADJUSTMENT_CONSTRAINTS.exposure.default,
      contrast: ADJUSTMENT_CONSTRAINTS.contrast.default,
      gamma: ADJUSTMENT_CONSTRAINTS.gamma.default
    };
  }

  // Calculate exposure from mean intensity deviation from midpoint (0.5)
  // Requirement 8.4: Calculate optimal exposure based on mean intensity deviation
  // If mean < 0.5, image is dark, need positive exposure
  // If mean > 0.5, image is bright, need negative exposure
  const targetMean = 0.5;
  const meanDeviation = targetMean - histogram.mean;
  // Scale the deviation to exposure range (-1 to 1)
  // A deviation of 0.5 (completely dark or bright) maps to full exposure adjustment
  const exposure = clampAdjustment("exposure", meanDeviation * 2);

  // Calculate contrast using percentile-based approach (industry standard)
  // Requirement 8.5: Calculate optimal contrast based on histogram distribution
  // Find 2nd and 98th percentiles to avoid outlier influence
  const lowPercentile = findPercentile(
    histogram.bins,
    histogram.totalPixels,
    0.02
  );
  const highPercentile = findPercentile(
    histogram.bins,
    histogram.totalPixels,
    0.98
  );
  const dynamicRange = (highPercentile - lowPercentile) / 255;

  // Target dynamic range is ~0.8 (using 80% of available range)
  // If current range is smaller, increase contrast; if larger, decrease
  const targetRange = 0.8;
  let contrast: number;
  if (dynamicRange < 0.01) {
    // Nearly flat histogram - maximum contrast boost
    contrast = 0.8;
  } else {
    // Calculate contrast adjustment to achieve target range
    // contrast = (targetRange / dynamicRange) - 1, scaled appropriately
    const rangeRatio = targetRange / dynamicRange;
    if (rangeRatio > 1) {
      // Need to increase contrast
      contrast = Math.min(0.8, (rangeRatio - 1) * 0.5);
    } else {
      // Need to decrease contrast
      contrast = Math.max(-0.5, (rangeRatio - 1) * 0.5);
    }
  }
  contrast = clampAdjustment("contrast", contrast);

  // Calculate gamma using proper mathematical formula (industry standard)
  // Requirement 8.6: Calculate optimal gamma to normalize histogram distribution
  // The standard formula maps the current mean to the target mean (0.5):
  // targetMean = currentMean^gamma => gamma = log(targetMean) / log(currentMean)
  let gamma: number;
  // Avoid division by zero and log of zero/negative
  if (histogram.mean <= 0.01) {
    // Very dark image - use minimum gamma to brighten
    gamma = ADJUSTMENT_CONSTRAINTS.gamma.min;
  } else if (histogram.mean >= 0.99) {
    // Very bright image - use maximum gamma to darken
    gamma = ADJUSTMENT_CONSTRAINTS.gamma.max;
  } else if (Math.abs(histogram.mean - targetMean) < 0.02) {
    // Already close to target - no gamma correction needed
    gamma = 1.0;
  } else {
    // Apply standard gamma correction formula
    gamma = Math.log(targetMean) / Math.log(histogram.mean);
  }
  gamma = clampAdjustment("gamma", gamma);

  return {
    exposure,
    contrast,
    gamma
  };
}

/**
 * Finds the intensity value at a given percentile in the histogram.
 * Used for percentile-based contrast calculation.
 *
 * @param bins - Histogram bins (256 values)
 * @param totalPixels - Total number of pixels
 * @param percentile - Percentile to find (0-1)
 * @returns Intensity value (0-255) at the given percentile
 */
function findPercentile(
  bins: number[],
  totalPixels: number,
  percentile: number
): number {
  const targetCount = totalPixels * percentile;
  let cumulative = 0;

  for (let i = 0; i < 256; i++) {
    cumulative += bins[i];
    if (cumulative >= targetCount) {
      return i;
    }
  }

  return 255;
}

/**
 * Result of an auto-adjust operation.
 */
export interface AutoAdjustResult {
  success: boolean;
  adjustments?: OptimalAdjustments;
  error?: string;
}

/**
 * Performs the complete auto-adjust operation: samples pixels, computes histogram,
 * and calculates optimal adjustments.
 *
 * Requirements: 8.7, 8.10
 *
 * @param map - The OpenLayers map instance
 * @param layer - The WebGLTileLayer to sample from
 * @returns AutoAdjustResult with success status and adjustments or error message
 */
export function performAutoAdjust(map: Map): AutoAdjustResult {
  try {
    // Sample pixel data from visible tiles
    const samples = sampleTilePixels(map);

    // Compute histogram from samples
    const histogram = computeHistogram(samples);

    // Check if we have enough pixel data
    if (histogram.totalPixels < MIN_PIXELS_FOR_AUTO_ADJUST) {
      return {
        success: false,
        error: "Please zoom in or wait for tiles to load"
      };
    }

    // Calculate optimal adjustments
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
}

/**
 * Applies auto-adjust results to existing adjustments, preserving RGB gains.
 *
 * Requirements: 8.9
 *
 * @param currentAdjustments - Current ImageAdjustments from state
 * @param optimalAdjustments - Optimal adjustments from auto-adjust
 * @returns New ImageAdjustments with optimal values but preserved RGB gains
 */
export function applyAutoAdjustPreservingRgbGains(
  currentAdjustments: ImageAdjustments,
  optimalAdjustments: OptimalAdjustments
): ImageAdjustments {
  return {
    exposure: optimalAdjustments.exposure,
    contrast: optimalAdjustments.contrast,
    saturation: currentAdjustments.saturation, // Preserve saturation
    gamma: optimalAdjustments.gamma,
    redGain: currentAdjustments.redGain, // Preserve RGB gains
    greenGain: currentAdjustments.greenGain,
    blueGain: currentAdjustments.blueGain
  };
}
