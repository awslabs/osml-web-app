// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for navbar-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import navbarReducer, {
  selectCurrentRoute,
  selectDrawerOpen,
  selectIsChatPageActive,
  setChatWidgetExpanded,
  setCurrentRoute,
  setDrawerOpen,
  toggleDrawer
} from "@/store/slices/navbar-slice";

const createStore = () =>
  configureStore({ reducer: { navbar: navbarReducer } });

describe("navbar-slice", () => {
  it("toggleDrawer should toggle drawerOpen", () => {
    const store = createStore();
    expect(selectDrawerOpen(store.getState())).toBe(false);
    store.dispatch(toggleDrawer());
    expect(selectDrawerOpen(store.getState())).toBe(true);
    store.dispatch(toggleDrawer());
    expect(selectDrawerOpen(store.getState())).toBe(false);
  });

  it("setDrawerOpen should set explicit value", () => {
    const store = createStore();
    store.dispatch(setDrawerOpen(true));
    expect(selectDrawerOpen(store.getState())).toBe(true);
  });

  it("setCurrentRoute should update route", () => {
    const store = createStore();
    store.dispatch(setCurrentRoute("/globe"));
    expect(selectCurrentRoute(store.getState())).toBe("/globe");
  });

  it("selectIsChatPageActive should detect /geo-agent route", () => {
    const store = createStore();
    store.dispatch(setCurrentRoute("/geo-agent"));
    expect(selectIsChatPageActive(store.getState())).toBe(true);
    store.dispatch(setCurrentRoute("/map"));
    expect(selectIsChatPageActive(store.getState())).toBe(false);
  });

  it("setChatWidgetExpanded should update state", () => {
    const store = createStore();
    store.dispatch(setChatWidgetExpanded(true));
    expect(store.getState().navbar.isChatWidgetExpanded).toBe(true);
  });
});
