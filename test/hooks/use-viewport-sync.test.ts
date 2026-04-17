// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-viewport-sync hook.
 * Covers viewport reading, updating, and initialization tracking.
 */

import { act } from "@testing-library/react";

import { useViewportSync } from "@/hooks/use-viewport-sync";

import { renderHookWithStore } from "../test-utils";

describe("useViewportSync", () => {
  it("should return initial viewport state", () => {
    const { result } = renderHookWithStore(() => useViewportSync());

    expect(result.current.viewport.longitude).toBe(0);
    expect(result.current.viewport.latitude).toBe(0);
    expect(result.current.viewport.zoom).toBe(2);
  });

  it("updateViewport should dispatch setViewport and update state", () => {
    const { result } = renderHookWithStore(() => useViewportSync());

    act(() => {
      result.current.updateViewport(
        -122.4,
        37.8,
        12,
        { west: -123, south: 37, east: -122, north: 38 },
        "map"
      );
    });

    expect(result.current.viewport.longitude).toBe(-122.4);
    expect(result.current.viewport.latitude).toBe(37.8);
    expect(result.current.viewport.zoom).toBe(12);
    expect(result.current.viewport.lastUpdatedBy).toBe("map");
  });

  it("getCurrentViewport should return current state", () => {
    const { result } = renderHookWithStore(() => useViewportSync());

    const vp = result.current.getCurrentViewport();
    expect(vp.longitude).toBe(0);
    expect(vp.latitude).toBe(0);
  });

  it("should track initialization state", () => {
    const { result } = renderHookWithStore(() => useViewportSync());

    expect(result.current.isInitialized()).toBe(false);

    act(() => {
      result.current.markAsInitialized();
    });

    expect(result.current.isInitialized()).toBe(true);
  });

  it("should update from globe source", () => {
    const { result } = renderHookWithStore(() => useViewportSync());

    act(() => {
      result.current.updateViewport(
        10,
        45,
        8,
        { west: 5, south: 40, east: 15, north: 50 },
        "globe"
      );
    });

    expect(result.current.viewport.lastUpdatedBy).toBe("globe");
  });
});
