// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for StacCollectionsList component.
 */

import { screen } from "@testing-library/react";

import { StacCollectionsList } from "@/components/data-catalog/stac-collections-list";
import { fetchCollections } from "@/store/slices/data-catalog-slice";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn().mockResolvedValue([]),
    searchItems: jest.fn()
  }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("StacCollectionsList", () => {
  it("should render header with collection count", () => {
    const store = createTestStore();
    store.dispatch(
      fetchCollections.fulfilled(
        [{ id: "col-1", title: "Test" }] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacCollectionsList />, { store });
    // Header includes count: "STAC Collections (1)"
    expect(screen.getByText(/STAC Collections/)).toBeInTheDocument();
  });

  it("should show loading state when pending", () => {
    const store = createTestStore();
    store.dispatch(fetchCollections.pending("r", undefined));
    renderWithStore(<StacCollectionsList />, { store });
    expect(screen.getByText("Loading collections...")).toBeInTheDocument();
  });

  it("should show collections when loaded", () => {
    const store = createTestStore();
    store.dispatch(
      fetchCollections.fulfilled(
        [
          {
            id: "landsat",
            title: "Landsat Collection",
            description: "Satellite imagery",
            itemCount: 42
          }
        ] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacCollectionsList />, { store });
    expect(screen.getByText("Landsat Collection")).toBeInTheDocument();
  });

  it("should show refresh button", () => {
    const store = createTestStore();
    store.dispatch(
      fetchCollections.fulfilled(
        [{ id: "col-1", title: "Test" }] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacCollectionsList />, { store });
    expect(
      screen.getByRole("button", { name: /refresh/i })
    ).toBeInTheDocument();
  });
});
