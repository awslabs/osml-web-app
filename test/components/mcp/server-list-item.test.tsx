// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ServerListItem component.
 * Pure props-driven component.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServerListItem } from "@/components/mcp/server-list-item";

const defaultServer = {
  id: "srv-1",
  name: "Test Server",
  url: "https://test.com/mcp",
  description: "A test MCP server",
  enabled: true,
  connectionStatus: "active" as const,
  autoApprovedTools: [] as string[],
  disabledTools: [] as string[]
};

const defaultProps = {
  server: defaultServer,
  isActive: true,
  connectionState: { status: "connected" as const },
  onToggleActive: jest.fn(),
  onRemove: jest.fn()
};

describe("ServerListItem", () => {
  it("should render server name", () => {
    render(<ServerListItem {...defaultProps} />);
    expect(screen.getByText("Test Server")).toBeInTheDocument();
  });

  it("should render server URL", () => {
    render(<ServerListItem {...defaultProps} />);
    expect(screen.getByText("https://test.com/mcp")).toBeInTheDocument();
  });

  it("should render toggle switch", () => {
    render(<ServerListItem {...defaultProps} />);
    expect(
      screen.getByRole("switch", { name: /toggle test server/i })
    ).toBeInTheDocument();
  });

  it("should render delete button", () => {
    render(<ServerListItem {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /remove test server/i })
    ).toBeInTheDocument();
  });

  it("should call onRemove when delete clicked", async () => {
    const onRemove = jest.fn();
    render(<ServerListItem {...defaultProps} onRemove={onRemove} />);
    await userEvent.click(
      screen.getByRole("button", { name: /remove test server/i })
    );
    expect(onRemove).toHaveBeenCalledWith("srv-1");
  });

  it("should show error message when connection has error", () => {
    render(
      <ServerListItem
        {...defaultProps}
        connectionState={{ status: "error", error: "Connection refused" }}
      />
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("should show connecting spinner", () => {
    render(
      <ServerListItem
        {...defaultProps}
        connectionState={{ status: "connecting" }}
      />
    );
    // Spinner should be present (aria-label="Loading")
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });
});
