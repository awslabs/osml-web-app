// Copyright Amazon.com, Inc. or its affiliates.
import { Store } from "@reduxjs/toolkit";

import { setViewport } from "@/store/slices/viewport-slice";
import { RootState } from "@/store/store";

import { LocalMcpTool, ToolArgs } from "./types";

// Helper function to determine zoom level based on geographic scale
function getZoomForScale(scale: string): number {
  const scaleMap: { [key: string]: number } = {
    building: 18,
    block: 16,
    neighborhood: 14,
    city: 11,
    region: 8,
    state: 6,
    country: 5,
    continent: 3
  };

  const normalizedScale = scale.toLowerCase();

  return scaleMap[normalizedScale] || 10; // Default to city-level zoom
}

// Helper function to calculate extent around a center point based on zoom level
function calculateExtentFromCenter(
  latitude: number,
  longitude: number,
  zoom: number
) {
  // Calculate approximate degrees per pixel at this zoom level and latitude
  // This is a simplified calculation - more precise would use Web Mercator math
  const degreesPerPixel =
    360 / (256 * Math.pow(2, zoom)) / Math.cos((latitude * Math.PI) / 180);

  // Assume a typical viewport of 1000x600 pixels
  const halfWidth = (1000 * degreesPerPixel) / 2;
  const halfHeight = (600 * degreesPerPixel) / 2;

  return {
    west: Math.max(-180, longitude - halfWidth),
    south: Math.max(-90, latitude - halfHeight),
    east: Math.min(180, longitude + halfWidth),
    north: Math.min(90, latitude + halfHeight)
  };
}

export const getViewportTool: LocalMcpTool = {
  name: "get_viewport",
  description:
    "Get the viewport that shows what the user is looking at currently on the map or globe.",
  schema: {
    type: "object",
    properties: {}
  },
  handler: (_args: ToolArgs, store: Store) => {
    const state = store.getState() as RootState;
    const { longitude, latitude, zoom, extent } = state.viewport;

    return {
      longitude,
      latitude,
      zoom,
      extent
    };
  }
};

export const zoomToLocationTool: LocalMcpTool = {
  name: "zoom_to_location",
  description:
    "Navigate the map and globe to a specific location with appropriate zoom level to show a location.",
  schema: {
    type: "object",
    properties: {
      latitude: {
        type: "number",
        description: "Latitude in degrees (-90 to 90)",
        minimum: -90,
        maximum: 90
      },
      longitude: {
        type: "number",
        description: "Longitude in degrees (-180 to 180)",
        minimum: -180,
        maximum: 180
      },
      zoom: {
        type: "number",
        description:
          "Optional zoom level (0-19). If not provided, will be determined by scale.",
        minimum: 0,
        maximum: 19
      },
      scale: {
        type: "string",
        description:
          "Geographic scale to determine zoom level if zoom not provided. Options: building, block, neighborhood, city, region, state, country, continent",
        enum: [
          "building",
          "block",
          "neighborhood",
          "city",
          "region",
          "state",
          "country",
          "continent"
        ]
      }
    },
    required: ["latitude", "longitude"]
  },
  handler: (args: ToolArgs, store: Store) => {
    const { latitude, longitude, zoom, scale } = args as {
      latitude: number;
      longitude: number;
      zoom?: number;
      scale?: string;
    };

    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
      throw new Error("Latitude must be between -90 and 90 degrees");
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error("Longitude must be between -180 and 180 degrees");
    }

    // Determine zoom level
    const finalZoom =
      zoom !== undefined ? zoom : getZoomForScale(scale || "city");

    // Calculate extent around the target location
    const extent = calculateExtentFromCenter(latitude, longitude, finalZoom);

    // Dispatch to Redux store with 'agent' as updatedBy
    store.dispatch(
      setViewport({
        latitude,
        longitude,
        zoom: finalZoom,
        extent,
        updatedBy: "agent"
      })
    );

    const scaleInfo = scale ? ` at ${scale} scale` : "";

    return {
      success: true,
      message: `Navigated to ${latitude.toFixed(4)}, ${longitude.toFixed(4)} (zoom ${finalZoom})${scaleInfo}`,
      viewport: { latitude, longitude, zoom: finalZoom, extent }
    };
  }
};
