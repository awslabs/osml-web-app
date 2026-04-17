// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { McpServerConfig } from "@/hooks/use-mcp";
import {
  addMessages,
  addNotification,
  selectChatSession
} from "@/store/slices/chat-session-slice";
import {
  closeToolApprovalModal,
  mcpGlobals,
  selectIsProcessingToolChain,
  selectMcpPreferences,
  selectToolApprovalModal,
  setProcessingToolChain,
  showToolApprovalModal
} from "@/store/slices/mcp-slice";
import {
  ChatMessage,
  ChatSession,
  MessageType,
  ToolExecutionStatus,
  ToolResult
} from "@/types/chat";

export const useToolChain = ({
  generateResponse
}: {
  generateResponse: (additionalMessages?: ChatMessage[]) => Promise<void>;
}) => {
  const dispatch = useDispatch();
  // Get session from Redux
  const session = useSelector(selectChatSession);

  const [callingToolName, setCallingToolName] = useState<string | undefined>();
  const [toolExecutions, setToolExecutions] = useState<ToolExecutionStatus[]>(
    []
  );
  const stopRequested = useRef(false);

  // Redux selectors
  const mcpPreferences = useSelector(selectMcpPreferences);
  const toolApprovalModalState = useSelector(selectToolApprovalModal);
  const isProcessingToolChain = useSelector(selectIsProcessingToolChain);

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

  // Global MCP tools and utilities
  const callTool = mcpGlobals.callTool;
  const toolToServerMap = mcpGlobals.toolToServerMap;

  // Store Promise callbacks in a ref Map (not serializable, can't go in Redux)
  const pendingApprovals = useRef<
    Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >
  >(new Map());

  const checkAutoApproval = useCallback(
    (toolName: string): boolean => {
      if (mcpPreferences?.overrideAllApprovals) {
        return true;
      }

      const serverName = toolToServerMap?.get(toolName);

      if (!serverName) return false;

      const server = mcpPreferences?.enabledServers.find(
        (s: McpServerConfig) => s.name === serverName
      );

      return server?.autoApprovedTools.includes(toolName) ?? false;
    },
    [mcpPreferences, toolToServerMap]
  );

  const executeToolWithApproval = useCallback(
    async (tool: {
      id: string;
      name: string;
      args: Record<string, unknown>;
    }): Promise<unknown> => {
      const isAutoApproved = checkAutoApproval(tool.name);

      if (isAutoApproved) {
        if (!callTool) throw new Error("No MCP tool caller available");

        return await callTool(tool.name, tool.args);
      } else {
        return new Promise((resolve, reject) => {
          const requestId = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Store callbacks in Map
          pendingApprovals.current.set(requestId, { resolve, reject });
          // Dispatch Redux action to show modal
          dispatch(
            showToolApprovalModal({
              requestId,
              tool: {
                name: tool.name,
                args: tool.args
              }
            })
          );
        });
      }
    },
    [callTool, checkAutoApproval, dispatch]
  );

  const handleToolApproval = useCallback(async () => {
    if (
      !toolApprovalModalState.isOpen ||
      !toolApprovalModalState.requestId ||
      !toolApprovalModalState.tool
    ) {
      return;
    }

    const requestId = toolApprovalModalState.requestId;
    const callbacks = pendingApprovals.current.get(requestId);

    if (!callbacks) {
      dispatch(closeToolApprovalModal());

      return;
    }

    try {
      dispatch(closeToolApprovalModal());

      if (!callTool) throw new Error("No MCP tool caller available");

      const result = await callTool(
        toolApprovalModalState.tool.name,
        toolApprovalModalState.tool.args
      );

      callbacks.resolve(result);
      pendingApprovals.current.delete(requestId);
    } catch (error) {
      callbacks.reject(
        error instanceof Error ? error : new Error(String(error))
      );
      pendingApprovals.current.delete(requestId);
    }
  }, [toolApprovalModalState, callTool, dispatch]);

  const handleToolRejection = useCallback(() => {
    if (!toolApprovalModalState.isOpen || !toolApprovalModalState.requestId) {
      return;
    }

    const requestId = toolApprovalModalState.requestId;
    const callbacks = pendingApprovals.current.get(requestId);

    if (callbacks) {
      callbacks.reject(new Error("Tool execution cancelled by user"));
      pendingApprovals.current.delete(requestId);
    }

    dispatch(closeToolApprovalModal());
  }, [toolApprovalModalState, dispatch]);

  const formatToolResult = useCallback((result: unknown): string => {
    if (Array.isArray(result)) {
      return result
        .map((item) => {
          if (
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item
          ) {
            return String(item.text);
          }

          return JSON.stringify(item, null, 2);
        })
        .join("\n");
    } else if (typeof result === "object" && result !== null) {
      return JSON.stringify(result, null, 2);
    } else {
      return String(result);
    }
  }, []);

  const processToolCallChain = useCallback(
    async (currentSession: ChatSession) => {
      if (isProcessingToolChain) {
        return; // Prevent concurrent processing
      }

      const lastMessage = currentSession.history.at(-1);

      // Check if there are tool calls to process
      if (
        !lastMessage ||
        lastMessage.type !== MessageType.AI ||
        !lastMessage.toolCalls ||
        lastMessage.toolCalls.length === 0
      ) {
        return; // No tool calls to process
      }

      dispatch(setProcessingToolChain(true));
      stopRequested.current = false;

      try {
        const toolCalls = lastMessage.toolCalls;
        const toolResults: ToolResult[] = [];

        // Initialize tool execution status
        setToolExecutions(
          toolCalls.map((tc) => ({
            toolName: tc.name,
            status: "executing",
            startTime: new Date()
          }))
        );

        // Execute tool calls sequentially
        for (const tool of toolCalls) {
          if (stopRequested.current) {
            if (notificationService) {
              notificationService(
                "Tool chain execution stopped by user",
                "info"
              );
            }
            break;
          }

          setCallingToolName(tool.name);
          try {
            const result = await executeToolWithApproval(tool);
            const formattedContent = formatToolResult(result);

            toolResults.push({
              toolCallId: tool.id,
              toolName: tool.name,
              content: formattedContent,
              status: "success"
            });

            // Update tool execution status
            setToolExecutions((prev: ToolExecutionStatus[]) =>
              prev.map((te: ToolExecutionStatus) =>
                te.toolName === tool.name
                  ? {
                      ...te,
                      status: "completed" as const,
                      endTime: new Date(),
                      result: formattedContent
                    }
                  : te
              )
            );
          } catch (error: unknown) {
            const errorObj = error as Error;

            if (errorObj.message === "Tool execution cancelled by user") {
              if (notificationService) {
                notificationService(
                  `Tool execution cancelled: ${tool.name}`,
                  "info"
                );
              }
              break; // Stop the chain if user cancels
            } else {
              const errorMessage = `Error: ${errorObj instanceof Error ? errorObj.message : "Unknown error"}`;

              toolResults.push({
                toolCallId: tool.id,
                toolName: tool.name,
                content: errorMessage,
                status: "error"
              });

              // Update tool execution status
              setToolExecutions((prev: ToolExecutionStatus[]) =>
                prev.map((te: ToolExecutionStatus) =>
                  te.toolName === tool.name
                    ? {
                        ...te,
                        status: "failed" as const,
                        endTime: new Date(),
                        error: errorMessage
                      }
                    : te
                )
              );

              if (notificationService) {
                notificationService(
                  `Tool execution failed: ${tool.name}`,
                  "error"
                );
              }
            }
          }
        }

        if (toolResults.length > 0 && !stopRequested.current) {
          // Create tool result messages following LISA's pattern
          const toolResultMessages = toolResults.map(
            (tr) =>
              new ChatMessage({
                type: MessageType.TOOL,
                content: tr.content,
                metadata: {
                  toolCallId: tr.toolCallId,
                  toolName: tr.toolName,
                  isToolResult: true
                }
              })
          );

          // Add tool result messages to Redux
          dispatch(addMessages(toolResultMessages));

          // Reset processing flag before generateResponse to allow subsequent tool chains
          dispatch(setProcessingToolChain(false));

          // Generate response with tool result messagesto enable the LLM to process
          // tool outputs and provide proper responses
          await generateResponse(toolResultMessages);
        }
      } finally {
        dispatch(setProcessingToolChain(false));
        setCallingToolName(undefined);
        setToolExecutions([]);
      }
    },
    [
      isProcessingToolChain,
      executeToolWithApproval,
      formatToolResult,
      dispatch,
      generateResponse,
      notificationService
    ]
  );

  const startToolChain = useCallback(async () => {
    await processToolCallChain(session);
  }, [processToolCallChain, session]);

  const stopToolChain = useCallback(() => {
    stopRequested.current = true;
  }, []);

  return {
    startToolChain,
    stopToolChain,
    isProcessingChain: () => isProcessingToolChain,
    callingToolName,
    toolExecutions,
    toolApprovalModal: toolApprovalModalState,
    handleToolApproval,
    handleToolRejection
  };
};
