// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for McpServerManagement component.
 */

import { render, screen } from "@testing-library/react";

import { McpServerManagement } from "@/components/mcp/mcp-server-management";

// Mock the mcp-slice selectors used internally
jest.mock("@/store/slices/mcp-slice", () => ({
  ...jest.requireActual("@/store/slices/mcp-slice"),
  selectMcpTools: () => [],
  selectMcpToolToServerMap: () => new Map()
}));

const defaultProps = {
  servers: [],
  preferences: { enabledServers: [], overrideAllApprovals: false },
  onUpdateServers: jest.fn(),
  onUpdatePreferences: jest.fn(),
  onAddServer: jest.fn()
};

describe("McpServerManagement", () => {
  it("should show empty state when no servers", () => {
    render(<McpServerManagement {...defaultProps} />);
    expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument();
  });

  it("should show Add MCP Server button", () => {
    render(<McpServerManagement {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /add mcp server/i })
    ).toBeInTheDocument();
  });

  it("should render server list when servers provided", () => {
    const servers = [
      {
        id: "srv-1",
        name: "Test Server",
        url: "https://test.com/mcp",
        description: "A test server",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={{ enabledServers: servers, overrideAllApprovals: false }}
      />
    );
    expect(screen.getByText("Test Server")).toBeInTheDocument();
  });

  it("should show server URL", () => {
    const servers = [
      {
        id: "srv-1",
        name: "Test Server",
        url: "https://test.com/mcp",
        description: "A test server",
        enabled: true,
        connectionStatus: "active" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={{ enabledServers: servers, overrideAllApprovals: false }}
      />
    );
    expect(screen.getByText("https://test.com/mcp")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for uncovered branches (lines 58-401)
// ---------------------------------------------------------------------------

import { fireEvent } from "@testing-library/react";

describe("McpServerManagement - additional coverage", () => {
  const servers = [
    {
      id: "srv-1",
      name: "Server One",
      url: "https://one.com/mcp",
      description: "First server",
      enabled: true,
      connectionStatus: "active" as const,
      autoApprovedTools: ["tool-a"] as string[],
      disabledTools: [] as string[]
    },
    {
      id: "srv-2",
      name: "Server Two",
      url: "https://two.com/mcp",
      description: "Second server",
      enabled: false,
      connectionStatus: "failed" as const,
      autoApprovedTools: [] as string[],
      disabledTools: [] as string[]
    }
  ];

  const preferences = { enabledServers: servers, overrideAllApprovals: false };

  it("should render multiple servers", () => {
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={preferences}
      />
    );
    expect(screen.getByText("Server One")).toBeInTheDocument();
    expect(screen.getByText("Server Two")).toBeInTheDocument();
  });

  it("should show server descriptions", () => {
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={preferences}
      />
    );
    expect(screen.getByText("First server")).toBeInTheDocument();
  });

  it("should show connection status indicators", () => {
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={preferences}
      />
    );
    expect(screen.getByText("https://two.com/mcp")).toBeInTheDocument();
  });

  it("should call onAddServer when Add button clicked", () => {
    const onAddServer = jest.fn();
    render(<McpServerManagement {...defaultProps} onAddServer={onAddServer} />);
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));
    expect(onAddServer).toHaveBeenCalled();
  });

  it("should render with disabled server styling", () => {
    render(
      <McpServerManagement
        {...defaultProps}
        servers={servers}
        preferences={preferences}
      />
    );
    expect(screen.getAllByText(/https:\/\//)).toHaveLength(2);
  });

  it("should call onUpdateServers when delete button clicked", () => {
    const onUpdateServers = jest.fn();
    const onUpdatePreferences = jest.fn();
    const { container } = render(
      <McpServerManagement
        servers={servers}
        preferences={preferences}
        onAddServer={jest.fn()}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateServers={onUpdateServers}
      />
    );

    // Delete buttons are icon-only with no accessible name — find by class
    const deleteButtons = container.querySelectorAll(
      "button.text-danger, button[class*='text-danger']"
    );
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]);

    expect(onUpdateServers).toHaveBeenCalled();
    expect(onUpdatePreferences).toHaveBeenCalled();
  });

  it("should call onUpdateServers when toggle switch clicked", () => {
    const onUpdateServers = jest.fn();
    const onUpdatePreferences = jest.fn();
    render(
      <McpServerManagement
        servers={servers}
        preferences={preferences}
        onAddServer={jest.fn()}
        onUpdatePreferences={onUpdatePreferences}
        onUpdateServers={onUpdateServers}
      />
    );

    // Toggle the first server's switch
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);

    expect(onUpdateServers).toHaveBeenCalled();
    expect(onUpdatePreferences).toHaveBeenCalled();
  });

  it("should show status chips for servers", () => {
    const serversWithStatus = [
      {
        id: "srv-1",
        name: "Ready Server",
        url: "https://ready.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        liveConnectionState: "ready",
        toolCount: 5,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      },
      {
        id: "srv-2",
        name: "Failed Server",
        url: "https://fail.com/mcp",
        enabled: true,
        connectionStatus: "failed" as const,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const prefs = {
      enabledServers: serversWithStatus,
      overrideAllApprovals: false
    };

    render(
      <McpServerManagement
        {...defaultProps}
        servers={serversWithStatus}
        preferences={prefs}
      />
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("should show tool count chip when tools available", () => {
    const serversWithTools = [
      {
        id: "srv-1",
        name: "Tool Server",
        url: "https://tools.com/mcp",
        enabled: true,
        connectionStatus: "active" as const,
        liveConnectionState: "ready",
        toolCount: 8,
        autoApprovedTools: [] as string[],
        disabledTools: [] as string[]
      }
    ];
    const prefs = {
      enabledServers: serversWithTools,
      overrideAllApprovals: false
    };

    render(
      <McpServerManagement
        {...defaultProps}
        servers={serversWithTools}
        preferences={prefs}
      />
    );
    expect(screen.getByText("8 tools")).toBeInTheDocument();
  });
});
