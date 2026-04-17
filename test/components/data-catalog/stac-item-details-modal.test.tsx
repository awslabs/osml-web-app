// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for StacItemDetailsModal component.
 */

import { screen } from "@testing-library/react";

import { StacItemDetailsModal } from "@/components/data-catalog/stac-item-details-modal";
import { showItemDetails } from "@/store/slices/data-catalog-slice";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { getCollections: jest.fn(), searchItems: jest.fn() }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

const mockItem = {
  type: "Feature",
  stac_version: "1.0.0",
  id: "item-1",
  collection: "landsat",
  geometry: { type: "Point", coordinates: [-122.4, 37.8] },
  bbox: [-122.5, 37.0, -121.5, 38.0],
  properties: {
    datetime: "2024-06-15T12:00:00Z",
    title: "Test Scene",
    platform: "sentinel-2"
  },
  links: [],
  assets: { data: { href: "s3://bucket/file.tif", type: "image/tiff" } }
} as never;

describe("StacItemDetailsModal", () => {
  it("should render nothing when not open", () => {
    const { container } = renderWithStore(<StacItemDetailsModal />);
    expect(container.innerHTML).toBe("");
  });

  it("should render item title when open", () => {
    const store = createTestStore();
    store.dispatch(showItemDetails({ item: mockItem, index: 0 }));
    renderWithStore(<StacItemDetailsModal />, { store });
    expect(screen.getAllByText("Test Scene").length).toBeGreaterThanOrEqual(1);
  });

  it("should render item ID", () => {
    const store = createTestStore();
    store.dispatch(showItemDetails({ item: mockItem, index: 0 }));
    renderWithStore(<StacItemDetailsModal />, { store });
    expect(screen.getByText("item-1")).toBeInTheDocument();
  });

  it("should render collection name", () => {
    const store = createTestStore();
    store.dispatch(showItemDetails({ item: mockItem, index: 0 }));
    renderWithStore(<StacItemDetailsModal />, { store });
    expect(screen.getByText("landsat")).toBeInTheDocument();
  });
});
