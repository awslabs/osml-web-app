// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for StacItemBrowser component.
 */

import { screen } from "@testing-library/react";

import { StacItemBrowser } from "@/components/data-catalog/stac-item-browser";
import { searchStacItems } from "@/store/slices/data-catalog-slice";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: { getCollections: jest.fn(), searchItems: jest.fn() }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("StacItemBrowser", () => {
  it("should render nothing when no search performed", () => {
    const { container } = renderWithStore(<StacItemBrowser />);
    // No results, not loading, no error → renders null
    expect(container.firstChild).toBeNull();
  });

  it("should show loading state", () => {
    const store = createTestStore();
    store.dispatch(searchStacItems.pending("r", undefined));
    renderWithStore(<StacItemBrowser />, { store });
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it("should show search results header with count", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.fulfilled(
        {
          features: [
            {
              id: "item-1",
              collection: "col-1",
              properties: { datetime: null }
            }
          ],
          context: { matched: 1 }
        } as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacItemBrowser />, { store });
    expect(screen.getByText("Search Results")).toBeInTheDocument();
  });

  it("should show error state", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.rejected(new Error("Timeout"), "r", undefined)
    );
    renderWithStore(<StacItemBrowser />, { store });
    expect(screen.getByText(/Timeout/)).toBeInTheDocument();
  });
});
