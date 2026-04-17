// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for auto-adjust utilities.
 * Complements the existing property-based tests by covering specific
 * deterministic scenarios: histogram computation edge cases,
 * optimal adjustment calculations for known inputs, and
 * applyAutoAdjustPreservingRgbGains.
 */

import { ADJUSTMENT_CONSTRAINTS, DEFAULT_ADJUSTMENTS } from "@/store/types";
import {
  applyAutoAdjustPreservingRgbGains,
  calculateOptimalAdjustments,
  computeHistogram,
  HistogramData,
  MIN_PIXELS_FOR_AUTO_ADJUST,
  PixelData
} from "@/utils/auto-adjust";

// Helper: create PixelData from uniform RGBA values
function uniformPixels(
  r: number,
  g: number,
  b: number,
  a: number,
  count: number
): PixelData {
  const side = Math.ceil(Math.sqrt(count));
  const data = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < side * side; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width: side, height: side };
}

// ---------------------------------------------------------------------------
// computeHistogram
// ---------------------------------------------------------------------------
describe("computeHistogram", () => {
  it("should return zero stats for empty samples", () => {
    const h = computeHistogram([]);
    expect(h.totalPixels).toBe(0);
    expect(h.mean).toBe(0);
    expect(h.stdDev).toBe(0);
    expect(h.min).toBe(0);
    expect(h.max).toBe(0);
    expect(h.bins).toHaveLength(256);
  });

  it("should skip fully transparent pixels", () => {
    const sample = uniformPixels(128, 128, 128, 0, 100);
    const h = computeHistogram([sample]);
    expect(h.totalPixels).toBe(0);
  });

  it("should compute correct stats for uniform mid-grey pixels", () => {
    // RGB(128,128,128) → luminance = 0.299*128 + 0.587*128 + 0.114*128 = 128
    const sample = uniformPixels(128, 128, 128, 255, 100);
    const h = computeHistogram([sample]);

    expect(h.totalPixels).toBeGreaterThan(0);
    expect(h.min).toBe(128);
    expect(h.max).toBe(128);
    // mean should be 128/255 ≈ 0.502
    expect(h.mean).toBeCloseTo(128 / 255, 2);
    // stdDev should be 0 for uniform pixels
    expect(h.stdDev).toBeCloseTo(0, 5);
  });

  it("should compute correct stats for all-black pixels", () => {
    const sample = uniformPixels(0, 0, 0, 255, 100);
    const h = computeHistogram([sample]);

    expect(h.min).toBe(0);
    expect(h.max).toBe(0);
    expect(h.mean).toBe(0);
    expect(h.stdDev).toBe(0);
  });

  it("should compute correct stats for all-white pixels", () => {
    const sample = uniformPixels(255, 255, 255, 255, 100);
    const h = computeHistogram([sample]);

    expect(h.min).toBe(255);
    expect(h.max).toBe(255);
    expect(h.mean).toBeCloseTo(1.0, 2);
    expect(h.stdDev).toBeCloseTo(0, 5);
  });

  it("should aggregate across multiple samples", () => {
    const black = uniformPixels(0, 0, 0, 255, 50);
    const white = uniformPixels(255, 255, 255, 255, 50);
    const h = computeHistogram([black, white]);

    // Should have pixels from both samples
    expect(h.totalPixels).toBeGreaterThan(0);
    expect(h.min).toBe(0);
    expect(h.max).toBe(255);
    // Mean should be roughly 0.5
    expect(h.mean).toBeCloseTo(0.5, 1);
  });

  it("should use luminance formula (not simple average)", () => {
    // Pure red: luminance = 0.299*255 = 76.245 → rounds to 76
    const red = uniformPixels(255, 0, 0, 255, 100);
    const h = computeHistogram([red]);

    const expectedIntensity = Math.round(0.299 * 255);
    expect(h.bins[expectedIntensity]).toBeGreaterThan(0);
    expect(h.min).toBe(expectedIntensity);
    expect(h.max).toBe(expectedIntensity);
  });
});

// ---------------------------------------------------------------------------
// calculateOptimalAdjustments
// ---------------------------------------------------------------------------
describe("calculateOptimalAdjustments", () => {
  it("should return defaults for empty histogram", () => {
    const emptyHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
      totalPixels: 0
    };

    const adj = calculateOptimalAdjustments(emptyHist);
    expect(adj.exposure).toBe(ADJUSTMENT_CONSTRAINTS.exposure.default);
    expect(adj.contrast).toBe(ADJUSTMENT_CONSTRAINTS.contrast.default);
    expect(adj.gamma).toBe(ADJUSTMENT_CONSTRAINTS.gamma.default);
  });

  it("should suggest positive exposure for dark images", () => {
    // Mean = 0.1 (dark image) → deviation = 0.5 - 0.1 = 0.4 → exposure = 0.8
    const darkHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 10,
      max: 40,
      mean: 0.1,
      stdDev: 0.05,
      totalPixels: 10000
    };
    darkHist.bins[25] = 10000;

    const adj = calculateOptimalAdjustments(darkHist);
    expect(adj.exposure).toBeGreaterThan(0);
  });

  it("should suggest negative exposure for bright images", () => {
    // Mean = 0.9 (bright image) → deviation = 0.5 - 0.9 = -0.4 → exposure = -0.8
    const brightHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 200,
      max: 250,
      mean: 0.9,
      stdDev: 0.05,
      totalPixels: 10000
    };
    brightHist.bins[230] = 10000;

    const adj = calculateOptimalAdjustments(brightHist);
    expect(adj.exposure).toBeLessThan(0);
  });

  it("should suggest near-zero exposure for well-exposed images", () => {
    const balancedHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 50,
      max: 200,
      mean: 0.5,
      stdDev: 0.15,
      totalPixels: 10000
    };
    balancedHist.bins[128] = 10000;

    const adj = calculateOptimalAdjustments(balancedHist);
    expect(Math.abs(adj.exposure)).toBeLessThan(0.05);
  });

  it("should boost contrast for low dynamic range images", () => {
    // All pixels concentrated in a narrow band
    const narrowHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 120,
      max: 130,
      mean: 0.49,
      stdDev: 0.01,
      totalPixels: 10000
    };
    // Spread pixels across bins 120-130
    for (let i = 120; i <= 130; i++) {
      narrowHist.bins[i] = 909;
    }
    narrowHist.bins[125] += 1; // total = 10000

    const adj = calculateOptimalAdjustments(narrowHist);
    expect(adj.contrast).toBeGreaterThan(0);
  });

  it("should set max contrast for nearly flat histogram", () => {
    // Dynamic range < 0.01 → contrast = 0.8
    const flatHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 128,
      max: 128,
      mean: 0.502,
      stdDev: 0.0,
      totalPixels: 10000
    };
    flatHist.bins[128] = 10000;

    const adj = calculateOptimalAdjustments(flatHist);
    expect(adj.contrast).toBe(0.8);
  });

  it("should use minimum gamma for very dark images (mean ≤ 0.01)", () => {
    const veryDarkHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 0,
      max: 2,
      mean: 0.005,
      stdDev: 0.002,
      totalPixels: 10000
    };
    veryDarkHist.bins[1] = 10000;

    const adj = calculateOptimalAdjustments(veryDarkHist);
    expect(adj.gamma).toBe(ADJUSTMENT_CONSTRAINTS.gamma.min);
  });

  it("should use maximum gamma for very bright images (mean ≥ 0.99)", () => {
    const veryBrightHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 253,
      max: 255,
      mean: 0.995,
      stdDev: 0.002,
      totalPixels: 10000
    };
    veryBrightHist.bins[254] = 10000;

    const adj = calculateOptimalAdjustments(veryBrightHist);
    expect(adj.gamma).toBe(ADJUSTMENT_CONSTRAINTS.gamma.max);
  });

  it("should set gamma to 1.0 when mean is close to 0.5", () => {
    const balancedHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 100,
      max: 155,
      mean: 0.5,
      stdDev: 0.1,
      totalPixels: 10000
    };
    balancedHist.bins[128] = 10000;

    const adj = calculateOptimalAdjustments(balancedHist);
    expect(adj.gamma).toBe(1.0);
  });

  it("should clamp all values within valid ranges", () => {
    // Extreme histogram that might push values out of range
    const extremeHist: HistogramData = {
      bins: Array<number>(256).fill(0),
      min: 0,
      max: 0,
      mean: 0.001,
      stdDev: 0.0,
      totalPixels: 10000
    };
    extremeHist.bins[0] = 10000;

    const adj = calculateOptimalAdjustments(extremeHist);
    expect(adj.exposure).toBeGreaterThanOrEqual(
      ADJUSTMENT_CONSTRAINTS.exposure.min
    );
    expect(adj.exposure).toBeLessThanOrEqual(
      ADJUSTMENT_CONSTRAINTS.exposure.max
    );
    expect(adj.contrast).toBeGreaterThanOrEqual(
      ADJUSTMENT_CONSTRAINTS.contrast.min
    );
    expect(adj.contrast).toBeLessThanOrEqual(
      ADJUSTMENT_CONSTRAINTS.contrast.max
    );
    expect(adj.gamma).toBeGreaterThanOrEqual(ADJUSTMENT_CONSTRAINTS.gamma.min);
    expect(adj.gamma).toBeLessThanOrEqual(ADJUSTMENT_CONSTRAINTS.gamma.max);
  });
});

// ---------------------------------------------------------------------------
// applyAutoAdjustPreservingRgbGains
// ---------------------------------------------------------------------------
describe("applyAutoAdjustPreservingRgbGains", () => {
  it("should apply optimal values while preserving RGB gains and saturation", () => {
    const current = {
      ...DEFAULT_ADJUSTMENTS,
      redGain: 1.5,
      greenGain: 0.8,
      blueGain: 1.2,
      saturation: 0.3
    };

    const optimal = { exposure: 0.5, contrast: -0.2, gamma: 1.5 };

    const result = applyAutoAdjustPreservingRgbGains(current, optimal);

    expect(result.exposure).toBe(0.5);
    expect(result.contrast).toBe(-0.2);
    expect(result.gamma).toBe(1.5);
    expect(result.redGain).toBe(1.5);
    expect(result.greenGain).toBe(0.8);
    expect(result.blueGain).toBe(1.2);
    expect(result.saturation).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// MIN_PIXELS_FOR_AUTO_ADJUST constant
// ---------------------------------------------------------------------------
describe("MIN_PIXELS_FOR_AUTO_ADJUST", () => {
  it("should be 1000", () => {
    expect(MIN_PIXELS_FOR_AUTO_ADJUST).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// performAutoAdjust and sampleTilePixels coverage
// ---------------------------------------------------------------------------

import { performAutoAdjust, sampleTilePixels } from "@/utils/auto-adjust";

describe("sampleTilePixels", () => {
  it("should return empty array when map has no viewport", () => {
    const mockMap = { getViewport: () => null } as never;
    expect(sampleTilePixels(mockMap)).toEqual([]);
  });

  it("should return empty array when viewport has no canvases", () => {
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => []
      })
    } as never;
    expect(sampleTilePixels(mockMap)).toEqual([]);
  });

  it("should sample from 2D canvas context", () => {
    const data = new Uint8ClampedArray(2 * 2 * 4);
    const mockImageData = { data, width: 2, height: 2 };
    const mockCtx = {
      getImageData: jest.fn(() => mockImageData)
    };
    const mockCanvas = {
      getContext: jest.fn((type: string) => (type === "2d" ? mockCtx : null)),
      width: 2,
      height: 2
    };
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => [mockCanvas]
      })
    } as never;

    const samples = sampleTilePixels(mockMap);
    expect(samples).toHaveLength(1);
    expect(mockCtx.getImageData).toHaveBeenCalledWith(0, 0, 2, 2);
  });

  it("should skip canvases with zero dimensions", () => {
    const mockCtx = { getImageData: jest.fn() };
    const mockCanvas = {
      getContext: jest.fn(() => mockCtx),
      width: 0,
      height: 0
    };
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => [mockCanvas]
      })
    } as never;

    const samples = sampleTilePixels(mockMap);
    expect(samples).toHaveLength(0);
  });

  it("should handle canvas read errors gracefully", () => {
    const mockCanvas = {
      getContext: jest.fn(() => {
        throw new Error("Security error");
      }),
      width: 100,
      height: 100
    };
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => [mockCanvas]
      })
    } as never;

    const samples = sampleTilePixels(mockMap);
    expect(samples).toEqual([]);
  });
});

describe("performAutoAdjust", () => {
  it("should return error when not enough pixels", () => {
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => []
      })
    } as never;

    const result = performAutoAdjust(mockMap);
    expect(result.success).toBe(false);
    expect(result.error).toContain("zoom in");
  });

  it("should return adjustments when enough pixels available", () => {
    // Create a canvas mock with enough pixel data
    const side = 50; // 50x50 = 2500 pixels > MIN_PIXELS_FOR_AUTO_ADJUST
    const data = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      data[i * 4] = 128;
      data[i * 4 + 1] = 128;
      data[i * 4 + 2] = 128;
      data[i * 4 + 3] = 255;
    }
    const mockImageData = { data, width: side, height: side };
    const mockCtx = { getImageData: jest.fn(() => mockImageData) };
    const mockCanvas = {
      getContext: jest.fn(() => mockCtx),
      width: side,
      height: side
    };
    const mockMap = {
      getViewport: () => ({
        querySelectorAll: () => [mockCanvas]
      })
    } as never;

    const result = performAutoAdjust(mockMap);
    expect(result.success).toBe(true);
    expect(result.adjustments).toBeDefined();
    expect(result.adjustments!.exposure).toBeDefined();
    expect(result.adjustments!.contrast).toBeDefined();
    expect(result.adjustments!.gamma).toBeDefined();
  });

  it("should return error when viewport throws", () => {
    // When getViewport throws, sampleTilePixels catches it and returns [],
    // which means totalPixels < MIN_PIXELS_FOR_AUTO_ADJUST
    const mockMap = {
      getViewport: () => {
        throw new Error("Map error");
      }
    } as never;

    const result = performAutoAdjust(mockMap);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
