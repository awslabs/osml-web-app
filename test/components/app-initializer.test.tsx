// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AppInitializer component.
 */

import { screen } from "@testing-library/react";

// Mock the heavy use-mcp hook
jest.mock("@/hooks/use-mcp", () => ({
  useMultipleMcp: jest.fn(() => ({
    tools: [],
    callTool: null,
    toolToServerMap: new Map(),
    McpConnections: null
  }))
}));

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: { getAvailableModels: jest.fn().mockResolvedValue([]) }
}));

import { AppInitializer } from "@/components/app-initializer";

import { renderWithStore } from "../test-utils";

describe("AppInitializer", () => {
  it("should render without crashing", () => {
    // AppInitializer renders a hidden div with MCP connections
    const { container } = renderWithStore(<AppInitializer />);
    expect(
      container.querySelector("[style*='display: none']")
    ).toBeInTheDocument();
  });

  it("should not render visible content", () => {
    renderWithStore(<AppInitializer />);
    // The component renders display:none — no visible text
    expect(screen.queryByText(/./)).toBeNull();
  });
});
