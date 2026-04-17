// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for chat-widget-slice.ts.
 */

import { configureStore } from "@reduxjs/toolkit";

import chatWidgetReducer, {
  closeWidget,
  minimizeWidget,
  openWidget,
  restoreWidget,
  selectIsWidgetMinimized,
  selectIsWidgetOpen,
  selectIsWidgetVisible,
  toggleWidget
} from "@/store/slices/chat-widget-slice";

const createStore = () =>
  configureStore({ reducer: { chatWidget: chatWidgetReducer } });

describe("chat-widget-slice", () => {
  it("should start closed", () => {
    const store = createStore();
    expect(selectIsWidgetOpen(store.getState())).toBe(false);
    expect(selectIsWidgetMinimized(store.getState())).toBe(false);
  });

  it("openWidget should open and un-minimize", () => {
    const store = createStore();
    store.dispatch(openWidget());
    expect(selectIsWidgetOpen(store.getState())).toBe(true);
    expect(selectIsWidgetVisible(store.getState())).toBe(true);
  });

  it("closeWidget should close", () => {
    const store = createStore();
    store.dispatch(openWidget());
    store.dispatch(closeWidget());
    expect(selectIsWidgetOpen(store.getState())).toBe(false);
  });

  it("minimizeWidget / restoreWidget should toggle minimized", () => {
    const store = createStore();
    store.dispatch(openWidget());
    store.dispatch(minimizeWidget());
    expect(selectIsWidgetMinimized(store.getState())).toBe(true);
    expect(selectIsWidgetVisible(store.getState())).toBe(false);

    store.dispatch(restoreWidget());
    expect(selectIsWidgetMinimized(store.getState())).toBe(false);
    expect(selectIsWidgetVisible(store.getState())).toBe(true);
  });

  it("toggleWidget should cycle: closed → open → minimized → open", () => {
    const store = createStore();

    store.dispatch(toggleWidget());
    expect(selectIsWidgetOpen(store.getState())).toBe(true);
    expect(selectIsWidgetMinimized(store.getState())).toBe(false);

    store.dispatch(toggleWidget());
    expect(selectIsWidgetOpen(store.getState())).toBe(true);
    expect(selectIsWidgetMinimized(store.getState())).toBe(true);

    store.dispatch(toggleWidget());
    expect(selectIsWidgetMinimized(store.getState())).toBe(false);
  });
});
