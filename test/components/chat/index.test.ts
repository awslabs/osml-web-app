// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for chat barrel export.
 */

import { ChatInput, ChatInterface, ChatMessage } from "@/components/chat";

describe("chat/index", () => {
  it("should export all chat components", () => {
    expect(ChatInterface).toBeDefined();
    expect(ChatMessage).toBeDefined();
    expect(ChatInput).toBeDefined();
  });
});
