// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for geo-agent page.
 */

import { screen } from "@testing-library/react";
import React from "react";

// Mock heavy child components
jest.mock("@/components/chat", () => ({
  ChatInterface: (props: { title?: string }) => (
    <div data-testid="chat-interface">{props.title || "Chat"}</div>
  )
}));

jest.mock("@/components/sidebar", () => ({
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  )
}));

jest.mock("@/components/sidebars/geo-agent-sidebar", () => ({
  GeoAgentSidebar: () => <div data-testid="geo-agent-sidebar">Sidebar</div>
}));

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: {
    getAvailableModels: jest.fn(),
    getModelDisplayName: jest.fn()
  }
}));

import GeoAgentPage from "@/app/geo-agent/page";

import { renderWithStore } from "../../test-utils";

describe("GeoAgentPage", () => {
  it("should render sidebar", () => {
    renderWithStore(<GeoAgentPage />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("geo-agent-sidebar")).toBeInTheDocument();
  });

  it("should render chat interface with title", () => {
    renderWithStore(<GeoAgentPage />);
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
    expect(screen.getByText("Geospatial Agent")).toBeInTheDocument();
  });
});
