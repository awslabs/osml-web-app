// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for image-viewer-slice.ts sync reducers.
 * Covers setSelectedViewpoint, setAdjustment, setAllAdjustments,
 * resetAdjustments, save/load/clearViewpointAdjustments.
 */

import { configureStore } from "@reduxjs/toolkit";

import imageViewerReducer, {
  clearViewpointAdjustments,
  loadViewpointAdjustments,
  resetAdjustments,
  saveViewpointAdjustments,
  setAdjustment,
  setAllAdjustments,
  setSelectedViewpoint
} from "@/store/slices/image-viewer-slice";
import { DEFAULT_ADJUSTMENTS } from "@/utils/image-adjustments";

const createStore = () =>
  configureStore({ reducer: { imageViewer: imageViewerReducer } });

describe("image-viewer-slice - unit tests", () => {
  describe("setSelectedViewpoint", () => {
    it("should set selected viewpoint", () => {
      const store = createStore();
      store.dispatch(
        setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
      );
      expect(store.getState().imageViewer.selectedViewpoint?.viewpointId).toBe(
        "vp-1"
      );
    });

    it("should allow setting to null", () => {
      const store = createStore();
      store.dispatch(
        setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
      );
      store.dispatch(setSelectedViewpoint(null));
      expect(store.getState().imageViewer.selectedViewpoint).toBeNull();
    });
  });

  describe("setAdjustment", () => {
    it("should update a single adjustment value", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "exposure", value: 0.5 }));
      expect(store.getState().imageViewer.currentAdjustments.exposure).toBe(
        0.5
      );
    });

    it("should clamp values to valid range", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "exposure", value: 5 }));
      expect(store.getState().imageViewer.currentAdjustments.exposure).toBe(1);
      store.dispatch(setAdjustment({ key: "gamma", value: 0.01 }));
      expect(store.getState().imageViewer.currentAdjustments.gamma).toBe(0.1);
    });

    it("should not affect other adjustment values", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "contrast", value: 0.3 }));
      expect(store.getState().imageViewer.currentAdjustments.exposure).toBe(
        DEFAULT_ADJUSTMENTS.exposure
      );
    });
  });

  describe("setAllAdjustments", () => {
    it("should update all adjustments at once with clamping", () => {
      const store = createStore();
      store.dispatch(
        setAllAdjustments({
          exposure: 10,
          contrast: -10,
          saturation: 0,
          gamma: 100,
          redGain: 5,
          greenGain: -1,
          blueGain: 1
        })
      );
      const c = store.getState().imageViewer.currentAdjustments;
      expect(c.exposure).toBe(1);
      expect(c.contrast).toBe(-1);
      expect(c.gamma).toBe(3.0);
      expect(c.redGain).toBe(2);
      expect(c.greenGain).toBe(0);
    });
  });

  describe("resetAdjustments", () => {
    it("should reset all adjustments to defaults", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "exposure", value: 0.8 }));
      store.dispatch(resetAdjustments());
      expect(store.getState().imageViewer.currentAdjustments).toEqual(
        DEFAULT_ADJUSTMENTS
      );
    });
  });

  describe("viewpoint adjustment persistence", () => {
    it("save then load should restore adjustments", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "contrast", value: -0.5 }));
      store.dispatch(saveViewpointAdjustments("vp-1"));
      store.dispatch(resetAdjustments());
      store.dispatch(loadViewpointAdjustments("vp-1"));
      expect(store.getState().imageViewer.currentAdjustments.contrast).toBe(
        -0.5
      );
    });

    it("load unknown viewpoint should use defaults", () => {
      const store = createStore();
      store.dispatch(setAdjustment({ key: "exposure", value: 0.9 }));
      store.dispatch(loadViewpointAdjustments("unknown-vp"));
      expect(store.getState().imageViewer.currentAdjustments).toEqual(
        DEFAULT_ADJUSTMENTS
      );
    });

    it("clear should remove saved adjustments", () => {
      const store = createStore();
      store.dispatch(saveViewpointAdjustments("vp-1"));
      store.dispatch(clearViewpointAdjustments("vp-1"));
      expect(
        store.getState().imageViewer.adjustmentsByViewpoint["vp-1"]
      ).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Async thunk extraReducers
// ---------------------------------------------------------------------------

import {
  createViewpoint,
  deleteViewpoint,
  fetchViewpointBounds,
  fetchViewpointInfo,
  fetchViewpointMetadata,
  fetchViewpoints,
  fetchViewpointStatistics
} from "@/store/slices/image-viewer-slice";
import { LoadingStatus } from "@/types/loading-status";

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoints: jest.fn(),
    createViewpoint: jest.fn(),
    deleteViewpoint: jest.fn(),
    getViewpointBounds: jest.fn(),
    getViewpointMetadata: jest.fn(),
    getViewpointInfo: jest.fn(),
    getViewpointStatistics: jest.fn()
  }
}));

describe("image-viewer-slice async thunks", () => {
  describe("fetchViewpoints", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(fetchViewpoints.pending("r", undefined));
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("fulfilled should set viewpoints", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpoints.fulfilled(
          [{ viewpoint_id: "vp-1" }] as never,
          "r",
          undefined
        )
      );
      expect(store.getState().imageViewer.viewpoints).toHaveLength(1);
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpoints.rejected(new Error("fail"), "r", undefined)
      );
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("fetchViewpointBounds", () => {
    it("fulfilled should set bounds", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointBounds.fulfilled({ bounds: [1, 2, 3, 4] }, "r", "vp-1")
      );
      expect(store.getState().imageViewer.viewpointBounds.bounds).toEqual([
        1, 2, 3, 4
      ]);
    });
  });

  describe("fetchViewpointMetadata", () => {
    it("fulfilled should set metadata", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointMetadata.fulfilled(
          { metadata: { crs: "EPSG:4326" } },
          "r",
          "vp-1"
        )
      );
      expect(store.getState().imageViewer.viewpointMetadata.metadata).toEqual({
        crs: "EPSG:4326"
      });
    });
  });

  describe("fetchViewpointInfo", () => {
    it("fulfilled should set info", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointInfo.fulfilled(
          { type: "FeatureCollection", features: [] },
          "r",
          "vp-1"
        )
      );
      expect(store.getState().imageViewer.viewpointInfo.type).toBe(
        "FeatureCollection"
      );
    });
  });

  describe("fetchViewpointStatistics", () => {
    it("fulfilled should set statistics", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointStatistics.fulfilled(
          { image_statistics: { bands: 3 } },
          "r",
          "vp-1"
        )
      );
      expect(
        store.getState().imageViewer.viewpointStatistics.image_statistics
      ).toEqual({ bands: 3 });
    });
  });

  describe("deleteViewpoint", () => {
    it("fulfilled should remove viewpoint", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpoints.fulfilled(
          [{ viewpoint_id: "vp-1" }, { viewpoint_id: "vp-2" }] as never,
          "r",
          undefined
        )
      );
      store.dispatch(deleteViewpoint.fulfilled("vp-1", "r", "vp-1"));
      expect(store.getState().imageViewer.viewpoints).toHaveLength(1);
    });
  });

  describe("createViewpoint", () => {
    it("fulfilled should add viewpoint", () => {
      const store = createStore();
      store.dispatch(
        createViewpoint.fulfilled(
          { viewpoint_id: "vp-new" } as never,
          "r",
          {} as never
        )
      );
      expect(store.getState().imageViewer.viewpoints).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Remaining pending/rejected extraReducer cases
// ---------------------------------------------------------------------------

describe("image-viewer-slice remaining async thunk cases", () => {
  describe("fetchViewpointBounds pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(fetchViewpointBounds.pending("r", "vp-1"));
      expect(store.getState().imageViewer.viewpointBoundsStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointBounds.rejected(new Error("fail"), "r", "vp-1")
      );
      expect(store.getState().imageViewer.viewpointBoundsStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("fetchViewpointMetadata pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(fetchViewpointMetadata.pending("r", "vp-1"));
      expect(store.getState().imageViewer.viewpointMetadataStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointMetadata.rejected(new Error("fail"), "r", "vp-1")
      );
      expect(store.getState().imageViewer.viewpointMetadataStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("fetchViewpointInfo pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(fetchViewpointInfo.pending("r", "vp-1"));
      expect(store.getState().imageViewer.viewpointInfoStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointInfo.rejected(new Error("fail"), "r", "vp-1")
      );
      expect(store.getState().imageViewer.viewpointInfoStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("fetchViewpointStatistics pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(fetchViewpointStatistics.pending("r", "vp-1"));
      expect(store.getState().imageViewer.viewpointStatisticsStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        fetchViewpointStatistics.rejected(new Error("fail"), "r", "vp-1")
      );
      expect(store.getState().imageViewer.viewpointStatisticsStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("deleteViewpoint pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(deleteViewpoint.pending("r", "vp-1"));
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(deleteViewpoint.rejected(new Error("fail"), "r", "vp-1"));
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Error
      );
    });
  });

  describe("createViewpoint pending/rejected", () => {
    it("pending should set loading", () => {
      const store = createStore();
      store.dispatch(createViewpoint.pending("r", {} as never));
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Loading
      );
    });

    it("rejected should set error", () => {
      const store = createStore();
      store.dispatch(
        createViewpoint.rejected(new Error("fail"), "r", {} as never)
      );
      expect(store.getState().imageViewer.viewpointsStatus).toBe(
        LoadingStatus.Error
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for createViewpoint and deleteViewpoint thunks (lines 74-94)
// ---------------------------------------------------------------------------

describe("image-viewer-slice - additional thunk coverage", () => {
  it("createViewpoint.fulfilled should add viewpoint to list", () => {
    const store = createStore();
    store.dispatch(
      createViewpoint.fulfilled(
        {
          viewpoint_id: "new-vp",
          viewpoint_name: "New VP",
          viewpoint_status: "READY"
        } as never,
        "r",
        {
          viewpointName: "New VP",
          viewpointId: "new-vp",
          bucketName: "b",
          objectKey: "k",
          tileSize: 256,
          rangeAdjustment: "NONE" as const
        }
      )
    );
    expect(
      store
        .getState()
        .imageViewer.viewpoints.some(
          (v: { viewpoint_id: string }) => v.viewpoint_id === "new-vp"
        )
    ).toBe(true);
  });

  it("deleteViewpoint.fulfilled should remove viewpoint from list", () => {
    const store = createStore();
    // First add a viewpoint
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-del",
            viewpoint_name: "To Delete",
            viewpoint_status: "READY"
          }
        ] as never,
        "r",
        undefined
      )
    );
    expect(store.getState().imageViewer.viewpoints).toHaveLength(1);

    // Delete it
    store.dispatch(deleteViewpoint.fulfilled("vp-del", "r", "vp-del"));
    expect(store.getState().imageViewer.viewpoints).toHaveLength(0);
  });

  it("fetchViewpointBounds.fulfilled should set bounds data", () => {
    const store = createStore();
    const bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    store.dispatch(
      fetchViewpointBounds.fulfilled(bounds as never, "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointBounds).toEqual(bounds);
  });

  it("fetchViewpointMetadata.fulfilled should set metadata", () => {
    const store = createStore();
    const metadata = { crs: "EPSG:4326" };
    store.dispatch(
      fetchViewpointMetadata.fulfilled(metadata as never, "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointMetadata).toEqual(metadata);
  });

  it("fetchViewpointInfo.fulfilled should set info", () => {
    const store = createStore();
    const info = { bands: 3 };
    store.dispatch(fetchViewpointInfo.fulfilled(info as never, "r", "vp-1"));
    expect(store.getState().imageViewer.viewpointInfo).toEqual(info);
  });

  it("fetchViewpointStatistics.fulfilled should set statistics", () => {
    const store = createStore();
    const stats = { image_statistics: { min: 0, max: 255 } };
    store.dispatch(
      fetchViewpointStatistics.fulfilled(stats as never, "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointStatistics).toEqual(stats);
  });

  it("fetchViewpointBounds.rejected should set error", () => {
    const store = createStore();
    store.dispatch(
      fetchViewpointBounds.rejected(new Error("fail"), "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointBoundsError).toBe("fail");
  });

  it("fetchViewpointMetadata.rejected should set error", () => {
    const store = createStore();
    store.dispatch(
      fetchViewpointMetadata.rejected(new Error("fail"), "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointMetadataError).toBe("fail");
  });

  it("fetchViewpointInfo.rejected should set error", () => {
    const store = createStore();
    store.dispatch(fetchViewpointInfo.rejected(new Error("fail"), "r", "vp-1"));
    expect(store.getState().imageViewer.viewpointInfoError).toBe("fail");
  });

  it("fetchViewpointStatistics.rejected should set error", () => {
    const store = createStore();
    store.dispatch(
      fetchViewpointStatistics.rejected(new Error("fail"), "r", "vp-1")
    );
    expect(store.getState().imageViewer.viewpointStatisticsError).toBe("fail");
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: createViewpoint and deleteViewpoint thunk branches (lines 74-94)
// ---------------------------------------------------------------------------

describe("image-viewer-slice - createViewpoint/deleteViewpoint branches", () => {
  it("createViewpoint.pending should set loading status", () => {
    const store = createStore();
    store.dispatch(
      createViewpoint.pending("r", {
        viewpointName: "VP",
        viewpointId: "vp-1",
        bucketName: "b",
        objectKey: "k",
        tileSize: 256,
        rangeAdjustment: "NONE" as const
      })
    );
    expect(store.getState().imageViewer.viewpointsStatus).toBe("Loading");
  });

  it("createViewpoint.rejected should set error with fallback message", () => {
    const store = createStore();
    store.dispatch(
      createViewpoint.rejected(null, "r", {
        viewpointName: "VP",
        viewpointId: "vp-1",
        bucketName: "b",
        objectKey: "k",
        tileSize: 256,
        rangeAdjustment: "NONE" as const
      })
    );
    // Should set error status with fallback message when error.message is undefined
    expect(store.getState().imageViewer.viewpointsStatus).toBe("Error");
  });

  it("deleteViewpoint.fulfilled should clean up saved adjustments for deleted viewpoint", () => {
    const store = createStore();
    // Set up a viewpoint with saved adjustments
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-del", viewpointTileSize: 256 })
    );
    store.dispatch(saveViewpointAdjustments("vp-del"));
    expect(
      store.getState().imageViewer.adjustmentsByViewpoint["vp-del"]
    ).toBeDefined();

    // Add the viewpoint to the list first
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-del",
            viewpoint_name: "To Delete",
            viewpoint_status: "READY"
          }
        ] as never,
        "r",
        undefined
      )
    );

    // Delete it
    store.dispatch(deleteViewpoint.fulfilled("vp-del", "r", "vp-del"));

    // Saved adjustments should be cleaned up
    expect(
      store.getState().imageViewer.adjustmentsByViewpoint["vp-del"]
    ).toBeUndefined();
    expect(store.getState().imageViewer.viewpoints).toHaveLength(0);
  });
});
