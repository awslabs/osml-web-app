// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for map page.
 */

import { screen } from "@testing-library/react";
import React from "react";

// Mock next/dynamic to return a simple component
jest.mock("next/dynamic", () => () => {
  const MockMapViewer = () => <div data-testid="map-viewer">Map Viewer</div>;
  MockMapViewer.displayName = "MockMapViewer";
  return MockMapViewer;
});

jest.mock("@/components/chat/chat-widget", () => ({
  ChatWidget: () => <div data-testid="chat-widget">Chat Widget</div>
}));

jest.mock("@/components/sidebars/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  )
}));

jest.mock("@/components/sidebars/map-viewer-sidebar", () => ({
  MapViewerSidebar: () => <div data-testid="map-sidebar">Map Sidebar</div>
}));

import MapPage from "@/app/map/page";

import { renderWithStore } from "../../test-utils";

describe("MapPage", () => {
  it("should render sidebar with map viewer sidebar", () => {
    renderWithStore(<MapPage />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("map-sidebar")).toBeInTheDocument();
  });

  it("should render map viewer", () => {
    renderWithStore(<MapPage />);
    expect(screen.getByTestId("map-viewer")).toBeInTheDocument();
  });

  it("should render chat widget", () => {
    renderWithStore(<MapPage />);
    expect(screen.getByTestId("chat-widget")).toBeInTheDocument();
  });
});
