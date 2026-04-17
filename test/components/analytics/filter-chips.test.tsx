// Copyright Amazon.com, Inc. or its affiliates.
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Provider } from "react-redux";

import { FilterChips } from "@/components/analytics/filter-chips";
import analyticsReducer from "@/store/slices/analytics-slice";
import type { AnalyticsFilter } from "@/utils/analytics/types";

function createStore(filters: AnalyticsFilter[] = []) {
  return configureStore({
    reducer: { analytics: analyticsReducer },
    preloadedState: {
      analytics: {
        colorMode: "layer" as const,
        activeFilters: filters,
        selectedLayerIds: [],
        confidenceThreshold: 0
      }
    }
  });
}

describe("FilterChips", () => {
  it("renders a chip for each active filter", () => {
    const filters: AnalyticsFilter[] = [
      {
        id: "cls-building",
        type: "classification",
        label: "Building",
        value: "building"
      },
      {
        id: "conf-0.8-0.9",
        type: "confidence-range",
        label: "80-90%",
        value: { min: 0.8, max: 0.9 }
      }
    ];
    const store = createStore(filters);
    render(
      <Provider store={store}>
        <FilterChips />
      </Provider>
    );
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("80-90%")).toBeInTheDocument();
  });

  it("dispatches removeFilter when a chip remove button is clicked", () => {
    const filters: AnalyticsFilter[] = [
      {
        id: "cls-building",
        type: "classification",
        label: "Building",
        value: "building"
      }
    ];
    const store = createStore(filters);
    render(
      <Provider store={store}>
        <FilterChips />
      </Provider>
    );
    const removeBtn = screen.getByRole("button", { name: /remove.*building/i });
    fireEvent.click(removeBtn);
    // After removal, the filter should be gone from the store
    expect(store.getState().analytics.activeFilters).toHaveLength(0);
  });

  it('shows "Clear all" button when 2 or more filters are active and dispatches clearFilters', () => {
    const filters: AnalyticsFilter[] = [
      {
        id: "cls-building",
        type: "classification",
        label: "Building",
        value: "building"
      },
      {
        id: "cls-vehicle",
        type: "classification",
        label: "Vehicle",
        value: "vehicle"
      }
    ];
    const store = createStore(filters);
    render(
      <Provider store={store}>
        <FilterChips />
      </Provider>
    );
    const clearBtn = screen.getByRole("button", { name: /clear all/i });
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);
    expect(store.getState().analytics.activeFilters).toHaveLength(0);
  });

  it('does not show "Clear all" button when fewer than 2 filters are active', () => {
    const filters: AnalyticsFilter[] = [
      {
        id: "cls-building",
        type: "classification",
        label: "Building",
        value: "building"
      }
    ];
    const store = createStore(filters);
    render(
      <Provider store={store}>
        <FilterChips />
      </Provider>
    );
    expect(
      screen.queryByRole("button", { name: /clear all/i })
    ).not.toBeInTheDocument();
  });

  it("renders nothing when no filters are active", () => {
    const store = createStore([]);
    const { container } = render(
      <Provider store={store}>
        <FilterChips />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
  });
});
