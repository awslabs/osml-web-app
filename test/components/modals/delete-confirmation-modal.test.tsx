// Copyright Amazon.com, Inc. or its affiliates.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { DeleteConfirmationModal } from "@/components/modals/delete-confirmation-modal";

// Mock the HeroUI modal components to avoid framer-motion dynamic import issues
jest.mock("@heroui/button", () => ({
  Button: ({
    children,
    onPress,
    ...props
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    [key: string]: unknown;
  }) => (
    <button onClick={onPress} {...props}>
      {children}
    </button>
  )
}));
jest.mock("@heroui/modal", () => ({
  Modal: ({
    children,
    isOpen
  }: {
    children: React.ReactNode;
    isOpen: boolean;
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalContent: ({
    children
  }: {
    children: React.ReactNode | ((onClose: () => void) => React.ReactNode);
  }) => (
    <div>{typeof children === "function" ? children(() => {}) : children}</div>
  ),
  ModalHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}));
jest.mock("@heroui/spinner", () => ({
  Spinner: () => (
    <div data-testid="spinner" role="status">
      Loading...
    </div>
  )
}));

describe("DeleteConfirmationModal", () => {
  const mockOnOpenChange = jest.fn();
  const mockOnDeleteAction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with correct content when item name is provided", () => {
    render(
      <DeleteConfirmationModal
        isOpen={true}
        itemName="test-job"
        itemType="job"
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    expect(screen.getByText("Confirm Delete")).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete "test-job"?')
    ).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("renders with generic message when item name is not provided", () => {
    render(
      <DeleteConfirmationModal
        isOpen={true}
        itemType="job"
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    expect(
      screen.getByText("Are you sure you want to delete this job?")
    ).toBeInTheDocument();
  });

  it("renders with correct item type in generic message", () => {
    render(
      <DeleteConfirmationModal
        isOpen={true}
        itemType="viewpoint"
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    expect(
      screen.getByText("Are you sure you want to delete this viewpoint?")
    ).toBeInTheDocument();
  });

  it("defaults to 'item' when no item type is provided", () => {
    render(
      <DeleteConfirmationModal
        isOpen={true}
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    expect(
      screen.getByText("Are you sure you want to delete this item?")
    ).toBeInTheDocument();
  });

  it("calls onDeleteAction when delete button is clicked", () => {
    render(
      <DeleteConfirmationModal
        isOpen={true}
        itemName="test-job"
        itemType="job"
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    const deleteButton = screen.getByText("Delete");
    fireEvent.click(deleteButton);

    expect(mockOnDeleteAction).toHaveBeenCalledTimes(1);
  });

  it("does not render when isOpen is false", () => {
    render(
      <DeleteConfirmationModal
        isOpen={false}
        itemName="test-job"
        itemType="job"
        onDeleteAction={mockOnDeleteAction}
        onOpenChange={mockOnOpenChange}
      />
    );

    // Modal should not be visible when closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
