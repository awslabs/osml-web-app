// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for coordinate-transformers.ts.
 * Covers clampWGS84 and clampExtent pure functions.
 */

import { clampExtent, clampWGS84 } from "@/utils/coordinate-transformers";

describe("clampWGS84", () => {
  it("should pass through valid coordinates unchanged", () => {
    const result = clampWGS84({ longitude: 10, latitude: 45, height: 100 });
    expect(result).toEqual({ longitude: 10, latitude: 45, height: 100 });
  });

  it("should clamp longitude to [-180, 180]", () => {
    expect(clampWGS84({ longitude: 200, latitude: 0 }).longitude).toBe(180);
    expect(clampWGS84({ longitude: -200, latitude: 0 }).longitude).toBe(-180);
  });

  it("should clamp latitude to [-85, 85]", () => {
    expect(clampWGS84({ longitude: 0, latitude: 90 }).latitude).toBe(85);
    expect(clampWGS84({ longitude: 0, latitude: -90 }).latitude).toBe(-85);
  });

  it("should preserve height", () => {
    expect(clampWGS84({ longitude: 0, latitude: 0, height: 5000 }).height).toBe(
      5000
    );
  });

  it("should handle undefined height", () => {
    expect(clampWGS84({ longitude: 0, latitude: 0 }).height).toBeUndefined();
  });
});

describe("clampExtent", () => {
  it("should pass through valid extent unchanged", () => {
    const extent = { west: -10, south: -10, east: 10, north: 10 };
    expect(clampExtent(extent)).toEqual(extent);
  });

  it("should clamp west/east to [-180, 180]", () => {
    const result = clampExtent({ west: -200, south: 0, east: 200, north: 10 });
    expect(result.west).toBe(-180);
    expect(result.east).toBe(180);
  });

  it("should clamp south/north to [-85, 85]", () => {
    const result = clampExtent({ west: 0, south: -90, east: 10, north: 90 });
    expect(result.south).toBe(-85);
    expect(result.north).toBe(85);
  });
});
