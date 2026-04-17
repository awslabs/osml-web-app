// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ToolApprovalModal component.
 * Pure props-driven component — no Redux needed.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToolApprovalModal } from "@/components/mcp/tool-approval-modal";

const defaultProps = {
  isOpen: true,
  tool: {
    name: "get_viewport",
    args: { zoom: 5 },
    description: "Gets the current viewport"
  },
  serverName: "Local Server",
  isAutoApproved: false,
  onApprove: jest.fn(),
  onReject: jest.fn(),
  onToggleAutoApproval: jest.fn()
};

describe("ToolApprovalModal", () => {
  it("should render tool name and server name", () => {
    render(<ToolApprovalModal {...defaultProps} />);
    expect(screen.getByText("get_viewport")).toBeInTheDocument();
    expect(screen.getByText("Local Server")).toBeInTheDocument();
  });

  it("should render approve and deny buttons", () => {
    render(<ToolApprovalModal {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /approve/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deny/i })).toBeInTheDocument();
  });

  it("should call onApprove when approve clicked", async () => {
    const onApprove = jest.fn();
    render(<ToolApprovalModal {...defaultProps} onApprove={onApprove} />);
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it("should call onReject when deny clicked", async () => {
    const onReject = jest.fn();
    render(<ToolApprovalModal {...defaultProps} onReject={onReject} />);
    await userEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onReject).toHaveBeenCalled();
  });

  it("should render tool description when provided", () => {
    render(<ToolApprovalModal {...defaultProps} />);
    expect(screen.getByText("Gets the current viewport")).toBeInTheDocument();
  });

  it("should render nothing when tool is undefined", () => {
    const { container } = render(
      <ToolApprovalModal {...defaultProps} tool={undefined} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("should render auto-approve checkbox", () => {
    render(<ToolApprovalModal {...defaultProps} />);
    expect(screen.getByText(/Auto-approve this tool/)).toBeInTheDocument();
  });
});
