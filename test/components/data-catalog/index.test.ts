// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for data-catalog barrel export.
 */

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { getCollections: jest.fn(), searchItems: jest.fn() }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));
jest.mock("@/utils/stac-viewpoint-utils", () => ({
  hasViewableImageAsset: jest.fn(() => false)
}));

import {
  DataCatalog,
  StacCollectionsList,
  StacItemBrowser,
  StacItemCard,
  StacItemDetailsModal,
  StacSearchPanel
} from "@/components/data-catalog";

describe("data-catalog/index", () => {
  it("should export all data-catalog components", () => {
    expect(StacCollectionsList).toBeDefined();
    expect(DataCatalog).toBeDefined();
    expect(StacSearchPanel).toBeDefined();
    expect(StacItemBrowser).toBeDefined();
    expect(StacItemCard).toBeDefined();
    expect(StacItemDetailsModal).toBeDefined();
  });
});
