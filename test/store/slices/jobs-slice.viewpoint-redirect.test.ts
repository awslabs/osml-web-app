// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for fetchViewpointStatus thunk redirect.
 *
 * These tests verify that fetchViewpointStatus dispatches to imagery-slice.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */

import { configureStore } from "@reduxjs/toolkit";

import { viewpointService } from "@/services/viewpoint-service";
import imageryReducer, { ViewpointData } from "@/store/slices/imagery-slice";
import jobsReducer, { fetchViewpointStatus } from "@/store/slices/jobs-slice";
import overlayReducer from "@/store/slices/overlay-slice";
import { Viewpoint, ViewpointExtent } from "@/types/viewpoint";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoint: jest.fn(),
    getViewpointExtentWGS84: jest.fn()
  }
}));

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { searchItems: jest.fn() }
}));

jest.mock("@/services/s3-service", () => ({
  s3Service: { downloadFile: jest.fn() }
}));

jest.mock("@/services/geojson-cache-service", () => ({
  GeoJSONCacheService: {
    getInstance: () => ({ set: jest.fn(), delete: jest.fn(), get: jest.fn() })
  }
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockGetViewpoint = viewpointService.getViewpoint as jest.Mock;
const mockGetExtent = viewpointService.getViewpointExtentWGS84 as jest.Mock;

function makeViewpoint(overrides: Partial<Viewpoint> = {}): Viewpoint {
  return {
    viewpoint_id: "vp-123",
    viewpoint_name: "test-viewpoint",
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

function makeExtent(): ViewpointExtent {
  return { minLon: -77.5, minLat: 38.5, maxLon: -77.0, maxLat: 39.0 };
}

function createTestStore(preloadedImagery: Record<string, ViewpointData> = {}) {
  // Capture all dispatched actions via a custom middleware
  const dispatchedActions: Array<{ type: string; [key: string]: unknown }> = [];
  const actionCaptureMiddleware =
    () => (next: (action: unknown) => unknown) => (action: unknown) => {
      const act = action as { type?: string; [key: string]: unknown };
      if (act && typeof act !== "function" && act.type) {
        dispatchedActions.push(act as { type: string; [key: string]: unknown });
      }
      return next(action);
    };

  const store = configureStore({
    reducer: {
      jobs: jobsReducer,
      imagery: imageryReducer,
      overlay: overlayReducer
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(actionCaptureMiddleware)
  });

  // Seed imagery state if needed
  if (Object.keys(preloadedImagery).length > 0) {
    const { setViewpointData } =
      require("@/store/slices/imagery-slice") as typeof import("@/store/slices/imagery-slice");
    Object.values(preloadedImagery).forEach((vp: ViewpointData) => {
      store.dispatch(setViewpointData(vp));
    });
    // Clear captured actions from seeding
    dispatchedActions.length = 0;
  }

  return { store, dispatchedActions };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("fetchViewpointStatus — imagery-slice redirect", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Validates: Requirement 7.1
   * The thunk dispatches imagery/setViewpointData (not mapViewer/setViewpointData)
   * when a READY viewpoint is fetched.
   */
  it("dispatches imagery/setViewpointData action on READY viewpoint", async () => {
    const viewpoint = makeViewpoint({ viewpoint_status: "READY" });
    const extent = makeExtent();
    mockGetViewpoint.mockResolvedValue(viewpoint);
    mockGetExtent.mockResolvedValue(extent);

    const { store, dispatchedActions } = createTestStore();

    await store.dispatch(
      fetchViewpointStatus("job-1") as unknown as { type: string }
    );

    const dispatchedTypes = dispatchedActions.map((a) => a.type);

    // Should dispatch to imagery-slice, not map-viewer-slice
    expect(dispatchedTypes).toContain("imagery/setViewpointData");
    expect(dispatchedTypes).not.toContain("mapViewer/setViewpointData");
  });

  /**
   * Validates: Requirement 7.2
   * The thunk dispatches imagery/setViewpointError (not mapViewer/setViewpointError)
   * when the viewpoint service throws an error.
   */
  it("dispatches imagery/setViewpointError action on error", async () => {
    mockGetViewpoint.mockRejectedValue(new Error("Service unavailable"));

    const { store, dispatchedActions } = createTestStore();

    await store.dispatch(
      fetchViewpointStatus("job-err") as unknown as { type: string }
    );

    const dispatchedTypes = dispatchedActions.map((a) => a.type);

    expect(dispatchedTypes).toContain("imagery/setViewpointError");
    expect(dispatchedTypes).not.toContain("mapViewer/setViewpointError");

    // Verify the error was stored in imagery state
    const state = store.getState();
    expect(state.imagery.viewpointData["job-err"]).toBeDefined();
    expect(state.imagery.viewpointData["job-err"].error).toBe(
      "Service unavailable"
    );
  });

  /**
   * Validates: Requirement 7.2
   * The thunk dispatches imagery/setViewpointError when viewpoint status is ERROR.
   */
  it("dispatches imagery/setViewpointError for ERROR viewpoint status", async () => {
    const viewpoint = makeViewpoint({
      viewpoint_status: "ERROR",
      error_message: "Viewpoint creation failed"
    });
    mockGetViewpoint.mockResolvedValue(viewpoint);

    const { store, dispatchedActions } = createTestStore();

    await store.dispatch(
      fetchViewpointStatus("job-fail") as unknown as { type: string }
    );

    const dispatchedTypes = dispatchedActions.map((a) => a.type);

    expect(dispatchedTypes).toContain("imagery/setViewpointError");
    expect(dispatchedTypes).not.toContain("mapViewer/setViewpointError");
  });

  /**
   * Validates: Requirement 7.3
   * The thunk reads existing data from state.imagery.viewpointData
   * (not state.mapViewer.viewpointData) to skip already-loaded viewpoints.
   */
  it("reads existing data from state.imagery.viewpointData", async () => {
    const viewpoint = makeViewpoint({ viewpoint_status: "READY" });
    const extent = makeExtent();

    // Pre-populate imagery state with a fully loaded viewpoint
    const { store } = createTestStore({
      "job-existing": {
        jobId: "job-existing",
        viewpoint,
        extent,
        loaded: true,
        isPolling: false
      }
    });

    mockGetViewpoint.mockResolvedValue(viewpoint);

    await store.dispatch(
      fetchViewpointStatus("job-existing") as unknown as { type: string }
    );

    // Should NOT call the service because the data already exists in imagery state
    expect(mockGetViewpoint).not.toHaveBeenCalled();
  });

  /**
   * Validates: Requirement 7.4
   * When a job is deselected during polling, the thunk exits silently.
   * (The jobs-slice middleware handles cleanup of overlay layers and
   * viewpoint data when the selection shrinks — not the thunk itself.)
   */
  it("exits polling silently when job deselected", async () => {
    const viewpoint = makeViewpoint({ viewpoint_status: "CREATING" });
    mockGetViewpoint.mockResolvedValue(viewpoint);

    const { store, dispatchedActions } = createTestStore();

    // Start the thunk — it will dispatch CREATING state and schedule a poll
    const thunkPromise = store.dispatch(
      fetchViewpointStatus("job-poll") as unknown as { type: string }
    );
    await thunkPromise;

    // Clear actions from the initial dispatch; we want to verify the
    // timer callback alone.
    dispatchedActions.length = 0;
    mockGetViewpoint.mockClear();

    // The job is NOT in selectedJobs — when the timer fires, the thunk
    // should exit silently (no recursive self-dispatch, no getViewpoint
    // call, no side-effect action).
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    // The thunk should not re-fetch the viewpoint
    expect(mockGetViewpoint).not.toHaveBeenCalled();

    // The thunk should not directly dispatch any cleanup action — the
    // middleware owns that path, triggered by setSelectedJobs changes.
    const dispatchedTypes = dispatchedActions.map((a) => a.type);
    expect(dispatchedTypes).not.toContain("imagery/removeViewpointData");
    expect(dispatchedTypes).not.toContain("imagery/setViewpointData");
  });
});
