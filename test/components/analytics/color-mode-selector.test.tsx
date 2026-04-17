// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import { act, render } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { ColorModeSelector } from "@/components/analytics/color-mode-selector";
import analyticsReducer, { setColorMode } from "@/store/slices/analytics-slice";
import type { ColorMode } from "@/utils/analytics/types";

function createStore(colorMode: ColorMode = "layer") {
  return configureStore({
    reducer: { analytics: analyticsReducer },
    preloadedState: {
      analytics: {
        colorMode,
        activeFilters: [],
        selectedLayerIds: [],
        confidenceThreshold: 0
      }
    }
  });
}

describe("ColorModeSelector", () => {
  it("renders without crashing", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <ColorModeSelector />
      </Provider>
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("reflects the current colorMode in the visible value", () => {
    const store = createStore("classification");
    render(
      <Provider store={store}>
        <ColorModeSelector />
      </Provider>
    );
    const valueSpan = document.querySelector('[data-slot="value"]');
    expect(valueSpan?.textContent).toBe("By Classification");
  });

  it("re-renders with updated value when store changes", () => {
    const store = createStore("layer");
    render(
      <Provider store={store}>
        <ColorModeSelector />
      </Provider>
    );

    act(() => {
      store.dispatch(setColorMode("confidence"));
    });

    const valueSpan = document.querySelector('[data-slot="value"]');
    expect(valueSpan?.textContent).toBe("By Confidence");
  });
});
