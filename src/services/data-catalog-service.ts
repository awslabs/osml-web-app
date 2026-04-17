// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import type {
  StacAsset,
  StacCollection as StacTsCollection,
  StacItem
} from "stac-ts";

import { dataCatalogApiClient } from "@/utils/api-client";

/**
 * App-level extension of the stac-ts StacCollection with runtime metadata
 * that our service enriches (item counts, item_assets from collection details).
 */
export interface StacCollection extends StacTsCollection {
  itemCount?: number;
  item_assets?: Record<string, StacAsset>;
}

export interface StacCollectionsResponse {
  collections: StacCollection[];
}

export interface StacSearchResponse {
  type: string;
  features: StacItem[];
  context?: {
    returned: number;
    matched?: number;
  };
  // Alternative response format used by some STAC servers
  numMatched?: number;
  numReturned?: number;
}

class DataCatalogService {
  /**
   * List all available STAC collections with detailed metadata including summaries and item_assets
   */
  async getCollections(): Promise<StacCollection[]> {
    const data: StacCollectionsResponse =
      await dataCatalogApiClient.get("/collections");

    // Get detailed information for each collection including item counts, summaries, and item_assets
    const collectionsWithDetails = await Promise.all(
      data.collections.map(async (collection) => {
        try {
          // Fetch item count and detailed collection metadata in parallel
          const [itemCount, details] = await Promise.all([
            this.getCollectionItemCount(collection.id),
            this.getCollectionDetails(collection.id)
          ]);

          return {
            ...collection,
            itemCount,
            summaries: details.summaries || {},
            item_assets: details.item_assets || {}
          };
        } catch {
          return {
            ...collection,
            itemCount: 0,
            summaries: {},
            item_assets: {}
          };
        }
      })
    );

    return collectionsWithDetails;
  }

  /**
   * Get the number of items in a collection using STAC API search endpoint
   * This is the standard way to get item counts per collection in STAC API
   */
  async getCollectionItemCount(collectionId: string): Promise<number> {
    try {
      const data: StacSearchResponse = await dataCatalogApiClient.post(
        "/search",
        {
          collections: [collectionId],
          limit: 1 // Minimum allowed value - we only need the count from context.matched
        }
      );

      // Handle different STAC server response formats for item counts
      // Standard format: context.matched, Alternative format: numMatched (direct field)
      const itemCount =
        data.context?.matched || data.numMatched || data.features?.length || 0;

      return itemCount;
    } catch {
      return 0;
    }
  }

  /**
   * Search STAC catalog
   */
  async searchItems(params: {
    collections?: string[];
    bbox?: number[];
    datetime?: string;
    query?: Record<string, unknown>;
    limit?: number;
  }): Promise<StacSearchResponse> {
    return await dataCatalogApiClient.post("/search", params);
  }

  /**
   * Get complete field mappings for a collection using available STAC API methods
   * Uses STAC queryables endpoint when available, falls back to enhanced item sampling
   */
  async getCollectionFieldMappings(
    collectionId: string
  ): Promise<Record<string, unknown>> {
    try {
      // Attempt 1: STAC queryables endpoint (standard STAC extension)
      try {
        const fieldsData = await dataCatalogApiClient.get<{
          properties?: Record<string, unknown>;
        }>(`/collections/${collectionId}/queryables`);

        if (fieldsData && fieldsData.properties) {
          return fieldsData.properties;
        }
      } catch {
        // Queryables endpoint not available, fall back to sampling
      }

      // Attempt 2: Enhanced sampling with larger sample size for better field coverage
      const sampleResponse = await this.searchItems({
        collections: [collectionId],
        limit: 50 // Much larger sample to capture more fields
      });

      if (sampleResponse.features && sampleResponse.features.length > 0) {
        return this.aggregateFieldsFromSamples(sampleResponse.features);
      }

      return {};
    } catch {
      return {};
    }
  }

  /**
   * Aggregate fields from sampled items with better coverage analysis
   */
  private aggregateFieldsFromSamples(
    features: StacItem[]
  ): Record<string, unknown> {
    const fieldSet = new Set<string>();
    const fieldExamples: Record<string, unknown[]> = {};
    const fieldTypes: Record<string, string> = {};

    features.forEach((item) => {
      if (item.properties) {
        Object.entries(item.properties).forEach(([field, value]) => {
          fieldSet.add(field);
          if (!fieldExamples[field]) fieldExamples[field] = [];
          if (fieldExamples[field].length < 5) {
            // Keep up to 5 examples
            fieldExamples[field].push(value);
          }
          // Track most common type
          const valueType = typeof value;

          fieldTypes[field] = valueType;
        });
      }
    });

    return Object.fromEntries(
      Array.from(fieldSet).map((field) => [
        field,
        {
          examples: fieldExamples[field].slice(0, 3),
          type: fieldTypes[field],
          sample_count: fieldExamples[field].length,
          total_occurrences: features.filter(
            (f) => f.properties?.[field] !== undefined
          ).length,
          coverage_percent: Math.round(
            (features.filter((f) => f.properties?.[field] !== undefined)
              .length /
              features.length) *
              100
          ),
          source: "item_sampling"
        }
      ])
    );
  }

  /**
   * Get detailed information for a specific collection including summaries and item_assets
   */
  async getCollectionDetails(
    collectionId: string
  ): Promise<Partial<StacCollection>> {
    try {
      const data = await dataCatalogApiClient.get<StacCollection>(
        `/collections/${collectionId}`
      );

      return {
        summaries: data.summaries || {},
        item_assets: data.item_assets || {}
      };
    } catch {
      // Return empty objects if details can't be fetched
      return {
        summaries: {},
        item_assets: {}
      };
    }
  }

  /**
   * Get a specific STAC item by ID
   */
  async getItem(collectionId: string, itemId: string): Promise<StacItem> {
    return await dataCatalogApiClient.get(
      `/collections/${collectionId}/items/${itemId}`
    );
  }

  /**
   * Delete a specific STAC item by ID.
   * Uses the STAC Transaction extension DELETE endpoint.
   */
  async deleteItem(collectionId: string, itemId: string): Promise<void> {
    await dataCatalogApiClient.delete(
      `/collections/${collectionId}/items/${itemId}`
    );
  }

  /**
   * Delete an entire STAC collection and all its items.
   * Uses the STAC Transaction extension DELETE endpoint.
   * WARNING: This is destructive and cannot be undone.
   */
  async deleteCollection(collectionId: string): Promise<void> {
    await dataCatalogApiClient.delete(`/collections/${collectionId}`);
  }
}

export const dataCatalogService = new DataCatalogService();
