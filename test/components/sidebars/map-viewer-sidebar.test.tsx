// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for MapViewerSidebar component.
 */

import { screen } from "@testing-library/react";
import React from "react";

jest.mock("@/components/analytics", () => ({
  AnalyticsPanel: () => <div>Analytics</div>
}));
jest.mock("@/components/data-catalog/data-catalog", () => ({
  DataCatalog: () => <div>DataCatalog</div>
}));
jest.mock("@/components/sidebars/shared/map-controls", () => ({
  MapControls: () => <div>MapControls</div>
}));
jest.mock("@/components/sidebars/shared/job-list", () => ({
  JobList: () => <div>JobList</div>
}));
jest.mock("@/components/sidebars/shared/layer-controls", () => ({
  LayerControls: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}));

import { MapViewerSidebar } from "@/components/sidebars/map-viewer-sidebar";

import { renderWithStore } from "../../test-utils";

describe("MapViewerSidebar", () => {
  it("should render accordion sections", () => {
    renderWithStore(<MapViewerSidebar />);
    expect(screen.getByText("Image Processing Jobs")).toBeInTheDocument();
    expect(screen.getByText("Data Catalog")).toBeInTheDocument();
    expect(screen.getByText("Detection Analytics")).toBeInTheDocument();
    expect(screen.getByText("Map Controls")).toBeInTheDocument();
  });
});
