// Copyright Amazon.com, Inc. or its affiliates.
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Geometry } from "geojson";

// --- Types ---

export type LayerSource = "agent" | "user" | "detection" | "stac-catalog";

export interface FeatureStyle {
  color?: string;
  fillColor?: string;
  opacity?: number;
  fillOpacity?: number;
  weight?: number;
  radius?: number;
  marker?: string;
  icon?: string;
  iconScale?: number;
}

export type LayerType = "vector" | "imagery";

export interface LayerMetadata {
  jobId?: string;
  collectionId?: string;
  groupId?: string;
  loading?: boolean;
  error?: string;
  layerType?: LayerType;
}

export interface OverlayLayer {
  id: string;
  name: string;
  source: LayerSource;
  visible: boolean;
  zIndex: number;
  style?: FeatureStyle;
  featureCount: number;
  metadata?: LayerMetadata;
}

export interface GeoJSONFeature {
  type: "Feature";
  id: string;
  geometry: Geometry;
  properties: {
    description?: string;
    style?: FeatureStyle;
    createdBy: "agent" | "user";
    createdAt: string;
    stacUrl?: string;
    dataSource?: "stac_url" | "geometry";
    [key: string]: unknown;
  };
}

export interface OverlayState {
  layers: Record<string, OverlayLayer>;
  layerOrder: string[];
  inlineFeatures: Record<string, GeoJSONFeature[]>;
  selectedFeatureId?: string;
  lastUpdatedBy: "agent" | "user" | "initial";
}

// --- Initial State ---

const initialState: OverlayState = {
  layers: {},
  layerOrder: [],
  inlineFeatures: {},
  selectedFeatureId: undefined,
  lastUpdatedBy: "initial"
};

// --- Slice ---

export const overlaySlice = createSlice({
  name: "overlay",
  initialState,
  reducers: {
    // Layer management
    addLayer: (state, action: PayloadAction<OverlayLayer>) => {
      const layer = action.payload;
      state.layers[layer.id] = layer;
      if (!state.layerOrder.includes(layer.id)) {
        state.layerOrder.push(layer.id);
      }
    },

    removeLayer: (state, action: PayloadAction<string>) => {
      const layerId = action.payload;
      // If selectedFeatureId belonged to this layer's inline features, clear it
      const inlineFeats = state.inlineFeatures[layerId];
      if (inlineFeats && state.selectedFeatureId) {
        if (inlineFeats.some((f) => f.id === state.selectedFeatureId)) {
          state.selectedFeatureId = undefined;
        }
      }
      delete state.layers[layerId];
      state.layerOrder = state.layerOrder.filter((id) => id !== layerId);
      delete state.inlineFeatures[layerId];
    },

    updateLayerMetadata: (
      state,
      action: PayloadAction<{ layerId: string } & Partial<OverlayLayer>>
    ) => {
      const { layerId, metadata, ...rest } = action.payload;
      const layer = state.layers[layerId];
      if (!layer) return;

      // Merge top-level fields (name, featureCount, etc.)
      const fieldsToMerge = { ...rest } as Record<string, unknown>;
      delete fieldsToMerge.layerId;
      for (const [key, value] of Object.entries(fieldsToMerge)) {
        if (value !== undefined) {
          (layer as Record<string, unknown>)[key] = value;
        }
      }

      // Merge metadata into existing metadata (don't replace entirely)
      if (metadata) {
        layer.metadata = { ...layer.metadata, ...metadata };
      }
    },

    setLayerVisibility: (
      state,
      action: PayloadAction<{ layerId: string; visible: boolean }>
    ) => {
      const { layerId, visible } = action.payload;
      if (state.layers[layerId]) {
        state.layers[layerId].visible = visible;
      }
    },

    toggleLayerVisibility: (state, action: PayloadAction<string>) => {
      const layerId = action.payload;
      if (state.layers[layerId]) {
        state.layers[layerId].visible = !state.layers[layerId].visible;
      }
    },

    setGroupVisibility: (
      state,
      action: PayloadAction<{ groupId: string; visible: boolean }>
    ) => {
      const { groupId, visible } = action.payload;
      Object.values(state.layers).forEach((layer) => {
        if (layer.metadata?.groupId === groupId) {
          layer.visible = visible;
        }
      });
    },

    setLayerOrder: (state, action: PayloadAction<string[]>) => {
      state.layerOrder = action.payload;
    },

    setLayerStyle: (
      state,
      action: PayloadAction<{ layerId: string; style: FeatureStyle }>
    ) => {
      const { layerId, style } = action.payload;
      if (state.layers[layerId]) {
        state.layers[layerId].style = style;
      }
    },

    // Inline feature management (agent/user features)
    addFeature: (
      state,
      action: PayloadAction<{
        feature: GeoJSONFeature;
        updatedBy: "agent" | "user";
      }>
    ) => {
      const { feature, updatedBy } = action.payload;
      const AGENT_LAYER_ID = "agent-features";

      // Auto-create agent layer if it doesn't exist
      if (!state.layers[AGENT_LAYER_ID]) {
        state.layers[AGENT_LAYER_ID] = {
          id: AGENT_LAYER_ID,
          name: "Agent Features",
          source: "agent",
          visible: true,
          zIndex: 100,
          featureCount: 0
        };
        state.layerOrder.push(AGENT_LAYER_ID);
        state.inlineFeatures[AGENT_LAYER_ID] = [];
      }

      // Upsert feature
      const features = state.inlineFeatures[AGENT_LAYER_ID];
      const existingIndex = features.findIndex((f) => f.id === feature.id);
      if (existingIndex !== -1) {
        features[existingIndex] = feature;
      } else {
        features.push(feature);
      }

      // Update count
      state.layers[AGENT_LAYER_ID].featureCount = features.length;
      state.lastUpdatedBy = updatedBy;
    },

    removeFeature: (
      state,
      action: PayloadAction<{ featureId: string; updatedBy: "agent" | "user" }>
    ) => {
      const { featureId, updatedBy } = action.payload;
      const AGENT_LAYER_ID = "agent-features";
      const features = state.inlineFeatures[AGENT_LAYER_ID];
      if (!features) return;

      state.inlineFeatures[AGENT_LAYER_ID] = features.filter(
        (f) => f.id !== featureId
      );

      // Update featureCount
      if (state.layers[AGENT_LAYER_ID]) {
        state.layers[AGENT_LAYER_ID].featureCount =
          state.inlineFeatures[AGENT_LAYER_ID].length;
      }

      // Clear selectedFeatureId if it was the removed feature
      if (state.selectedFeatureId === featureId) {
        state.selectedFeatureId = undefined;
      }

      state.lastUpdatedBy = updatedBy;
    },

    clearAllFeatures: (
      state,
      action: PayloadAction<{ updatedBy: "agent" | "user" }>
    ) => {
      const AGENT_LAYER_ID = "agent-features";
      state.inlineFeatures[AGENT_LAYER_ID] = [];
      if (state.layers[AGENT_LAYER_ID]) {
        state.layers[AGENT_LAYER_ID].featureCount = 0;
      }
      state.selectedFeatureId = undefined;
      state.lastUpdatedBy = action.payload.updatedBy;
    },

    selectFeature: (state, action: PayloadAction<string | undefined>) => {
      state.selectedFeatureId = action.payload;
    },

    updateFeatureStyle: (
      state,
      action: PayloadAction<{
        featureId: string;
        style: FeatureStyle;
        updatedBy: "agent" | "user";
      }>
    ) => {
      const { featureId, style, updatedBy } = action.payload;
      const AGENT_LAYER_ID = "agent-features";
      const features = state.inlineFeatures[AGENT_LAYER_ID];
      if (!features) return;

      const feature = features.find((f) => f.id === featureId);
      if (feature) {
        feature.properties.style = { ...feature.properties.style, ...style };
        state.lastUpdatedBy = updatedBy;
      }
    }
  }
});

// --- Exports ---

export const {
  addLayer,
  removeLayer,
  updateLayerMetadata,
  setLayerVisibility,
  toggleLayerVisibility,
  setGroupVisibility,
  setLayerOrder,
  setLayerStyle,
  addFeature,
  removeFeature,
  clearAllFeatures,
  selectFeature,
  updateFeatureStyle
} = overlaySlice.actions;

export default overlaySlice.reducer;
