// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for GlobeViewerSidebar component.
 */

import { screen } from "@testing-library/react";
import React from "react";

// Mock heavy child components
jest.mock("@/components/analytics", () => ({
  AnalyticsPanel: () => <div>Analytics</div>
}));
jest.mock("@/components/data-catalog/data-catalog", () => ({
  DataCatalog: () => <div>DataCatalog</div>
}));
jest.mock("@/components/sidebars/shared/globe-controls", () => ({
  GlobeControls: () => <div>GlobeControls</div>
}));
jest.mock("@/components/sidebars/shared/job-list", () => ({
  JobList: () => <div>JobList</div>
}));
jest.mock("@/components/sidebars/shared/layer-controls", () => ({
  LayerControls: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}));

import { GlobeViewerSidebar } from "@/components/sidebars/globe-viewer-sidebar";

import { renderWithStore } from "../../test-utils";

describe("GlobeViewerSidebar", () => {
  it("should render accordion sections", () => {
    renderWithStore(<GlobeViewerSidebar />);
    expect(screen.getByText("Image Processing Jobs")).toBeInTheDocument();
    expect(screen.getByText("Data Catalog")).toBeInTheDocument();
    expect(screen.getByText("Detection Analytics")).toBeInTheDocument();
    expect(screen.getByText("Globe Controls")).toBeInTheDocument();
  });
});
