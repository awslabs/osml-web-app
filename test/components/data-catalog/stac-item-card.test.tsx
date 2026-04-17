// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for StacItemCard component.
 * Covers title, collection, metadata display, and viewpoint status.
 */

import { screen } from "@testing-library/react";

import { StacItemCard } from "@/components/data-catalog/stac-item-card";
import { setViewpointStatus } from "@/store/slices/data-catalog-slice";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { getCollections: jest.fn(), searchItems: jest.fn() }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

const makeItem = (overrides: Record<string, unknown> = {}) =>
  ({
    type: "Feature",
    stac_version: "1.0.0",
    id: "item-1",
    collection: "landsat",
    geometry: null,
    bbox: [-122.5, 37.0, -121.5, 38.0],
    properties: {
      datetime: "2024-06-15T12:00:00Z",
      title: "Landsat Scene",
      ...overrides
    },
    links: [],
    assets: {}
  }) as never;

describe("StacItemCard", () => {
  it("should render item title", () => {
    renderWithStore(<StacItemCard item={makeItem()} />);
    expect(screen.getByText("Landsat Scene")).toBeInTheDocument();
  });

  it("should fall back to item ID when no title", () => {
    renderWithStore(<StacItemCard item={makeItem({ title: undefined })} />);
    expect(screen.getByText("item-1")).toBeInTheDocument();
  });

  it("should render collection chip", () => {
    renderWithStore(<StacItemCard item={makeItem()} />);
    expect(screen.getByText("landsat")).toBeInTheDocument();
  });

  it("should render date", () => {
    renderWithStore(<StacItemCard item={makeItem()} />);
    // Date is formatted via toLocaleDateString
    expect(screen.getByText(/2024/)).toBeInTheDocument();
  });

  it("should render bbox indicator", () => {
    renderWithStore(<StacItemCard item={makeItem()} />);
    expect(screen.getByText("Bbox")).toBeInTheDocument();
  });

  it("should render cloud cover when present", () => {
    renderWithStore(<StacItemCard item={makeItem({ "eo:cloud_cover": 15 })} />);
    expect(screen.getByText("15%")).toBeInTheDocument();
  });

  it("should render platform chip when present", () => {
    renderWithStore(
      <StacItemCard item={makeItem({ platform: "sentinel-2" })} />
    );
    expect(screen.getByText("sentinel-2")).toBeInTheDocument();
  });

  it("should render viewpoint ready status", () => {
    const store = createTestStore();
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "ready"
      })
    );

    renderWithStore(<StacItemCard item={makeItem()} />, { store });
    expect(screen.getByText("Imagery Ready")).toBeInTheDocument();
  });

  it("should render viewpoint creating status", () => {
    const store = createTestStore();
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "creating"
      })
    );

    renderWithStore(<StacItemCard item={makeItem()} />, { store });
    expect(screen.getByText("Preparing...")).toBeInTheDocument();
  });

  it("should render viewpoint error status", () => {
    const store = createTestStore();
    store.dispatch(
      setViewpointStatus({
        itemId: "item-1",
        viewpointId: "vp-1",
        status: "error",
        error: "Timeout"
      })
    );

    renderWithStore(<StacItemCard item={makeItem()} />, { store });
    expect(screen.getByText("Imagery Unavailable")).toBeInTheDocument();
  });
});
