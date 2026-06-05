// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { siteConfig } from "@/config/site";
import { ChatMessage, MessageType } from "@/types/chat";

interface UseAutoToolChainArgs {
  history: ChatMessage[];
  isProcessingToolChain: boolean;
  startToolChain: () => Promise<void>;
}

/**
 * Watches chat history and auto-runs the tool chain when the latest AI message
 * carries tool calls, with a circuit breaker that pauses for user confirmation
 * after `tool_call_limit` consecutive tool rounds (guards against infinite tool
 * loops). Extracted from ChatInterface; owns the counters/refs so the component
 * only renders the warning modal from `showToolLimitWarning`.
 */
export function useAutoToolChain({
  history,
  isProcessingToolChain,
  startToolChain
}: UseAutoToolChainArgs) {
  // Track the last message index processed to prevent re-processing.
  const lastProcessedMessageIndex = useRef(-1);
  // Consecutive tool-call rounds since the last human input (circuit breaker).
  const consecutiveToolCallCount = useRef(0);
  // Deferred tool-chain run, held while the limit-warning modal is open.
  const pendingToolChainExecution = useRef<(() => Promise<void>) | null>(null);
  const [showToolLimitWarning, setShowToolLimitWarning] = useState(false);
  const toolCallLimit = siteConfig.chat.tool_call_limit;

  useEffect(() => {
    const handleToolCalls = async () => {
      if (history.length && !isProcessingToolChain) {
        const currentMessageIndex = history.length - 1;
        const lastMessage = history.at(-1);

        // Check if the last message has tool calls that need to be processed
        if (
          lastMessage?.type === MessageType.AI &&
          lastMessage.toolCalls &&
          lastMessage.toolCalls.length > 0 &&
          currentMessageIndex > lastProcessedMessageIndex.current
        ) {
          // Update lastProcessedIndex IMMEDIATELY to prevent race conditions
          lastProcessedMessageIndex.current = currentMessageIndex;

          // Circuit breaker: Check for potential infinite loop
          consecutiveToolCallCount.current += 1;

          if (consecutiveToolCallCount.current > toolCallLimit) {
            // Store the pending execution for after user confirmation
            pendingToolChainExecution.current = async () => {
              await startToolChain();
            };

            // Show warning modal to user
            setShowToolLimitWarning(true);

            return;
          }

          // Start the tool chain — handles multiple rounds automatically
          await startToolChain();
        }
      }
    };

    handleToolCalls();
  }, [history, toolCallLimit, isProcessingToolChain, startToolChain]);

  /** Reset the consecutive-call counter (call when the human sends input). */
  const resetToolCallCount = useCallback(() => {
    consecutiveToolCallCount.current = 0;
  }, []);

  /** Full reset of loop tracking (call when history is cleared). */
  const resetToolLoopState = useCallback(() => {
    consecutiveToolCallCount.current = 0;
    lastProcessedMessageIndex.current = -1;
  }, []);

  /** User chose to stop at the limit warning. */
  const cancelToolLimit = useCallback(() => {
    consecutiveToolCallCount.current = 0;
    pendingToolChainExecution.current = null;
    setShowToolLimitWarning(false);
  }, []);

  /** User chose to continue past the limit warning. */
  const continueToolLimit = useCallback(async () => {
    consecutiveToolCallCount.current = 0;
    setShowToolLimitWarning(false);

    if (pendingToolChainExecution.current) {
      await pendingToolChainExecution.current();
      pendingToolChainExecution.current = null;
    }
  }, []);

  return {
    toolCallLimit,
    showToolLimitWarning,
    resetToolCallCount,
    resetToolLoopState,
    cancelToolLimit,
    continueToolLimit
  };
}
