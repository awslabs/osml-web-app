// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for feature-tools.ts.
 * Covers WKT parsing (all geometry types), GeoJSON validation,
 * STAC URL references, draw/clear/get/delete layer operations.
 */

import { configureStore } from "@reduxjs/toolkit";

import {
  clearLayersTool,
  deleteLayerTool,
  drawFeatureTool,
  getLayersTool
} from "@/mcp/local-server/feature-tools";
import overlayReducer from "@/store/slices/overlay-slice";

// Mock uuid to return predictable IDs
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-1234")
}));

function createStore() {
  return configureStore({
    reducer: { overlay: overlayReducer }
  });
}

// ---------------------------------------------------------------------------
// WKT Parsing via drawFeatureTool
// ---------------------------------------------------------------------------
describe("drawFeatureTool - WKT parsing", () => {
  it("should parse POINT", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "POINT(-122.4 37.8)" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("Point");
  });

  it("should parse POINT with extra whitespace", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "  POINT (  -122.4   37.8  )  " },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("Point");
  });

  it("should parse LINESTRING", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "LINESTRING(0 0, 1 1, 2 2)" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("LineString");
  });

  it("should parse POLYGON", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("Polygon");
  });

  it("should parse MULTIPOINT with parenthesised coordinates", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "MULTIPOINT((0 0), (1 1))" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("MultiPoint");
  });

  it("should parse MULTIPOINT without parenthesised coordinates", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "MULTIPOINT(0 0, 1 1)" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("MultiPoint");
  });

  it("should parse MULTILINESTRING", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "MULTILINESTRING((0 0, 1 1), (2 2, 3 3))" },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("MultiLineString");
  });

  it("should parse MULTIPOLYGON", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      {
        wkt: "MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2)))"
      },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("MultiPolygon");
  });

  it("should be case-insensitive", () => {
    const store = createStore();
    const result = drawFeatureTool.handler({ wkt: "point(-1 2)" }, store) as {
      success: boolean;
      feature: { type: string };
    };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("Point");
  });

  it("should throw for unsupported WKT type", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler({ wkt: "GEOMETRYCOLLECTION(POINT(0 0))" }, store)
    ).toThrow(/Failed to draw feature/);
  });

  it("should throw for malformed WKT", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler({ wkt: "POINT(not a number)" }, store)
    ).toThrow(/Failed to draw feature/);
  });
});

// ---------------------------------------------------------------------------
// GeoJSON input via drawFeatureTool
// ---------------------------------------------------------------------------
describe("drawFeatureTool - GeoJSON input", () => {
  it("should accept a valid GeoJSON Feature", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      {
        geoJsonFeature: {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { name: "test" }
        }
      },
      store
    ) as { success: boolean; feature: { type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("Point");
  });

  it("should reject GeoJSON with invalid geometry type", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler(
        {
          geoJsonFeature: {
            type: "Feature",
            geometry: { type: "InvalidType", coordinates: [0, 0] },
            properties: {}
          }
        },
        store
      )
    ).toThrow(/Failed to draw feature/);
  });

  it("should reject GeoJSON Feature with missing geometry", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler(
        {
          geoJsonFeature: {
            type: "Feature",
            geometry: null as never,
            properties: {}
          }
        },
        store
      )
    ).toThrow(/Failed to draw feature/);
  });

  it("should reject non-Feature type", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler(
        {
          geoJsonFeature: {
            type: "FeatureCollection" as "Feature",
            geometry: { type: "Point", coordinates: [0, 0] },
            properties: {}
          }
        },
        store
      )
    ).toThrow(/Failed to draw feature/);
  });
});

// ---------------------------------------------------------------------------
// STAC URL reference via drawFeatureTool
// ---------------------------------------------------------------------------
describe("drawFeatureTool - STAC URL", () => {
  it("should create a STAC reference feature", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      {
        stacUrl: "https://stac.example.com/collections/test/items/item-1"
      },
      store
    ) as { success: boolean; feature: { stacUrl: string; type: string } };

    expect(result.success).toBe(true);
    expect(result.feature.type).toBe("STAC_Reference");
    expect(result.feature.stacUrl).toBe(
      "https://stac.example.com/collections/test/items/item-1"
    );
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
describe("drawFeatureTool - input validation", () => {
  it("should throw when no input is provided", () => {
    const store = createStore();
    expect(() => drawFeatureTool.handler({}, store)).toThrow(
      /must be provided/
    );
  });

  it("should throw when multiple inputs are provided", () => {
    const store = createStore();
    expect(() =>
      drawFeatureTool.handler(
        {
          wkt: "POINT(0 0)",
          stacUrl: "https://example.com/item"
        },
        store
      )
    ).toThrow(/exactly one/);
  });
});

// ---------------------------------------------------------------------------
// Style and metadata
// ---------------------------------------------------------------------------
describe("drawFeatureTool - style and metadata", () => {
  it("should apply custom style", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      {
        wkt: "POINT(0 0)",
        style: { color: "#ff0000", fillOpacity: 0.5 }
      },
      store
    ) as { feature: { style: Record<string, unknown> } };

    expect(result.feature.style).toMatchObject({
      color: "#ff0000",
      fillOpacity: 0.5
    });
  });

  it("should use provided ID instead of generating one", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "POINT(0 0)", id: "custom-id" },
      store
    ) as { feature: { id: string } };

    expect(result.feature.id).toBe("custom-id");
  });

  it("should use provided description", () => {
    const store = createStore();
    const result = drawFeatureTool.handler(
      { wkt: "POINT(0 0)", description: "Test point" },
      store
    ) as { feature: { description: string } };

    expect(result.feature.description).toBe("Test point");
  });
});

// ---------------------------------------------------------------------------
// clearLayersTool
// ---------------------------------------------------------------------------
describe("clearLayersTool", () => {
  it("should report 0 cleared when map is empty", () => {
    const store = createStore();
    const result = clearLayersTool.handler({}, store) as {
      success: boolean;
      clearedCount: number;
    };

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBe(0);
  });

  it("should clear all features and report count", () => {
    const store = createStore();

    // Add two features
    drawFeatureTool.handler({ wkt: "POINT(0 0)", id: "f1" }, store);
    drawFeatureTool.handler({ wkt: "POINT(1 1)", id: "f2" }, store);

    const result = clearLayersTool.handler({}, store) as {
      success: boolean;
      clearedCount: number;
    };

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getLayersTool
// ---------------------------------------------------------------------------
describe("getLayersTool", () => {
  it("should return empty list when no features exist", () => {
    const store = createStore();
    const result = getLayersTool.handler({}, store) as {
      layers: unknown[];
      totalCount: number;
    };

    expect(result.totalCount).toBe(0);
    expect(result.layers).toEqual([]);
  });

  it("should list added features with metadata", () => {
    const store = createStore();
    drawFeatureTool.handler(
      { wkt: "POINT(0 0)", id: "pt-1", description: "A point" },
      store
    );

    const result = getLayersTool.handler({}, store) as {
      layers: Array<{ id: string; type: string; description: string }>;
      totalCount: number;
    };

    expect(result.totalCount).toBe(1);
    expect(result.layers[0]).toMatchObject({
      id: "pt-1",
      type: "Point",
      description: "A point"
    });
  });
});

// ---------------------------------------------------------------------------
// deleteLayerTool
// ---------------------------------------------------------------------------
describe("deleteLayerTool", () => {
  it("should delete an existing layer by ID", () => {
    const store = createStore();
    drawFeatureTool.handler({ wkt: "POINT(0 0)", id: "to-delete" }, store);

    const result = deleteLayerTool.handler({ layerId: "to-delete" }, store) as {
      success: boolean;
      removedLayer: { id: string };
    };

    expect(result.success).toBe(true);
    expect(result.removedLayer.id).toBe("to-delete");

    // Verify it's gone
    const layers = getLayersTool.handler({}, store) as { totalCount: number };
    expect(layers.totalCount).toBe(0);
  });

  it("should throw when layer ID does not exist", () => {
    const store = createStore();
    expect(() =>
      deleteLayerTool.handler({ layerId: "nonexistent" }, store)
    ).toThrow(/not found/);
  });
});
