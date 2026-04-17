// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for DataCatalog component.
 */

import { screen } from "@testing-library/react";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn().mockResolvedValue([]),
    searchItems: jest.fn()
  }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));
jest.mock("@/utils/stac-viewpoint-utils", () => ({
  ...jest.requireActual("@/utils/stac-viewpoint-utils"),
  hasViewableImageAsset: jest.fn(() => false)
}));

import { DataCatalog } from "@/components/data-catalog/data-catalog";

import { renderWithStore } from "../../test-utils";

describe("DataCatalog", () => {
  it("should render Collections and Search tabs", () => {
    renderWithStore(<DataCatalog />);
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  it("should render Data Catalog Options aria label", () => {
    renderWithStore(<DataCatalog />);
    const elements = screen.getAllByLabelText("Data Catalog Options");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });
});
