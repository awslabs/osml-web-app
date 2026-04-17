// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { bedrockChatService } from "@/services/bedrock-service";
import {
  clearThrottle,
  selectThrottleForModel,
  setThrottled
} from "@/store/slices/bedrock-throttle-slice";
import {
  addMessage,
  addNotification,
  selectChatSession
} from "@/store/slices/chat-session-slice";
import { RootState } from "@/store/store";
import { ChatMessage, MessageType } from "@/types/chat";
import { isApiError } from "@/utils/api-client";

import { useQuotaUsage } from "./use-quota-usage";

interface BedrockResponse {
  message: string;
  toolCalls?: Array<{
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  requiresToolExecution?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export const useChatGeneration = ({
  openAiTools
}: {
  openAiTools?: Array<Record<string, unknown>>;
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const stopRequested = useRef(false);
  const dispatch = useDispatch();

  const { selectedModel } = useSelector(
    (state: RootState) => state.bedrockModel
  );

  const { fetchQuotaUsage } = useQuotaUsage();

  // Get current session from Redux
  const session = useSelector(selectChatSession);

  // Get current throttle state for selected model
  const throttleInfo = useSelector((state: RootState) =>
    selectedModel ? selectThrottleForModel(state, selectedModel.modelId) : null
  );

  // Notification service using Redux dispatch
  const notificationService = useCallback(
    (message: string, type: "info" | "warning" | "error") => {
      dispatch(
        addNotification({
          type,
          message,
          timestamp: new Date()
        })
      );
    },
    [dispatch]
  );

  const generateResponse = useCallback(
    async (additionalMessages?: ChatMessage[]) => {
      if (!selectedModel?.modelId) {
        throw new Error("No model selected");
      }

      // Include tools if available, no strict validation
      // This fixes the generic response issue on first query

      setIsRunning(true);
      stopRequested.current = false;

      try {
        // concatenate session history with additional messages
        const messagesToProcess = additionalMessages
          ? [...session.history, ...additionalMessages]
          : session.history;

        // Get current session messages, filtering out empty content
        // Only send role and content to match backend ChatMessage model
        const cleanMessages = messagesToProcess
          .filter((msg) => msg.content.trim().length > 0)
          .map((msg) => ({
            role:
              msg.type === MessageType.HUMAN
                ? ("user" as const)
                : msg.type === MessageType.AI
                  ? ("assistant" as const)
                  : msg.type === MessageType.TOOL
                    ? ("user" as const) // Tool results are sent as user messages
                    : ("system" as const),
            content: msg.content
          }));

        // CRITICAL: Bedrock requires conversations to end with a user message
        // Remove trailing assistant messages (like error messages from failed retries)
        while (
          cleanMessages.length > 0 &&
          cleanMessages[cleanMessages.length - 1].role === "assistant"
        ) {
          cleanMessages.pop();
        }

        // Validate we have at least one message and it ends with user
        if (cleanMessages.length === 0) {
          throw new Error("No valid messages to send");
        }

        if (cleanMessages[cleanMessages.length - 1].role !== "user") {
          throw new Error(
            "Invalid conversation format: must end with user message"
          );
        }

        // Prepare request payload
        const requestPayload: {
          messages: typeof cleanMessages;
          modelId: string;
          maxTokens: number;
          tools?: Array<Record<string, unknown>>;
        } = {
          messages: cleanMessages,
          modelId: selectedModel.modelId,
          maxTokens: 4000
        };

        // Include tools if available, no strict validation
        if (openAiTools && openAiTools.length > 0) {
          requestPayload.tools = openAiTools;
        }

        const data: BedrockResponse =
          await bedrockChatService.sendChatMessage(requestPayload);

        // Clear any existing throttle state on successful request
        if (throttleInfo?.isThrottled && selectedModel) {
          dispatch(clearThrottle(selectedModel.modelId));
        }

        // Create AI response message with potential tool calls
        const aiMessage = new ChatMessage({
          type: MessageType.AI,
          content: data.message.trim(),
          toolCalls:
            data.toolCalls?.map((tc) => ({
              id: tc.toolUseId,
              name: tc.name,
              args: tc.input,
              type: "function"
            })) || []
        });

        // Add AI message to Redux
        dispatch(addMessage(aiMessage));

        // Immediately fetch updated quota status after successful chat
        fetchQuotaUsage();
      } catch (error: unknown) {
        // Handle throttling errors specially
        if (
          isApiError(error) &&
          error.status === 429 &&
          (error.data?.detail as Record<string, unknown> | undefined)?.error ===
            "throttled"
        ) {
          const throttleData = error.data!.detail as Record<string, unknown>;

          // Dispatch throttle state to Redux
          if (selectedModel) {
            dispatch(
              setThrottled({
                modelId:
                  (throttleData.model_id as string) || selectedModel.modelId,
                errorType: throttleData.error_type as
                  | "rate_limit"
                  | "service_unavailable",
                message: throttleData.message as string,
                retryAfterSeconds: throttleData.retry_after_seconds as number,
                timestamp: throttleData.timestamp as string
              })
            );
          }

          // Determine the specific limit that was exceeded
          const isTokenLimit =
            throttleData.error_type === "quota_exceeded" &&
            (throttleData.message as string).toLowerCase().includes("token");
          const isRequestLimit =
            throttleData.error_type === "quota_exceeded" &&
            (throttleData.message as string).toLowerCase().includes("request");
          const isRequestTooLarge = throttleData.retry_after_seconds === 0;

          let limitType = "Rate";

          if (isTokenLimit) limitType = "Token";
          else if (isRequestLimit) limitType = "Request";

          // Create concise, informative error message
          let content: string;

          if (isRequestTooLarge) {
            content = `${limitType} limit exceeded. Request too large - please reduce conversation length.`;
          } else {
            content = `${limitType} limit exceeded.`;
          }

          const errorMessage = new ChatMessage({
            type: MessageType.AI,
            content,
            canRetry: !isRequestTooLarge, // Allow retry unless request is too large
            error: "throttled",
            metadata: {
              throttleData: {
                retryAfterSeconds: throttleData.retry_after_seconds as number,
                errorType: throttleData.error_type as string,
                limitType,
                isPermanent: isRequestTooLarge
              }
            }
          });

          // Add error message to Redux
          dispatch(addMessage(errorMessage));

          notificationService(
            isRequestTooLarge
              ? `${limitType} limit exceeded - request too large`
              : `${limitType} limit exceeded - retry in ${throttleData.retry_after_seconds as number}s`,
            "warning"
          );
        } else {
          // Handle other errors normally
          const errorMessage = new ChatMessage({
            type: MessageType.AI,
            content: `Error: ${error instanceof Error ? error.message : "Failed to generate response"}`,
            canRetry: true,
            error: error instanceof Error ? error.message : "Unknown error"
          });

          // Add error message to Redux
          dispatch(addMessage(errorMessage));

          notificationService("Chat generation failed", "error");
        }
      } finally {
        setIsRunning(false);
      }
    },
    [
      selectedModel,
      session.history,
      dispatch,
      openAiTools,
      notificationService,
      fetchQuotaUsage,
      throttleInfo
    ]
  );

  const stopGeneration = useCallback(() => {
    stopRequested.current = true;
    setIsRunning(false);
  }, []);

  return {
    isRunning,
    generateResponse,
    stopGeneration,
    throttleInfo
  };
};
