// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Property-based tests for auto-adjust utilities.
 * Tests histogram computation and optimal adjustment calculation.
 */

import * as fc from "fast-check";

import {
  calculateOptimalAdjustments,
  computeHistogram,
  PixelData
} from "@/utils/auto-adjust";

// Helper to create PixelData from pixel values (compatible with computeHistogram)
function createPixelData(
  pixels: Array<{ r: number; g: number; b: number; a: number }>,
  width: number,
  height: number
): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length && i < width * height; i++) {
    const pixel = pixels[i];
    data[i * 4] = pixel.r;
    data[i * 4 + 1] = pixel.g;
    data[i * 4 + 2] = pixel.b;
    data[i * 4 + 3] = pixel.a;
  }
  return { data, width, height };
}

// Arbitrary for a single pixel (RGBA values 0-255)
const pixelArb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
  a: fc.integer({ min: 0, max: 255 })
});

// Arbitrary for non-transparent pixel (alpha > 0)
const opaquePixelArb = fc.record({
  r: fc.integer({ min: 0, max: 255 }),
  g: fc.integer({ min: 0, max: 255 }),
  b: fc.integer({ min: 0, max: 255 }),
  a: fc.integer({ min: 1, max: 255 })
});

// Arbitrary for image dimensions (small for performance)
const dimensionsArb = fc.tuple(
  fc.integer({ min: 1, max: 32 }),
  fc.integer({ min: 1, max: 32 })
);

describe("Auto-Adjust Utilities - Property-Based Tests", () => {
  /**
   * Feature: image-adjustment-controls, Property 4: Histogram Bin Sum Invariant
   * Validates: Requirements 8.3
   *
   * Property: For any array of pixel data samples, computing a histogram SHALL
   * produce bins where the sum of all bin counts equals the total number of
   * pixels sampled.
   */
  describe("Property 4: Histogram Bin Sum Invariant", () => {
    it("should have bin sum equal to totalPixels for opaque pixels", () => {
      fc.assert(
        fc.property(
          dimensionsArb,
          fc.array(opaquePixelArb, { minLength: 1, maxLength: 100 }),
          ([width, height], pixels) => {
            // Create PixelData with the generated pixels
            const pixelData = createPixelData(pixels, width, height);
            const samples = [pixelData];

            // Compute histogram
            const histogram = computeHistogram(samples);

            // Property: Sum of all bins should equal totalPixels
            const binSum = histogram.bins.reduce(
              (sum, count) => sum + count,
              0
            );
            expect(binSum).toBe(histogram.totalPixels);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should have bin sum equal to totalPixels excluding transparent pixels", () => {
      fc.assert(
        fc.property(
          dimensionsArb,
          fc.array(pixelArb, { minLength: 1, maxLength: 100 }),
          ([width, height], pixels) => {
            // Create PixelData with the generated pixels
            const pixelData = createPixelData(pixels, width, height);
            const samples = [pixelData];

            // Compute histogram
            const histogram = computeHistogram(samples);

            // Count non-transparent pixels manually
            let expectedOpaquePixels = 0;
            const actualPixelCount = Math.min(pixels.length, width * height);
            for (let i = 0; i < actualPixelCount; i++) {
              if (pixels[i].a > 0) {
                expectedOpaquePixels++;
              }
            }

            // Property: Sum of all bins should equal totalPixels
            const binSum = histogram.bins.reduce(
              (sum, count) => sum + count,
              0
            );
            expect(binSum).toBe(histogram.totalPixels);

            // Property: totalPixels should equal count of non-transparent pixels
            expect(histogram.totalPixels).toBe(expectedOpaquePixels);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should have bin sum equal to totalPixels across multiple samples", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(
              dimensionsArb,
              fc.array(opaquePixelArb, { minLength: 1, maxLength: 50 })
            ),
            { minLength: 1, maxLength: 5 }
          ),
          (sampleSpecs) => {
            // Create multiple PixelData samples
            const samples = sampleSpecs.map(([[width, height], pixels]) =>
              createPixelData(pixels, width, height)
            );

            // Compute histogram
            const histogram = computeHistogram(samples);

            // Property: Sum of all bins should equal totalPixels
            const binSum = histogram.bins.reduce(
              (sum, count) => sum + count,
              0
            );
            expect(binSum).toBe(histogram.totalPixels);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it("should return zero totalPixels for empty samples", () => {
      const histogram = computeHistogram([]);

      // Property: Empty samples should produce zero totalPixels
      expect(histogram.totalPixels).toBe(0);
      const binSum = histogram.bins.reduce((sum, count) => sum + count, 0);
      expect(binSum).toBe(0);
    });

    it("should have exactly 256 bins", () => {
      fc.assert(
        fc.property(
          dimensionsArb,
          fc.array(pixelArb, { minLength: 0, maxLength: 100 }),
          ([width, height], pixels) => {
            const pixelData = createPixelData(pixels, width, height);
            const samples = pixels.length > 0 ? [pixelData] : [];

            const histogram = computeHistogram(samples);

            // Property: Histogram should always have exactly 256 bins
            expect(histogram.bins).toHaveLength(256);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * Feature: image-adjustment-controls, Property 5: Optimal Adjustments Within Valid Ranges
 * Validates: Requirements 8.4, 8.5, 8.6
 *
 * Property: For any computed histogram, the calculated optimal adjustments SHALL
 * have exposure in [-1, 1], contrast in [-1, 1], and gamma in [0.1, 3.0].
 */
describe("Property 5: Optimal Adjustments Within Valid Ranges", () => {
  it("should produce exposure within valid range for any histogram", () => {
    fc.assert(
      fc.property(
        dimensionsArb,
        fc.array(opaquePixelArb, { minLength: 1, maxLength: 100 }),
        ([width, height], pixels) => {
          const pixelData = createPixelData(pixels, width, height);
          const histogram = computeHistogram([pixelData]);
          const optimal = calculateOptimalAdjustments(histogram);

          // Property: Exposure should be within [-1, 1]
          expect(optimal.exposure).toBeGreaterThanOrEqual(-1);
          expect(optimal.exposure).toBeLessThanOrEqual(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should produce contrast within valid range for any histogram", () => {
    fc.assert(
      fc.property(
        dimensionsArb,
        fc.array(opaquePixelArb, { minLength: 1, maxLength: 100 }),
        ([width, height], pixels) => {
          const pixelData = createPixelData(pixels, width, height);
          const histogram = computeHistogram([pixelData]);
          const optimal = calculateOptimalAdjustments(histogram);

          // Property: Contrast should be within [-1, 1]
          expect(optimal.contrast).toBeGreaterThanOrEqual(-1);
          expect(optimal.contrast).toBeLessThanOrEqual(1);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should produce gamma within valid range for any histogram", () => {
    fc.assert(
      fc.property(
        dimensionsArb,
        fc.array(opaquePixelArb, { minLength: 1, maxLength: 100 }),
        ([width, height], pixels) => {
          const pixelData = createPixelData(pixels, width, height);
          const histogram = computeHistogram([pixelData]);
          const optimal = calculateOptimalAdjustments(histogram);

          // Property: Gamma should be within [0.1, 3.0]
          expect(optimal.gamma).toBeGreaterThanOrEqual(0.1);
          expect(optimal.gamma).toBeLessThanOrEqual(3.0);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should produce valid adjustments for empty histogram", () => {
    const emptyHistogram = computeHistogram([]);
    const optimal = calculateOptimalAdjustments(emptyHistogram);

    // Property: All adjustments should be within valid ranges
    expect(optimal.exposure).toBeGreaterThanOrEqual(-1);
    expect(optimal.exposure).toBeLessThanOrEqual(1);
    expect(optimal.contrast).toBeGreaterThanOrEqual(-1);
    expect(optimal.contrast).toBeLessThanOrEqual(1);
    expect(optimal.gamma).toBeGreaterThanOrEqual(0.1);
    expect(optimal.gamma).toBeLessThanOrEqual(3.0);
  });

  it("should produce valid adjustments for extreme pixel values", () => {
    // Test with all black pixels
    const blackPixels = Array(100).fill({ r: 0, g: 0, b: 0, a: 255 });
    const blackData = createPixelData(blackPixels, 10, 10);
    const blackHistogram = computeHistogram([blackData]);
    const blackOptimal = calculateOptimalAdjustments(blackHistogram);

    expect(blackOptimal.exposure).toBeGreaterThanOrEqual(-1);
    expect(blackOptimal.exposure).toBeLessThanOrEqual(1);
    expect(blackOptimal.contrast).toBeGreaterThanOrEqual(-1);
    expect(blackOptimal.contrast).toBeLessThanOrEqual(1);
    expect(blackOptimal.gamma).toBeGreaterThanOrEqual(0.1);
    expect(blackOptimal.gamma).toBeLessThanOrEqual(3.0);

    // Test with all white pixels
    const whitePixels = Array(100).fill({ r: 255, g: 255, b: 255, a: 255 });
    const whiteData = createPixelData(whitePixels, 10, 10);
    const whiteHistogram = computeHistogram([whiteData]);
    const whiteOptimal = calculateOptimalAdjustments(whiteHistogram);

    expect(whiteOptimal.exposure).toBeGreaterThanOrEqual(-1);
    expect(whiteOptimal.exposure).toBeLessThanOrEqual(1);
    expect(whiteOptimal.contrast).toBeGreaterThanOrEqual(-1);
    expect(whiteOptimal.contrast).toBeLessThanOrEqual(1);
    expect(whiteOptimal.gamma).toBeGreaterThanOrEqual(0.1);
    expect(whiteOptimal.gamma).toBeLessThanOrEqual(3.0);
  });
});

/**
 * Feature: image-adjustment-controls, Property 6: Auto-Adjust Preserves RGB Gains
 * Validates: Requirements 8.9
 *
 * Property: For any auto-adjust operation, the RGB gain values (redGain, greenGain,
 * blueGain) in currentAdjustments SHALL remain unchanged from their values before
 * the auto-adjust was triggered.
 */
describe("Property 6: Auto-Adjust Preserves RGB Gains", () => {
  // Import the function we need to test
  const { applyAutoAdjustPreservingRgbGains } =
    require("@/utils/auto-adjust") as typeof import("@/utils/auto-adjust");

  // Arbitrary for RGB gain values
  const rgbGainArb = fc.double({ min: 0, max: 2, noNaN: true });

  // Arbitrary for current adjustments (full ImageAdjustments)
  const currentAdjustmentsArb = fc.record({
    exposure: fc.double({ min: -1, max: 1, noNaN: true }),
    contrast: fc.double({ min: -1, max: 1, noNaN: true }),
    saturation: fc.double({ min: -1, max: 1, noNaN: true }),
    gamma: fc.double({ min: 0.1, max: 3.0, noNaN: true }),
    redGain: rgbGainArb,
    greenGain: rgbGainArb,
    blueGain: rgbGainArb
  });

  // Arbitrary for optimal adjustments (only exposure, contrast, gamma)
  const optimalAdjustmentsArb = fc.record({
    exposure: fc.double({ min: -1, max: 1, noNaN: true }),
    contrast: fc.double({ min: -1, max: 1, noNaN: true }),
    gamma: fc.double({ min: 0.1, max: 3.0, noNaN: true })
  });

  it("should preserve redGain after auto-adjust", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: redGain should be unchanged
          expect(result.redGain).toBeCloseTo(currentAdjustments.redGain, 10);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should preserve greenGain after auto-adjust", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: greenGain should be unchanged
          expect(result.greenGain).toBeCloseTo(
            currentAdjustments.greenGain,
            10
          );

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should preserve blueGain after auto-adjust", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: blueGain should be unchanged
          expect(result.blueGain).toBeCloseTo(currentAdjustments.blueGain, 10);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should preserve all RGB gains simultaneously", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: All RGB gains should be unchanged
          expect(result.redGain).toBeCloseTo(currentAdjustments.redGain, 10);
          expect(result.greenGain).toBeCloseTo(
            currentAdjustments.greenGain,
            10
          );
          expect(result.blueGain).toBeCloseTo(currentAdjustments.blueGain, 10);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should apply optimal exposure, contrast, and gamma values", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: Optimal values should be applied
          expect(result.exposure).toBeCloseTo(optimalAdjustments.exposure, 10);
          expect(result.contrast).toBeCloseTo(optimalAdjustments.contrast, 10);
          expect(result.gamma).toBeCloseTo(optimalAdjustments.gamma, 10);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("should preserve saturation (not modified by auto-adjust)", () => {
    fc.assert(
      fc.property(
        currentAdjustmentsArb,
        optimalAdjustmentsArb,
        (currentAdjustments, optimalAdjustments) => {
          const result = applyAutoAdjustPreservingRgbGains(
            currentAdjustments,
            optimalAdjustments
          );

          // Property: Saturation should be preserved (not part of optimal adjustments)
          expect(result.saturation).toBeCloseTo(
            currentAdjustments.saturation,
            10
          );

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});
