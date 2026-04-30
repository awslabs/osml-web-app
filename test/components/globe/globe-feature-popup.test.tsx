// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for GlobeFeaturePopup component.
 * Requires Cesium mocking for Cartesian3, SceneTransforms, and Viewer.
 */

jest.mock("cesium", () => ({
  Cartesian3: jest.fn(),
  SceneTransforms: {
    worldToWindowCoordinates: jest.fn(() => ({ x: 100, y: 200 }))
  }
}));

// Mock the CSS import
jest.mock("@/components/globe/globe-feature-popup.css", () => ({}));

import { fireEvent, render, screen } from "@testing-library/react";
import type { Viewer } from "cesium";

import { GlobeFeaturePopup } from "@/components/globe/globe-feature-popup";

const mockViewer = {
  scene: {
    preRender: {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }
  }
};

// Cast to Viewer for prop passing; the component only reads scene.preRender
// in tests, so the partial mock above is sufficient at runtime.
const mockViewerProp = mockViewer as unknown as Viewer;

const mockData = {
  position: {} as never,
  groups: [
    {
      label: "Classification",
      entries: [
        { key: "Class", value: "building" },
        { key: "Score", value: "95.0%" }
      ]
    },
    { label: "Location", entries: [{ key: "Latitude", value: "37.7749" }] }
  ],
  color: "#ff0000",
  title: "Detection Feature"
};

describe("GlobeFeaturePopup", () => {
  it("should render title", () => {
    render(
      <GlobeFeaturePopup
        data={mockData}
        viewer={mockViewerProp}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText("Detection Feature")).toBeInTheDocument();
  });

  it("should render property groups", () => {
    render(
      <GlobeFeaturePopup
        data={mockData}
        viewer={mockViewerProp}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText("Classification")).toBeInTheDocument();
    expect(screen.getByText("building")).toBeInTheDocument();
    expect(screen.getByText("95.0%")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
  });

  it("should call onClose when close button clicked", () => {
    const onClose = jest.fn();
    render(
      <GlobeFeaturePopup
        data={mockData}
        viewer={mockViewerProp}
        onClose={onClose}
      />
    );
    // Close button is an SVG button
    const closeBtn = screen.getByRole("button");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("should show empty state when no groups", () => {
    const emptyData = { ...mockData, groups: [] };
    render(
      <GlobeFeaturePopup
        data={emptyData}
        viewer={mockViewerProp}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText("No metadata available")).toBeInTheDocument();
  });

  it("should register preRender listener on mount", () => {
    render(
      <GlobeFeaturePopup
        data={mockData}
        viewer={mockViewerProp}
        onClose={jest.fn()}
      />
    );
    expect(mockViewer.scene.preRender.addEventListener).toHaveBeenCalled();
  });
});
