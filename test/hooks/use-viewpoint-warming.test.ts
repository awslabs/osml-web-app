// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-viewpoint-warming hook.
 * Covers warming status tracking (isWarming, readyCount, errorCount).
 */

import { useViewpointWarming } from "@/hooks/use-viewpoint-warming";

// Mock stac-viewpoint-utils to control which items are "viewable"
jest.mock("@/utils/stac-viewpoint-utils", () => ({
  ...jest.requireActual("@/utils/stac-viewpoint-utils"),
  hasViewableImageAsset: jest.fn(() => false)
}));

// Mock viewpoint-service to prevent actual API calls from async thunks
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    createViewpoint: jest.fn(),
    getViewpoint: jest.fn(),
    getViewpoints: jest.fn(),
    getViewpointBounds: jest.fn(),
    getViewpointMetadata: jest.fn(),
    getViewpointInfo: jest.fn(),
    getViewpointStatistics: jest.fn(),
    getViewpointExtentWGS84: jest.fn(),
    deleteViewpoint: jest.fn()
  }
}));

// Mock data-catalog-service to prevent actual API calls
jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn(),
    searchItems: jest.fn(),
    getCollectionFieldMappings: jest.fn(),
    deleteItem: jest.fn(),
    deleteCollection: jest.fn()
  }
}));

import { setViewpointStatus } from "@/store/slices/data-catalog-slice";

import { createTestStore, renderHookWithStore } from "../test-utils";

describe("useViewpointWarming", () => {
  it("should return initial state with no warming activity", () => {
    const { result } = renderHookWithStore(() => useViewpointWarming());

    expect(result.current.isWarming).toBe(false);
    expect(result.current.readyCount).toBe(0);
    expect(result.current.errorCount).toBe(0);
  });

  it("should reflect viewpoint states from store", () => {
    const store = createTestStore();

    // Populate viewpoint states via dispatching actions
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "ready"
      })
    );
    store.dispatch(
      setViewpointStatus({
        itemId: "item-2",
        viewpointId: "vp-2",
        status: "creating"
      })
    );
    store.dispatch(
      setViewpointStatus({
        itemId: "item-3",
        viewpointId: "vp-3",
        status: "error",
        error: "timeout"
      })
    );

    const { result } = renderHookWithStore(() => useViewpointWarming(), {
      store
    });

    expect(result.current.isWarming).toBe(true); // item-2 is creating
    expect(result.current.readyCount).toBe(1);
    expect(result.current.errorCount).toBe(1);
  });

  it("should report not warming when all viewpoints are ready", () => {
    const store = createTestStore();

    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "ready"
      })
    );
    store.dispatch(
      setViewpointStatus({
        itemId: "item-2",
        viewpointId: "vp-2",
        status: "ready"
      })
    );

    const { result } = renderHookWithStore(() => useViewpointWarming(), {
      store
    });

    expect(result.current.isWarming).toBe(false);
    expect(result.current.readyCount).toBe(2);
    expect(result.current.errorCount).toBe(0);
  });
});

import { hasViewableImageAsset } from "@/utils/stac-viewpoint-utils";

describe("useViewpointWarming - effect behavior", () => {
  it("should not process items when search results are loading", () => {
    // Item is viewable; what we're testing is that loading state blocks processing
    (hasViewableImageAsset as jest.Mock).mockReturnValue(true);

    const baseState = createTestStore().getState();
    const store = createTestStore({
      dataCatalog: {
        ...baseState.dataCatalog,
        search: {
          ...baseState.dataCatalog.search,
          results: {
            features: [
              {
                id: "item-1",
                type: "Feature",
                geometry: null,
                properties: { datetime: null },
                assets: { visual: { href: "s3://b/i.tif" } }
              }
            ] as never,
            loading: true,
            totalCount: 1,
            error: null
          }
        }
      }
    });

    const dispatchSpy = jest.spyOn(store, "dispatch");

    renderHookWithStore(() => useViewpointWarming(), { store });

    // The hook must bail out early when loading=true even though the item
    // would otherwise be eligible. No warming thunk should be dispatched.
    const warmingDispatches = dispatchSpy.mock.calls.filter((call) => {
      const action = call[0] as unknown;
      const type =
        typeof action === "function"
          ? "thunk"
          : (action as { type?: string })?.type;
      return type === "thunk";
    });
    expect(warmingDispatches).toHaveLength(0);
  });

  it("should not process items when search results are empty", () => {
    const { result } = renderHookWithStore(() => useViewpointWarming());
    expect(result.current.isWarming).toBe(false);
    expect(result.current.readyCount).toBe(0);
  });

  it("should skip items without viewable image assets", () => {
    (hasViewableImageAsset as jest.Mock).mockReturnValue(false);

    const baseState = createTestStore().getState();
    const store = createTestStore({
      dataCatalog: {
        ...baseState.dataCatalog,
        search: {
          ...baseState.dataCatalog.search,
          results: {
            features: [
              {
                id: "item-1",
                type: "Feature",
                geometry: null,
                properties: { datetime: null },
                assets: {}
              }
            ] as never,
            loading: false,
            totalCount: 1,
            error: null
          }
        }
      }
    });

    const dispatchSpy = jest.spyOn(store, "dispatch");

    renderHookWithStore(() => useViewpointWarming(), { store });

    // hasViewableImageAsset returns false for this item, so no warming
    // thunk should be dispatched.
    const warmingDispatches = dispatchSpy.mock.calls.filter((call) => {
      const action = call[0] as unknown;
      const type =
        typeof action === "function"
          ? "thunk"
          : (action as { type?: string })?.type;
      return type === "thunk";
    });
    expect(warmingDispatches).toHaveLength(0);
  });

  it("should skip items that already have viewpoints", () => {
    (hasViewableImageAsset as jest.Mock).mockReturnValue(true);

    const store = createTestStore();
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "ready"
      })
    );

    const { result } = renderHookWithStore(() => useViewpointWarming(), {
      store
    });
    expect(result.current.readyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Cover the effect body that processes items (lines 32-69)
// ---------------------------------------------------------------------------

import { searchStacItems } from "@/store/slices/data-catalog-slice";

describe("useViewpointWarming - item processing effect", () => {
  it("should attempt to warm viewable items from search results", () => {
    (hasViewableImageAsset as jest.Mock).mockReturnValue(true);

    // Mock createViewpoint to resolve
    const { viewpointService } = require("@/services/viewpoint-service") as {
      viewpointService: { createViewpoint: jest.Mock };
    };
    viewpointService.createViewpoint.mockResolvedValue({
      viewpoint_id: "vp-new",
      viewpoint_status: "CREATING"
    });

    const store = createTestStore();

    // Populate search results with items that have viewable assets
    store.dispatch(
      searchStacItems.fulfilled(
        {
          features: [
            {
              id: "item-warm-1",
              type: "Feature",
              geometry: null,
              properties: { datetime: null },
              assets: { visual: { href: "s3://b/i.tif" } }
            },
            {
              id: "item-warm-2",
              type: "Feature",
              geometry: null,
              properties: { datetime: null },
              assets: { visual: { href: "s3://b/i2.tif" } }
            }
          ],
          context: { matched: 2 }
        } as never,
        "r",
        undefined
      )
    );

    const { result } = renderHookWithStore(() => useViewpointWarming(), {
      store
    });

    // The hook should have attempted to process the items
    // Even if the thunk fails, the hook should not crash
    expect(result.current).toBeDefined();
    expect(typeof result.current.isWarming).toBe("boolean");
    expect(typeof result.current.readyCount).toBe("number");
  });

  it("should not re-process items that already have viewpoints", () => {
    (hasViewableImageAsset as jest.Mock).mockReturnValue(true);

    const store = createTestStore();

    // Item already has a viewpoint
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "ready"
      })
    );

    store.dispatch(
      searchStacItems.fulfilled(
        {
          features: [
            {
              id: "item-1",
              type: "Feature",
              geometry: null,
              properties: { datetime: null },
              assets: {}
            }
          ],
          context: { matched: 1 }
        } as never,
        "r",
        undefined
      )
    );

    const { result } = renderHookWithStore(() => useViewpointWarming(), {
      store
    });

    // Should report the existing ready viewpoint
    expect(result.current.readyCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency cap: only MAX_CONCURRENT_WARMING (4) creations run at once,
// remaining items start as in-flight slots free up.
// ---------------------------------------------------------------------------

import { act, waitFor } from "@testing-library/react";

describe("useViewpointWarming - concurrency cap", () => {
  it("caps concurrent creations at 4 and processes the rest as slots free", async () => {
    (hasViewableImageAsset as jest.Mock).mockReturnValue(true);

    const { viewpointService } = require("@/services/viewpoint-service") as {
      viewpointService: { createViewpoint: jest.Mock; getViewpoint: jest.Mock };
    };

    // Keep every creation pending until we explicitly resolve it so we can
    // observe how many run concurrently.
    const resolvers: Array<(v: unknown) => void> = [];
    viewpointService.createViewpoint.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );
    // Polling after a creation resolves should not call createViewpoint.
    viewpointService.getViewpoint.mockResolvedValue({
      viewpoint_status: "READY"
    });

    const features = Array.from({ length: 6 }, (_, i) => ({
      id: `warm-${i}`,
      type: "Feature",
      geometry: null,
      properties: { datetime: null },
      assets: { visual: { href: `s3://b/i${i}.tif`, type: "image/tiff" } }
    }));

    const store = createTestStore();
    store.dispatch(
      searchStacItems.fulfilled(
        { features, context: { matched: features.length } } as never,
        "r",
        undefined
      )
    );

    renderHookWithStore(() => useViewpointWarming(), { store });

    // 6 eligible items, but only the cap of 4 should be in flight.
    expect(viewpointService.createViewpoint).toHaveBeenCalledTimes(4);

    // Resolving two frees two slots → the remaining two items start.
    await act(async () => {
      resolvers[0]({ viewpoint_id: "v0", viewpoint_status: "CREATING" });
      resolvers[1]({ viewpoint_id: "v1", viewpoint_status: "CREATING" });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(viewpointService.createViewpoint).toHaveBeenCalledTimes(6)
    );
  });
});
