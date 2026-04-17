// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ThrottleCountdown component.
 * Covers countdown display, time formatting, and expiration callback.
 */

import { act, render, screen } from "@testing-library/react";

import { ThrottleCountdown } from "@/components/chat/throttle-countdown";

describe("ThrottleCountdown", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("should render countdown when time remaining", () => {
    const retryAt = Date.now() + 30000; // 30 seconds from now
    render(<ThrottleCountdown retryAt={retryAt} />);
    expect(screen.getByText(/Retry in/)).toBeInTheDocument();
  });

  it("should render null when already expired", () => {
    const retryAt = Date.now() - 1000; // 1 second ago
    const { container } = render(<ThrottleCountdown retryAt={retryAt} />);
    expect(container.innerHTML).toBe("");
  });

  it("should call onExpired when countdown reaches zero", () => {
    const onExpired = jest.fn();
    const retryAt = Date.now() + 2000; // 2 seconds from now

    render(<ThrottleCountdown retryAt={retryAt} onExpired={onExpired} />);

    // Advance past expiration
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(onExpired).toHaveBeenCalled();
  });

  it("should format minutes and seconds correctly", () => {
    const retryAt = Date.now() + 90000; // 90 seconds = 1:30
    render(<ThrottleCountdown retryAt={retryAt} />);
    expect(screen.getByText(/Retry in 1:30/)).toBeInTheDocument();
  });

  it("should format seconds only when under a minute", () => {
    const retryAt = Date.now() + 15000; // 15 seconds
    render(<ThrottleCountdown retryAt={retryAt} />);
    expect(screen.getByText(/Retry in 15s/)).toBeInTheDocument();
  });

  it("should update countdown every second", () => {
    const retryAt = Date.now() + 5000;
    render(<ThrottleCountdown retryAt={retryAt} />);

    expect(screen.getByText(/5s/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/4s/)).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/3s/)).toBeInTheDocument();
  });
});
