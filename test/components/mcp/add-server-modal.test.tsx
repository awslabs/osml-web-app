// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for AddServerModal component.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddServerModal } from "@/components/mcp/add-server-modal";

describe("AddServerModal", () => {
  it("should render modal header when open", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByText("Add MCP Server")).toBeInTheDocument();
  });

  it("should render form inputs", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByLabelText(/Server Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Server URL/i)).toBeInTheDocument();
  });

  it("should render Cancel and Add Server buttons", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add server/i })
    ).toBeInTheDocument();
  });

  it("should disable Add Server button when fields empty", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });

  it("should not render when closed", () => {
    const { container } = render(
      <AddServerModal isOpen={false} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for form submission and reset (lines 31-57)
// ---------------------------------------------------------------------------

describe("AddServerModal - form interactions", () => {
  it("should render description textarea", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
  });

  it("should call onClose when Cancel clicked", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(
      <AddServerModal isOpen={true} onClose={onClose} onAdd={jest.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("should have Add Server button disabled initially", () => {
    render(
      <AddServerModal isOpen={true} onClose={jest.fn()} onAdd={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: /add server/i })).toBeDisabled();
  });
});
