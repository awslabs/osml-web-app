// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for globe page.
 */

import { screen } from "@testing-library/react";
import React from "react";

// Mock next/dynamic to return a simple component
jest.mock("next/dynamic", () => () => {
  const MockCesium = () => <div data-testid="cesium-viewer">Cesium Globe</div>;
  MockCesium.displayName = "MockCesium";
  return MockCesium;
});

jest.mock("@/components/chat/chat-widget", () => ({
  ChatWidget: () => <div data-testid="chat-widget">Chat Widget</div>
}));

jest.mock("@/components/sidebars/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  )
}));

jest.mock("@/components/sidebars/globe-viewer-sidebar", () => ({
  GlobeViewerSidebar: () => <div data-testid="globe-sidebar">Globe Sidebar</div>
}));

import GlobePage from "@/app/globe/page";

import { renderWithStore } from "../../test-utils";

describe("GlobePage", () => {
  it("should render sidebar with globe viewer sidebar", () => {
    renderWithStore(<GlobePage />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("globe-sidebar")).toBeInTheDocument();
  });

  it("should render cesium viewer", () => {
    renderWithStore(<GlobePage />);
    expect(screen.getByTestId("cesium-viewer")).toBeInTheDocument();
  });

  it("should render chat widget", () => {
    renderWithStore(<GlobePage />);
    expect(screen.getByTestId("chat-widget")).toBeInTheDocument();
  });
});
