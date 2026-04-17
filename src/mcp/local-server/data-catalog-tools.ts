// Copyright Amazon.com, Inc. or its affiliates.
import type { StacItem } from "stac-ts";

import { siteConfig } from "@/config/site";
import {
  dataCatalogService,
  StacSearchResponse
} from "@/services/data-catalog-service";

import { LocalMcpTool, ToolArgs } from "./types";

export const SAMPLE_SIZE = 5;

// Base URL for constructing STAC item references, consistent with dataCatalogApiClient.
export const STAC_BASE_URL = siteConfig.stac_catalog_url.replace(/\/+$/, "");

export interface LightweightSearchResult {
  success: boolean;
  message: string;
  sample_features: (StacItem & { stac_url: string })[];
  stac_urls: string[];
  totalMatched: number;
  returned: number;
  hasMore: boolean;
  searchParams: Record<string, unknown>;
  suggestion?: string;
}

/**
 * Transforms raw STAC features into a lightweight search result with
 * sample features and STAC URLs for all items.
 */
export function transformSearchResponse(
  features: StacItem[],
  totalMatched: number,
  searchParams: Record<string, unknown>
): LightweightSearchResult {
  const returned = features.length;
  const hasMore = totalMatched > returned;

  // Build STAC URLs for all items
  const stacUrls = features.map(
    (feature) =>
      `${STAC_BASE_URL}/collections/${feature.collection}/items/${feature.id}`
  );

  // Full features for the sample (agent sees all fields)
  const sampleFeatures = features.slice(0, SAMPLE_SIZE).map((feature, i) => ({
    ...feature,
    stac_url: stacUrls[i]
  }));

  let message = `Found ${returned} items`;
  if (totalMatched > returned) {
    message += ` (showing first ${returned} of ${totalMatched} total matches)`;
  }

  return {
    success: true,
    message,
    sample_features: sampleFeatures,
    stac_urls: stacUrls,
    totalMatched,
    returned,
    hasMore,
    searchParams,
    suggestion: hasMore
      ? "Results truncated. Consider adding more specific filters (smaller bbox, specific collections, date range) to narrow results."
      : returned === 0
        ? "No items found. Try broadening your search criteria or check if the collection contains data."
        : undefined
  };
}

export const listStacCollectionsTool: LocalMcpTool = {
  name: "list_stac_collections",
  description:
    "List all available STAC collections with their metadata including IDs, titles, descriptions, and item counts. Use this to understand what geospatial data collections are available in the catalog.",
  schema: {
    type: "object",
    properties: {}
  },
  handler: async () => {
    try {
      const collections = await dataCatalogService.getCollections();

      // Sample items from each collection to discover actual field structure
      const collectionsWithFieldDiscovery = await Promise.all(
        collections.map(async (collection) => {
          let availableFields = {};
          let sampleProperties = {};

          // If summaries are empty, use comprehensive field discovery
          if (
            !collection.summaries ||
            Object.keys(collection.summaries).length === 0
          ) {
            try {
              // Use advanced field discovery with OpenSearch mappings fallback to enhanced sampling
              availableFields =
                await dataCatalogService.getCollectionFieldMappings(
                  collection.id
                );

              // Get sample properties for context if we have discovered fields
              if (Object.keys(availableFields).length > 0) {
                try {
                  const sampleResponse = await dataCatalogService.searchItems({
                    collections: [collection.id],
                    limit: 1 // Just one sample for example properties
                  });

                  sampleProperties =
                    sampleResponse.features?.[0]?.properties || {};
                } catch {
                  // Sample properties fetch failed silently
                }
              }
            } catch {
              // Field discovery failed silently
            }
          }

          return {
            id: collection.id,
            title: collection.title || collection.id,
            description: collection.description || "No description available",
            itemCount: collection.itemCount || 0,
            license: collection.license,
            extent: collection.extent,
            summaries:
              Object.keys(collection.summaries || {}).length > 0
                ? collection.summaries
                : availableFields, // Use discovered fields if summaries empty
            item_assets: collection.item_assets || {},
            sample_properties:
              Object.keys(sampleProperties).length > 0
                ? sampleProperties
                : undefined
          };
        })
      );

      return {
        success: true,
        collections: collectionsWithFieldDiscovery,
        totalCollections: collectionsWithFieldDiscovery.length,
        message: `Found ${collectionsWithFieldDiscovery.length} STAC collections with field discovery`,
        field_discovery_note:
          "For collections without summaries, actual item properties were sampled to discover available fields."
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch collections",
        message:
          "Unable to retrieve STAC collections. Please check if the catalog service is available."
      };
    }
  }
};

export const searchStacItemsTool: LocalMcpTool = {
  name: "search_stac_items",
  description: `Search for geospatial items in the STAC catalog with filtering options.
You MUST provide at least one filter (collections, bbox, datetime, or query).
IMPORTANT: Query parameters must use STAC query format with operator objects like {'name': {'eq': 'Cuba'}}, NOT direct values like {'name': 'Cuba'}.

Returns a small sample of full features plus STAC URLs for all results.
Sample features show all available fields. Use stac_urls for subsequent operations.

Response includes:
- message: Human-readable description of results
- sample_features: First 5 items with full properties (for field discovery)
- stac_urls: Array of all STAC item URLs (usable with load_stac_as_geojson for spatial operations, or draw_feature for visualization)
- totalMatched: Total number of matching items
- returned: Number of items in this response

To load results for spatial analysis, pass the stac_urls array to load_stac_as_geojson which combines them into a single GeoJSON file in the workspace.`,
  schema: {
    type: "object",
    properties: {
      collections: {
        type: "array",
        items: {
          type: "string"
        },
        description:
          "Array of collection IDs to search within. Use list_stac_collections first to get available collection IDs. Highly recommended to limit search scope."
      },
      bbox: {
        type: "array",
        items: {
          type: "number"
        },
        minItems: 4,
        maxItems: 4,
        description:
          "Bounding box filter [west, south, east, north] in WGS84 longitude/latitude. Example: [-122.4, 37.7, -122.3, 37.8] for San Francisco area."
      },
      datetime: {
        type: "string",
        description:
          "Temporal filter in RFC3339 format. Examples: '2023-01-01T00:00:00Z' (single date), '2023-01-01T00:00:00Z/2023-12-31T23:59:59Z' (range), '2023-01-01T00:00:00Z/..' (open-ended)."
      },
      query: {
        type: "object",
        description:
          "Property-based filters using STAC query format. Each field must use an operator object. Available operators: 'eq' (equals), 'neq' (not equals), 'lt' (less than), 'lte' (less than or equal), 'gt' (greater than), 'gte' (greater than or equal), 'in' (array of values). CORRECT FORMAT: {'name': {'eq': 'Cuba'}, 'population': {'gte': 1000000}}. WRONG FORMAT: {'name': 'Cuba'}."
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        default: 50,
        description:
          "Maximum number of items to return (1-200). Default is 50. Use smaller limits for initial exploration."
      }
    }
  },
  handler: async (args: ToolArgs) => {
    try {
      const {
        collections,
        bbox,
        datetime,
        query,
        limit = 50
      } = args as {
        collections?: string[];
        bbox?: number[];
        datetime?: string;
        query?: Record<string, unknown>;
        limit?: number;
      };

      // Validate that at least one filter is provided to prevent overly broad searches
      const hasFilters =
        (collections?.length ?? 0) > 0 ||
        bbox?.length === 4 ||
        datetime ||
        query;

      if (!hasFilters) {
        return {
          success: false,
          error: "No filters provided",
          message:
            "To prevent overwhelming results, you must provide at least one filter: collections, bbox, datetime, or query. Use list_stac_collections first to see available collections.",
          suggestion:
            "Start by calling list_stac_collections to see available data, then specify collections or geographic bounds."
        };
      }

      // Validate bbox format if provided
      if (bbox && bbox.length !== 4) {
        return {
          success: false,
          error: "Invalid bbox format",
          message:
            "Bounding box must be an array of exactly 4 numbers: [west, south, east, north]"
        };
      }

      // Prepare search parameters
      const searchParams: Record<string, unknown> = {
        limit: Math.min(Math.max(limit, 1), 200) // Ensure limit is between 1 and 200
      };

      if ((collections?.length ?? 0) > 0) {
        searchParams.collections = collections;
      }
      if (bbox?.length === 4) {
        searchParams.bbox = bbox;
      }
      if (datetime) {
        searchParams.datetime = datetime;
      }
      if (query) {
        searchParams.query = query;
      }

      const response: StacSearchResponse =
        await dataCatalogService.searchItems(searchParams);

      // Get total count from response
      const totalMatched =
        response.context?.matched ||
        response.numMatched ||
        response.features?.length ||
        0;
      const features = response.features || [];

      return transformSearchResponse(features, totalMatched, searchParams);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Search failed",
        message:
          "Unable to search STAC catalog. Please check your search parameters and try again."
      };
    }
  }
};

export const deleteStacItemTool: LocalMcpTool = {
  name: "delete_stac_item",
  description:
    "Delete a specific STAC item from a collection by its collection ID and item ID. Use this to remove items from the data catalog.",
  schema: {
    type: "object",
    properties: {
      collection_id: {
        type: "string",
        description: "The STAC collection ID that contains the item."
      },
      item_id: {
        type: "string",
        description: "The unique identifier of the STAC item to delete."
      }
    },
    required: ["collection_id", "item_id"]
  },
  handler: async (args: ToolArgs) => {
    try {
      const { collection_id, item_id } = args as {
        collection_id?: string;
        item_id?: string;
      };

      if (!collection_id || !item_id) {
        return {
          success: false,
          error: "Missing required parameters",
          message: "Both collection_id and item_id are required."
        };
      }

      await dataCatalogService.deleteItem(collection_id, item_id);

      return {
        success: true,
        message: `Successfully deleted item '${item_id}' from collection '${collection_id}'.`,
        deleted: { collection_id, item_id }
      };
    } catch (error) {
      const { collection_id, item_id } = args as Record<string, string>;

      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
        message: `Unable to delete item '${item_id}' from collection '${collection_id}'.`
      };
    }
  }
};

export const deleteStacCollectionTool: LocalMcpTool = {
  name: "delete_stac_collection",
  description:
    "Delete an entire STAC collection and ALL of its items from the data catalog. WARNING: This is a destructive operation that cannot be undone. Use list_stac_collections first to verify the collection ID.",
  schema: {
    type: "object",
    properties: {
      collection_id: {
        type: "string",
        description:
          "The STAC collection ID to delete. All items in this collection will also be permanently removed."
      }
    },
    required: ["collection_id"]
  },
  handler: async (args: ToolArgs) => {
    try {
      const { collection_id } = args as { collection_id?: string };

      if (!collection_id) {
        return {
          success: false,
          error: "Missing required parameter",
          message: "collection_id is required."
        };
      }

      await dataCatalogService.deleteCollection(collection_id);

      return {
        success: true,
        message: `Successfully deleted collection '${collection_id}' and all its items.`,
        deleted: { collection_id }
      };
    } catch (error) {
      const { collection_id: cid } = args as Record<string, string>;

      return {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
        message: `Unable to delete collection '${cid}'. It may not exist or the catalog service may be unavailable.`
      };
    }
  }
};
