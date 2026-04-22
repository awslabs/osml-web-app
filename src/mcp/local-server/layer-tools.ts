// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Layer Management MCP Tools
 *
 * Provides tools for the AI agent to manage overlay layers on the map/globe.
 * The tools mirror the user-facing sidebar surface exactly: jobs are
 * selected/deselected (which causes their detection and imagery layers to
 * appear/disappear via the jobs-slice middleware), layer render order can
 * be adjusted, and per-job detection styles can be changed.
 *
 * There is intentionally no tool for flipping an individual layer's
 * visibility — the sidebar has no such affordance, so neither should the
 * agent.
 */

import { Store } from "@reduxjs/toolkit";

import {
  selectIsJobSelected,
  selectSelectedJobs,
  setLayerStyle as setJobLayerStyle,
  setSelectedJobs
} from "@/store/slices/jobs-slice";
import {
  type FeatureStyle,
  setLayerOrder,
  setLayerStyle as setOverlayLayerStyle
} from "@/store/slices/overlay-slice";
import { selectAutoZoom } from "@/store/slices/settings-slice";
import { RootState } from "@/store/store";

import { LocalMcpTool, ToolArgs } from "./types";

// ─── Response interfaces ─────────────────────────────────────────────────────

interface LayerInfo {
  id: string;
  name: string;
  source: string;
  z_index: number;
  feature_count: number;
  job_id?: string;
  layer_type?: string;
  loading?: boolean;
  error?: string;
}

// ─── Tool 1: List all overlay layers ─────────────────────────────────────────

export const listLayersTool: LocalMcpTool = {
  name: "list_overlay_layers",
  description:
    "List all overlay layers currently rendered on the map/globe, including detection result layers, agent-drawn features, and STAC references. Each entry is a layer that is actively being rendered — layers only exist in this list while their underlying data is selected or drawn.",
  schema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        enum: ["detection", "agent", "user", "stac-catalog"],
        description:
          "Optional filter by layer source type. Omit to list all layers."
      }
    },
    additionalProperties: false
  },
  handler: (args: { source?: string }, store: Store) => {
    const state = store.getState() as RootState;
    const { layers, layerOrder } = state.overlay;

    // Build ordered list
    const orderedLayers: LayerInfo[] = layerOrder
      .map((id) => layers[id])
      .filter((layer) => !!layer)
      .filter((layer) => !args.source || layer.source === args.source)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        source: layer.source,
        z_index: layer.zIndex,
        feature_count: layer.featureCount,
        job_id: layer.metadata?.jobId,
        layer_type: layer.metadata?.layerType,
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

// ─── Tool 2: Show or hide a job's layers ────────────────────────────────────

export const setJobVisibilityTool: LocalMcpTool = {
  name: "set_job_visibility",
  description:
    "Show or hide all layers for an image processing job. This is the agent equivalent of clicking the show/hide button next to a job in the sidebar: selecting the job causes its detection results and imagery to render on both the map and globe; deselecting it removes them. When auto-zoom is enabled (default) and a job becomes visible, the map/globe automatically zooms to it — there is no need to call zoom_to_location separately. Check the auto_zoom_enabled field in the response.",
  schema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description:
          "The image processing job ID to show or hide. Use list_image_processing_jobs to discover available job IDs."
      },
      visible: {
        type: "boolean",
        description:
          "true to show the job's detection and imagery layers, false to hide them."
      }
    },
    required: ["job_id", "visible"],
    additionalProperties: false
  },
  handler: (args: ToolArgs, store: Store) => {
    const { job_id, visible } = args as {
      job_id: string;
      visible: boolean;
    };
    const state = store.getState() as RootState;
    const job = state.jobs.jobsList.jobs.find((j) => j.job_id === job_id);

    if (!job) {
      return {
        success: false,
        error: `Job not found: ${job_id}`,
        message:
          "Use list_image_processing_jobs to see available job IDs, or wait for the job to finish processing."
      };
    }

    const wasSelected = selectIsJobSelected(state, job_id);

    // No-op if already in the requested state — keep response honest.
    if (wasSelected === visible) {
      const autoZoom = selectAutoZoom(state);
      return {
        success: true,
        job_id,
        visible,
        auto_zoom_enabled: autoZoom,
        message: `Job '${job.job_name || job_id}' was already ${visible ? "visible" : "hidden"}`
      };
    }

    const currentSelection = selectSelectedJobs(state);
    const nextSelection = visible
      ? [...currentSelection, job]
      : currentSelection.filter((j) => j.job_id !== job_id);

    store.dispatch(setSelectedJobs(nextSelection));

    const autoZoom = selectAutoZoom(store.getState() as RootState);

    return {
      success: true,
      job_id,
      visible,
      auto_zoom_enabled: autoZoom,
      message: `Job '${job.job_name || job_id}' is now ${visible ? "visible" : "hidden"}`
    };
  }
};

// ─── Tool 3: Reorder layers ─────────────────────────────────────────────────

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

// ─── Tool 4: Style a layer ──────────────────────────────────────────────────

/**
 * For detection layers (`detection-<jobId>`), styling is a per-job concept
 * stored in `jobs.selection.layerStyles` and applied by the map/globe
 * renderers when drawing features. We dispatch to jobs-slice for these so
 * that the style persists across deselect/reselect (matching the sidebar's
 * per-job color control).
 *
 * For agent features (`agent-features`), styling is a layer-level
 * FeatureStyle stored in overlay-slice.
 */
export const styleLayerTool: LocalMcpTool = {
  name: "style_layer",
  description:
    "Change the visual style of an overlay layer. For detection layers (ID format 'detection-<job_id>'), this updates the per-job color and opacity — equivalent to adjusting the color picker next to a job in the sidebar. For agent-drawn feature layers, this updates the layer-wide FeatureStyle.",
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
        description:
          "Fill color (agent features only; ignored for detection layers)"
      },
      opacity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Opacity (0-1)"
      },
      fill_opacity: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Fill opacity (agent features only; ignored for detection layers)"
      },
      weight: {
        type: "number",
        minimum: 0,
        description:
          "Stroke width in pixels (agent features only; ignored for detection layers)"
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
        message:
          "Use list_overlay_layers to see available layers. Detection and imagery layers only exist while their job is selected (use set_job_visibility to make them visible first)."
      };
    }

    // Detection layers use per-job styling in jobs-slice
    const detectionMatch = /^detection-(.+)$/.exec(layer_id);
    if (detectionMatch) {
      const jobId = detectionMatch[1];
      const existingStyle =
        state.jobs.selection.layerStyles[jobId] ?? undefined;

      const nextColor = color ?? existingStyle?.color;
      const nextOpacity = opacity ?? existingStyle?.opacity;

      if (nextColor === undefined || nextOpacity === undefined) {
        return {
          success: false,
          error:
            "Cannot style this detection layer: no existing style and no color/opacity provided",
          message:
            "Provide color and opacity for detection layers that have no existing style."
        };
      }

      store.dispatch(
        setJobLayerStyle({
          jobId,
          style: { color: nextColor, opacity: nextOpacity }
        })
      );

      return {
        success: true,
        layer_id,
        applied_style: { color: nextColor, opacity: nextOpacity },
        message: `Style updated for job '${jobId}' detection layer`
      };
    }

    // Non-detection layers (e.g. agent features) use FeatureStyle in overlay-slice
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
      layer_id,
      applied_style: style,
      message: `Style updated for layer '${layer.name}'`
    };
  }
};
