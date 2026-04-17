// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for McpServerManagementModal component.
 */

import { screen } from "@testing-library/react";

import { McpServerManagementModal } from "@/components/modals/mcp-server-management-modal";

import { renderWithStore } from "../../test-utils";

describe("McpServerManagementModal", () => {
  it("should render modal header when open", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByText("MCP Server Management")).toBeInTheDocument();
  });

  it("should render close button", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("should render auto-approve toggle", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByText(/Auto-approve all/)).toBeInTheDocument();
  });

  it("should not render when closed", () => {
    const { container } = renderWithStore(
      <McpServerManagementModal isOpen={false} onOpenChange={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for uncovered branches (lines 62-222)
// ---------------------------------------------------------------------------

import { fireEvent } from "@testing-library/react";

import { addServer } from "@/store/slices/mcp-slice";

import { createTestStore } from "../../test-utils";

describe("McpServerManagementModal - additional coverage", () => {
  it("should render McpServerManagement component inside modal body", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    // The default store has a Local Viewport Server, so it renders that
    expect(screen.getByText(/Local Viewport Server/)).toBeInTheDocument();
  });

  it("should render auto-approve all text", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(screen.getByText(/Auto-approve all/)).toBeInTheDocument();
  });

  it("should toggle auto-approve when the footer switch is clicked", () => {
    const store = createTestStore();
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );

    // Multiple switches exist — find the one associated with "Auto-approve all"
    const switches = screen.getAllByRole("switch");
    const autoApproveSwitch = switches[switches.length - 1]; // footer switch is last
    fireEvent.click(autoApproveSwitch);

    expect(store.getState().mcp.preferences.overrideAllApprovals).toBe(true);
  });

  it("should render server list when servers exist in store", () => {
    const store = createTestStore();
    store.dispatch(
      addServer({
        id: "srv-1",
        name: "Test Server",
        url: "https://test.com/mcp",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );
    expect(screen.getByText("Test Server")).toBeInTheDocument();
  });
});

describe("McpServerManagementModal - server interactions", () => {
  it("should render Add MCP Server button inside modal", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /add mcp server/i })
    ).toBeInTheDocument();
  });

  it("should call onOpenChange when close button clicked", () => {
    const onOpenChange = jest.fn();
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalled();
  });

  it("should show server toggle switches for each server", () => {
    const store = createTestStore();
    store.dispatch(
      addServer({
        id: "srv-1",
        name: "Server A",
        url: "https://a.com/mcp",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );
    store.dispatch(
      addServer({
        id: "srv-2",
        name: "Server B",
        url: "https://b.com/mcp",
        enabled: true,
        connectionStatus: "active",
        autoApprovedTools: [],
        disabledTools: []
      })
    );
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />,
      { store }
    );

    expect(screen.getByText("Server A")).toBeInTheDocument();
    expect(screen.getByText("Server B")).toBeInTheDocument();
  });
});

describe("McpServerManagementModal - add server flow", () => {
  it("should open add server form when Add MCP Server clicked", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );

    // Click the Add MCP Server button
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    // The add server form modal should appear
    expect(screen.getByText("Add New MCP Server")).toBeInTheDocument();
  });

  it("should render server name input in add form", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    expect(screen.getByLabelText(/Server Name/i)).toBeInTheDocument();
  });

  it("should render server URL input in add form", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    expect(screen.getByLabelText(/Server URL/i)).toBeInTheDocument();
  });

  it("should render description textarea in add form", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
  });

  it("should render enable switch in add form", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    expect(screen.getByText(/Enable server by default/)).toBeInTheDocument();
  });

  it("should render Cancel and Add Server buttons in add form", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    // Add Server button in the form (may be disabled)
    const addBtns = screen.getAllByRole("button", { name: /add server/i });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it("should have Add Server button disabled when form empty", () => {
    renderWithStore(
      <McpServerManagementModal isOpen={true} onOpenChange={jest.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /add mcp server/i }));

    // The submit button in the form should be disabled
    const addBtns = screen.getAllByRole("button", { name: /add server/i });
    const formSubmitBtn = addBtns[addBtns.length - 1]; // Last one is the form submit
    expect(formSubmitBtn).toBeDisabled();
  });
});
