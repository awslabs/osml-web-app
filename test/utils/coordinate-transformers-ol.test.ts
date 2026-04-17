// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for coordinate-transformers-ol.ts.
 * Covers WGS84 ↔ Web Mercator coordinate and extent transformations.
 * Mocks ol/proj since OpenLayers ships ESM-only and doesn't work in Jest without config changes.
 */

// Mock ol/proj with simplified math (real Web Mercator formulas)
jest.mock("ol/proj", () => {
  const DEG_TO_RAD = Math.PI / 180;
  const EARTH_RADIUS = 6378137; // WGS84 semi-major axis

  function lonToMercatorX(lon: number): number {
    return lon * DEG_TO_RAD * EARTH_RADIUS;
  }

  function latToMercatorY(lat: number): number {
    return (
      Math.log(Math.tan(Math.PI / 4 + (lat * DEG_TO_RAD) / 2)) * EARTH_RADIUS
    );
  }

  function mercatorXToLon(x: number): number {
    return x / EARTH_RADIUS / DEG_TO_RAD;
  }

  function mercatorYToLat(y: number): number {
    return (
      (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) / DEG_TO_RAD
    );
  }

  return {
    transform: jest.fn((coords: number[], from: string, to: string) => {
      if (from === "EPSG:4326" && to === "EPSG:3857") {
        return [lonToMercatorX(coords[0]), latToMercatorY(coords[1])];
      }
      if (from === "EPSG:3857" && to === "EPSG:4326") {
        return [mercatorXToLon(coords[0]), mercatorYToLat(coords[1])];
      }
      return coords;
    }),
    transformExtent: jest.fn((extent: number[], from: string, to: string) => {
      if (from === "EPSG:4326" && to === "EPSG:3857") {
        return [
          lonToMercatorX(extent[0]),
          latToMercatorY(extent[1]),
          lonToMercatorX(extent[2]),
          latToMercatorY(extent[3])
        ];
      }
      if (from === "EPSG:3857" && to === "EPSG:4326") {
        return [
          mercatorXToLon(extent[0]),
          mercatorYToLat(extent[1]),
          mercatorXToLon(extent[2]),
          mercatorYToLat(extent[3])
        ];
      }
      return extent;
    })
  };
});

import {
  webMercatorExtentToWGS84,
  webMercatorToWGS84,
  wgs84ExtentToWebMercator,
  wgs84ToWebMercator
} from "@/utils/coordinate-transformers-ol";

describe("wgs84ToWebMercator", () => {
  it("should convert origin (0,0) to (0,0)", () => {
    const result = wgs84ToWebMercator({ longitude: 0, latitude: 0 });
    expect(result.x).toBeCloseTo(0, 0);
    expect(result.y).toBeCloseTo(0, 0);
  });

  it("should convert known coordinates (San Francisco)", () => {
    const result = wgs84ToWebMercator({
      longitude: -122.4194,
      latitude: 37.7749
    });
    // Web Mercator x for -122.4194° ≈ -13627665
    expect(result.x).toBeLessThan(-13000000);
    // Web Mercator y for 37.7749° ≈ 4548430
    expect(result.y).toBeGreaterThan(4000000);
  });
});

describe("webMercatorToWGS84", () => {
  it("should convert origin (0,0) to (0,0)", () => {
    const result = webMercatorToWGS84({ x: 0, y: 0 });
    expect(result.longitude).toBeCloseTo(0, 5);
    expect(result.latitude).toBeCloseTo(0, 5);
  });

  it("should round-trip with wgs84ToWebMercator", () => {
    const original = { longitude: -74.006, latitude: 40.7128 };
    const mercator = wgs84ToWebMercator(original);
    const roundTrip = webMercatorToWGS84(mercator);
    expect(roundTrip.longitude).toBeCloseTo(original.longitude, 4);
    expect(roundTrip.latitude).toBeCloseTo(original.latitude, 4);
  });
});

describe("wgs84ExtentToWebMercator", () => {
  it("should transform a WGS84 extent to Web Mercator", () => {
    const result = wgs84ExtentToWebMercator({
      west: -10,
      south: -10,
      east: 10,
      north: 10
    });
    expect(result).toHaveLength(4);
    // West should be negative, east positive in Mercator
    expect(result[0]).toBeLessThan(0);
    expect(result[2]).toBeGreaterThan(0);
  });

  it("should clamp extreme latitudes", () => {
    // Latitude > 85 gets clamped by clampExtent
    const result = wgs84ExtentToWebMercator({
      west: -180,
      south: -90,
      east: 180,
      north: 90
    });
    expect(result).toHaveLength(4);
    // Should not produce Infinity
    expect(Number.isFinite(result[1])).toBe(true);
    expect(Number.isFinite(result[3])).toBe(true);
  });
});

describe("webMercatorExtentToWGS84", () => {
  it("should transform a Web Mercator extent to WGS84", () => {
    const result = webMercatorExtentToWGS84([
      -1113195, -1113195, 1113195, 1113195
    ]);
    expect(result.west).toBeCloseTo(-10, 0);
    expect(result.south).toBeCloseTo(-10, 0);
    expect(result.east).toBeCloseTo(10, 0);
    expect(result.north).toBeCloseTo(10, 0);
  });

  it("should round-trip with wgs84ExtentToWebMercator", () => {
    const original = { west: -20, south: -15, east: 30, north: 25 };
    const mercator = wgs84ExtentToWebMercator(original);
    const roundTrip = webMercatorExtentToWGS84(mercator);
    expect(roundTrip.west).toBeCloseTo(original.west, 2);
    expect(roundTrip.south).toBeCloseTo(original.south, 2);
    expect(roundTrip.east).toBeCloseTo(original.east, 2);
    expect(roundTrip.north).toBeCloseTo(original.north, 2);
  });
});
