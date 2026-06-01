// Copyright Amazon.com, Inc. or its affiliates.
import { fireEvent, render, screen } from "@testing-library/react";

import { DestructiveConfirmationCard } from "@/components/chat/destructive-confirmation-card";

const baseProps = {
  title: "Delete collection?",
  message: "Delete collection 'eo_imagery_2023' and all its items?",
  warning: "This cannot be undone.",
  onConfirm: jest.fn(),
  onCancel: jest.fn()
};

describe("DestructiveConfirmationCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("pending state", () => {
    it("renders title, message, warning, and both buttons", () => {
      render(<DestructiveConfirmationCard {...baseProps} status="pending" />);
      expect(screen.getByText("Delete collection?")).toBeInTheDocument();
      expect(
        screen.getByText(/Delete collection 'eo_imagery_2023'/)
      ).toBeInTheDocument();
      expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /cancel/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete/i })
      ).toBeInTheDocument();
    });

    it("calls onConfirm when Delete is clicked", () => {
      render(<DestructiveConfirmationCard {...baseProps} status="pending" />);
      fireEvent.click(screen.getByRole("button", { name: /delete/i }));
      expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
      expect(baseProps.onCancel).not.toHaveBeenCalled();
    });

    it("calls onCancel when Cancel is clicked", () => {
      render(<DestructiveConfirmationCard {...baseProps} status="pending" />);
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
      expect(baseProps.onConfirm).not.toHaveBeenCalled();
    });

    it("renders without a warning when none provided", () => {
      render(
        <DestructiveConfirmationCard
          {...baseProps}
          status="pending"
          warning={undefined}
        />
      );
      expect(
        screen.queryByText("This cannot be undone.")
      ).not.toBeInTheDocument();
    });
  });

  describe("terminal states", () => {
    it("completed: shows deleted message and hides action buttons", () => {
      render(<DestructiveConfirmationCard {...baseProps} status="completed" />);
      expect(screen.getByText(/Deleted/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /cancel/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^delete$/i })
      ).not.toBeInTheDocument();
    });

    it("cancelled: shows cancelled message and hides action buttons", () => {
      render(<DestructiveConfirmationCard {...baseProps} status="cancelled" />);
      expect(screen.getByText(/Cancelled by user/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /cancel/i })
      ).not.toBeInTheDocument();
    });

    it("failed: shows failure message with error detail and hides buttons", () => {
      render(
        <DestructiveConfirmationCard
          {...baseProps}
          errorMessage="Network timeout"
          status="failed"
        />
      );
      expect(screen.getByText(/Failed/)).toBeInTheDocument();
      expect(screen.getByText("Network timeout")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^delete$/i })
      ).not.toBeInTheDocument();
    });
  });
});
