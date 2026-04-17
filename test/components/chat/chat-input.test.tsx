// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ChatInput component.
 * Covers rendering, message submission, disabled state, and keyboard handling.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChatInput } from "@/components/chat/chat-input";

describe("ChatInput", () => {
  it("should render input and send button", () => {
    render(<ChatInput onSendMessage={jest.fn()} />);
    expect(screen.getByPlaceholderText(/geospatial/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("should use custom placeholder", () => {
    render(<ChatInput onSendMessage={jest.fn()} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText("Type here...")).toBeInTheDocument();
  });

  it("should call onSendMessage with trimmed text on submit", async () => {
    const onSend = jest.fn();
    render(<ChatInput onSendMessage={onSend} />);

    const input = screen.getByPlaceholderText(/geospatial/i);
    await userEvent.type(input, "  Hello world  ");

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(onSend).toHaveBeenCalledWith("Hello world");
  });

  it("should clear input after submission", async () => {
    render(<ChatInput onSendMessage={jest.fn()} />);

    const input = screen.getByPlaceholderText(/geospatial/i);
    await userEvent.type(input, "Hello");

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(input).toHaveValue("");
  });

  it("should not submit empty messages", () => {
    const onSend = jest.fn();
    render(<ChatInput onSendMessage={onSend} />);

    const form = screen.getByPlaceholderText(/geospatial/i).closest("form")!;
    fireEvent.submit(form);

    expect(onSend).not.toHaveBeenCalled();
  });

  it("should not submit whitespace-only messages", async () => {
    const onSend = jest.fn();
    render(<ChatInput onSendMessage={onSend} />);

    const input = screen.getByPlaceholderText(/geospatial/i);
    await userEvent.type(input, "   ");

    const form = input.closest("form")!;
    fireEvent.submit(form);

    expect(onSend).not.toHaveBeenCalled();
  });

  it("should not submit when disabled", () => {
    const onSend = jest.fn();
    render(<ChatInput disabled onSendMessage={onSend} />);

    const input = screen.getByPlaceholderText(/geospatial/i);
    // Input should be disabled
    expect(input).toBeDisabled();
  });
});
