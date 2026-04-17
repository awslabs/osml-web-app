// Copyright Amazon.com, Inc. or its affiliates.
import { Store } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";

import {
  addFeature,
  clearAllFeatures,
  GeoJSONFeature,
  removeFeature
} from "@/store/slices/overlay-slice";

import { LocalMcpTool, ToolArgs } from "./types";

// Type definitions for tool arguments
interface DrawFeatureArgs {
  wkt?: string;
  geoJsonFeature?: {
    type: "Feature";
    geometry: {
      type: string;
      coordinates: unknown;
    };
    properties?: Record<string, unknown>;
  };
  stacUrl?: string;
  id?: string;
  description?: string;
  style?: {
    color?: string;
    fillColor?: string;
    opacity?: number;
    fillOpacity?: number;
    weight?: number;
    radius?: number;
    marker?: string;
    icon?: string;
    iconScale?: number;
  };
}

interface DeleteLayerArgs {
  layerId: string;
}

interface RootState {
  overlay: {
    inlineFeatures: Record<string, GeoJSONFeature[]>;
  };
}

// Helper function to parse WKT string to GeoJSON geometry
function parseWKTToGeoJSON(wkt: string): GeoJSONFeature["geometry"] {
  try {
    // Remove extra whitespace and normalize
    const cleanWkt = wkt.trim().toUpperCase();

    // Simple WKT parser for common geometry types
    if (cleanWkt.startsWith("POINT")) {
      const match = cleanWkt.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/);

      if (match) {
        return {
          type: "Point",
          coordinates: [parseFloat(match[1]), parseFloat(match[2])]
        };
      }
    }

    if (cleanWkt.startsWith("LINESTRING")) {
      const match = cleanWkt.match(/LINESTRING\s*\(\s*(.*)\s*\)/);

      if (match) {
        const coords = match[1].split(",").map((pair) => {
          const [x, y] = pair.trim().split(/\s+/);

          return [parseFloat(x), parseFloat(y)];
        });

        return {
          type: "LineString",
          coordinates: coords
        };
      }
    }

    if (cleanWkt.startsWith("POLYGON")) {
      const match = cleanWkt.match(/POLYGON\s*\(\s*\((.*)\)\s*\)/);

      if (match) {
        const coords = match[1].split(",").map((pair) => {
          const [x, y] = pair.trim().split(/\s+/);

          return [parseFloat(x), parseFloat(y)];
        });

        return {
          type: "Polygon",
          coordinates: [coords]
        };
      }
    }

    if (cleanWkt.startsWith("MULTIPOINT")) {
      // Handle both formats: MULTIPOINT((1 2), (3 4)) and MULTIPOINT(1 2, 3 4)
      const match = cleanWkt.match(/MULTIPOINT\s*\(\s*(.*)\s*\)/);

      if (match) {
        const coordsText = match[1];
        let coords: number[][];

        // Check if coordinates are wrapped in parentheses
        if (coordsText.includes("(") && coordsText.includes(")")) {
          // Format: MULTIPOINT((1 2), (3 4))
          const pointMatches = coordsText.match(/\([^)]+\)/g);

          if (pointMatches) {
            coords = pointMatches.map((point) => {
              const cleanPoint = point.replace(/[()]/g, "").trim();
              const [x, y] = cleanPoint.split(/\s+/);

              return [parseFloat(x), parseFloat(y)];
            });
          } else {
            throw new Error("Invalid MULTIPOINT format");
          }
        } else {
          // Format: MULTIPOINT(1 2, 3 4)
          coords = coordsText.split(",").map((pair) => {
            const [x, y] = pair.trim().split(/\s+/);

            return [parseFloat(x), parseFloat(y)];
          });
        }

        return {
          type: "MultiPoint",
          coordinates: coords
        };
      }
    }

    if (cleanWkt.startsWith("MULTILINESTRING")) {
      // Format: MULTILINESTRING((1 2, 3 4), (5 6, 7 8))
      const match = cleanWkt.match(/MULTILINESTRING\s*\(\s*(.*)\s*\)/);

      if (match) {
        const lineStrings = match[1].match(/\([^)]+\)/g);

        if (lineStrings) {
          const coords = lineStrings.map((lineString) => {
            const cleanLine = lineString.replace(/[()]/g, "").trim();

            return cleanLine.split(",").map((pair) => {
              const [x, y] = pair.trim().split(/\s+/);

              return [parseFloat(x), parseFloat(y)];
            });
          });

          return {
            type: "MultiLineString",
            coordinates: coords
          };
        }
      }
    }

    if (cleanWkt.startsWith("MULTIPOLYGON")) {
      // Format: MULTIPOLYGON(((1 2, 3 4, 5 6, 1 2)), ((7 8, 9 10, 11 12, 7 8)))
      const match = cleanWkt.match(/MULTIPOLYGON\s*\(\s*(.*)\s*\)/);

      if (match) {
        let coordsText = match[1];
        const polygons: number[][][][] = [];

        // Find polygon groups by matching balanced parentheses
        let depth = 0;
        let start = 0;

        for (let i = 0; i < coordsText.length; i++) {
          if (coordsText[i] === "(") {
            if (depth === 0) start = i;
            depth++;
          } else if (coordsText[i] === ")") {
            depth--;
            if (depth === 0) {
              // Extract this polygon
              const polygonText = coordsText.substring(start, i + 1);

              // Parse individual polygon: ((coords))
              const polygonMatch = polygonText.match(/\(\s*\((.*)\)\s*\)/);

              if (polygonMatch) {
                const coords = polygonMatch[1].split(",").map((pair) => {
                  const [x, y] = pair.trim().split(/\s+/);

                  return [parseFloat(x), parseFloat(y)];
                });

                polygons.push([coords]); // Each polygon is an array of rings (we handle simple polygons for now)
              }
            }
          }
        }

        if (polygons.length > 0) {
          return {
            type: "MultiPolygon",
            coordinates: polygons
          };
        }
      }
    }

    throw new Error("Unsupported WKT geometry type or invalid format");
  } catch (error) {
    throw new Error(
      `Failed to parse WKT: ${error instanceof Error ? error.message : "Invalid format"}`
    );
  }
}

// Helper function to validate and normalize GeoJSON geometry
function validateGeoJSONGeometry(
  geometry: unknown
): GeoJSONFeature["geometry"] {
  if (!geometry || typeof geometry !== "object") {
    throw new Error("Invalid geometry: must be an object");
  }

  const geom = geometry as Record<string, unknown>;
  const { type, coordinates } = geom;

  if (!type || !coordinates) {
    throw new Error("Invalid geometry: missing type or coordinates");
  }

  if (typeof type !== "string") {
    throw new Error("Invalid geometry: type must be a string");
  }

  const validTypes = [
    "Point",
    "LineString",
    "Polygon",
    "MultiPoint",
    "MultiLineString",
    "MultiPolygon"
  ];

  if (!validTypes.includes(type)) {
    throw new Error(
      `Invalid geometry type: ${type}. Must be one of: ${validTypes.join(", ")}`
    );
  }

  // Basic coordinate validation
  if (!Array.isArray(coordinates)) {
    throw new Error("Invalid coordinates: must be an array");
  }

  return { type, coordinates } as GeoJSONFeature["geometry"];
}

// Helper function to validate GeoJSON Feature
function validateGeoJSONFeature(feature: unknown): {
  geometry: GeoJSONFeature["geometry"];
  properties: Record<string, unknown>;
} {
  if (!feature || typeof feature !== "object") {
    throw new Error("Invalid feature: must be an object");
  }

  const feat = feature as Record<string, unknown>;

  if (feat.type !== "Feature") {
    throw new Error("Invalid feature: type must be 'Feature'");
  }

  const geometry = validateGeoJSONGeometry(feat.geometry);
  const properties =
    (feat.properties as Record<string, unknown> | undefined) || {};

  return { geometry, properties };
}

// Default style configuration
const DEFAULT_STYLE = {
  color: "#3388ff",
  fillColor: "#3388ff",
  opacity: 0.8,
  fillOpacity: 0.2,
  weight: 3
};

export const drawFeatureTool: LocalMcpTool = {
  name: "draw_feature",
  description:
    "DISPLAY GEOMETRY ON MAP: The essential tool for adding any geographic features to the map visualization. Use this tool to show WKT polygons from buffer_geometry, points, lines, or any spatial data on both the 2D map and 3D globe. This is the ONLY tool that can make geometry visible to users on the map interface. Always use this after getting WKT output from other geospatial tools to display the results.",
  schema: {
    type: "object",
    properties: {
      wkt: {
        type: "string",
        description:
          "Well-Known Text (WKT) geometry string to display on the map. Supports all standard geometry types: POINT, LINESTRING, POLYGON, MULTIPOINT, MULTILINESTRING, and MULTIPOLYGON. Use this when you have WKT output from other tools like buffer_geometry. Examples: 'POINT(-122.4 37.8)', 'MULTIPOINT((-122.4 37.8), (-122.3 37.9))', 'POLYGON((-122.4 37.8, -122.3 37.8, -122.3 37.9, -122.4 37.9, -122.4 37.8))', 'MULTIPOLYGON(((-122.4 37.8, -122.3 37.8, -122.3 37.9, -122.4 37.8)), ((-122.1 37.6, -122.0 37.6, -122.0 37.7, -122.1 37.6)))'"
      },
      geoJsonFeature: {
        type: "object",
        description: "GeoJSON Feature object with geometry and properties",
        properties: {
          type: { type: "string", enum: ["Feature"] },
          geometry: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "Point",
                  "LineString",
                  "Polygon",
                  "MultiPoint",
                  "MultiLineString",
                  "MultiPolygon"
                ]
              },
              coordinates: { type: "array" }
            },
            required: ["type", "coordinates"]
          },
          properties: { type: "object" }
        },
        required: ["type", "geometry"]
      },
      stacUrl: {
        type: "string",
        description:
          "URL to a STAC item that contains the geometry to display. STAC items are valid GeoJSON Features and will be loaded directly by both the 2D map and 3D globe, avoiding large payload issues while preserving full geometry detail. Use this when you have a STAC item URL from search results. Example: 'https://api.stac.com/collections/admin-countries/items/france-123'"
      },
      id: {
        type: "string",
        description:
          "Optional unique identifier for the feature. If not provided, a UUID will be generated."
      },
      description: {
        type: "string",
        description:
          "Human-readable description explaining what this geometry represents (e.g., '10km buffer around Paris', 'Analysis boundary', 'Points of interest'). Users will see this when they click the feature on the map."
      },
      style: {
        type: "object",
        description: "Optional styling configuration for the feature",
        properties: {
          color: {
            type: "string",
            description: "Border/stroke color (hex color like #ff0000)"
          },
          fillColor: {
            type: "string",
            description: "Fill color (hex color like #ff0000)"
          },
          opacity: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Border opacity (0-1)"
          },
          fillOpacity: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Fill opacity (0-1)"
          },
          weight: {
            type: "number",
            minimum: 1,
            description: "Border width in pixels"
          },
          radius: {
            type: "number",
            minimum: 2,
            maximum: 50,
            description:
              "Point marker radius in pixels (for Point and MultiPoint geometries)"
          },
          marker: {
            type: "string",
            description:
              "Point marker type: 'circle', 'square', 'triangle', 'star' (for Point and MultiPoint geometries)"
          },
          icon: {
            type: "string",
            description:
              "URL or path to custom icon image for points (overrides marker type)"
          },
          iconScale: {
            type: "number",
            minimum: 0.1,
            maximum: 5.0,
            description: "Scale factor for custom icons (default: 1.0)"
          }
        }
      }
    },
    oneOf: [
      { required: ["wkt"] },
      { required: ["geoJsonFeature"] },
      { required: ["stacUrl"] }
    ]
  },
  handler: (args: ToolArgs, store: Store) => {
    const { wkt, geoJsonFeature, stacUrl, id, description, style } =
      args as DrawFeatureArgs;

    // Validate that exactly one input format is provided
    const inputCount = [wkt, geoJsonFeature, stacUrl].filter(Boolean).length;

    if (inputCount === 0) {
      throw new Error(
        "Either 'wkt', 'geoJsonFeature', or 'stacUrl' must be provided"
      );
    }

    if (inputCount > 1) {
      throw new Error(
        "Provide exactly one of: 'wkt', 'geoJsonFeature', or 'stacUrl'"
      );
    }

    let geometry: GeoJSONFeature["geometry"] | undefined;
    let existingProperties: Record<string, unknown> = {};

    try {
      if (stacUrl) {
        // Generate feature ID for STAC reference
        const featureId = id || uuidv4();

        // Create STAC reference feature (placeholder geometry - mapping libraries load actual geometry from URL)
        const feature = {
          type: "Feature" as const,
          id: featureId,
          geometry: {
            type: "Point" as const,
            coordinates: [0, 0] // Placeholder - mapping libraries ignore this and load from URL
          },
          properties: {
            description: description || "STAC item",
            style: { ...DEFAULT_STYLE, ...style },
            createdBy: "agent" as const,
            createdAt: new Date().toISOString(),
            stacUrl: stacUrl, // Store URL for mapping library loading
            dataSource: "stac_url" as const // Flag for mapping libraries
          }
        };

        // Store STAC reference (not geometry) in Redux
        store.dispatch(
          addFeature({
            feature,
            updatedBy: "agent"
          })
        );

        return {
          success: true,
          message: "Successfully created STAC reference for map loading",
          feature: {
            id: featureId,
            type: "STAC_Reference",
            description: feature.properties.description,
            stacUrl: stacUrl,
            note: "Geometry will be loaded directly by mapping libraries from STAC URL"
          }
        };
      } else if (wkt) {
        // Parse WKT to GeoJSON geometry
        geometry = parseWKTToGeoJSON(wkt);
      } else if (geoJsonFeature) {
        // Validate and extract from GeoJSON feature
        const validated = validateGeoJSONFeature(geoJsonFeature);

        geometry = validated.geometry;
        existingProperties = validated.properties;
      }

      // Handle WKT and GeoJSON paths (existing logic)
      if (!stacUrl && geometry) {
        // Generate feature ID
        const featureId = id || uuidv4();

        const existingDesc = existingProperties.description;
        const existingStyle = existingProperties.style;

        // Create standardized GeoJSON feature
        const feature: GeoJSONFeature = {
          type: "Feature",
          id: featureId,
          geometry,
          properties: {
            ...existingProperties,
            description:
              description ||
              (typeof existingDesc === "string" ? existingDesc : "") ||
              "",
            style: {
              ...DEFAULT_STYLE,
              ...(typeof existingStyle === "object" && existingStyle !== null
                ? existingStyle
                : {}),
              ...style
            },
            createdBy: "agent",
            createdAt: new Date().toISOString()
          }
        };

        // Dispatch to Redux store
        store.dispatch(
          addFeature({
            feature,
            updatedBy: "agent"
          })
        );

        const geometryType = geometry.type.toLowerCase();
        const inputFormat = wkt ? "WKT" : "GeoJSON";

        const result = {
          success: true,
          message: `Successfully drew ${geometryType} feature from ${inputFormat}`,
          feature: {
            id: featureId,
            type: geometry.type,
            description: feature.properties.description,
            style: feature.properties.style
          }
        };

        return result;
      }

      throw new Error("Failed to process feature: no valid geometry found");
    } catch (error) {
      throw new Error(
        `Failed to draw feature: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
};

export const clearLayersTool: LocalMcpTool = {
  name: "clear_layers",
  description:
    "CLEAR ALL LAYERS: Remove all layers/features from the map at once. This will clear both the 2D map and 3D globe of all agent-drawn features. Use this when you want to start fresh or clear all previous analysis results. This is more efficient than calling delete_layer multiple times.",
  schema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  handler: (_args: unknown, store: Store) => {
    try {
      // Get current layer count before clearing
      const state = store.getState() as RootState;
      const features = state.overlay.inlineFeatures["agent-features"] ?? [];
      const layerCount = features.length;

      if (layerCount === 0) {
        return {
          success: true,
          message: "Map is already clear - no layers to remove",
          clearedCount: 0
        };
      }

      // Use existing clearAllFeatures Redux action to avoid code duplication
      store.dispatch(
        clearAllFeatures({
          updatedBy: "agent"
        })
      );

      return {
        success: true,
        message: `Successfully cleared ${layerCount} layer${layerCount === 1 ? "" : "s"} from map`,
        clearedCount: layerCount
      };
    } catch (error) {
      throw new Error(
        `Failed to clear layers: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
};

export const getLayersTool: LocalMcpTool = {
  name: "get_layers",
  description:
    "LIST CURRENT LAYERS: Retrieve all currently displayed layers/features on the map. Use this to see what geometries have been added by the agent and are currently visible on both the 2D map and 3D globe. Each layer represents a feature with its own ID, description, and styling.",
  schema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  handler: (_args: unknown, store: Store) => {
    try {
      // Get current features from Redux store
      const state = store.getState() as RootState;
      const features = state.overlay.inlineFeatures["agent-features"] ?? [];

      // Return essential layer information
      const layers = features.map((feature: GeoJSONFeature) => ({
        id: feature.id,
        type: feature.geometry.type,
        description: feature.properties.description || "",
        createdBy: feature.properties.createdBy,
        createdAt: feature.properties.createdAt,
        hasCustomStyle: !!feature.properties.style,
        isPoint:
          feature.geometry.type === "Point" ||
          feature.geometry.type === "MultiPoint",
        style: feature.properties.style
      }));

      return {
        success: true,
        message: `Found ${layers.length} layer${layers.length === 1 ? "" : "s"} currently displayed on map`,
        layers,
        totalCount: layers.length
      };
    } catch (error) {
      throw new Error(
        `Failed to get layers: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
};

export const deleteLayerTool: LocalMcpTool = {
  name: "delete_layer",
  description:
    "REMOVE LAYER FROM MAP: Delete a specific layer/feature from the map by its ID. The layer will be removed from both the 2D map and 3D globe. Use get_layers first to see available layer IDs, then use this tool to remove unwanted layers. This is useful for cleaning up the map or replacing old analysis results.",
  schema: {
    type: "object",
    properties: {
      layerId: {
        type: "string",
        description:
          "The unique ID of the layer/feature to remove. Use get_layers to see available layer IDs."
      }
    },
    required: ["layerId"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { layerId } = args as unknown as DeleteLayerArgs;

    try {
      // Get current features to verify the layer exists
      const state = store.getState() as RootState;
      const features = state.overlay.inlineFeatures["agent-features"] ?? [];
      const existingFeature = features.find(
        (f: GeoJSONFeature) => f.id === layerId
      );

      if (!existingFeature) {
        throw new Error(
          `Layer with ID '${layerId}' not found. Use get_layers to see available layers.`
        );
      }

      // Dispatch remove action to Redux store
      store.dispatch(
        removeFeature({
          featureId: layerId,
          updatedBy: "agent"
        })
      );

      return {
        success: true,
        message: `Successfully removed layer '${layerId}' from map`,
        removedLayer: {
          id: existingFeature.id,
          type: existingFeature.geometry.type,
          description: existingFeature.properties.description
        }
      };
    } catch (error) {
      throw new Error(
        `Failed to delete layer: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }
};
