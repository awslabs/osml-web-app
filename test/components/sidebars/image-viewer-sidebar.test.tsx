// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ImageViewerSidebar component.
 */

import { screen } from "@testing-library/react";

import { ImageViewerSidebar } from "@/components/sidebars/image-viewer-sidebar";
import { fetchViewpoints } from "@/store/slices/image-viewer-slice";

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: {
    getViewpoints: jest.fn(),
    createViewpoint: jest.fn(),
    deleteViewpoint: jest.fn(),
    getViewpointBounds: jest.fn(),
    getViewpointMetadata: jest.fn(),
    getViewpointInfo: jest.fn(),
    getViewpointStatistics: jest.fn()
  }
}));
jest.mock("@/services/s3-service", () => ({
  s3Service: {
    getBuckets: jest.fn().mockResolvedValue([]),
    getBucketContents: jest.fn().mockResolvedValue([])
  }
}));
jest.mock("@/contexts/auto-adjust-context", () => ({
  useAutoAdjust: () => ({
    performAutoAdjust: jest.fn(),
    clearBaselineHistogram: jest.fn()
  })
}));
jest.mock("@/components/image-adjustment-slider", () => ({
  AdjustmentSlider: ({ label }: { label: string }) => <div>{label}</div>
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("ImageViewerSidebar", () => {
  it("should render Viewpoints accordion section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Viewpoints")).toBeInTheDocument();
  });

  it("should render Create Viewpoint button", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(
      screen.getByRole("button", { name: /create new viewpoint/i })
    ).toBeInTheDocument();
  });

  it("should show viewpoint list when viewpoints loaded", () => {
    const store = createTestStore();
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-1",
            viewpoint_name: "Test Viewpoint",
            viewpoint_status: "READY"
          }
        ] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<ImageViewerSidebar />, { store });
    expect(screen.getByText("Test Viewpoint")).toBeInTheDocument();
  });

  it("should render Image Adjustments section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Image Adjustments")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for uncovered branches (lines 57-129)
// ---------------------------------------------------------------------------

describe("ImageViewerSidebar - additional coverage", () => {
  it("should show loading state when viewpoints are loading", () => {
    const store = createTestStore();
    store.dispatch(fetchViewpoints.pending("r", undefined));
    renderWithStore(<ImageViewerSidebar />, { store });
    expect(screen.getByText(/Loading viewpoints/)).toBeInTheDocument();
  });

  it("should show error state when viewpoints fail to load", () => {
    const store = createTestStore();
    store.dispatch(fetchViewpoints.rejected(new Error("fail"), "r", undefined));
    renderWithStore(<ImageViewerSidebar />, { store });
    expect(screen.getByText(/Failed to load viewpoints/)).toBeInTheDocument();
  });

  it("should show empty state when no viewpoints exist", () => {
    const store = createTestStore();
    store.dispatch(fetchViewpoints.fulfilled([] as never, "r", undefined));
    renderWithStore(<ImageViewerSidebar />, { store });
    expect(screen.getByText(/No viewpoints available/)).toBeInTheDocument();
  });

  it("should render Bounds accordion section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Bounds")).toBeInTheDocument();
  });

  it("should render Metadata accordion section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Metadata")).toBeInTheDocument();
  });

  it("should render Info accordion section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("should render Statistics accordion section", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });

  it("should render multiple viewpoints in list", () => {
    const store = createTestStore();
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-1",
            viewpoint_name: "Viewpoint A",
            viewpoint_status: "READY"
          },
          {
            viewpoint_id: "vp-2",
            viewpoint_name: "Viewpoint B",
            viewpoint_status: "READY"
          }
        ] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<ImageViewerSidebar />, { store });
    expect(screen.getByText("Viewpoint A")).toBeInTheDocument();
    expect(screen.getByText("Viewpoint B")).toBeInTheDocument();
  });
});

import { fireEvent } from "@testing-library/react";

describe("ImageViewerSidebar - viewpoint interaction", () => {
  it("should dispatch setSelectedViewpoint when viewpoint selected", () => {
    const store = createTestStore();
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-1",
            viewpoint_name: "VP One",
            viewpoint_status: "READY",
            tile_size: 512
          },
          {
            viewpoint_id: "vp-2",
            viewpoint_name: "VP Two",
            viewpoint_status: "READY",
            tile_size: 256
          }
        ] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<ImageViewerSidebar />, { store });

    // Click on a viewpoint to select it
    fireEvent.click(screen.getByText("VP One"));

    const state = store.getState().imageViewer;
    expect(state.selectedViewpoint).not.toBeNull();
  });

  it("should render delete buttons for each viewpoint", () => {
    const store = createTestStore();
    store.dispatch(
      fetchViewpoints.fulfilled(
        [
          {
            viewpoint_id: "vp-1",
            viewpoint_name: "VP One",
            viewpoint_status: "READY"
          }
        ] as never,
        "r",
        undefined
      )
    );
    renderWithStore(<ImageViewerSidebar />, { store });

    // Delete button should exist (icon-only button within the listbox item)
    const deleteButtons = screen
      .getAllByRole("button")
      .filter((btn) => btn.className.includes("danger"));
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it("should render Bounds accordion header", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Bounds")).toBeInTheDocument();
  });

  it("should render Metadata accordion header", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Metadata")).toBeInTheDocument();
  });

  it("should render Info accordion header", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("should render Statistics accordion header", () => {
    renderWithStore(<ImageViewerSidebar />);
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });
});
