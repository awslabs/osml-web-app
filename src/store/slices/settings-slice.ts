// Copyright Amazon.com, Inc. or its affiliates.
// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import {
  DEFAULT_PREFERRED_MODEL,
  PreferredModelRef
} from "@/config/bedrock-defaults";

export type { PreferredModelRef };

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
  /**
   * The user's preferred Bedrock model. Initialized to
   * `DEFAULT_PREFERRED_MODEL`; overwritten when the user picks a model in
   * the selector. When the preferred model's `modelId` matches an entry in
   * the available-models list, it is selected automatically on app load.
   * `null` indicates an explicit clearing of the preference.
   */
  preferredModel: PreferredModelRef | null;
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
  },
  preferredModel: { ...DEFAULT_PREFERRED_MODEL }
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
    },
    setPreferredModel: (
      state,
      action: PayloadAction<PreferredModelRef | null>
    ) => {
      state.preferredModel = action.payload;
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
  toggleFog,
  setPreferredModel
} = settingsSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectAutoZoom = (state: { settings: SettingsState }) =>
  state.settings.autoZoomOnLayerToggle;

export const selectMapSettings = (state: { settings: SettingsState }) =>
  state.settings.map;

export const selectGlobeSettings = (state: { settings: SettingsState }) =>
  state.settings.globe;

export const selectPreferredModel = (state: { settings: SettingsState }) =>
  state.settings.preferredModel;

export default settingsSlice.reducer;
