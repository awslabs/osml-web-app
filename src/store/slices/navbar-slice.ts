// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { NavbarState } from "@/store/types.ts";

const initialState: NavbarState = {
  drawerOpen: false,
  currentRoute: "/",
  isChatWidgetExpanded: false
};

export const navbarSlice = createSlice({
  name: "navbar",
  initialState,
  reducers: {
    toggleDrawer: (state) => {
      state.drawerOpen = !state.drawerOpen;
    },
    setDrawerOpen: (state, action: PayloadAction<boolean>) => {
      state.drawerOpen = action.payload;
    },
    setCurrentRoute: (state, action: PayloadAction<string>) => {
      state.currentRoute = action.payload;
    },
    setChatWidgetExpanded: (state, action: PayloadAction<boolean>) => {
      state.isChatWidgetExpanded = action.payload;
    }
  }
});

export const {
  toggleDrawer,
  setDrawerOpen,
  setCurrentRoute,
  setChatWidgetExpanded
} = navbarSlice.actions;
export default navbarSlice.reducer;

// Selectors
export const selectDrawerOpen = (state: { navbar: NavbarState }) =>
  state.navbar.drawerOpen;
export const selectCurrentRoute = (state: { navbar: NavbarState }) =>
  state.navbar.currentRoute;
export const selectIsChatPageActive = (state: { navbar: NavbarState }) =>
  state.navbar.currentRoute === "/geo-agent";
