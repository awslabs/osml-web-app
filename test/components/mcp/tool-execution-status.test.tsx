// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for ToolExecutionStatus component.
 * Covers empty state, executing/completed/failed statuses, summary chips, and retry.
 */

import { render, screen } from "@testing-library/react";

import {
  ToolExecutionResult,
  ToolExecutionStatus
} from "@/components/mcp/tool-execution-status";

const makeExecution = (
  overrides: Partial<ToolExecutionResult> = {}
): ToolExecutionResult => ({
  toolName: "get_viewport",
  serverName: "Local Server",
  status: "completed",
  startTime: new Date(Date.now() - 500),
  endTime: new Date(),
  ...overrides
});

describe("ToolExecutionStatus", () => {
  it("should render nothing when executions is empty", () => {
    const { container } = render(<ToolExecutionStatus executions={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("should render summary with completed count", () => {
    render(<ToolExecutionStatus executions={[makeExecution()]} />);
    expect(screen.getByText("Tool Execution:")).toBeInTheDocument();
    expect(screen.getByText("1 completed")).toBeInTheDocument();
  });

  it("should render executing status", () => {
    render(
      <ToolExecutionStatus
        executions={[
          makeExecution({ status: "executing", endTime: undefined })
        ]}
      />
    );
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("executing")).toBeInTheDocument();
  });

  it("should render failed status", () => {
    render(
      <ToolExecutionStatus
        executions={[makeExecution({ status: "failed", error: "Timeout" })]}
      />
    );
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("should render tool name and server name", () => {
    render(
      <ToolExecutionStatus
        executions={[
          makeExecution({ toolName: "draw_feature", serverName: "MCP Agent" })
        ]}
      />
    );
    expect(screen.getByText("draw_feature")).toBeInTheDocument();
    expect(screen.getByText("MCP Agent")).toBeInTheDocument();
  });

  it("should render retry button for failed executions", () => {
    const onRetry = jest.fn();
    render(
      <ToolExecutionStatus
        executions={[makeExecution({ status: "failed" })]}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("should render multiple executions with mixed statuses", () => {
    const executions = [
      makeExecution({ toolName: "tool-1", status: "completed" }),
      makeExecution({
        toolName: "tool-2",
        status: "executing",
        endTime: undefined
      }),
      makeExecution({ toolName: "tool-3", status: "failed" })
    ];
    render(<ToolExecutionStatus executions={executions} />);
    expect(screen.getByText("1 completed")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
  });

  it("should format duration in milliseconds for fast executions", () => {
    const start = new Date();
    const end = new Date(start.getTime() + 150);
    render(
      <ToolExecutionStatus
        executions={[makeExecution({ startTime: start, endTime: end })]}
      />
    );
    expect(screen.getByText("150ms")).toBeInTheDocument();
  });

  it("should format duration in seconds", () => {
    const start = new Date();
    const end = new Date(start.getTime() + 2500);
    render(
      <ToolExecutionStatus
        executions={[makeExecution({ startTime: start, endTime: end })]}
      />
    );
    expect(screen.getByText("2.5s")).toBeInTheDocument();
  });
});
