// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Unit tests for data-catalog-tools.ts.
 * Covers transformSearchResponse edge cases, searchStacItemsTool validation,
 * deleteStacItemTool, and deleteStacCollectionTool.
 */

import type { StacItem } from "stac-ts";

import {
  deleteStacCollectionTool,
  deleteStacItemTool,
  SAMPLE_SIZE,
  searchStacItemsTool,
  STAC_BASE_URL,
  transformSearchResponse
} from "@/mcp/local-server/data-catalog-tools";
import { dataCatalogService } from "@/services/data-catalog-service";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn(),
    searchItems: jest.fn(),
    getCollectionFieldMappings: jest.fn(),
    deleteItem: jest.fn(),
    deleteCollection: jest.fn()
  }
}));

const mockSearchItems = dataCatalogService.searchItems as jest.Mock;
const mockDeleteItem = dataCatalogService.deleteItem as jest.Mock;
const mockDeleteCollection = dataCatalogService.deleteCollection as jest.Mock;

const makeFeature = (id: string, collection = "col-1") =>
  ({ id, collection, properties: { datetime: null } }) as never;

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// transformSearchResponse edge cases
// ---------------------------------------------------------------------------
describe("transformSearchResponse - edge cases", () => {
  const defaultParams = { limit: 50, collections: ["test"] };

  it("handles 0 results (empty arrays)", () => {
    const result = transformSearchResponse([], 0, defaultParams);
    expect(result.sample_features).toEqual([]);
    expect(result.stac_urls).toEqual([]);
    expect(result.returned).toBe(0);
    expect(result.message).toBe("Found 0 items");
    expect(result.suggestion).toContain("No items found");
  });

  it("handles exactly 1 result", () => {
    const features = [
      { id: "item-1", collection: "col-1", type: "Feature" }
    ] as unknown as StacItem[];
    const result = transformSearchResponse(features, 1, defaultParams);
    expect(result.sample_features).toHaveLength(1);
    expect(result.stac_urls).toHaveLength(1);
    expect(result.sample_features[0].stac_url).toBeDefined();
  });

  it("handles exactly SAMPLE_SIZE results (boundary)", () => {
    const features = Array.from({ length: SAMPLE_SIZE }, (_, i) => ({
      id: `item-${i}`,
      collection: "col",
      type: "Feature"
    })) as unknown as StacItem[];
    const result = transformSearchResponse(
      features,
      SAMPLE_SIZE,
      defaultParams
    );
    expect(result.sample_features).toHaveLength(SAMPLE_SIZE);
    expect(result.stac_urls).toHaveLength(SAMPLE_SIZE);
  });

  it("handles 200 results (max limit)", () => {
    const features = Array.from({ length: 200 }, (_, i) => ({
      id: `item-${i}`,
      collection: "col",
      type: "Feature",
      properties: { name: `Feature ${i}` }
    })) as unknown as StacItem[];
    const result = transformSearchResponse(features, 236, defaultParams);
    expect(result.sample_features).toHaveLength(SAMPLE_SIZE);
    expect(result.stac_urls).toHaveLength(200);
    expect(result.hasMore).toBe(true);
    expect(result.totalMatched).toBe(236);
  });

  it("message format for hasMore: true", () => {
    const features = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      collection: "col",
      type: "Feature"
    })) as unknown as StacItem[];
    const result = transformSearchResponse(features, 50, defaultParams);
    expect(result.hasMore).toBe(true);
    expect(result.message).toContain("showing first 10 of 50");
    expect(result.suggestion).toContain("Results truncated");
  });

  it("message format for hasMore: false", () => {
    const features = Array.from({ length: 3 }, (_, i) => ({
      id: `item-${i}`,
      collection: "col",
      type: "Feature"
    })) as unknown as StacItem[];
    const result = transformSearchResponse(features, 3, defaultParams);
    expect(result.hasMore).toBe(false);
    expect(result.message).toBe("Found 3 items");
    expect(result.suggestion).toBeUndefined();
  });

  it("sample features include stac_url field", () => {
    const features = [
      {
        id: "abc-123",
        collection: "airports",
        type: "Feature",
        properties: { name: "Test" }
      }
    ] as unknown as StacItem[];
    const result = transformSearchResponse(features, 1, defaultParams);
    expect(result.sample_features[0].stac_url).toBe(
      `${STAC_BASE_URL}/collections/airports/items/abc-123`
    );
  });
});

// ---------------------------------------------------------------------------
// searchStacItemsTool
// ---------------------------------------------------------------------------
describe("searchStacItemsTool", () => {
  it("should reject when no filters provided", async () => {
    const result = (await searchStacItemsTool.handler({}, {} as never)) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain("No filters");
  });

  it("should reject invalid bbox (3 elements = no filter)", async () => {
    const result = (await searchStacItemsTool.handler(
      { bbox: [1, 2, 3] },
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it("should reject invalid bbox (5 elements) when combined with another filter", async () => {
    mockSearchItems.mockResolvedValue({
      features: [],
      context: { matched: 0 }
    });
    const result = (await searchStacItemsTool.handler(
      { collections: ["col-1"], bbox: [1, 2, 3, 4, 5] },
      {} as never
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid bbox");
  });

  it("should search with collections filter", async () => {
    mockSearchItems.mockResolvedValue({
      features: [makeFeature("item-1")],
      context: { matched: 1 }
    });
    const result = (await searchStacItemsTool.handler(
      { collections: ["col-1"] },
      {} as never
    )) as { success: boolean; returned: number };
    expect(result.success).toBe(true);
    expect(result.returned).toBe(1);
  });

  it("should search with bbox filter", async () => {
    mockSearchItems.mockResolvedValue({
      features: [],
      context: { matched: 0 }
    });
    await searchStacItemsTool.handler(
      { bbox: [-122, 37, -121, 38] },
      {} as never
    );
    expect(mockSearchItems).toHaveBeenCalledWith(
      expect.objectContaining({ bbox: [-122, 37, -121, 38] })
    );
  });

  it("should clamp limit to 1-200", async () => {
    mockSearchItems.mockResolvedValue({
      features: [],
      context: { matched: 0 }
    });
    await searchStacItemsTool.handler(
      { collections: ["col-1"], limit: 500 },
      {} as never
    );
    expect(mockSearchItems).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 })
    );
  });

  it("should handle search errors gracefully", async () => {
    mockSearchItems.mockRejectedValue(new Error("Service unavailable"));
    const result = (await searchStacItemsTool.handler(
      { collections: ["col-1"] },
      {} as never
    )) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toBe("Service unavailable");
  });
});

// ---------------------------------------------------------------------------
// deleteStacItemTool
// ---------------------------------------------------------------------------
describe("deleteStacItemTool", () => {
  it("should delete item and return success", async () => {
    mockDeleteItem.mockResolvedValue(undefined);
    const result = (await deleteStacItemTool.handler(
      { collection_id: "col-1", item_id: "item-1" },
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("should return error when parameters missing", async () => {
    const result = (await deleteStacItemTool.handler({}, {} as never)) as {
      success: boolean;
    };
    expect(result.success).toBe(false);
  });

  it("should handle delete errors", async () => {
    mockDeleteItem.mockRejectedValue(new Error("Not found"));
    const result = (await deleteStacItemTool.handler(
      { collection_id: "col-1", item_id: "item-1" },
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteStacCollectionTool
// ---------------------------------------------------------------------------
describe("deleteStacCollectionTool", () => {
  it("should delete collection", async () => {
    mockDeleteCollection.mockResolvedValue(undefined);
    const result = (await deleteStacCollectionTool.handler(
      { collection_id: "col-1" },
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("should return error when collection_id missing", async () => {
    const result = (await deleteStacCollectionTool.handler(
      {},
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(false);
  });

  it("should handle delete errors", async () => {
    mockDeleteCollection.mockRejectedValue(new Error("Forbidden"));
    const result = (await deleteStacCollectionTool.handler(
      { collection_id: "col-1" },
      {} as never
    )) as { success: boolean };
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listStacCollectionsTool
// ---------------------------------------------------------------------------

import { listStacCollectionsTool } from "@/mcp/local-server/data-catalog-tools";

const mockGetCollections = dataCatalogService.getCollections as jest.Mock;
const mockGetFieldMappings =
  dataCatalogService.getCollectionFieldMappings as jest.Mock;

describe("listStacCollectionsTool", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return collections with metadata", async () => {
    mockGetCollections.mockResolvedValue([
      {
        id: "col-1",
        title: "Collection 1",
        description: "Test",
        itemCount: 10,
        summaries: { platform: ["s2"] }
      }
    ]);

    const result = (await listStacCollectionsTool.handler({}, {} as never)) as {
      success: boolean;
      totalCollections: number;
    };

    expect(result.success).toBe(true);
    expect(result.totalCollections).toBe(1);
  });

  it("should handle errors gracefully", async () => {
    mockGetCollections.mockRejectedValue(new Error("Service down"));

    const result = (await listStacCollectionsTool.handler({}, {} as never)) as {
      success: boolean;
      error: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe("Service down");
  });

  it("should discover fields when summaries are empty", async () => {
    mockGetCollections.mockResolvedValue([
      { id: "col-1", title: "Test", summaries: {} }
    ]);
    mockGetFieldMappings.mockResolvedValue({ datetime: { type: "string" } });
    mockSearchItems.mockResolvedValue({ features: [] });

    const result = (await listStacCollectionsTool.handler({}, {} as never)) as {
      success: boolean;
      collections: Array<{ summaries: Record<string, unknown> }>;
    };

    expect(result.success).toBe(true);
  });
});
