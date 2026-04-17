// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-stac-item-visibility hook.
 * Covers toggle visibility, isItemVisible, and feature creation/removal.
 */

import { act } from "@testing-library/react";

import { useStacItemVisibility } from "@/hooks/use-stac-item-visibility";

import { renderHookWithStore } from "../test-utils";

// Mock STAC item
const mockStacItem = {
  type: "Feature",
  stac_version: "1.0.0",
  id: "item-1",
  collection: "col-1",
  geometry: { type: "Point", coordinates: [-122.4, 37.8] },
  bbox: [-122.5, 37.7, -122.3, 37.9],
  properties: { datetime: "2024-01-01T00:00:00Z", title: "Test Item" },
  links: [],
  assets: {}
} as never;

describe("useStacItemVisibility", () => {
  it("should start with no visible items", () => {
    const { result } = renderHookWithStore(() => useStacItemVisibility());

    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.isItemVisible("item-1")).toBe(false);
  });

  it("handleToggleVisibility should make item visible and add feature", () => {
    const { result, store } = renderHookWithStore(() =>
      useStacItemVisibility()
    );

    act(() => {
      result.current.handleToggleVisibility("item-1", mockStacItem);
    });

    expect(result.current.isItemVisible("item-1")).toBe(true);
    expect(result.current.visibleItems).toContain("item-1");

    // Verify feature was added to overlay
    const overlayState = store.getState().overlay;
    const agentFeatures = overlayState.inlineFeatures["agent-features"] || [];
    expect(
      agentFeatures.find((f: { id: string }) => f.id === "stac-item-1")
    ).toBeDefined();
  });

  it("handleToggleVisibility should hide item and remove feature", () => {
    const { result, store } = renderHookWithStore(() =>
      useStacItemVisibility()
    );

    // First make visible
    act(() => {
      result.current.handleToggleVisibility("item-1", mockStacItem);
    });
    expect(result.current.isItemVisible("item-1")).toBe(true);

    // Then toggle off
    act(() => {
      result.current.handleToggleVisibility("item-1");
    });
    expect(result.current.isItemVisible("item-1")).toBe(false);

    // Feature should be removed
    const overlayState = store.getState().overlay;
    const agentFeatures = overlayState.inlineFeatures["agent-features"] || [];
    expect(
      agentFeatures.find((f: { id: string }) => f.id === "stac-item-1")
    ).toBeUndefined();
  });

  it("should handle multiple items independently", () => {
    const { result } = renderHookWithStore(() => useStacItemVisibility());

    const item2 = { ...mockStacItem, id: "item-2" } as never;

    act(() => {
      result.current.handleToggleVisibility("item-1", mockStacItem);
      result.current.handleToggleVisibility("item-2", item2);
    });

    expect(result.current.isItemVisible("item-1")).toBe(true);
    expect(result.current.isItemVisible("item-2")).toBe(true);

    act(() => {
      result.current.handleToggleVisibility("item-1");
    });

    expect(result.current.isItemVisible("item-1")).toBe(false);
    expect(result.current.isItemVisible("item-2")).toBe(true);
  });
});
