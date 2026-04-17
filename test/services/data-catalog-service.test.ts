// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for data-catalog-service.ts.
 * Covers collection fetching with parallel detail loading, item count retrieval,
 * search with different response formats, field mapping discovery, and CRUD.
 */

import { dataCatalogService } from "@/services/data-catalog-service";
import { dataCatalogApiClient } from "@/utils/api-client";

jest.mock("@/utils/api-client", () => ({
  dataCatalogApiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn()
  }
}));

const mockGet = dataCatalogApiClient.get as jest.Mock;
const mockPost = dataCatalogApiClient.post as jest.Mock;
const mockDelete = dataCatalogApiClient.delete as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe("DataCatalogService", () => {
  // -----------------------------------------------------------------------
  // getCollections
  // -----------------------------------------------------------------------
  describe("getCollections", () => {
    it("should fetch collections and enrich with item counts and details", async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === "/collections") {
          return Promise.resolve({
            collections: [{ id: "col-1", title: "Collection 1" }]
          });
        }
        if (url === "/collections/col-1") {
          return Promise.resolve({
            summaries: { platform: ["sentinel"] },
            item_assets: { data: { type: "image/tiff" } }
          });
        }
        return Promise.resolve({});
      });

      mockPost.mockResolvedValue({
        features: [],
        context: { matched: 42 }
      });

      const collections = await dataCatalogService.getCollections();

      expect(collections).toHaveLength(1);
      expect(collections[0].itemCount).toBe(42);
      expect(collections[0].summaries).toEqual({ platform: ["sentinel"] });
      expect(collections[0].item_assets).toEqual({
        data: { type: "image/tiff" }
      });
    });

    it("should gracefully handle errors for individual collections", async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === "/collections") {
          return Promise.resolve({
            collections: [{ id: "col-1" }, { id: "col-2" }]
          });
        }
        if (url === "/collections/col-1") {
          return Promise.reject(new Error("Not found"));
        }
        if (url === "/collections/col-2") {
          return Promise.resolve({ summaries: {}, item_assets: {} });
        }
        return Promise.resolve({});
      });

      // col-1 detail fetch fails, col-2 succeeds
      mockPost.mockImplementation(
        (_url: string, body: { collections: string[] }) => {
          if (body?.collections?.[0] === "col-1") {
            return Promise.reject(new Error("fail"));
          }
          return Promise.resolve({ features: [], context: { matched: 10 } });
        }
      );

      const collections = await dataCatalogService.getCollections();
      expect(collections).toHaveLength(2);
      // Failed collection should have fallback values
      expect(collections[0].itemCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getCollectionItemCount
  // -----------------------------------------------------------------------
  describe("getCollectionItemCount", () => {
    it("should use context.matched when available", async () => {
      mockPost.mockResolvedValue({ features: [], context: { matched: 100 } });
      const count = await dataCatalogService.getCollectionItemCount("col-1");
      expect(count).toBe(100);
    });

    it("should fall back to numMatched", async () => {
      mockPost.mockResolvedValue({ features: [{}], numMatched: 50 });
      const count = await dataCatalogService.getCollectionItemCount("col-1");
      expect(count).toBe(50);
    });

    it("should fall back to features.length", async () => {
      mockPost.mockResolvedValue({ features: [{}, {}, {}] });
      const count = await dataCatalogService.getCollectionItemCount("col-1");
      expect(count).toBe(3);
    });

    it("should return 0 on error", async () => {
      mockPost.mockRejectedValue(new Error("Network error"));
      const count = await dataCatalogService.getCollectionItemCount("col-1");
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // searchItems
  // -----------------------------------------------------------------------
  describe("searchItems", () => {
    it("should POST search params and return response", async () => {
      const mockResponse = {
        type: "FeatureCollection",
        features: [{ id: "item-1" }],
        context: { matched: 1, returned: 1 }
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await dataCatalogService.searchItems({
        collections: ["col-1"],
        limit: 10
      });

      expect(mockPost).toHaveBeenCalledWith("/search", {
        collections: ["col-1"],
        limit: 10
      });
      expect(result.features).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // getCollectionFieldMappings
  // -----------------------------------------------------------------------
  describe("getCollectionFieldMappings", () => {
    it("should use queryables endpoint when available", async () => {
      mockGet.mockResolvedValue({
        properties: {
          datetime: { type: "string" },
          platform: { type: "string" }
        }
      });

      const fields =
        await dataCatalogService.getCollectionFieldMappings("col-1");

      expect(mockGet).toHaveBeenCalledWith("/collections/col-1/queryables");
      expect(fields).toHaveProperty("datetime");
      expect(fields).toHaveProperty("platform");
    });

    it("should fall back to item sampling when queryables fails", async () => {
      // First call (queryables) fails, second call (collection details) may also be called
      mockGet.mockRejectedValue(new Error("Not found"));
      mockPost.mockResolvedValue({
        features: [
          { properties: { datetime: "2024-01-01", platform: "sentinel-2" } },
          { properties: { datetime: "2024-01-02", cloud_cover: 10 } }
        ]
      });

      const fields =
        await dataCatalogService.getCollectionFieldMappings("col-1");

      // Should have aggregated fields from samples
      expect(fields).toHaveProperty("datetime");
      expect(fields).toHaveProperty("platform");
      expect(fields).toHaveProperty("cloud_cover");

      // Check field metadata structure
      const dtField = fields.datetime as Record<string, unknown>;
      expect(dtField.source).toBe("item_sampling");
      expect(dtField.coverage_percent).toBeDefined();
    });

    it("should return empty object when both methods fail", async () => {
      mockGet.mockRejectedValue(new Error("fail"));
      mockPost.mockResolvedValue({ features: [] });

      const fields =
        await dataCatalogService.getCollectionFieldMappings("col-1");
      expect(fields).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // getCollectionDetails
  // -----------------------------------------------------------------------
  describe("getCollectionDetails", () => {
    it("should return summaries and item_assets", async () => {
      mockGet.mockResolvedValue({
        summaries: { platform: ["s2"] },
        item_assets: { visual: { type: "image/png" } }
      });

      const details = await dataCatalogService.getCollectionDetails("col-1");
      expect(details.summaries).toEqual({ platform: ["s2"] });
      expect(details.item_assets).toEqual({ visual: { type: "image/png" } });
    });

    it("should return empty objects on error", async () => {
      mockGet.mockRejectedValue(new Error("fail"));
      const details = await dataCatalogService.getCollectionDetails("col-1");
      expect(details.summaries).toEqual({});
      expect(details.item_assets).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // getItem / deleteItem / deleteCollection
  // -----------------------------------------------------------------------
  describe("CRUD operations", () => {
    it("getItem should fetch by collection and item ID", async () => {
      mockGet.mockResolvedValue({ id: "item-1" });
      const item = await dataCatalogService.getItem("col-1", "item-1");
      expect(mockGet).toHaveBeenCalledWith("/collections/col-1/items/item-1");
      expect(item.id).toBe("item-1");
    });

    it("deleteItem should call DELETE endpoint", async () => {
      mockDelete.mockResolvedValue(undefined);
      await dataCatalogService.deleteItem("col-1", "item-1");
      expect(mockDelete).toHaveBeenCalledWith(
        "/collections/col-1/items/item-1"
      );
    });

    it("deleteCollection should call DELETE endpoint", async () => {
      mockDelete.mockResolvedValue(undefined);
      await dataCatalogService.deleteCollection("col-1");
      expect(mockDelete).toHaveBeenCalledWith("/collections/col-1");
    });
  });
});
