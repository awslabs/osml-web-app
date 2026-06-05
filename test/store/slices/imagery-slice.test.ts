// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for imagery-slice.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import imageryReducer, {
  clearAllViewpointData,
  ImageryState,
  removeViewpointData,
  setViewpointData,
  setViewpointError,
  setViewpointExtent,
  ViewpointData
} from "@/store/slices/imagery-slice";
import { Viewpoint, ViewpointExtent } from "@/types/viewpoint";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitialState(): ImageryState {
  return imageryReducer(undefined, { type: "@@INIT" });
}

function makeViewpoint(overrides: Partial<Viewpoint> = {}): Viewpoint {
  return {
    viewpoint_id: "vp-1",
    viewpoint_name: "Test Viewpoint",
    viewpoint_status: "READY",
    bucket_name: "test-bucket",
    object_key: "test-key",
    tile_size: 256,
    range_adjustment: "NONE",
    local_object_path: "",
    error_message: "",
    expire_time: 0,
    ...overrides
  };
}

function makeViewpointData(
  overrides: Partial<ViewpointData> = {}
): ViewpointData {
  return {
    jobId: "job-1",
    viewpoint: makeViewpoint(),
    loaded: true,
    ...overrides
  };
}

const sampleExtent: ViewpointExtent = {
  minLon: -122.5,
  minLat: 37.5,
  maxLon: -122.0,
  maxLat: 38.0
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("imagery-slice", () => {
  // ── Requirement 1.1: Initial state ─────────────────────────────────────

  describe("initial state", () => {
    /**
     * Validates: Requirement 1.1
     * The imagery slice initial state should be { viewpointData: {} }.
     */
    it("is { viewpointData: {} }", () => {
      const state = getInitialState();

      expect(state).toEqual({ viewpointData: {} });
    });
  });

  // ── Requirement 1.3: setViewpointData ──────────────────────────────────

  describe("setViewpointData", () => {
    /**
     * Validates: Requirement 1.3
     * setViewpointData stores the entry keyed by jobId.
     */
    it("stores entry keyed by jobId", () => {
      const vpData = makeViewpointData({ jobId: "job-abc" });
      const state = imageryReducer(getInitialState(), setViewpointData(vpData));

      expect(state.viewpointData["job-abc"]).toEqual(vpData);
    });

    /**
     * Validates: Requirement 1.3
     * Multiple viewpoints can be stored independently.
     */
    it("stores multiple viewpoints independently", () => {
      const vp1 = makeViewpointData({ jobId: "job-1" });
      const vp2 = makeViewpointData({
        jobId: "job-2",
        viewpoint: makeViewpoint({
          viewpoint_id: "vp-2",
          viewpoint_status: "CREATING"
        }),
        loaded: false,
        isPolling: true
      });

      let state = imageryReducer(getInitialState(), setViewpointData(vp1));
      state = imageryReducer(state, setViewpointData(vp2));

      expect(Object.keys(state.viewpointData)).toHaveLength(2);
      expect(state.viewpointData["job-1"]).toEqual(vp1);
      expect(state.viewpointData["job-2"]).toEqual(vp2);
    });

    /**
     * Validates: Requirement 1.3
     * Overwriting an existing entry replaces it entirely.
     */
    it("overwrites existing entry for same jobId", () => {
      const original = makeViewpointData({ jobId: "job-1", loaded: false });
      const updated = makeViewpointData({
        jobId: "job-1",
        loaded: true,
        extent: sampleExtent
      });

      let state = imageryReducer(getInitialState(), setViewpointData(original));
      state = imageryReducer(state, setViewpointData(updated));

      expect(state.viewpointData["job-1"]).toEqual(updated);
      expect(Object.keys(state.viewpointData)).toHaveLength(1);
    });
  });

  // ── Requirement 1.4: setViewpointExtent ────────────────────────────────

  describe("setViewpointExtent", () => {
    /**
     * Validates: Requirement 1.4
     * Updates extent for an existing entry.
     */
    it("updates extent for existing entry", () => {
      const vpData = makeViewpointData({ jobId: "job-1" });
      let state = imageryReducer(getInitialState(), setViewpointData(vpData));

      state = imageryReducer(
        state,
        setViewpointExtent({ jobId: "job-1", extent: sampleExtent })
      );

      expect(state.viewpointData["job-1"].extent).toEqual(sampleExtent);
      // Other fields preserved
      expect(state.viewpointData["job-1"].viewpoint.viewpoint_status).toBe(
        "READY"
      );
      expect(state.viewpointData["job-1"].loaded).toBe(true);
    });

    /**
     * Validates: Requirement 1.4
     * No-ops for a missing entry (does not create a new entry).
     */
    it("no-ops for missing entry", () => {
      const state = imageryReducer(
        getInitialState(),
        setViewpointExtent({ jobId: "nonexistent", extent: sampleExtent })
      );

      expect(state.viewpointData).toEqual({});
    });
  });

  // ── Requirement 1.5: setViewpointError ─────────────────────────────────

  describe("setViewpointError", () => {
    /**
     * Validates: Requirement 1.5
     * Creates error entry with loaded: true and error message.
     */
    it("creates error entry with loaded: true and error message", () => {
      const state = imageryReducer(
        getInitialState(),
        setViewpointError({
          jobId: "job-1",
          error: "Viewpoint creation failed"
        })
      );

      const entry = state.viewpointData["job-1"];
      expect(entry).toBeDefined();
      expect(entry.loaded).toBe(true);
      expect(entry.error).toBe("Viewpoint creation failed");
      expect(entry.viewpoint.viewpoint_status).toBe("ERROR");
      expect(entry.viewpoint.error_message).toBe("Viewpoint creation failed");
      expect(entry.isPolling).toBe(false);
    });
  });

  // ── Requirement 1.6: removeViewpointData ───────────────────────────────

  describe("removeViewpointData", () => {
    /**
     * Validates: Requirement 1.6
     * Deletes entry without affecting others.
     */
    it("deletes entry without affecting others", () => {
      const vp1 = makeViewpointData({ jobId: "job-1" });
      const vp2 = makeViewpointData({
        jobId: "job-2",
        viewpoint: makeViewpoint({ viewpoint_id: "vp-2" })
      });

      let state = imageryReducer(getInitialState(), setViewpointData(vp1));
      state = imageryReducer(state, setViewpointData(vp2));
      state = imageryReducer(state, removeViewpointData({ jobId: "job-1" }));

      expect(state.viewpointData["job-1"]).toBeUndefined();
      expect(state.viewpointData["job-2"]).toEqual(vp2);
      expect(Object.keys(state.viewpointData)).toHaveLength(1);
    });

    /**
     * Validates: Requirement 1.6
     * No-ops when removing a nonexistent entry.
     */
    it("no-ops when removing nonexistent entry", () => {
      const vp1 = makeViewpointData({ jobId: "job-1" });
      let state = imageryReducer(getInitialState(), setViewpointData(vp1));

      state = imageryReducer(
        state,
        removeViewpointData({ jobId: "nonexistent" })
      );

      expect(state.viewpointData["job-1"]).toEqual(vp1);
      expect(Object.keys(state.viewpointData)).toHaveLength(1);
    });
  });

  // ── Requirement 1.7: clearAllViewpointData ─────────────────────────────

  describe("clearAllViewpointData", () => {
    /**
     * Validates: Requirement 1.7
     * Resets viewpointData to empty.
     */
    it("resets to empty", () => {
      const vp1 = makeViewpointData({ jobId: "job-1" });
      const vp2 = makeViewpointData({ jobId: "job-2" });

      let state = imageryReducer(getInitialState(), setViewpointData(vp1));
      state = imageryReducer(state, setViewpointData(vp2));

      expect(Object.keys(state.viewpointData)).toHaveLength(2);

      state = imageryReducer(state, clearAllViewpointData());

      expect(state.viewpointData).toEqual({});
    });

    /**
     * Validates: Requirement 1.7
     * Clearing an already-empty state is a no-op.
     */
    it("is a no-op on already-empty state", () => {
      const state = imageryReducer(getInitialState(), clearAllViewpointData());

      expect(state.viewpointData).toEqual({});
    });
  });
});
