// Copyright Amazon.com, Inc. or its affiliates.
"use client";
import { Cog6ToothIcon, ServerIcon } from "@heroicons/react/24/outline";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Tooltip } from "@heroui/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import { DestructiveConfirmationCard } from "@/components/chat/destructive-confirmation-card";
import { ToolApprovalModal } from "@/components/mcp/tool-approval-modal";
import { siteConfig } from "@/config/site";
import { useChatGeneration } from "@/hooks/use-chat-generation";
import { useSmartQuotaPolling } from "@/hooks/use-smart-quota-polling";
import { useToolChain } from "@/hooks/use-tool-chain";
import { bedrockModelsService } from "@/services/bedrock-service";
import {
  clearExpiredThrottles,
  clearThrottle,
  selectThrottleForModel
} from "@/store/slices/bedrock-throttle-slice";
import {
  addMessage,
  addMessages,
  addNotification,
  clearHistory,
  removeMessage,
  selectChatSession,
  updateUserActivity
} from "@/store/slices/chat-session-slice";
import {
  mcpGlobals,
  selectIsProcessingToolChain,
  selectMcpPreferences,
  selectTotalToolCount,
  toggleToolAutoApproval
} from "@/store/slices/mcp-slice";
import { RootState } from "@/store/store";
import { ChatMessage as NewChatMessage, MessageType } from "@/types/chat";

import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { LoadingState, useSystemReady } from "./loading-state";
import { QuotaConfigModal } from "./quota-config-modal";
import { QuotaMeter } from "./quota-meter";
import { ThrottleCountdown } from "./throttle-countdown";

export interface ChatInterfaceProps {
  className?: string;
  variant?: "full" | "widget" | "compact";
  title?: string;
  showHeader?: boolean;
  showServerInfo?: boolean;
  maxHeight?: string;
  onConnectionChange?: (connected: boolean) => void;
  serverUrl?: string;
  onOpenServerConfig?: () => void;
}

export const ChatInterface = ({
  className = "",
  variant = "full",
  title = "Geospatial Agent",
  showHeader = true,
  maxHeight,
  onConnectionChange,
  onOpenServerConfig
}: ChatInterfaceProps) => {
  const [isConnected] = useState(true); // Always connected for MCP
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();

  // Refs to track processing state and prevent concurrent execution
  const lastProcessedMessageIndex = useRef(-1);

  // Circuit breaker mechanism to prevent infinite tool loops
  const consecutiveToolCallCount = useRef(0);
  const TOOL_CALL_LIMIT = siteConfig.chat.tool_call_limit;
  const [showToolLimitWarning, setShowToolLimitWarning] = useState(false);
  const pendingToolChainExecution = useRef<(() => Promise<void>) | null>(null);
  const [showQuotaConfig, setShowQuotaConfig] = useState(false);

  // Redux selectors
  const { selectedModel, isLoading: modelsLoading } = useSelector(
    (state: RootState) => state.bedrockModel
  );
  const mcpPreferences = useSelector(selectMcpPreferences);
  const totalToolCount = useSelector(selectTotalToolCount);
  const isProcessingToolChain = useSelector(selectIsProcessingToolChain);
  const session = useSelector(selectChatSession);

  // Get throttle info for current model
  const throttleInfo = useSelector((state: RootState) =>
    selectedModel ? selectThrottleForModel(state, selectedModel.modelId) : null
  );

  // Global MCP tools
  const mcpTools = mcpGlobals.tools;

  // Format tools for OpenAI compatibility - driven from Redux state
  const openAiTools =
    mcpTools && mcpTools.length > 0
      ? mcpTools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description || `Tool: ${tool.name}`,
            parameters: {
              type: "object",
              properties: tool.inputSchema?.properties || {},
              required: tool.inputSchema?.required || []
            }
          }
        }))
      : [];

  // Single source of truth for welcome message
  const getWelcomeMessage = useCallback((toolCount: number) => {
    return `Hello! I'm your Geospatial Agent with access to ${toolCount} specialized tools. I can help with mapping, navigation, spatial analysis, and coordinates. What would you like to explore?`;
  }, []);

  const { isRunning, generateResponse, stopGeneration } = useChatGeneration({
    openAiTools
  });

  const {
    startToolChain,
    stopToolChain,
    isProcessingChain,
    callingToolName,
    toolExecutions,
    toolApprovalModal,
    handleToolApproval,
    handleToolRejection,
    destructiveConfirmation,
    handleDestructiveConfirm,
    handleDestructiveCancel
  } = useToolChain({
    generateResponse
  });

  // Auto-clear expired throttles periodically
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch(clearExpiredThrottles());
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [dispatch]);

  // Handle throttle expiration
  const handleThrottleExpired = useCallback(() => {
    if (selectedModel) {
      dispatch(clearThrottle(selectedModel.modelId));
    }
  }, [selectedModel, dispatch]);

  // Initialize smart quota polling
  useSmartQuotaPolling();

  useEffect(() => {
    const handleToolCalls = async () => {
      if (session.history.length && !isProcessingToolChain) {
        const currentMessageIndex = session.history.length - 1;
        const lastMessage = session.history.at(-1);

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

          if (consecutiveToolCallCount.current > TOOL_CALL_LIMIT) {
            // Store the pending execution for after user confirmation
            pendingToolChainExecution.current = async () => {
              await startToolChain();
            };

            // Show warning modal to user
            setShowToolLimitWarning(true);

            return;
          }

          // Start the tool chain - this will handle multiple rounds of tool calls automatically
          await startToolChain();
        }
      }
    };

    handleToolCalls();
  }, [session.history, TOOL_CALL_LIMIT, isProcessingToolChain, startToolChain]);

  // Use consolidated system readiness hook
  const { isSystemReady, isLoadingModels, isLoadingMcpTools } =
    useSystemReady();

  // Add system context message when system is fully ready
  // Use ref to prevent React StrictMode double-mount from adding duplicate messages
  const hasAddedWelcomeMessage = useRef(false);

  useEffect(() => {
    if (
      session.history.length === 0 &&
      isSystemReady &&
      totalToolCount > 0 &&
      !hasAddedWelcomeMessage.current
    ) {
      hasAddedWelcomeMessage.current = true;

      const systemMessage = new NewChatMessage({
        type: MessageType.AI,
        content: getWelcomeMessage(totalToolCount)
      });

      dispatch(addMessage(systemMessage));
    }

    // Reset flag when history is cleared
    if (session.history.length === 0) {
      hasAddedWelcomeMessage.current = false;
    }
  }, [
    isSystemReady,
    session.history.length,
    totalToolCount,
    getWelcomeMessage,
    dispatch
  ]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [session.history.length]);

  // Notify parent of connection changes
  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(isConnected);
    }
  }, [isConnected, onConnectionChange]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!selectedModel?.modelId) {
        return;
      }

      try {
        // Update user activity for smart polling
        dispatch(updateUserActivity());

        // Reset tool call counter when human provides input
        consecutiveToolCallCount.current = 0;

        // CRITICAL FIX: Build complete message context synchronously
        const messagesToAdd: NewChatMessage[] = [];

        // Add welcome message if this is the first user interaction
        if (session.history.length === 0 && totalToolCount > 0) {
          const systemMessage = new NewChatMessage({
            type: MessageType.AI,
            content: getWelcomeMessage(totalToolCount)
          });

          messagesToAdd.push(systemMessage);
        }

        // Add user message
        const userMessage = new NewChatMessage({
          type: MessageType.HUMAN,
          content
        });

        messagesToAdd.push(userMessage);

        // Add messages to Redux
        dispatch(addMessages(messagesToAdd));

        // Pass messages directly to generateResponse to bypass React state timing
        await generateResponse(messagesToAdd);
      } catch (error) {
        // Add error notification to Redux
        dispatch(
          addNotification({
            type: "error",
            message: `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
            timestamp: new Date()
          })
        );
      }
    },
    [
      selectedModel,
      generateResponse,
      session,
      totalToolCount,
      getWelcomeMessage,
      dispatch
    ]
  );

  const handleClearHistory = useCallback(() => {
    // Reset circuit breaker when clearing history
    consecutiveToolCallCount.current = 0;

    // Clear history in Redux
    dispatch(clearHistory());
    lastProcessedMessageIndex.current = -1;
  }, [dispatch]);

  const handleStop = useCallback(() => {
    stopToolChain();
    stopGeneration();
  }, [stopToolChain, stopGeneration]);

  const handleRetry = useCallback(
    async (messageId: string) => {
      const failedMessage = session.history.find((m) => m.id === messageId);

      // Check if this was ANY throttled AI message (includes tool calls AND final summaries)
      if (
        failedMessage?.error === "throttled" &&
        failedMessage.type === MessageType.AI
      ) {
        // Clear throttle state first
        if (selectedModel) {
          dispatch(clearThrottle(selectedModel.modelId));
        }

        // Check if there are actual pending tool calls to resume
        if (failedMessage.toolCalls && failedMessage.toolCalls.length > 0) {
          try {
            await startToolChain();
          } catch {
            // Fallback to regular regeneration if tool chain fails
            dispatch(removeMessage(messageId));
            await generateResponse();
          }
        } else {
          // No tool calls found - this is a final AI summary that was throttled
          try {
            dispatch(removeMessage(messageId));
            await generateResponse();
          } catch (error) {
            dispatch(
              addNotification({
                type: "error",
                message: `Retry failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                timestamp: new Date()
              })
            );
          }
        }
      } else {
        // Regular text retry - remove message and regenerate
        dispatch(removeMessage(messageId));

        try {
          await generateResponse();
        } catch (error) {
          dispatch(
            addNotification({
              type: "error",
              message: `Retry failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              timestamp: new Date()
            })
          );
        }
      }
    },
    [dispatch, generateResponse, session.history, selectedModel, startToolChain]
  );

  const handleToggleAutoApproval = () => {
    if (!toolApprovalModal?.isOpen || !toolApprovalModal?.tool) return;

    const toolName = toolApprovalModal.tool.name;
    const serverName = mcpGlobals.toolToServerMap.get(toolName);
    const server = mcpPreferences.enabledServers.find(
      (s) => s.name === serverName
    );

    if (server) {
      dispatch(toggleToolAutoApproval({ serverId: server.id, toolName }));
    }
  };

  // Check if the current tool in the approval modal is auto-approved.
  const isCurrentToolAutoApproved = () => {
    if (!toolApprovalModal?.tool) return false;

    const toolName = toolApprovalModal.tool.name;
    const serverName = mcpGlobals.toolToServerMap.get(toolName);
    const server = mcpPreferences.enabledServers.find(
      (s) => s.name === serverName
    );

    return server?.autoApprovedTools?.includes(toolName) ?? false;
  };

  // Determine if we should show stop button
  const shouldShowStopButton =
    isRunning || !!callingToolName || isProcessingChain();

  // Check if chat is throttled
  const isThrottled = throttleInfo?.isThrottled || false;

  // Determine variant-specific styling
  const getVariantStyles = () => {
    switch (variant) {
      case "widget":
        return {
          container: "max-w-sm h-full",
          header: showHeader ? "text-base" : "hidden",
          messages: maxHeight || "max-h-80 min-h-0",
          input: "compact"
        };
      case "compact":
        return {
          container: "max-w-md h-full",
          header: showHeader ? "text-lg" : "hidden",
          messages: maxHeight || "max-h-96 min-h-0",
          input: "compact"
        };
      default: // 'full'
        return {
          container: "h-full",
          header: showHeader ? "text-xl" : "hidden",
          messages: maxHeight || "flex-1 min-h-0",
          input: "normal"
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className={`flex flex-col h-full ${styles.container} ${className}`}>
      {/* Header */}
      {showHeader && (
        <Card className="flex-shrink-0 mb-4">
          <CardHeader className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <h2 className={`font-semibold ${styles.header}`}>{title}</h2>
              {onOpenServerConfig && (
                <Button
                  isIconOnly
                  aria-label="Configure MCP Servers"
                  size="sm"
                  variant="light"
                  onPress={onOpenServerConfig}
                >
                  <Cog6ToothIcon className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Throttle Countdown */}
              {isThrottled && throttleInfo && (
                <ThrottleCountdown
                  retryAt={throttleInfo.retryAt}
                  onExpired={handleThrottleExpired}
                />
              )}

              {/* MCP Server Status */}
              {totalToolCount > 0 && !isThrottled && (
                <Tooltip
                  content={`${mcpPreferences.enabledServers.length} MCP servers, ${totalToolCount} tools available`}
                  placement="bottom"
                >
                  <Chip
                    color="primary"
                    size="sm"
                    startContent={<ServerIcon className="w-3 h-3" />}
                    variant="flat"
                  >
                    {totalToolCount} tools
                  </Chip>
                </Tooltip>
              )}

              {/* Model Status */}
              {selectedModel && !modelsLoading && !isThrottled && (
                <Tooltip
                  content={bedrockModelsService.getModelDisplayName(
                    selectedModel
                  )}
                  placement="bottom"
                >
                  <Chip color="success" size="sm" variant="flat">
                    Connected
                  </Chip>
                </Tooltip>
              )}

              {shouldShowStopButton && !isThrottled && (
                <Button
                  color="danger"
                  size="sm"
                  variant="flat"
                  onPress={handleStop}
                >
                  Stop
                </Button>
              )}

              <Button
                color="warning"
                isDisabled={session.history.length === 0}
                size="sm"
                variant="flat"
                onPress={handleClearHistory}
              >
                {variant === "widget" ? "Clear" : "Clear History"}
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Quota Display (above messages) - clickable to open details */}
      {selectedModel && (
        <div
          className="flex-shrink-0 mb-4 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => setShowQuotaConfig(true)}
          onKeyDown={(e) => {
            if (e.key === "q" || e.key === "Q") {
              e.preventDefault();
              setShowQuotaConfig(true);
            }
          }}
        >
          <QuotaMeter modelId={selectedModel.modelId} variant="compact" />
        </div>
      )}

      {/* Quota Configuration Modal */}
      <QuotaConfigModal
        isOpen={showQuotaConfig}
        onClose={() => setShowQuotaConfig(false)}
      />

      {/* Messages */}
      <Card className="flex-1 mb-4">
        <CardBody className="h-full overflow-y-auto">
          {session.history.length === 0 && !isSystemReady && <LoadingState />}

          {session.history.length === 0 && isSystemReady && (
            <div className="h-full flex flex-col items-center justify-center p-4">
              <div className="text-sm text-center">
                <div className="space-y-2">
                  <div>Start a conversation with your {title}!</div>
                  <div className="text-xs text-default-400">
                    {totalToolCount} geospatial tools available
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {session.history.map((message) => {
              // Tool result messages aren't shown directly; agent responses
              // surface the outcome.
              if (message.type === MessageType.TOOL) {
                return null;
              }

              // Skip AI messages with empty content that have tool calls (they're being executed)
              if (
                message.type === MessageType.AI &&
                message.content.trim().length === 0 &&
                message.toolCalls &&
                message.toolCalls.length > 0
              ) {
                return null;
              }

              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  showRetry={message.canRetry}
                  onRetry={
                    message.canRetry ? () => handleRetry(message.id) : undefined
                  }
                />
              );
            })}

            {/* Show processing indicator */}
            {(isRunning || callingToolName || isProcessingChain()) && (
              <div className="flex items-center gap-2 text-default-500">
                <Spinner color="primary" size="sm" variant="dots" />
                <span className="text-sm">
                  {callingToolName
                    ? `Executing ${callingToolName}...`
                    : "Thinking..."}
                </span>
              </div>
            )}

            {/* Inline destructive-confirmation card */}
            {destructiveConfirmation && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[80%] mr-auto">
                  <DestructiveConfirmationCard
                    message={destructiveConfirmation.payload.message}
                    status="pending"
                    title={destructiveConfirmation.payload.title}
                    warning={destructiveConfirmation.payload.warning}
                    onCancel={handleDestructiveCancel}
                    onConfirm={handleDestructiveConfirm}
                  />
                </div>
              </div>
            )}

            {/* Tool Execution Status */}
            {toolExecutions.length > 0 && (
              <div className="text-xs text-default-400 space-y-1">
                <div className="font-medium">Tool Execution Status:</div>
                {toolExecutions.map((execution, index) => (
                  <div key={index} className="flex justify-between">
                    <span>{execution.toolName}</span>
                    <span
                      className={
                        execution.status === "completed"
                          ? "text-success"
                          : execution.status === "failed"
                            ? "text-danger"
                            : "text-warning"
                      }
                    >
                      {execution.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div ref={messagesEndRef} />
        </CardBody>
      </Card>

      {/* Tool Approval Modal */}
      {toolApprovalModal?.isOpen && toolApprovalModal.tool && (
        <ToolApprovalModal
          isAutoApproved={isCurrentToolAutoApproved()}
          isOpen={true}
          serverName={mcpGlobals.toolToServerMap.get(
            toolApprovalModal.tool.name
          )}
          tool={toolApprovalModal.tool}
          onApprove={handleToolApproval}
          onReject={handleToolRejection}
          onToggleAutoApproval={handleToggleAutoApproval}
        />
      )}

      {/* Circuit Breaker Warning Modal */}
      {showToolLimitWarning && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <h3 className="text-lg font-semibold text-warning">
                Tool Execution Limit Reached
              </h3>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-default-600">
                The AI has made {TOOL_CALL_LIMIT} consecutive tool calls. This
                might indicate an infinite loop. Do you want to continue
                processing or stop here?
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  color="default"
                  variant="flat"
                  onPress={() => {
                    // Stop tool chain and reset
                    consecutiveToolCallCount.current = 0;
                    pendingToolChainExecution.current = null;
                    setShowToolLimitWarning(false);
                  }}
                >
                  Stop
                </Button>
                <Button
                  color="primary"
                  onPress={async () => {
                    // Continue with tool execution
                    consecutiveToolCallCount.current = 0; // Reset counter
                    setShowToolLimitWarning(false);

                    if (pendingToolChainExecution.current) {
                      await pendingToolChainExecution.current();
                      pendingToolChainExecution.current = null;
                    }
                  }}
                >
                  Continue
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Input */}
      <Card className="flex-shrink-0">
        <CardBody className={variant === "widget" ? "p-2" : ""}>
          <ChatInput
            disabled={!isSystemReady || shouldShowStopButton || isThrottled}
            placeholder={
              isLoadingModels
                ? "Loading AI models..."
                : isLoadingMcpTools
                  ? "Loading MCP tools..."
                  : shouldShowStopButton
                    ? "Processing..."
                    : "Ask about geospatial data, coordinates, maps..."
            }
            onSendMessage={handleSendMessage}
          />
        </CardBody>
      </Card>
    </div>
  );
};
