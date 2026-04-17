// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ChatWidget component.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatWidget } from "@/components/chat/chat-widget";

jest.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface">Chat</div>
}));
jest.mock("@/components/chat/loading-state", () => ({
  LoadingState: () => <div>Loading...</div>,
  useSystemReady: () => ({ isSystemReady: true })
}));
jest.mock("@/hooks/use-mcp", () => ({
  useMultipleMcp: jest.fn(() => ({
    tools: [],
    callTool: null,
    toolToServerMap: new Map(),
    McpConnections: null
  }))
}));

import { renderWithStore } from "../../test-utils";

describe("ChatWidget", () => {
  it("should render toggle button", () => {
    renderWithStore(<ChatWidget />);
    expect(
      screen.getByRole("button", { name: /ai chat/i })
    ).toBeInTheDocument();
  });

  it("should not show chat panel initially", () => {
    renderWithStore(<ChatWidget />);
    expect(screen.queryByTestId("chat-interface")).not.toBeInTheDocument();
  });

  it("should toggle chat panel on click", async () => {
    const { store } = renderWithStore(<ChatWidget />);
    await userEvent.click(
      screen.getByRole("button", { name: /open ai chat/i })
    );
    expect(store.getState().navbar.isChatWidgetExpanded).toBe(true);
  });
});
