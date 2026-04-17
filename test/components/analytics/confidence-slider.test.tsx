// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import { act, render } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { ConfidenceSlider } from "@/components/analytics/confidence-slider";
import analyticsReducer, {
  setConfidenceThreshold
} from "@/store/slices/analytics-slice";

function createStore(confidenceThreshold: number = 0) {
  return configureStore({
    reducer: { analytics: analyticsReducer },
    preloadedState: {
      analytics: {
        colorMode: "layer" as const,
        activeFilters: [],
        selectedLayerIds: [],
        confidenceThreshold
      }
    }
  });
}

describe("ConfidenceSlider", () => {
  it("renders without crashing", () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <ConfidenceSlider />
      </Provider>
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("displays the current threshold as a percentage", () => {
    const store = createStore(0.75);
    render(
      <Provider store={store}>
        <ConfidenceSlider />
      </Provider>
    );
    const output = document.querySelector('[data-slot="value"]');
    expect(output?.textContent).toBe("75%");
  });

  it("re-renders with updated value when store changes", () => {
    const store = createStore(0);
    render(
      <Provider store={store}>
        <ConfidenceSlider />
      </Provider>
    );

    act(() => {
      store.dispatch(setConfidenceThreshold(0.6));
    });

    const output = document.querySelector('[data-slot="value"]');
    expect(output?.textContent).toBe("60%");
  });
});
