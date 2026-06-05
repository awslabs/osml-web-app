// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for navbar-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import navbarReducer, {
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
    expect(store.getState().navbar.drawerOpen).toBe(false);
    store.dispatch(toggleDrawer());
    expect(store.getState().navbar.drawerOpen).toBe(true);
    store.dispatch(toggleDrawer());
    expect(store.getState().navbar.drawerOpen).toBe(false);
  });

  it("setDrawerOpen should set explicit value", () => {
    const store = createStore();
    store.dispatch(setDrawerOpen(true));
    expect(store.getState().navbar.drawerOpen).toBe(true);
  });

  it("setCurrentRoute should update route", () => {
    const store = createStore();
    store.dispatch(setCurrentRoute("/globe"));
    expect(store.getState().navbar.currentRoute).toBe("/globe");
  });

  it("setChatWidgetExpanded should update state", () => {
    const store = createStore();
    store.dispatch(setChatWidgetExpanded(true));
    expect(store.getState().navbar.isChatWidgetExpanded).toBe(true);
  });
});
