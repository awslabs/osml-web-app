// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for layout-client.tsx.
 */

import React from "react";

// Mock cesium CSS import
jest.mock("cesium/Build/Cesium/Widgets/widgets.css", () => ({}));

// Mock heavy child components to avoid deep dependency chains
jest.mock("@/components/app/app-initializer", () => ({
  AppInitializer: () => null
}));

jest.mock("@/components/navigation/navbar", () => ({
  Navbar: () => <nav data-testid="navbar">Navbar</nav>
}));

jest.mock("@/components/navigation/route-tracker", () => ({
  RouteTracker: () => null
}));

jest.mock("@/config/fonts", () => ({
  fontSans: { variable: "mock-font-var" }
}));

// Mock next-themes
jest.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  )
}));

import { screen } from "@testing-library/react";

import { RootLayoutClient } from "@/app/layout-client";

import { renderWithStore } from "../test-utils";

describe("RootLayoutClient", () => {
  it("should render children", () => {
    renderWithStore(
      <RootLayoutClient session={null}>
        <div data-testid="page-content">Page</div>
      </RootLayoutClient>
    );
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("should render navbar", () => {
    renderWithStore(
      <RootLayoutClient session={null}>
        <div>Content</div>
      </RootLayoutClient>
    );
    expect(screen.getByTestId("navbar")).toBeInTheDocument();
  });
});
