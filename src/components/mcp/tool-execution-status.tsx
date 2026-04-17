// Copyright Amazon.com, Inc. or its affiliates.
"use client";

import {
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  PlayIcon,
  XCircleIcon
} from "@heroicons/react/24/outline";
import { Accordion, AccordionItem } from "@heroui/accordion";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Code } from "@heroui/code";
import { Divider } from "@heroui/divider";
import { Progress } from "@heroui/progress";
import React from "react";

export interface ToolExecutionResult {
  toolName: string;
  serverName: string;
  status: "executing" | "completed" | "failed";
  startTime: Date;
  endTime?: Date;
  result?: string;
  error?: string;
  args?: Record<string, unknown>;
}

interface ToolExecutionStatusProps {
  executions: ToolExecutionResult[];
  onRetry?: (toolName: string) => void;
  className?: string;
}

const StatusIcon: React.FC<{ status: ToolExecutionResult["status"] }> = ({
  status
}) => {
  switch (status) {
    case "executing":
      return <ClockIcon className="w-4 h-4 text-warning animate-spin" />;
    case "completed":
      return <CheckCircleIcon className="w-4 h-4 text-success" />;
    case "failed":
      return <XCircleIcon className="w-4 h-4 text-danger" />;
  }
};

const getStatusColor = (status: ToolExecutionResult["status"]) => {
  switch (status) {
    case "executing":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "danger";
  }
};

const formatDuration = (start: Date, end?: Date) => {
  const endTime = end || new Date();
  const duration = endTime.getTime() - start.getTime();

  if (duration < 1000) {
    return `${duration}ms`;
  } else if (duration < 60000) {
    return `${(duration / 1000).toFixed(1)}s`;
  } else {
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  }
};

const ToolExecutionCard: React.FC<{
  execution: ToolExecutionResult;
  onRetry?: (toolName: string) => void;
}> = ({ execution, onRetry }) => {
  const {
    toolName,
    serverName,
    status,
    startTime,
    endTime,
    result,
    error,
    args
  } = execution;

  return (
    <Card className="w-full">
      <CardBody className="gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} />
            <div>
              <h4 className="font-medium text-small">{toolName}</h4>
              <p className="text-tiny text-default-500">{serverName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Chip color={getStatusColor(status)} size="sm" variant="flat">
              {status}
            </Chip>
            <span className="text-tiny text-default-500">
              {formatDuration(startTime, endTime)}
            </span>
            {status === "failed" && onRetry && (
              <Button
                color="primary"
                size="sm"
                startContent={<PlayIcon className="w-3 h-3" />}
                variant="light"
                onPress={() => onRetry(toolName)}
              >
                Retry
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar for executing status */}
        {status === "executing" && (
          <Progress
            isIndeterminate
            className="max-w-md"
            color="warning"
            size="sm"
          />
        )}

        {/* Results/Error Display */}
        {(result || error) && (
          <Accordion className="px-0" variant="light">
            <AccordionItem
              key="details"
              aria-label="Execution details"
              classNames={{
                trigger: "py-1",
                content: "pt-0 pb-2"
              }}
              title={
                <div className="flex items-center gap-2">
                  <EyeIcon className="w-3 h-3" />
                  <span className="text-small">
                    {error ? "Error Details" : "Result"}
                  </span>
                </div>
              }
            >
              <div className="space-y-2">
                {error && (
                  <div className="bg-danger-50 border border-danger-200 p-2 rounded-small">
                    <Code
                      className="text-xs whitespace-pre-wrap"
                      color="danger"
                    >
                      {error}
                    </Code>
                  </div>
                )}

                {result && (
                  <div className="bg-success-50 border border-success-200 p-2 rounded-small">
                    <Code
                      className="text-xs whitespace-pre-wrap max-h-32 overflow-y-auto"
                      color="success"
                    >
                      {result.length > 500
                        ? `${result.substring(0, 500)}...`
                        : result}
                    </Code>
                  </div>
                )}

                {args && Object.keys(args).length > 0 && (
                  <>
                    <Divider />
                    <div>
                      <p className="text-tiny font-medium text-default-600 mb-1">
                        Arguments:
                      </p>
                      <Code className="text-xs">
                        {JSON.stringify(args, null, 2)}
                      </Code>
                    </div>
                  </>
                )}
              </div>
            </AccordionItem>
          </Accordion>
        )}
      </CardBody>
    </Card>
  );
};

export const ToolExecutionStatus: React.FC<ToolExecutionStatusProps> = ({
  executions,
  onRetry,
  className = ""
}) => {
  if (executions.length === 0) return null;

  const completedCount = executions.filter(
    (e) => e.status === "completed"
  ).length;
  const failedCount = executions.filter((e) => e.status === "failed").length;
  const executingCount = executions.filter(
    (e) => e.status === "executing"
  ).length;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Summary */}
      <div className="flex items-center gap-2 text-small">
        <span className="font-medium">Tool Execution:</span>
        {executingCount > 0 && (
          <Chip color="warning" size="sm" variant="flat">
            {executingCount} running
          </Chip>
        )}
        {completedCount > 0 && (
          <Chip color="success" size="sm" variant="flat">
            {completedCount} completed
          </Chip>
        )}
        {failedCount > 0 && (
          <Chip color="danger" size="sm" variant="flat">
            {failedCount} failed
          </Chip>
        )}
      </div>

      {/* Execution Cards */}
      <div className="space-y-2">
        {executions.map((execution, index) => (
          <ToolExecutionCard
            key={`${execution.toolName}-${index}`}
            execution={execution}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
};
