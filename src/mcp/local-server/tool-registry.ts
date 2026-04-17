// Copyright Amazon.com, Inc. or its affiliates.
import {
  filterDetectionsTool,
  getDetectionAnalyticsTool,
  setAnalyticsDisplayTool
} from "./analytics-tools";
import {
  deleteStacCollectionTool,
  deleteStacItemTool,
  listStacCollectionsTool,
  searchStacItemsTool
} from "./data-catalog-tools";
import {
  clearLayersTool,
  deleteLayerTool,
  drawFeatureTool,
  getLayersTool
} from "./feature-tools";
import {
  listLayersTool,
  reorderLayersTool,
  setGroupVisibilityTool,
  setLayerVisibilityTool,
  styleLayerTool,
  toggleLayerVisibilityTool
} from "./layer-tools";
import {
  deleteImageProcessingJobTool,
  displayDetectionResultsTool,
  getJobStatusTool,
  listAvailableImagesTool,
  listImageProcessingJobsTool,
  listModelEndpointsTool,
  submitImageProcessingJobTool
} from "./model-runner-tools";
import { LocalMcpTool } from "./types";
import { getViewportTool, zoomToLocationTool } from "./viewport-tools";

// Centralized registry for easy extension
export const LOCAL_TOOLS: LocalMcpTool[] = [
  getViewportTool,
  zoomToLocationTool,
  drawFeatureTool,
  getLayersTool,
  deleteLayerTool,
  clearLayersTool,
  listStacCollectionsTool,
  searchStacItemsTool,
  deleteStacItemTool,
  deleteStacCollectionTool,
  // Model Runner tools
  listModelEndpointsTool,
  listAvailableImagesTool,
  submitImageProcessingJobTool,
  getJobStatusTool,
  listImageProcessingJobsTool,
  displayDetectionResultsTool,
  deleteImageProcessingJobTool,
  // Layer management tools
  listLayersTool,
  setLayerVisibilityTool,
  toggleLayerVisibilityTool,
  setGroupVisibilityTool,
  reorderLayersTool,
  styleLayerTool,
  // Analytics tools
  getDetectionAnalyticsTool,
  setAnalyticsDisplayTool,
  filterDetectionsTool
];

// Helper function to register all local tools to a server instance
export function getLocalToolsList(): LocalMcpTool[] {
  return LOCAL_TOOLS;
}

// Helper function to find a tool by name
export function findLocalTool(toolName: string): LocalMcpTool | undefined {
  return LOCAL_TOOLS.find((tool) => tool.name === toolName);
}

// Helper function to get tool names
export function getLocalToolNames(): string[] {
  return LOCAL_TOOLS.map((tool) => tool.name);
}
