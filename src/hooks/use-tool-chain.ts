// Copyright Amazon.com, Inc. or its affiliates.
import { useCallback, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { McpServerConfig } from "@/hooks/use-mcp";
import { McpCallTool } from "@/hooks/use-mcp-runtime";
import { dataCatalogService } from "@/services/data-catalog-service";
import { deleteJob } from "@/services/job-management";
import {
  addMessages,
  addNotification,
  selectChatHistory
} from "@/store/slices/chat-session-slice";
import {
  JobSnapshot,
  removeJobOptimistically,
  restoreJob,
  VectorStyle
} from "@/store/slices/jobs-slice";
import {
  closeDestructiveConfirmation,
  closeToolApprovalModal,
  selectDestructiveConfirmation,
  selectIsProcessingToolChain,
  selectMcpPreferences,
  selectMcpToolToServerMap,
  selectToolApprovalModal,
  setProcessingToolChain,
  showDestructiveConfirmation,
  showToolApprovalModal
} from "@/store/slices/mcp-slice";
import { AppDispatch, RootState, store } from "@/store/store";
import {
  ChatMessage,
  ConfirmationRequiredPayload,
  MessageType,
  ToolExecutionStatus,
  ToolResult
} from "@/types/chat";

export const useToolChain = ({
  generateResponse,
  callTool
}: {
  generateResponse: (additionalMessages?: ChatMessage[]) => Promise<void>;
  callTool: McpCallTool | null;
}) => {
  const dispatch = useDispatch();
  // Get chat history from Redux
  const history = useSelector(selectChatHistory);

  const [callingToolName, setCallingToolName] = useState<string | undefined>();
  const [toolExecutions, setToolExecutions] = useState<ToolExecutionStatus[]>(
    []
  );
  const stopRequested = useRef(false);

  // Redux selectors
  const mcpPreferences = useSelector(selectMcpPreferences);
  const toolApprovalModalState = useSelector(selectToolApprovalModal);
  const destructiveConfirmation = useSelector(selectDestructiveConfirmation);
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

  // Global MCP tool→server map (Redux); `callTool` is injected via props.
  const toolToServerMap = useSelector(selectMcpToolToServerMap);

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

  // Pending destructive confirmation promises, keyed by requestId. The card
  // resolves with "confirm" or "cancel" via handleDestructive*.
  const pendingConfirmations = useRef<
    Map<string, { resolve: (choice: "confirm" | "cancel") => void }>
  >(new Map());

  const checkAutoApproval = useCallback(
    (toolName: string): boolean => {
      if (mcpPreferences?.overrideAllApprovals) {
        return true;
      }

      const serverName = toolToServerMap[toolName];

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

  const extractConfirmationPayload = useCallback(
    (result: unknown): ConfirmationRequiredPayload | undefined => {
      const isPayload = (v: unknown): v is ConfirmationRequiredPayload =>
        typeof v === "object" &&
        v !== null &&
        (v as Record<string, unknown>).confirmationRequired === true &&
        typeof (v as Record<string, unknown>).action === "string" &&
        typeof (v as Record<string, unknown>).title === "string";

      if (isPayload(result)) return result;

      // External MCP servers wrap results as [{type:"text", text:"<json>"}].
      if (Array.isArray(result)) {
        for (const item of result) {
          if (
            typeof item === "object" &&
            item !== null &&
            "type" in item &&
            item.type === "text" &&
            "text" in item &&
            typeof item.text === "string"
          ) {
            try {
              const parsed: unknown = JSON.parse(item.text);
              if (isPayload(parsed)) return parsed;
            } catch {
              // Not JSON; ignore.
            }
          } else if (isPayload(item)) {
            return item;
          }
        }
      }
      return undefined;
    },
    []
  );

  const requestDestructiveConfirmation = useCallback(
    (payload: ConfirmationRequiredPayload): Promise<"confirm" | "cancel"> => {
      return new Promise((resolve) => {
        const requestId = `conf-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 11)}`;
        pendingConfirmations.current.set(requestId, { resolve });
        dispatch(showDestructiveConfirmation({ requestId, payload }));
      });
    },
    [dispatch]
  );

  const handleDestructiveConfirm = useCallback(() => {
    if (!destructiveConfirmation) return;
    const { requestId } = destructiveConfirmation;
    const cbs = pendingConfirmations.current.get(requestId);
    if (cbs) {
      cbs.resolve("confirm");
      pendingConfirmations.current.delete(requestId);
    }
    dispatch(closeDestructiveConfirmation());
  }, [destructiveConfirmation, dispatch]);

  const handleDestructiveCancel = useCallback(() => {
    if (!destructiveConfirmation) return;
    const { requestId } = destructiveConfirmation;
    const cbs = pendingConfirmations.current.get(requestId);
    if (cbs) {
      cbs.resolve("cancel");
      pendingConfirmations.current.delete(requestId);
    }
    dispatch(closeDestructiveConfirmation());
  }, [destructiveConfirmation, dispatch]);

  /**
   * Runs the actual delete service call for a confirmed payload. The result
   * shape mirrors what each tool's pre-refactor handler returned so the
   * agent's view of the conversation stays consistent.
   */
  const performDeletion = useCallback(
    async (payload: ConfirmationRequiredPayload): Promise<unknown> => {
      try {
        switch (payload.action) {
          case "delete_stac_collection": {
            const id = payload.args.collection_id as string;
            await dataCatalogService.deleteCollection(id);
            return {
              success: true,
              completed: true,
              action: "delete_stac_collection",
              deleted: { collection_id: id },
              message: `Collection '${id}' and all of its items were deleted after user confirmation. This deletion is final; do not retry.`
            };
          }
          case "delete_stac_item": {
            const cid = payload.args.collection_id as string;
            const iid = payload.args.item_id as string;
            await dataCatalogService.deleteItem(cid, iid);
            return {
              success: true,
              completed: true,
              action: "delete_stac_item",
              deleted: { collection_id: cid, item_id: iid },
              message: `Item '${iid}' was deleted from collection '${cid}' after user confirmation. This deletion is final; do not retry.`
            };
          }
          case "delete_image_processing_job": {
            return await runJobDelete(payload.args.job_id as string);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return {
          success: false,
          completed: true,
          action: payload.action,
          error: msg,
          message: `Deletion failed after user confirmation: ${msg}. Do not retry automatically; report the failure to the user.`
        };
      }
    },
    []
  );

  const awaitConfirmationIfNeeded = useCallback(
    async (rawResult: unknown): Promise<unknown> => {
      const payload = extractConfirmationPayload(rawResult);
      if (!payload) return rawResult;

      const choice = await requestDestructiveConfirmation(payload);
      if (choice === "cancel") {
        return {
          success: false,
          completed: true,
          cancelled: true,
          action: payload.action,
          message:
            "User declined the deletion. Do not retry; the user has explicitly chosen not to proceed."
        };
      }
      return await performDeletion(payload);
    },
    [
      extractConfirmationPayload,
      requestDestructiveConfirmation,
      performDeletion
    ]
  );

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
    async (currentHistory: ChatMessage[]) => {
      if (isProcessingToolChain) {
        return; // Prevent concurrent processing
      }

      const lastMessage = currentHistory.at(-1);

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
            const rawResult = await executeToolWithApproval(tool);
            // For destructive tools the handler returns a confirmation
            // request; this blocks on the user's click and substitutes the
            // actual deletion result. For non-destructive tools, it returns
            // the original value unchanged.
            const result = await awaitConfirmationIfNeeded(rawResult);
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
          // Create tool result messages following LISA's pattern.
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
      awaitConfirmationIfNeeded,
      formatToolResult,
      dispatch,
      generateResponse,
      notificationService
    ]
  );

  const startToolChain = useCallback(async () => {
    await processToolCallChain(history);
  }, [processToolCallChain, history]);

  const stopToolChain = useCallback(() => {
    stopRequested.current = true;
    // Resolve any in-flight destructive confirmation as cancelled so the
    // tool chain can proceed past it cleanly.
    pendingConfirmations.current.forEach((cbs) => cbs.resolve("cancel"));
    pendingConfirmations.current.clear();
    if (destructiveConfirmation) {
      dispatch(closeDestructiveConfirmation());
    }
  }, [destructiveConfirmation, dispatch]);

  return {
    startToolChain,
    stopToolChain,
    isProcessingChain: () => isProcessingToolChain,
    callingToolName,
    toolExecutions,
    toolApprovalModal: toolApprovalModalState,
    handleToolApproval,
    handleToolRejection,
    destructiveConfirmation,
    handleDestructiveConfirm,
    handleDestructiveCancel
  };
};

/**
 * Job deletion preserves the model-runner tool's optimistic-with-rollback
 * semantics: snapshot the job, optimistically remove it from Redux, call the
 * backend, restore on failure.
 */
async function runJobDelete(jobId: string): Promise<unknown> {
  const state = store.getState() as RootState;
  const job = state.jobs.jobsList.jobs.find((j) => j.job_id === jobId);
  if (!job) {
    return {
      success: false,
      completed: true,
      action: "delete_image_processing_job",
      message: `Job '${jobId}' was not found at deletion time. It may have been deleted already or never existed. Do not retry.`
    };
  }

  const orderIndex = state.jobs.jobsList.customOrder.indexOf(jobId);
  const wasSelected = state.jobs.selection.selectedJobs.some(
    (j) => j.job_id === jobId
  );
  const layerStyle: VectorStyle | undefined =
    state.jobs.selection.layerStyles[jobId];
  const snapshot: JobSnapshot = {
    job,
    orderIndex:
      orderIndex >= 0 ? orderIndex : state.jobs.jobsList.jobs.indexOf(job),
    wasSelected,
    layerStyle
  };

  const dispatch = store.dispatch as AppDispatch;
  dispatch(removeJobOptimistically({ jobId }));
  const result = await deleteJob(jobId, job.output_bucket);

  if (!result.success) {
    dispatch(restoreJob(snapshot));
    return {
      success: false,
      completed: true,
      action: "delete_image_processing_job",
      deleted: { job_id: jobId },
      error: result.error || "Failed to delete job",
      message: `Job '${jobId}' deletion failed: ${result.error || "unknown error"}. Do not retry automatically; report the failure to the user.`
    };
  }

  const label = job.job_name || jobId;
  const partial = result.partialFailures;
  if (partial && (partial.viewpoint || partial.s3)) {
    return {
      success: true,
      completed: true,
      action: "delete_image_processing_job",
      deleted: { job_id: jobId },
      partial_failures: {
        ...(partial.viewpoint ? { viewpoint: partial.viewpoint } : {}),
        ...(partial.s3 ? { s3: partial.s3 } : {})
      },
      message: `Job '${label}' was deleted after user confirmation, with cleanup warnings noted. This deletion is final; do not retry.`
    };
  }
  return {
    success: true,
    completed: true,
    action: "delete_image_processing_job",
    deleted: { job_id: jobId },
    message: `Job '${label}' was deleted after user confirmation. This deletion is final; do not retry.`
  };
}
