// Copyright Amazon.com, Inc. or its affiliates.
// Shared types and pure utility functions for coordinate transformations.
// No heavy dependencies (no Cesium, no OpenLayers).

// Types for coordinate formats
export interface WGS84Coordinates {
  longitude: number; // degrees, -180 to 180
  latitude: number; // degrees, -90 to 90
  height?: number; // meters above ellipsoid
}

export interface WebMercatorCoordinates {
  x: number; // meters
  y: number; // meters
}

export interface OpenLayersViewport {
  center: [number, number]; // [x, y] in Web Mercator
  zoom: number;
  extent?: [number, number, number, number];
}

export interface CesiumViewport {
  longitude: number;
  latitude: number;
  height: number;
  heading?: number;
  pitch?: number;
  roll?: number;
}

export interface ViewportExtent {
  west: number; // degrees
  south: number; // degrees
  east: number; // degrees
  north: number; // degrees
}

/**
 * Clamp coordinates to valid WGS84 bounds
 */
export function clampWGS84(coords: WGS84Coordinates): WGS84Coordinates {
  return {
    longitude: Math.max(-180, Math.min(180, coords.longitude)),
    latitude: Math.max(-85, Math.min(85, coords.latitude)),
    height: coords.height
  };
}

/**
 * Clamp extent to valid WGS84 bounds
 */
export function clampExtent(extent: ViewportExtent): ViewportExtent {
  return {
    west: Math.max(-180, Math.min(180, extent.west)),
    east: Math.max(-180, Math.min(180, extent.east)),
    south: Math.max(-85, Math.min(85, extent.south)),
    north: Math.max(-85, Math.min(85, extent.north))
  };
}
