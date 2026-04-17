// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for coordinate-transformers-cesium.ts.
 * Covers all exported functions: wgs84ToCartesian3, cartesian3ToWGS84,
 * heightToZoom, zoomToHeight, extentToHeight, extentToRectangle,
 * rectangleToExtent, calculateZoomFromExtent, calculateExtentFromZoom.
 *
 * Cesium is mocked with lightweight math-accurate implementations so
 * tests run in jsdom without the full Cesium runtime.
 */

// Earth radius used by WGS84 ellipsoid
const EARTH_RADIUS = 6378137;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

jest.mock("cesium", () => {
  // Minimal Cartesian3 implementation
  class Cartesian3 {
    x: number;
    y: number;
    z: number;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    static fromDegrees(lon: number, lat: number, height = 0): Cartesian3 {
      const lonRad = lon * DEG2RAD;
      const latRad = lat * DEG2RAD;
      const cosLat = Math.cos(latRad);
      const r = EARTH_RADIUS + height;
      return new Cartesian3(
        r * cosLat * Math.cos(lonRad),
        r * cosLat * Math.sin(lonRad),
        r * Math.sin(latRad)
      );
    }
  }

  // Minimal cartographic representation
  class Cartographic {
    longitude: number;
    latitude: number;
    height: number;
    constructor(lon: number, lat: number, height: number) {
      this.longitude = lon;
      this.latitude = lat;
      this.height = height;
    }
  }

  const Ellipsoid = {
    WGS84: {
      cartesianToCartographic(cartesian: Cartesian3): Cartographic {
        const r = Math.sqrt(
          cartesian.x ** 2 + cartesian.y ** 2 + cartesian.z ** 2
        );
        const lat = Math.asin(cartesian.z / r);
        const lon = Math.atan2(cartesian.y, cartesian.x);
        const height = r - EARTH_RADIUS;
        return new Cartographic(lon, lat, height);
      }
    }
  };

  const CesiumMath = {
    toDegrees: (rad: number) => rad * RAD2DEG,
    toRadians: (deg: number) => deg * DEG2RAD
  };

  class Rectangle {
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
    ): Rectangle {
      return new Rectangle(
        west * DEG2RAD,
        south * DEG2RAD,
        east * DEG2RAD,
        north * DEG2RAD
      );
    }
  }

  return {
    Cartesian3,
    Ellipsoid,
    Math: CesiumMath,
    Rectangle
  };
});

import { Cartesian3 } from "cesium";

import {
  calculateExtentFromZoom,
  calculateZoomFromExtent,
  cartesian3ToWGS84,
  extentToHeight,
  extentToRectangle,
  heightToZoom,
  rectangleToExtent,
  wgs84ToCartesian3,
  zoomToHeight
} from "@/utils/coordinate-transformers-cesium";

// ---------------------------------------------------------------------------
// wgs84ToCartesian3
// ---------------------------------------------------------------------------
describe("wgs84ToCartesian3", () => {
  it("should convert origin (0,0) to a point on the equator", () => {
    const result = wgs84ToCartesian3({ longitude: 0, latitude: 0 });
    // At (0,0,0) the cartesian x should be ~EARTH_RADIUS, y and z ~0
    expect(result.x).toBeCloseTo(EARTH_RADIUS, -2);
    expect(result.y).toBeCloseTo(0, -2);
    expect(result.z).toBeCloseTo(0, -2);
  });

  it("should handle the north pole", () => {
    const result = wgs84ToCartesian3({ longitude: 0, latitude: 90 });
    expect(result.z).toBeCloseTo(EARTH_RADIUS, -2);
    expect(Math.abs(result.x)).toBeLessThan(1); // essentially 0
  });

  it("should include height in the conversion", () => {
    const height = 10000;
    const result = wgs84ToCartesian3({
      longitude: 0,
      latitude: 0,
      height
    });
    expect(result.x).toBeCloseTo(EARTH_RADIUS + height, -2);
  });

  it("should handle negative longitude (western hemisphere)", () => {
    const result = wgs84ToCartesian3({ longitude: -90, latitude: 0 });
    // At lon=-90, lat=0: x~0, y~-EARTH_RADIUS
    expect(Math.abs(result.x)).toBeLessThan(1);
    expect(result.y).toBeCloseTo(-EARTH_RADIUS, -2);
  });
});

// ---------------------------------------------------------------------------
// cartesian3ToWGS84
// ---------------------------------------------------------------------------
describe("cartesian3ToWGS84", () => {
  it("should round-trip from WGS84 through Cartesian3 and back", () => {
    const original = { longitude: 45, latitude: 30, height: 5000 };
    const cartesian = wgs84ToCartesian3(original);
    const result = cartesian3ToWGS84(cartesian);

    expect(result.longitude).toBeCloseTo(original.longitude, 4);
    expect(result.latitude).toBeCloseTo(original.latitude, 4);
    expect(result.height).toBeCloseTo(original.height, 0);
  });

  it("should convert origin cartesian back to (0,0)", () => {
    const cartesian = Cartesian3.fromDegrees(0, 0, 0);
    const result = cartesian3ToWGS84(cartesian);
    expect(result.longitude).toBeCloseTo(0, 4);
    expect(result.latitude).toBeCloseTo(0, 4);
  });

  it("should handle southern hemisphere", () => {
    const original = { longitude: -120, latitude: -45 };
    const cartesian = wgs84ToCartesian3(original);
    const result = cartesian3ToWGS84(cartesian);
    expect(result.longitude).toBeCloseTo(-120, 4);
    expect(result.latitude).toBeCloseTo(-45, 4);
  });
});

// ---------------------------------------------------------------------------
// heightToZoom
// ---------------------------------------------------------------------------
describe("heightToZoom", () => {
  it("should return 0 for very high altitude", () => {
    expect(heightToZoom(20000000)).toBe(0);
  });

  it("should return higher zoom for lower altitude", () => {
    const highZoom = heightToZoom(1000);
    const lowZoom = heightToZoom(1000000);
    expect(highZoom).toBeGreaterThan(lowZoom);
  });

  it("should clamp to max 19", () => {
    expect(heightToZoom(0.001)).toBe(19);
  });

  it("should return reasonable zoom for typical heights", () => {
    // baseHeight = 15,000,000; zoom = log2(15000000/height)
    // height = 15000000 → zoom = 0
    expect(heightToZoom(15000000)).toBe(0);
    // height = 7500000 → zoom = 1
    expect(heightToZoom(7500000)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// zoomToHeight
// ---------------------------------------------------------------------------
describe("zoomToHeight", () => {
  it("should return baseHeight at zoom 0", () => {
    expect(zoomToHeight(0)).toBe(15000000);
  });

  it("should return half baseHeight at zoom 1", () => {
    expect(zoomToHeight(1)).toBe(7500000);
  });

  it("should be inverse of heightToZoom", () => {
    for (const zoom of [0, 3, 7, 12, 18]) {
      const height = zoomToHeight(zoom);
      const recoveredZoom = heightToZoom(height);
      expect(recoveredZoom).toBe(zoom);
    }
  });

  it("should decrease with increasing zoom", () => {
    expect(zoomToHeight(5)).toBeGreaterThan(zoomToHeight(10));
  });
});

// ---------------------------------------------------------------------------
// extentToHeight
// ---------------------------------------------------------------------------
describe("extentToHeight", () => {
  it("should return larger height for larger extents", () => {
    const small = extentToHeight({ west: -1, south: -1, east: 1, north: 1 }, 0);
    const large = extentToHeight(
      { west: -10, south: -10, east: 10, north: 10 },
      0
    );
    expect(large).toBeGreaterThan(small);
  });

  it("should return minimum 1000m", () => {
    const result = extentToHeight(
      { west: 0, south: 0, east: 0.00001, north: 0.00001 },
      0
    );
    expect(result).toBeGreaterThanOrEqual(1000);
  });

  it("should account for latitude correction", () => {
    const equator = extentToHeight(
      { west: -5, south: -5, east: 5, north: 5 },
      0
    );
    const highLat = extentToHeight(
      { west: -5, south: -5, east: 5, north: 5 },
      70
    );
    // At higher latitude, the same degree extent covers less ground,
    // so camera needs to be higher to see the same angular extent
    expect(highLat).toBeGreaterThan(equator);
  });

  it("should handle extreme latitude (near pole)", () => {
    const result = extentToHeight(
      { west: -5, south: -5, east: 5, north: 5 },
      89
    );
    // Should not return Infinity or NaN — latitudeCorrection is clamped to 0.1
    expect(isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// extentToRectangle
// ---------------------------------------------------------------------------
describe("extentToRectangle", () => {
  it("should convert extent to Cesium Rectangle (radians)", () => {
    const rect = extentToRectangle({
      west: -180,
      south: -90,
      east: 180,
      north: 90
    });
    expect(rect.west).toBeCloseTo(-Math.PI, 5);
    expect(rect.south).toBeCloseTo(-Math.PI / 2, 5);
    expect(rect.east).toBeCloseTo(Math.PI, 5);
    expect(rect.north).toBeCloseTo(Math.PI / 2, 5);
  });

  it("should handle small extents", () => {
    const rect = extentToRectangle({
      west: 10,
      south: 20,
      east: 11,
      north: 21
    });
    expect(rect.west).toBeCloseTo(10 * DEG2RAD, 5);
    expect(rect.south).toBeCloseTo(20 * DEG2RAD, 5);
  });
});

// ---------------------------------------------------------------------------
// rectangleToExtent
// ---------------------------------------------------------------------------
describe("rectangleToExtent", () => {
  it("should round-trip through extentToRectangle and back", () => {
    const original = { west: -10, south: -20, east: 30, north: 40 };
    const rect = extentToRectangle(original);
    const result = rectangleToExtent(rect);

    expect(result.west).toBeCloseTo(original.west, 3);
    expect(result.south).toBeCloseTo(original.south, 3);
    expect(result.east).toBeCloseTo(original.east, 3);
    expect(result.north).toBeCloseTo(original.north, 3);
  });

  it("should clamp values to valid WGS84 bounds", () => {
    // Create a rectangle that would exceed bounds when converted
    const rect = extentToRectangle({
      west: -200,
      south: -100,
      east: 200,
      north: 100
    });
    const result = rectangleToExtent(rect);

    expect(result.west).toBeGreaterThanOrEqual(-180);
    expect(result.east).toBeLessThanOrEqual(180);
    expect(result.south).toBeGreaterThanOrEqual(-85);
    expect(result.north).toBeLessThanOrEqual(85);
  });
});

// ---------------------------------------------------------------------------
// calculateZoomFromExtent
// ---------------------------------------------------------------------------
describe("calculateZoomFromExtent", () => {
  it("should return 0 for full world extent", () => {
    expect(
      calculateZoomFromExtent({ west: -180, south: -85, east: 180, north: 85 })
    ).toBe(0);
  });

  it("should return higher zoom for smaller extents", () => {
    const wide = calculateZoomFromExtent({
      west: -90,
      south: -45,
      east: 90,
      north: 45
    });
    const narrow = calculateZoomFromExtent({
      west: -1,
      south: -1,
      east: 1,
      north: 1
    });
    expect(narrow).toBeGreaterThan(wide);
  });

  it("should clamp between 0 and 19", () => {
    const tiny = calculateZoomFromExtent({
      west: 0,
      south: 0,
      east: 0.00001,
      north: 0.00001
    });
    expect(tiny).toBeLessThanOrEqual(19);
    expect(tiny).toBeGreaterThanOrEqual(0);
  });

  it("should return integer values", () => {
    const zoom = calculateZoomFromExtent({
      west: -10,
      south: -10,
      east: 10,
      north: 10
    });
    expect(zoom).toBe(Math.round(zoom));
  });
});

// ---------------------------------------------------------------------------
// calculateExtentFromZoom
// ---------------------------------------------------------------------------
describe("calculateExtentFromZoom", () => {
  it("should return full world at zoom 0", () => {
    const extent = calculateExtentFromZoom({ longitude: 0, latitude: 0 }, 0);
    expect(extent.west).toBeCloseTo(-180, 0);
    expect(extent.east).toBeCloseTo(180, 0);
  });

  it("should return smaller extent at higher zoom", () => {
    const z5 = calculateExtentFromZoom({ longitude: 0, latitude: 0 }, 5);
    const z10 = calculateExtentFromZoom({ longitude: 0, latitude: 0 }, 10);

    const width5 = z5.east - z5.west;
    const width10 = z10.east - z10.west;
    expect(width10).toBeLessThan(width5);
  });

  it("should center on the given coordinates", () => {
    const center = { longitude: 45, latitude: 30 };
    const extent = calculateExtentFromZoom(center, 8);

    const midLon = (extent.west + extent.east) / 2;
    expect(midLon).toBeCloseTo(center.longitude, 2);
  });

  it("should account for latitude in height calculation", () => {
    const equator = calculateExtentFromZoom({ longitude: 0, latitude: 0 }, 5);
    const highLat = calculateExtentFromZoom({ longitude: 0, latitude: 60 }, 5);

    const equatorHeight = equator.north - equator.south;
    const highLatHeight = highLat.north - highLat.south;
    // At higher latitude, cos(lat) < 1, so height should be smaller
    expect(highLatHeight).toBeLessThan(equatorHeight);
  });
});
