// Copyright Amazon.com, Inc. or its affiliates.
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  WrenchIcon
} from "@heroicons/react/16/solid";
import { Accordion, AccordionItem } from "@heroui/accordion";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Spinner } from "@heroui/spinner";

import { ChatMessage as NewChatMessage, MessageType } from "@/types/chat";

import { ThrottleRetryButton } from "./throttle-retry-button";

interface ChatMessageProps {
  message: NewChatMessage;
  onRetry?: () => void;
  showRetry?: boolean;
}

export const ChatMessage = ({
  message,
  onRetry,
  showRetry
}: ChatMessageProps) => {
  const isUser = message.type === MessageType.HUMAN;
  const isThinking = message.id === "thinking-indicator";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[80%] ${isUser ? "ml-auto" : "mr-auto"}`}>
        <Card
          className={`${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-default-100 text-default-900"
          } ${message.error === "throttled" ? "w-full" : ""}`}
        >
          <CardBody className="px-4 py-3">
            {isThinking ? (
              <div className="flex items-center gap-3">
                <Spinner size="sm" variant="dots" />
                <span className="text-sm italic text-default-600">
                  {message.content}
                </span>
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words">
                {message.content}
              </div>
            )}

            {/* Tool results accordion - shows after execution completes */}
            {message.toolResults && message.toolResults.length > 0 && (
              <div className="mt-3">
                <Accordion variant="splitted">
                  <AccordionItem
                    key="tool-results"
                    aria-label="Tool Execution Results"
                    className="text-xs"
                    title={
                      <div className="flex items-center gap-2">
                        <WrenchIcon className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">
                          Tool Results ({message.toolResults.length})
                        </span>
                      </div>
                    }
                  >
                    <div className="space-y-3">
                      {message.toolResults.map((result, index) => (
                        <div
                          key={`result-${result.toolCallId}`}
                          className="bg-default-50 p-3 rounded-lg"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-default-700">
                              {result.toolName} - Result {index + 1}
                            </span>
                            <div
                              className={`flex items-center gap-1 ${
                                result.status === "success"
                                  ? "text-success"
                                  : "text-warning"
                              }`}
                            >
                              {result.status === "success" ? (
                                <CheckCircleIcon className="w-3 h-3" />
                              ) : (
                                <ExclamationTriangleIcon className="w-3 h-3" />
                              )}
                              <span className="text-xs capitalize">
                                {result.status}
                              </span>
                            </div>
                          </div>

                          {/* Tool result content */}
                          {result.content && (
                            <div className="mt-2">
                              <pre className="text-xs text-default-600 whitespace-pre-wrap bg-default-100 p-2 rounded overflow-x-auto">
                                {result.content}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </AccordionItem>
                </Accordion>
              </div>
            )}

            {!isThinking && (
              <div className="flex items-center justify-between mt-2">
                <div
                  className={`text-xs opacity-70 ${
                    isUser ? "text-primary-foreground" : "text-default-500"
                  }`}
                >
                  {message.timestamp.toLocaleTimeString()}
                </div>

                {/* Retry button for failed messages */}
                {showRetry && onRetry && !isUser && (
                  <>
                    {/* For throttle messages, show inline with timestamp */}
                    {message.error === "throttled" &&
                    message.metadata?.throttleData ? (
                      <ThrottleRetryButton
                        isPermanent={message.metadata.throttleData.isPermanent}
                        retryAfterSeconds={
                          message.metadata.throttleData.retryAfterSeconds
                        }
                        onRetry={onRetry}
                      />
                    ) : (
                      /* Regular retry button for other errors */
                      <Button
                        className="opacity-80 hover:opacity-100"
                        color="warning"
                        size="sm"
                        startContent={<ArrowPathIcon className="w-3 h-3" />}
                        variant="flat"
                        onPress={onRetry}
                      >
                        Retry
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
