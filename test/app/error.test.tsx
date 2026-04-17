// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for error.tsx error boundary page.
 */

import { fireEvent, render, screen } from "@testing-library/react";

import ErrorPage from "@/app/error";

describe("Error page", () => {
  it("should render error message", () => {
    render(
      <ErrorPage error={new globalThis.Error("Test error")} reset={jest.fn()} />
    );
    expect(screen.getByText("Something went wrong!")).toBeInTheDocument();
  });

  it("should render Try again button", () => {
    render(
      <ErrorPage error={new globalThis.Error("Test error")} reset={jest.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /try again/i })
    ).toBeInTheDocument();
  });

  it("should call reset when Try again clicked", () => {
    const reset = jest.fn();
    render(
      <ErrorPage error={new globalThis.Error("Test error")} reset={reset} />
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("should log error to console", () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const error = new globalThis.Error("Logged error");
    render(<ErrorPage error={error} reset={jest.fn()} />);
    expect(consoleSpy).toHaveBeenCalledWith(error);
    consoleSpy.mockRestore();
  });
});
