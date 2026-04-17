// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MapSettings {
  /** When true, a day/night terminator overlay is shown on the 2D map. */
  dayNightEnabled: boolean;
}

export interface GlobeSettings {
  /** When true, the globe is lit by the sun (day/night shading). */
  enableLighting: boolean;
  /** When true, atmospheric scattering is rendered at the horizon. */
  showGroundAtmosphere: boolean;
  /** When true, sky glow is rendered around the globe limb. */
  showSkyAtmosphere: boolean;
  /** When true, distance fog is applied for depth. */
  enableFog: boolean;
}

export interface SettingsState {
  /** When true, the map/globe auto-zooms to a layer when it becomes visible. */
  autoZoomOnLayerToggle: boolean;
  /** 2D map-specific settings. */
  map: MapSettings;
  /** 3D globe-specific settings. */
  globe: GlobeSettings;
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialState: SettingsState = {
  autoZoomOnLayerToggle: true,
  map: {
    dayNightEnabled: false
  },
  globe: {
    enableLighting: true,
    showGroundAtmosphere: true,
    showSkyAtmosphere: true,
    enableFog: true
  }
};

// ─── Slice ───────────────────────────────────────────────────────────────────

export const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setAutoZoom: (state, action: PayloadAction<boolean>) => {
      state.autoZoomOnLayerToggle = action.payload;
    },
    toggleAutoZoom: (state) => {
      state.autoZoomOnLayerToggle = !state.autoZoomOnLayerToggle;
    },
    // Map settings
    toggleMapDayNight: (state) => {
      state.map.dayNightEnabled = !state.map.dayNightEnabled;
    },
    // Globe settings
    toggleGlobeLighting: (state) => {
      state.globe.enableLighting = !state.globe.enableLighting;
    },
    toggleGroundAtmosphere: (state) => {
      state.globe.showGroundAtmosphere = !state.globe.showGroundAtmosphere;
    },
    toggleSkyAtmosphere: (state) => {
      state.globe.showSkyAtmosphere = !state.globe.showSkyAtmosphere;
    },
    toggleFog: (state) => {
      state.globe.enableFog = !state.globe.enableFog;
    }
  }
});

export const {
  setAutoZoom,
  toggleAutoZoom,
  toggleMapDayNight,
  toggleGlobeLighting,
  toggleGroundAtmosphere,
  toggleSkyAtmosphere,
  toggleFog
} = settingsSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectAutoZoom = (state: { settings: SettingsState }) =>
  state.settings.autoZoomOnLayerToggle;

export const selectMapSettings = (state: { settings: SettingsState }) =>
  state.settings.map;

export const selectGlobeSettings = (state: { settings: SettingsState }) =>
  state.settings.globe;

export default settingsSlice.reducer;
