// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for the shared auto-zoom helpers used by the map and globe views.
 *
 * These helpers govern WHEN auto-zoom fires: the view should zoom to a
 * job's detection extent only when its overlay data has finished loading,
 * not when the loading-state record first appears. The diff against the
 * previous render's loaded set is what determines "newly ready."
 */

import type { OverlayLayer } from "@/store/slices/overlay-slice";
import {
  computeLoadedDetectionJobIds,
  diffNewlyLoaded
} from "@/utils/auto-zoom";

function makeDetectionLayer(
  jobId: string,
  overrides: {
    loading?: boolean;
    error?: string;
    source?: OverlayLayer["source"];
  } = {}
): OverlayLayer {
  return {
    id: `detection-${jobId}`,
    name: `Detection: ${jobId}`,
    source: overrides.source ?? "detection",
    zIndex: 10,
    featureCount: 0,
    metadata: {
      jobId,
      layerType: "vector",
      loading: overrides.loading,
      error: overrides.error
    }
  };
}

describe("computeLoadedDetectionJobIds", () => {
  it("returns empty set for no layers", () => {
    expect(computeLoadedDetectionJobIds({})).toEqual(new Set());
  });

  it("excludes detection layers that are still loading", () => {
    const layer = makeDetectionLayer("job-1", { loading: true });
    const result = computeLoadedDetectionJobIds({
      "detection-job-1": layer
    });
    expect(result).toEqual(new Set());
  });

  it("excludes detection layers with errors", () => {
    const layer = makeDetectionLayer("job-1", {
      loading: false,
      error: "boom"
    });
    const result = computeLoadedDetectionJobIds({
      "detection-job-1": layer
    });
    expect(result).toEqual(new Set());
  });

  it("includes detection layers that are loaded and error-free", () => {
    const layer = makeDetectionLayer("job-1", { loading: false });
    const result = computeLoadedDetectionJobIds({
      "detection-job-1": layer
    });
    expect(result).toEqual(new Set(["job-1"]));
  });

  it("does not include non-detection layers", () => {
    const layer = makeDetectionLayer("job-1", {
      loading: false,
      source: "agent"
    });
    const result = computeLoadedDetectionJobIds({
      "detection-job-1": layer
    });
    expect(result).toEqual(new Set());
  });

  it("does not include imagery layers (they share source=detection)", () => {
    // The imagery tile layer uses `source: "detection"` today but has
    // `metadata.layerType === "imagery"`. It must NOT be treated as a
    // loaded detection (vector) layer, otherwise auto-zoom will think the
    // job is ready to zoom before the detection data actually loads.
    const imageryLayer: OverlayLayer = {
      id: "imagery-job-1",
      name: "Imagery: job-1",
      source: "detection", // shared source type
      zIndex: 5,
      featureCount: 0,
      metadata: { jobId: "job-1", layerType: "imagery" }
    };
    const result = computeLoadedDetectionJobIds({
      "imagery-job-1": imageryLayer
    });
    expect(result).toEqual(new Set());
  });

  it("only counts the vector detection layer when both imagery and detection exist", () => {
    // While the detection layer is still loading, an imagery-layer record
    // may already be present. The filter must still report empty so that
    // auto-zoom waits for the vector data.
    const imageryLayer: OverlayLayer = {
      id: "imagery-job-1",
      name: "Imagery: job-1",
      source: "detection",
      zIndex: 5,
      featureCount: 0,
      metadata: { jobId: "job-1", layerType: "imagery" }
    };
    const loadingDetection = makeDetectionLayer("job-1", { loading: true });
    const result = computeLoadedDetectionJobIds({
      "imagery-job-1": imageryLayer,
      "detection-job-1": loadingDetection
    });
    expect(result).toEqual(new Set());
  });

  it("does not include layers without a jobId in metadata", () => {
    const layer: OverlayLayer = {
      id: "detection-orphan",
      name: "Detection: orphan",
      source: "detection",
      zIndex: 10,
      featureCount: 0
      // No metadata
    };
    const result = computeLoadedDetectionJobIds({
      "detection-orphan": layer
    });
    expect(result).toEqual(new Set());
  });

  it("handles a mix of loading and loaded layers", () => {
    const layers: Record<string, OverlayLayer> = {
      "detection-a": makeDetectionLayer("a", { loading: true }),
      "detection-b": makeDetectionLayer("b", { loading: false }),
      "detection-c": makeDetectionLayer("c", {
        loading: false,
        error: "failed"
      }),
      "detection-d": makeDetectionLayer("d", { loading: false })
    };
    const result = computeLoadedDetectionJobIds(layers);
    expect(result).toEqual(new Set(["b", "d"]));
  });
});

describe("diffNewlyLoaded", () => {
  it("returns empty set when both sets are empty", () => {
    expect(diffNewlyLoaded(new Set(), new Set())).toEqual(new Set());
  });

  it("returns the current set when previous is empty", () => {
    expect(diffNewlyLoaded(new Set(["a", "b"]), new Set())).toEqual(
      new Set(["a", "b"])
    );
  });

  it("returns empty when nothing changed", () => {
    expect(diffNewlyLoaded(new Set(["a", "b"]), new Set(["a", "b"]))).toEqual(
      new Set()
    );
  });

  it("returns only the newly added IDs", () => {
    expect(diffNewlyLoaded(new Set(["a", "b"]), new Set(["a"]))).toEqual(
      new Set(["b"])
    );
  });

  it("does NOT return IDs that were removed from the current set", () => {
    // Jobs that left the current set are not "newly loaded" — they are
    // gone. The diff only reports IDs present now but not before.
    expect(diffNewlyLoaded(new Set(["a"]), new Set(["a", "b"]))).toEqual(
      new Set()
    );
  });
});

/**
 * End-to-end scenario: first-toggle auto-zoom after the fix.
 *
 * Before the fix, the loading-state render would mark a job as "seen" in
 * the prev ref, so the subsequent loaded-state render would compute an
 * empty diff and skip the zoom. This test locks in the post-fix behaviour:
 * the prev ref tracks only loaded jobs, so the transition loading→loaded
 * surfaces the job as newly ready.
 */
describe("first-toggle auto-zoom scenario", () => {
  it("produces a non-empty newlyVisible set on the loaded render, not the loading render", () => {
    // Render 1: user just clicked show. Overlay has detection-job-1 with
    // loading: true.
    const loadingLayers: Record<string, OverlayLayer> = {
      "detection-job-1": makeDetectionLayer("job-1", { loading: true })
    };
    let prev = new Set<string>();

    const loadedR1 = computeLoadedDetectionJobIds(loadingLayers);
    const newlyR1 = diffNewlyLoaded(loadedR1, prev);
    expect(loadedR1).toEqual(new Set());
    expect(newlyR1).toEqual(new Set());
    prev = loadedR1;

    // Render 2: STAC completed. Overlay has detection-job-1 with
    // loading: false.
    const loadedLayers: Record<string, OverlayLayer> = {
      "detection-job-1": makeDetectionLayer("job-1", { loading: false })
    };

    const loadedR2 = computeLoadedDetectionJobIds(loadedLayers);
    const newlyR2 = diffNewlyLoaded(loadedR2, prev);
    expect(loadedR2).toEqual(new Set(["job-1"]));
    expect(newlyR2).toEqual(new Set(["job-1"]));
  });

  it("cache-hit fast path fires newlyVisible on render 1 (layer enters already loaded)", () => {
    // When the cache already has data, fetchGeoJSONData dispatches addLayer
    // with loading:false directly — so the first render after the toggle
    // sees the layer as already loaded. Auto-zoom must fire immediately.
    const layers: Record<string, OverlayLayer> = {
      "detection-job-1": makeDetectionLayer("job-1", { loading: false })
    };
    const prev = new Set<string>();

    const loaded = computeLoadedDetectionJobIds(layers);
    const newly = diffNewlyLoaded(loaded, prev);
    expect(newly).toEqual(new Set(["job-1"]));
  });

  it("toggling off then on (cache preserved) still fires auto-zoom on the second show", () => {
    // Initial state: job is loaded and visible.
    let prev = new Set<string>(["job-1"]);

    // User hides the job — middleware removes the overlay record.
    const hiddenLayers: Record<string, OverlayLayer> = {};
    const loadedHidden = computeLoadedDetectionJobIds(hiddenLayers);
    const newlyHidden = diffNewlyLoaded(loadedHidden, prev);
    expect(loadedHidden).toEqual(new Set());
    expect(newlyHidden).toEqual(new Set());
    prev = loadedHidden;

    // User shows again — cache hit means fetchGeoJSONData re-adds the
    // overlay record immediately in loaded state.
    const shownLayers: Record<string, OverlayLayer> = {
      "detection-job-1": makeDetectionLayer("job-1", { loading: false })
    };
    const loadedShown = computeLoadedDetectionJobIds(shownLayers);
    const newlyShown = diffNewlyLoaded(loadedShown, prev);
    expect(newlyShown).toEqual(new Set(["job-1"]));
  });
});
