// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for layer-tools.ts.
 *
 * The agent-facing tool surface mirrors the human sidebar surface:
 * - list_overlay_layers        (read-only introspection)
 * - set_job_visibility         (add/remove a job from the selection)
 * - reorder_layers             (change draw order)
 * - style_layer                (detection → jobs-slice per-job style;
 *                               agent features → overlay-slice FeatureStyle)
 */

import { configureStore } from "@reduxjs/toolkit";

import {
  listLayersTool,
  reorderLayersTool,
  setJobVisibilityTool,
  styleLayerTool
} from "@/mcp/local-server/layer-tools";
import { ImageProcessingJob } from "@/services/model-runner-service";
import imageryReducer from "@/store/slices/imagery-slice";
import jobsReducer, { fetchDataMiddleware } from "@/store/slices/jobs-slice";
import overlayReducer, { addLayer } from "@/store/slices/overlay-slice";
import settingsReducer from "@/store/slices/settings-slice";

// Prevent real network calls from the middleware-triggered thunks
jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { searchItems: jest.fn(() => Promise.resolve({})) }
}));
jest.mock("@/services/s3-service", () => ({
  s3Service: { downloadFile: jest.fn() }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoint: jest.fn(() => new Promise(() => {})),
    getViewpointExtentWGS84: jest.fn()
  }
}));
jest.mock("@/services/geojson-cache-service", () => {
  const cache = {
    has: jest.fn(() => false),
    get: jest.fn(() => null),
    set: jest.fn(),
    delete: jest.fn()
  };
  return {
    GeoJSONCacheService: {
      getInstance: () => cache
    }
  };
});

const createStore = () =>
  configureStore({
    reducer: {
      overlay: overlayReducer,
      settings: settingsReducer,
      jobs: jobsReducer,
      imagery: imageryReducer
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: true,
        serializableCheck: false
      }).concat(fetchDataMiddleware)
  });

function seedLayer(
  store: ReturnType<typeof createStore>,
  id: string,
  opts: { source?: string; jobId?: string } = {}
) {
  store.dispatch(
    addLayer({
      id,
      name: `Layer ${id}`,
      source: (opts.source || "detection") as "detection",
      zIndex: 0,
      featureCount: 5,
      metadata: opts.jobId ? { jobId: opts.jobId } : undefined
    })
  );
}

function makeJob(jobId: string): ImageProcessingJob {
  return {
    job_id: jobId,
    status: "SUCCESS",
    updated_at: new Date().toISOString(),
    job_name: `Job ${jobId}`
  };
}

// ─── list_overlay_layers ──────────────────────────────────────────────────────

describe("listLayersTool", () => {
  it("should return empty list when no layers exist", () => {
    const store = createStore();
    const result = listLayersTool.handler({}, store) as { layer_count: number };
    expect(result.layer_count).toBe(0);
  });

  it("should list all layers with metadata", () => {
    const store = createStore();
    seedLayer(store, "layer-1");
    seedLayer(store, "layer-2");

    const result = listLayersTool.handler({}, store) as {
      layer_count: number;
      layers: Array<{ id: string; name: string }>;
    };
    expect(result.layer_count).toBe(2);
    expect(result.layers[0].id).toBe("layer-1");
  });

  it("should filter by source", () => {
    const store = createStore();
    seedLayer(store, "det-1", { source: "detection" });
    seedLayer(store, "agent-1", { source: "agent" });

    const result = listLayersTool.handler({ source: "agent" }, store) as {
      layer_count: number;
    };
    expect(result.layer_count).toBe(1);
  });
});

// ─── set_job_visibility ───────────────────────────────────────────────────────

describe("setJobVisibilityTool", () => {
  /**
   * Seed the jobs list so the tool can find the job to toggle.
   */
  function seedJob(
    store: ReturnType<typeof createStore>,
    job: ImageProcessingJob
  ) {
    store.dispatch({
      type: "jobs/fetchJobs/fulfilled",
      payload: { jobs: [job], isManualRefresh: false }
    });
  }

  it("adds the job to selection when visible=true", () => {
    const store = createStore();
    const job = makeJob("j1");
    seedJob(store, job);

    const result = setJobVisibilityTool.handler(
      { job_id: "j1", visible: true },
      store
    ) as { success: boolean; visible: boolean };

    expect(result.success).toBe(true);
    expect(result.visible).toBe(true);
    expect(
      store.getState().jobs.selection.selectedJobs.map((j) => j.job_id)
    ).toContain("j1");
  });

  it("removes the job from selection when visible=false", () => {
    const store = createStore();
    const job = makeJob("j1");
    seedJob(store, job);

    // First select
    setJobVisibilityTool.handler({ job_id: "j1", visible: true }, store);
    // Then deselect
    const result = setJobVisibilityTool.handler(
      { job_id: "j1", visible: false },
      store
    ) as { success: boolean; visible: boolean };

    expect(result.success).toBe(true);
    expect(result.visible).toBe(false);
    expect(
      store.getState().jobs.selection.selectedJobs.map((j) => j.job_id)
    ).not.toContain("j1");
  });

  it("is a no-op when the job is already in the requested state", () => {
    const store = createStore();
    const job = makeJob("j1");
    seedJob(store, job);

    // Job starts deselected; asking for visible=false should succeed as no-op
    const result = setJobVisibilityTool.handler(
      { job_id: "j1", visible: false },
      store
    ) as { success: boolean; message: string };

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/already/);
  });

  it("errors for an unknown job_id", () => {
    const store = createStore();

    const result = setJobVisibilityTool.handler(
      { job_id: "unknown", visible: true },
      store
    ) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it("includes auto_zoom_enabled in the response", () => {
    const store = createStore();
    const job = makeJob("j1");
    seedJob(store, job);

    const result = setJobVisibilityTool.handler(
      { job_id: "j1", visible: true },
      store
    ) as { auto_zoom_enabled: boolean };

    expect(typeof result.auto_zoom_enabled).toBe("boolean");
  });
});

// ─── reorder_layers ───────────────────────────────────────────────────────────

describe("reorderLayersTool", () => {
  it("reorders layers", () => {
    const store = createStore();
    seedLayer(store, "a");
    seedLayer(store, "b");

    const result = reorderLayersTool.handler(
      { layer_order: ["b", "a"] },
      store
    ) as { success: boolean; layer_order: string[] };

    expect(result.success).toBe(true);
    expect(result.layer_order).toEqual(["b", "a"]);
  });

  it("errors for unknown layer IDs", () => {
    const store = createStore();
    seedLayer(store, "a");

    const result = reorderLayersTool.handler(
      { layer_order: ["a", "nonexistent"] },
      store
    ) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("nonexistent");
  });
});

// ─── style_layer ──────────────────────────────────────────────────────────────

describe("styleLayerTool", () => {
  it("updates jobs-slice per-job style for detection layers", () => {
    const store = createStore();
    seedLayer(store, "detection-job-1", { jobId: "job-1" });

    const result = styleLayerTool.handler(
      { layer_id: "detection-job-1", color: "#ff0000", opacity: 0.5 },
      store
    ) as { success: boolean; applied_style: Record<string, unknown> };

    expect(result.success).toBe(true);
    expect(result.applied_style).toEqual({ color: "#ff0000", opacity: 0.5 });
    expect(store.getState().jobs.selection.layerStyles["job-1"]).toEqual({
      color: "#ff0000",
      opacity: 0.5
    });
  });

  it("preserves existing opacity when only color is provided for a detection layer with an existing style", () => {
    const store = createStore();
    seedLayer(store, "detection-job-2", { jobId: "job-2" });
    // Seed an existing style via jobs-slice
    store.dispatch({
      type: "jobs/setLayerStyle",
      payload: { jobId: "job-2", style: { color: "#00ff00", opacity: 0.7 } }
    });

    const result = styleLayerTool.handler(
      { layer_id: "detection-job-2", color: "#ff0000" },
      store
    ) as { success: boolean; applied_style: Record<string, unknown> };

    expect(result.success).toBe(true);
    expect(result.applied_style).toEqual({ color: "#ff0000", opacity: 0.7 });
  });

  it("errors when styling a detection layer with no existing style and incomplete args", () => {
    const store = createStore();
    seedLayer(store, "detection-job-3", { jobId: "job-3" });

    const result = styleLayerTool.handler(
      { layer_id: "detection-job-3", color: "#ff0000" },
      store
    ) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/existing style/i);
  });

  it("updates overlay FeatureStyle for non-detection layers", () => {
    const store = createStore();
    seedLayer(store, "agent-features", { source: "agent" });

    const result = styleLayerTool.handler(
      {
        layer_id: "agent-features",
        color: "#ff0000",
        opacity: 0.5,
        fill_color: "#00ff00",
        weight: 2
      },
      store
    ) as { success: boolean; applied_style: Record<string, unknown> };

    expect(result.success).toBe(true);
    expect(result.applied_style).toEqual({
      color: "#ff0000",
      opacity: 0.5,
      fillColor: "#00ff00",
      weight: 2
    });
    expect(store.getState().overlay.layers["agent-features"].style).toEqual({
      color: "#ff0000",
      opacity: 0.5,
      fillColor: "#00ff00",
      weight: 2
    });
  });

  it("errors when no style properties are provided for a non-detection layer", () => {
    const store = createStore();
    seedLayer(store, "agent-features", { source: "agent" });

    const result = styleLayerTool.handler(
      { layer_id: "agent-features" },
      store
    ) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("No style properties");
  });

  it("errors for a non-existent layer", () => {
    const store = createStore();
    const result = styleLayerTool.handler(
      { layer_id: "nope", color: "red" },
      store
    ) as { success: boolean };

    expect(result.success).toBe(false);
  });
});
