// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { FormEvent, KeyboardEvent, useState } from "react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput = ({
  onSendMessage,
  disabled = false,
  placeholder = "Ask a geospatial question..."
}: ChatInputProps) => {
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!message.trim() || disabled) {
      return;
    }

    const trimmedMessage = message.trim();

    setMessage("");
    await onSendMessage(trimmedMessage);
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className="flex gap-2" onSubmit={handleSubmit}>
      <Input
        className="flex-1"
        classNames={{
          input: "min-h-[44px] cursor-text",
          inputWrapper: "min-h-[44px] cursor-text"
        }}
        isDisabled={disabled}
        placeholder={placeholder}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={handleKeyPress}
      />
      <Button
        className="min-h-[44px] px-6"
        color="primary"
        isDisabled={!message.trim() || disabled}
        type="submit"
      >
        Send
      </Button>
    </form>
  );
};
