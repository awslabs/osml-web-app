// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ThrottleRetryButton component.
 * Covers countdown timer, retry enabled state, and permanent error display.
 */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThrottleRetryButton } from "@/components/chat/throttle-retry-button";

describe("ThrottleRetryButton", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("should show retry button immediately when retryAfterSeconds is 0", () => {
    render(<ThrottleRetryButton retryAfterSeconds={0} onRetry={jest.fn()} />);
    expect(screen.getByRole("button")).not.toBeDisabled();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("should show countdown when retryAfterSeconds > 0", () => {
    render(<ThrottleRetryButton retryAfterSeconds={30} onRetry={jest.fn()} />);
    // Button should be disabled during countdown
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("should enable retry after countdown completes", () => {
    render(<ThrottleRetryButton retryAfterSeconds={2} onRetry={jest.fn()} />);

    // Initially disabled
    expect(screen.getByRole("button")).toBeDisabled();

    // Advance past countdown
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("should show permanent error message when isPermanent", () => {
    render(
      <ThrottleRetryButton
        retryAfterSeconds={30}
        onRetry={jest.fn()}
        isPermanent
      />
    );
    expect(screen.getByText(/Request too large/)).toBeInTheDocument();
    // Should not show a button
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("should call onRetry when clicked after countdown", async () => {
    jest.useRealTimers(); // Need real timers for userEvent
    const onRetry = jest.fn();
    render(<ThrottleRetryButton retryAfterSeconds={0} onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
