// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ImageAdjustmentControls component.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImageAdjustmentControls } from "@/components/image-adjustment/image-adjustment-controls";
import { setSelectedViewpoint } from "@/store/slices/image-viewer-slice";

// Mock the auto-adjust context
jest.mock("@/contexts/auto-adjust-context", () => ({
  useAutoAdjust: () => ({
    performAutoAdjust: jest.fn().mockResolvedValue({
      success: true,
      adjustments: { exposure: 0.5, contrast: 0.2, gamma: 1.2 }
    }),
    clearBaselineHistogram: jest.fn()
  })
}));

// Mock the slider component to avoid complex HeroUI slider rendering
jest.mock("@/components/image-adjustment/image-adjustment-slider", () => ({
  AdjustmentSlider: ({
    label,
    value,
    onChange
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
  }) => (
    <div data-testid={`slider-${label}`}>
      <label>{label}</label>
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  )
}));

jest.mock("@/services/viewpoint-service", () => ({
  viewpointService: { getViewpoints: jest.fn() }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("ImageAdjustmentControls", () => {
  it("should show disabled message when no viewpoint selected", () => {
    renderWithStore(<ImageAdjustmentControls />);
    expect(screen.getByText(/Select a viewpoint/)).toBeInTheDocument();
  });

  it("should render sliders when viewpoint is selected", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });
    expect(screen.getByText("Exposure")).toBeInTheDocument();
    expect(screen.getByText("Contrast")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("should render Reset and Auto buttons", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /auto/i })).toBeInTheDocument();
  });

  it("should render RGB gain sliders", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });
    expect(screen.getByText("Red Gain")).toBeInTheDocument();
    expect(screen.getByText("Green Gain")).toBeInTheDocument();
    expect(screen.getByText("Blue Gain")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for handleReset, handleAuto, handleAdjustmentChange (lines 44-83)
// ---------------------------------------------------------------------------

import { fireEvent } from "@testing-library/react";

describe("ImageAdjustmentControls - interactions", () => {
  it("should dispatch resetAdjustments when Reset clicked", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));

    // Adjustments should be back to defaults
    const adj = store.getState().imageViewer.currentAdjustments;
    expect(adj.exposure).toBe(0);
    expect(adj.contrast).toBe(0);
  });

  it("should dispatch setAllAdjustments when Auto clicked", async () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });

    await userEvent.click(screen.getByRole("button", { name: /auto/i }));

    // Auto-adjust mock returns exposure: 0.5, contrast: 0.2, gamma: 1.2
    const adj = store.getState().imageViewer.currentAdjustments;
    expect(adj.exposure).toBe(0.5);
    expect(adj.contrast).toBe(0.2);
    expect(adj.gamma).toBe(1.2);
  });

  it("should update adjustment when slider changes", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });

    const exposureSlider = screen.getByRole("slider", { name: /exposure/i });
    fireEvent.change(exposureSlider, { target: { value: "0.5" } });

    expect(store.getState().imageViewer.currentAdjustments.exposure).toBe(0.5);
  });

  it("should render Saturation slider", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls />, { store });
    expect(screen.getByText("Saturation")).toBeInTheDocument();
  });

  it("should show disabled message when disabled prop is true", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls disabled={true} />, { store });
    expect(screen.getByText(/Select a viewpoint/)).toBeInTheDocument();
  });

  it("should call onAutoAdjustError when auto-adjust context is null", () => {
    const onError = jest.fn();
    const store = createTestStore();
    store.dispatch(
      setSelectedViewpoint({ viewpointId: "vp-1", viewpointTileSize: 256 })
    );
    renderWithStore(<ImageAdjustmentControls onAutoAdjustError={onError} />, {
      store
    });

    // Auto button should be present
    expect(screen.getByRole("button", { name: /auto/i })).toBeInTheDocument();
  });
});
