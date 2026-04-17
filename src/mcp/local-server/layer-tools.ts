// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Layer Management MCP Tools
 *
 * Provides tools for the AI agent to manage overlay layers on the map/globe:
 * list, show/hide, reorder, and restyle detection and feature layers.
 *
 * All tools operate on the unified overlay slice in Redux, which both
 * OpenLayers (map) and Cesium (globe) consume for rendering.
 */

import { Store } from "@reduxjs/toolkit";

import {
  type FeatureStyle,
  setGroupVisibility,
  setLayerOrder,
  setLayerStyle as setOverlayLayerStyle,
  setLayerVisibility,
  toggleLayerVisibility
} from "@/store/slices/overlay-slice";
import { selectAutoZoom } from "@/store/slices/settings-slice";
import { RootState } from "@/store/store";

import { LocalMcpTool, ToolArgs } from "./types";

// ─── Response interfaces ─────────────────────────────────────────────────────

interface LayerInfo {
  id: string;
  name: string;
  source: string;
  visible: boolean;
  z_index: number;
  feature_count: number;
  group_id?: string;
  loading?: boolean;
  error?: string;
}

// ─── Tool 1: List all overlay layers ─────────────────────────────────────────

export const listLayersTool: LocalMcpTool = {
  name: "list_overlay_layers",
  description:
    "List all overlay layers currently registered on the map/globe, including detection result layers, STAC catalog layers, and agent-drawn features. Returns each layer's visibility state, feature count, and style.",
  schema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        enum: ["detection", "agent", "user", "stac-catalog"],
        description:
          "Optional filter by layer source type. Omit to list all layers."
      },
      visible_only: {
        type: "boolean",
        default: false,
        description: "If true, only return currently visible layers."
      }
    },
    additionalProperties: false
  },
  handler: (
    args: { source?: string; visible_only?: boolean },
    store: Store
  ) => {
    const state = store.getState() as RootState;
    const { layers, layerOrder } = state.overlay;

    // Build ordered list
    const orderedLayers: LayerInfo[] = layerOrder
      .map((id) => layers[id])
      .filter((layer) => !!layer)
      .filter((layer) => !args.source || layer.source === args.source)
      .filter((layer) => !args.visible_only || layer.visible)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        source: layer.source,
        visible: layer.visible,
        z_index: layer.zIndex,
        feature_count: layer.featureCount,
        group_id: layer.metadata?.groupId,
        loading: layer.metadata?.loading || undefined,
        error: layer.metadata?.error || undefined
      }));

    return {
      success: true,
      layer_count: orderedLayers.length,
      layers: orderedLayers,
      message: `Found ${orderedLayers.length} layer(s)${args.source ? ` with source '${args.source}'` : ""}`
    };
  }
};

// ─── Tool 2: Show or hide a layer ────────────────────────────────────────────

export const setLayerVisibilityTool: LocalMcpTool = {
  name: "set_layer_visibility",
  description:
    "Show or hide a specific overlay layer on the map/globe. Use list_overlay_layers first to discover available layer IDs. When auto-zoom is enabled (default), the map automatically zooms to a layer when it becomes visible — there is no need to call zoom_to_location separately. Check the auto_zoom_enabled field in the response.",
  schema: {
    type: "object",
    properties: {
      layer_id: {
        type: "string",
        description:
          "The layer ID to show/hide (e.g. 'detection-<job_id>' or 'agent-features')"
      },
      visible: {
        type: "boolean",
        description: "true to show the layer, false to hide it"
      }
    },
    required: ["layer_id", "visible"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { layer_id, visible } = args as {
      layer_id: string;
      visible: boolean;
    };
    const state = store.getState() as RootState;
    const layer = state.overlay.layers[layer_id];

    if (!layer) {
      return {
        success: false,
        error: `Layer not found: ${layer_id}`,
        message: "Use list_overlay_layers to see available layers"
      };
    }

    store.dispatch(setLayerVisibility({ layerId: layer_id, visible: visible }));

    const autoZoom = selectAutoZoom(store.getState() as RootState);

    return {
      success: true,
      layer_id: layer_id,
      visible: visible,
      auto_zoom_enabled: autoZoom,
      message: `Layer '${layer.name}' is now ${visible ? "visible" : "hidden"}`
    };
  }
};

// ─── Tool 3: Toggle a layer's visibility ─────────────────────────────────────

export const toggleLayerVisibilityTool: LocalMcpTool = {
  name: "toggle_layer_visibility",
  description:
    "Toggle the visibility of a specific overlay layer. If it's visible it becomes hidden, and vice versa. When auto-zoom is enabled (default), the map automatically zooms to a layer when it becomes visible — there is no need to call zoom_to_location separately. Check the auto_zoom_enabled field in the response.",
  schema: {
    type: "object",
    properties: {
      layer_id: {
        type: "string",
        description: "The layer ID to toggle"
      }
    },
    required: ["layer_id"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { layer_id } = args as { layer_id: string };
    const state = store.getState() as RootState;
    const layer = state.overlay.layers[layer_id];

    if (!layer) {
      return {
        success: false,
        error: `Layer not found: ${layer_id}`,
        message: "Use list_overlay_layers to see available layers"
      };
    }

    store.dispatch(toggleLayerVisibility(layer_id));

    const newVisible = !layer.visible;
    const autoZoom = selectAutoZoom(store.getState() as RootState);

    return {
      success: true,
      layer_id: layer_id,
      visible: newVisible,
      auto_zoom_enabled: autoZoom,
      message: `Layer '${layer.name}' is now ${newVisible ? "visible" : "hidden"}`
    };
  }
};

// ─── Tool 4: Show/hide all layers in a group ────────────────────────────────

export const setGroupVisibilityTool: LocalMcpTool = {
  name: "set_group_visibility",
  description:
    "Show or hide all layers belonging to a group (e.g. all layers for a specific job). Detection layers use group IDs like 'job-<job_id>'. When auto-zoom is enabled (default), the map automatically zooms to layers when they become visible — there is no need to call zoom_to_location separately. Check the auto_zoom_enabled field in the response.",
  schema: {
    type: "object",
    properties: {
      group_id: {
        type: "string",
        description: "The group ID (e.g. 'job-<job_id>' for detection layers)"
      },
      visible: {
        type: "boolean",
        description: "true to show all layers in the group, false to hide them"
      }
    },
    required: ["group_id", "visible"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { group_id, visible } = args as {
      group_id: string;
      visible: boolean;
    };
    store.dispatch(setGroupVisibility({ groupId: group_id, visible: visible }));

    // Count affected layers
    const state = store.getState() as RootState;
    const affected = Object.values(state.overlay.layers).filter(
      (l) => l.metadata?.groupId === group_id
    );
    const autoZoom = selectAutoZoom(state);

    return {
      success: true,
      group_id: group_id,
      visible: visible,
      affected_layers: affected.length,
      auto_zoom_enabled: autoZoom,
      message: `${affected.length} layer(s) in group '${group_id}' are now ${visible ? "visible" : "hidden"}`
    };
  }
};

// ─── Tool 5: Reorder layers ─────────────────────────────────────────────────

export const reorderLayersTool: LocalMcpTool = {
  name: "reorder_layers",
  description:
    "Set the draw order of overlay layers. Layers later in the array render on top. Use list_overlay_layers to get current IDs and order.",
  schema: {
    type: "object",
    properties: {
      layer_order: {
        type: "array",
        items: { type: "string" },
        description: "Ordered array of layer IDs. First = bottom, last = top."
      }
    },
    required: ["layer_order"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { layer_order } = args as { layer_order: string[] };
    const state = store.getState() as RootState;

    // Validate all IDs exist
    const missing = layer_order.filter((id) => !state.overlay.layers[id]);
    if (missing.length > 0) {
      return {
        success: false,
        error: `Unknown layer IDs: ${missing.join(", ")}`,
        message: "Use list_overlay_layers to see available layers"
      };
    }

    store.dispatch(setLayerOrder(layer_order));

    return {
      success: true,
      layer_order: layer_order,
      message: `Layer order updated (${layer_order.length} layers)`
    };
  }
};

// ─── Tool 6: Style a layer ──────────────────────────────────────────────────

export const styleLayerTool: LocalMcpTool = {
  name: "style_layer",
  description:
    "Change the visual style (color, opacity, weight, etc.) of an overlay layer.",
  schema: {
    type: "object",
    properties: {
      layer_id: {
        type: "string",
        description: "The layer ID to restyle"
      },
      color: {
        type: "string",
        description:
          "Stroke/outline color as a CSS color string (e.g. '#ff0000', 'red')"
      },
      fill_color: {
        type: "string",
        description: "Fill color as a CSS color string"
      },
      opacity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Stroke opacity (0-1)"
      },
      fill_opacity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Fill opacity (0-1)"
      },
      weight: {
        type: "number",
        minimum: 0,
        description: "Stroke width in pixels"
      }
    },
    required: ["layer_id"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { layer_id, color, fill_color, opacity, fill_opacity, weight } =
      args as {
        layer_id: string;
        color?: string;
        fill_color?: string;
        opacity?: number;
        fill_opacity?: number;
        weight?: number;
      };
    const state = store.getState() as RootState;
    const layer = state.overlay.layers[layer_id];

    if (!layer) {
      return {
        success: false,
        error: `Layer not found: ${layer_id}`,
        message: "Use list_overlay_layers to see available layers"
      };
    }

    const style: Partial<FeatureStyle> = {};
    if (color !== undefined) style.color = color;
    if (fill_color !== undefined) style.fillColor = fill_color;
    if (opacity !== undefined) style.opacity = opacity;
    if (fill_opacity !== undefined) style.fillOpacity = fill_opacity;
    if (weight !== undefined) style.weight = weight;

    if (Object.keys(style).length === 0) {
      return {
        success: false,
        error: "No style properties provided",
        message:
          "Provide at least one of: color, fill_color, opacity, fill_opacity, weight"
      };
    }

    store.dispatch(setOverlayLayerStyle({ layerId: layer_id, style }));

    return {
      success: true,
      layer_id: layer_id,
      applied_style: style,
      message: `Style updated for layer '${layer.name}'`
    };
  }
};
