// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for layer-tools.ts.
 * Covers list, show/hide, toggle, group visibility, reorder, and style tools.
 */

import { configureStore } from "@reduxjs/toolkit";

import {
  listLayersTool,
  reorderLayersTool,
  setGroupVisibilityTool,
  setLayerVisibilityTool,
  styleLayerTool,
  toggleLayerVisibilityTool
} from "@/mcp/local-server/layer-tools";
import overlayReducer, { addLayer } from "@/store/slices/overlay-slice";
import settingsReducer from "@/store/slices/settings-slice";

const createStore = () =>
  configureStore({
    reducer: {
      overlay: overlayReducer,
      settings: settingsReducer
    }
  });

function seedLayer(
  store: ReturnType<typeof createStore>,
  id: string,
  opts: { source?: string; visible?: boolean; groupId?: string } = {}
) {
  store.dispatch(
    addLayer({
      id,
      name: `Layer ${id}`,
      source: (opts.source || "detection") as "detection",
      visible: opts.visible ?? true,
      zIndex: 0,
      featureCount: 5,
      metadata: opts.groupId ? { groupId: opts.groupId } : undefined
    })
  );
}

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

  it("should filter by visible_only", () => {
    const store = createStore();
    seedLayer(store, "vis", { visible: true });
    seedLayer(store, "hid", { visible: false });

    const result = listLayersTool.handler({ visible_only: true }, store) as {
      layer_count: number;
    };
    expect(result.layer_count).toBe(1);
  });
});

describe("setLayerVisibilityTool", () => {
  it("should set layer visibility", () => {
    const store = createStore();
    seedLayer(store, "layer-1", { visible: true });

    const result = setLayerVisibilityTool.handler(
      { layer_id: "layer-1", visible: false },
      store
    ) as { success: boolean; visible: boolean };

    expect(result.success).toBe(true);
    expect(result.visible).toBe(false);
  });

  it("should return error for non-existent layer", () => {
    const store = createStore();
    const result = setLayerVisibilityTool.handler(
      { layer_id: "nope", visible: true },
      store
    ) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("should include auto_zoom_enabled in response", () => {
    const store = createStore();
    seedLayer(store, "layer-1");

    const result = setLayerVisibilityTool.handler(
      { layer_id: "layer-1", visible: true },
      store
    ) as { auto_zoom_enabled: boolean };

    expect(typeof result.auto_zoom_enabled).toBe("boolean");
  });
});

describe("toggleLayerVisibilityTool", () => {
  it("should toggle from visible to hidden", () => {
    const store = createStore();
    seedLayer(store, "layer-1", { visible: true });

    const result = toggleLayerVisibilityTool.handler(
      { layer_id: "layer-1" },
      store
    ) as { visible: boolean };

    expect(result.visible).toBe(false);
  });

  it("should toggle from hidden to visible", () => {
    const store = createStore();
    seedLayer(store, "layer-1", { visible: false });

    const result = toggleLayerVisibilityTool.handler(
      { layer_id: "layer-1" },
      store
    ) as { visible: boolean };

    expect(result.visible).toBe(true);
  });

  it("should return error for non-existent layer", () => {
    const store = createStore();
    const result = toggleLayerVisibilityTool.handler(
      { layer_id: "nope" },
      store
    ) as { success: boolean };

    expect(result.success).toBe(false);
  });
});

describe("setGroupVisibilityTool", () => {
  it("should set visibility for all layers in a group", () => {
    const store = createStore();
    seedLayer(store, "det-1", { groupId: "job-123", visible: true });
    seedLayer(store, "det-2", { groupId: "job-123", visible: true });
    seedLayer(store, "other", { groupId: "job-456", visible: true });

    const result = setGroupVisibilityTool.handler(
      { group_id: "job-123", visible: false },
      store
    ) as { affected_layers: number };

    expect(result.affected_layers).toBe(2);
  });
});

describe("reorderLayersTool", () => {
  it("should reorder layers", () => {
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

  it("should return error for unknown layer IDs", () => {
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

describe("styleLayerTool", () => {
  it("should apply style to a layer", () => {
    const store = createStore();
    seedLayer(store, "layer-1");

    const result = styleLayerTool.handler(
      { layer_id: "layer-1", color: "#ff0000", opacity: 0.5 },
      store
    ) as { success: boolean; applied_style: Record<string, unknown> };

    expect(result.success).toBe(true);
    expect(result.applied_style).toEqual({ color: "#ff0000", opacity: 0.5 });
  });

  it("should return error when no style properties provided", () => {
    const store = createStore();
    seedLayer(store, "layer-1");

    const result = styleLayerTool.handler({ layer_id: "layer-1" }, store) as {
      success: boolean;
      error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain("No style properties");
  });

  it("should return error for non-existent layer", () => {
    const store = createStore();
    const result = styleLayerTool.handler(
      { layer_id: "nope", color: "red" },
      store
    ) as { success: boolean };

    expect(result.success).toBe(false);
  });
});
