// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for GeoAgentSidebar component.
 */

import { screen } from "@testing-library/react";

import { GeoAgentSidebar } from "@/components/sidebars/geo-agent-sidebar";
import { setSelectedModel } from "@/store/slices/bedrock-model-slice";

jest.mock("@/services/bedrock-service", () => ({
  bedrockModelsService: {
    getAvailableModels: jest.fn(),
    getModelDisplayName: (m: { modelName: string }) => m.modelName || "Unknown"
  }
}));

import { createTestStore, renderWithStore } from "../../test-utils";

describe("GeoAgentSidebar", () => {
  it("should render AI Model section", () => {
    renderWithStore(<GeoAgentSidebar />);
    expect(screen.getByText("AI Model")).toBeInTheDocument();
  });

  it("should render MCP Servers section", () => {
    renderWithStore(<GeoAgentSidebar />);
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
  });

  it("should show model status as No Model Selected when none selected", () => {
    renderWithStore(<GeoAgentSidebar />);
    expect(screen.getByText("No Model Selected")).toBeInTheDocument();
  });

  it("should show Connected when model is selected", () => {
    const store = createTestStore();
    store.dispatch(
      setSelectedModel({
        modelId: "claude-1",
        modelName: "Claude",
        providerName: "Anthropic",
        inputModalities: ["TEXT"],
        outputModalities: ["TEXT"],
        supportsStreaming: true,
        supportsToolUse: true,
        modelLifecycle: "ACTIVE",
        customizationsSupported: [],
        inferenceTypesSupported: []
      })
    );
    renderWithStore(<GeoAgentSidebar />, { store });
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("should show server count info", () => {
    renderWithStore(<GeoAgentSidebar />);
    expect(screen.getByText("Total Servers:")).toBeInTheDocument();
  });

  it("should render Manage Servers button", () => {
    renderWithStore(<GeoAgentSidebar />);
    expect(
      screen.getByRole("button", { name: /manage servers/i })
    ).toBeInTheDocument();
  });
});
