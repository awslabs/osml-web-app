// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// Shared viewport state using WGS84 geographic coordinates
interface ViewportState {
  longitude: number; // degrees, -180 to 180
  latitude: number; // degrees, -90 to 90
  zoom: number; // zoom level, 0-19
  extent: {
    west: number; // degrees
    south: number; // degrees
    east: number; // degrees
    north: number; // degrees
  };
  lastUpdatedBy: "map" | "globe" | "initial" | "agent"; // prevent update loops
}

const initialState: ViewportState = {
  longitude: 0,
  latitude: 0,
  zoom: 2,
  extent: {
    west: -180,
    south: -85,
    east: 180,
    north: 85
  },
  lastUpdatedBy: "initial"
};

export const viewportSlice = createSlice({
  name: "viewport",
  initialState,
  reducers: {
    setViewport: (
      state,
      action: PayloadAction<{
        longitude: number;
        latitude: number;
        zoom: number;
        extent: { west: number; south: number; east: number; north: number };
        updatedBy: "map" | "globe" | "agent";
      }>
    ) => {
      const { longitude, latitude, zoom, extent, updatedBy } = action.payload;

      // Always update all viewport data from native library APIs
      state.longitude = longitude;
      state.latitude = latitude;
      state.zoom = zoom;
      state.extent = extent;
      state.lastUpdatedBy = updatedBy;
    }
  }
});

export const { setViewport } = viewportSlice.actions;

export default viewportSlice.reducer;
export type { ViewportState };
