// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for settings-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import settingsReducer, {
  selectAutoZoom,
  selectGlobeSettings,
  selectMapSettings,
  setAutoZoom,
  toggleAutoZoom,
  toggleFog,
  toggleGlobeLighting,
  toggleGroundAtmosphere,
  toggleMapDayNight,
  toggleSkyAtmosphere
} from "@/store/slices/settings-slice";

const createStore = () =>
  configureStore({ reducer: { settings: settingsReducer } });

describe("settings-slice", () => {
  it("should have autoZoom enabled by default", () => {
    const store = createStore();
    expect(selectAutoZoom(store.getState())).toBe(true);
  });

  it("setAutoZoom should set explicit value", () => {
    const store = createStore();
    store.dispatch(setAutoZoom(false));
    expect(selectAutoZoom(store.getState())).toBe(false);
  });

  it("toggleAutoZoom should toggle", () => {
    const store = createStore();
    store.dispatch(toggleAutoZoom());
    expect(selectAutoZoom(store.getState())).toBe(false);
    store.dispatch(toggleAutoZoom());
    expect(selectAutoZoom(store.getState())).toBe(true);
  });

  it("toggleMapDayNight should toggle", () => {
    const store = createStore();
    expect(selectMapSettings(store.getState()).dayNightEnabled).toBe(false);
    store.dispatch(toggleMapDayNight());
    expect(selectMapSettings(store.getState()).dayNightEnabled).toBe(true);
  });

  it("globe toggles should work", () => {
    const store = createStore();
    const initial = selectGlobeSettings(store.getState());
    expect(initial.enableLighting).toBe(true);

    store.dispatch(toggleGlobeLighting());
    expect(selectGlobeSettings(store.getState()).enableLighting).toBe(false);

    store.dispatch(toggleGroundAtmosphere());
    expect(selectGlobeSettings(store.getState()).showGroundAtmosphere).toBe(
      false
    );

    store.dispatch(toggleSkyAtmosphere());
    expect(selectGlobeSettings(store.getState()).showSkyAtmosphere).toBe(false);

    store.dispatch(toggleFog());
    expect(selectGlobeSettings(store.getState()).enableFog).toBe(false);
  });
});
