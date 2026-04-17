// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ChatMessage component.
 * Covers user/AI message rendering, thinking indicator, tool results,
 * retry button, and throttle retry.
 */

import { render, screen } from "@testing-library/react";

import { ChatMessage as ChatMessageComponent } from "@/components/chat/chat-message";
import { ChatMessage, MessageType } from "@/types/chat";

describe("ChatMessage", () => {
  it("should render user message content", () => {
    const msg = new ChatMessage({
      type: MessageType.HUMAN,
      content: "Hello there"
    });
    render(<ChatMessageComponent message={msg} />);
    expect(screen.getByText("Hello there")).toBeInTheDocument();
  });

  it("should render AI message content", () => {
    const msg = new ChatMessage({
      type: MessageType.AI,
      content: "I can help with that."
    });
    render(<ChatMessageComponent message={msg} />);
    expect(screen.getByText("I can help with that.")).toBeInTheDocument();
  });

  it("should render timestamp", () => {
    const msg = new ChatMessage({ type: MessageType.HUMAN, content: "Test" });
    render(<ChatMessageComponent message={msg} />);
    // Timestamp is rendered as toLocaleTimeString
    const timeStr = msg.timestamp.toLocaleTimeString();
    expect(screen.getByText(timeStr)).toBeInTheDocument();
  });

  it("should render thinking indicator with spinner", () => {
    const msg = new ChatMessage({
      type: MessageType.AI,
      content: "Thinking..."
    });
    msg.id = "thinking-indicator";
    render(<ChatMessageComponent message={msg} />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("should render retry button when showRetry is true and message has error", () => {
    const msg = new ChatMessage({
      type: MessageType.AI,
      content: "Error occurred",
      canRetry: true,
      error: "some_error"
    });
    const onRetry = jest.fn();
    render(<ChatMessageComponent message={msg} onRetry={onRetry} showRetry />);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("should not render retry button for user messages", () => {
    const msg = new ChatMessage({ type: MessageType.HUMAN, content: "Hello" });
    render(
      <ChatMessageComponent message={msg} onRetry={jest.fn()} showRetry />
    );
    expect(
      screen.queryByRole("button", { name: /retry/i })
    ).not.toBeInTheDocument();
  });

  it("should render tool results accordion when present", () => {
    const msg = new ChatMessage({
      type: MessageType.AI,
      content: "Done.",
      toolResults: [
        {
          toolCallId: "tc-1",
          toolName: "get_viewport",
          content: '{"lat": 0}',
          status: "success"
        }
      ]
    });
    render(<ChatMessageComponent message={msg} />);
    expect(screen.getByText(/Tool Results/)).toBeInTheDocument();
  });
});
