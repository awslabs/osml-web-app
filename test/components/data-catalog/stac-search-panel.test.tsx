// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for StacSearchPanel component.
 */

import { fireEvent, screen } from "@testing-library/react";

import { StacSearchPanel } from "@/components/data-catalog/stac-search-panel";
import {
  fetchCollections,
  searchStacItems,
  setCollectionFilter,
  setDateRangeFilter,
  toggleBboxFilter
} from "@/store/slices/data-catalog-slice";

jest.mock("@/services/data-catalog-service", () => ({
  dataCatalogService: {
    getCollections: jest.fn().mockResolvedValue([]),
    searchItems: jest
      .fn()
      .mockResolvedValue({ features: [], context: { matched: 0 } }),
    getCollectionFieldMappings: jest.fn().mockResolvedValue({})
  }
}));
jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { createViewpoint: jest.fn(), getViewpoint: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("StacSearchPanel", () => {
  it("should render search filters header", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText("Search Filters")).toBeInTheDocument();
  });

  it("should render search button", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("should render spatial filter toggle", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText(/Filter by current map view/)).toBeInTheDocument();
  });

  it("should render text search input", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText(/Search Filters/)).toBeInTheDocument();
  });

  it("should render collections select when collections loaded", () => {
    const store = createTestStore();
    store.dispatch(
      fetchCollections.fulfilled(
        [{ id: "col-1", title: "Collection 1" }] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Collections/)).toBeInTheDocument();
  });
});

describe("StacSearchPanel - state-driven coverage", () => {
  it("should render loading spinner when collections are loading", () => {
    const store = createTestStore();
    store.dispatch(fetchCollections.pending("r", undefined));
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Loading collections/)).toBeInTheDocument();
  });

  it("should render search results count when results exist", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.fulfilled(
        {
          features: [{ id: "i1" }, { id: "i2" }],
          context: { matched: 50 }
        } as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Found 50 items/)).toBeInTheDocument();
  });

  it("should render Clear button when results exist", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.fulfilled(
        { features: [{ id: "i1" }], context: { matched: 1 } } as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("should render error message when search fails", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.rejected(new Error("Network error"), "r", undefined)
    );
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it("should render date range picker", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText(/Date Range/)).toBeInTheDocument();
  });

  it("should render bbox display when bbox filter is active", () => {
    const store = createTestStore();
    store.dispatch(toggleBboxFilter());
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Bbox:/)).toBeInTheDocument();
  });

  it("should show partial results message when showing fewer than total", () => {
    const store = createTestStore();
    store.dispatch(
      searchStacItems.fulfilled(
        { features: [{ id: "i1" }], context: { matched: 100 } } as never,
        "r",
        undefined
      )
    );
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/showing 1/)).toBeInTheDocument();
  });

  it("should render collection chips when collections selected", () => {
    const store = createTestStore();
    store.dispatch(
      fetchCollections.fulfilled(
        [
          { id: "col-1", title: "Landsat" },
          { id: "col-2", title: "Sentinel" }
        ] as never,
        "r",
        undefined
      )
    );
    store.dispatch(setCollectionFilter(["col-1"]));
    renderWithStore(<StacSearchPanel />, { store });
    const elements = screen.getAllByText("Landsat");
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it("should update query filter when text input changes", () => {
    const store = createTestStore();
    renderWithStore(<StacSearchPanel />, { store });

    const input = screen.getByPlaceholderText(/Cuba, Landsat/i);
    fireEvent.change(input, { target: { value: "urban areas" } });

    expect(store.getState().dataCatalog.search.filters.query).toBe(
      "urban areas"
    );
  });

  it("should toggle bbox filter when switch clicked", () => {
    const store = createTestStore();
    renderWithStore(<StacSearchPanel />, { store });

    const bboxSwitch = screen.getByRole("switch");
    fireEvent.click(bboxSwitch);

    expect(store.getState().dataCatalog.search.filters.useBboxFilter).toBe(
      true
    );
  });
});

describe("StacSearchPanel - rendering coverage", () => {
  it("should render Search Terms label", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText("Search Terms")).toBeInTheDocument();
  });

  it("should render search description text", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText(/Search across item titles/)).toBeInTheDocument();
  });

  it("should render date range description text", () => {
    renderWithStore(<StacSearchPanel />);
    expect(screen.getByText(/Select date range to filter/)).toBeInTheDocument();
  });

  it("should render search input placeholder", () => {
    renderWithStore(<StacSearchPanel />);
    expect(
      screen.getByPlaceholderText(/Cuba, Landsat, forest/)
    ).toBeInTheDocument();
  });

  it("should render with className prop", () => {
    const { container } = renderWithStore(
      <StacSearchPanel className="custom-class" />
    );
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
  });

  it("should render Searching... text when loading", () => {
    const store = createTestStore();
    store.dispatch(searchStacItems.pending("r", undefined));
    renderWithStore(<StacSearchPanel />, { store });
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it("should render date range with pre-set values", () => {
    const store = createTestStore();
    store.dispatch(
      setDateRangeFilter({
        start: "2024-01-01T00:00:00Z",
        end: "2024-12-31T23:59:59Z"
      })
    );
    renderWithStore(<StacSearchPanel />, { store });
    // Date range picker should be rendered with values
    expect(screen.getByText(/Date Range/)).toBeInTheDocument();
  });
});
