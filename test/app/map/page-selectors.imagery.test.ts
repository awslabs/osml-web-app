// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for Map Page selectors reading from imagery-slice.
 *
 * 1. viewpointData from state.imagery.viewpointData
 * 2. No imports from map-viewer-slice
 *
 * Validates: Requirements 5.1, 5.3
 */

import { configureStore } from "@reduxjs/toolkit";
import { readFileSync } from "fs";
import { resolve } from "path";

import imageryReducer, {
  setViewpointData,
  ViewpointData
} from "@/store/slices/imagery-slice";
import jobsReducer from "@/store/slices/jobs-slice";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestStore() {
  return configureStore({
    reducer: {
      jobs: jobsReducer,
      imagery: imageryReducer
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware()
  });
}

const makeViewpointData = (jobId: string): ViewpointData => ({
  jobId,
  viewpoint: {
    viewpoint_id: jobId,
    viewpoint_name: `VP ${jobId}`,
    viewpoint_status: "READY",
    bucket_name: "bucket",
    object_key: "key",
    tile_size: 256,
    range_adjustment: "NONE",
    local_object_path: "",
    error_message: "",
    expire_time: 0
  },
  loaded: true
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Map page selector migration to imagery-slice", () => {
  // =========================================================================
  // Test 1: viewpointData from state.imagery.viewpointData
  // Validates: Requirement 5.1
  // =========================================================================

  describe("viewpointData from state.imagery", () => {
    it("reads viewpointData from state.imagery.viewpointData", () => {
      const store = createTestStore();
      const vpData = makeViewpointData("job-1");

      store.dispatch(setViewpointData(vpData));

      const state = store.getState();

      // Verify data lives at state.imagery.viewpointData
      expect(state.imagery.viewpointData["job-1"]).toEqual(vpData);

      expect(state.imagery.viewpointData).toBeDefined();
      expect(Object.keys(state.imagery.viewpointData)).toContain("job-1");
    });

    it("viewpointData is NOT on state.mapViewer", () => {
      const store = createTestStore();
      const state = store.getState();

      // state.mapViewer should not exist
      expect((state as Record<string, unknown>).mapViewer).toBeUndefined();
    });
  });

  // =========================================================================
  // Test 2: no imports from map-viewer-slice in map/page.tsx
  // Validates: Requirement 5.3
  // =========================================================================

  describe("no imports from map-viewer-slice", () => {
    it("map/page.tsx does not import from map-viewer-slice", () => {
      const mapPagePath = resolve(__dirname, "../../../src/app/map/page.tsx");
      const source = readFileSync(mapPagePath, "utf-8");

      // The map page should NOT contain any import from map-viewer-slice
      expect(source).not.toMatch(/from\s+["'].*map-viewer-slice/);
    });
  });
});
