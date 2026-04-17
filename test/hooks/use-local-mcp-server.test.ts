// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for use-local-mcp-server hook.
 * Covers tool execution, tool lookup, and MCP integration format.
 */

import { act } from "@testing-library/react";

import { useLocalMcpServer } from "@/hooks/use-local-mcp-server";

import { renderHookWithStore } from "../test-utils";

describe("useLocalMcpServer", () => {
  it("should return local tools and tool names", () => {
    const { result } = renderHookWithStore(() => useLocalMcpServer());

    expect(result.current.localTools.length).toBeGreaterThan(0);
    expect(result.current.localToolNames).toContain("get_viewport");
    expect(result.current.toolCount).toBeGreaterThan(0);
  });

  it("isLocalTool should identify registered tools", () => {
    const { result } = renderHookWithStore(() => useLocalMcpServer());

    expect(result.current.isLocalTool("get_viewport")).toBe(true);
    expect(result.current.isLocalTool("nonexistent_tool")).toBe(false);
  });

  it("executeLocalTool should run a tool and return result", async () => {
    const { result } = renderHookWithStore(() => useLocalMcpServer());

    let toolResult: unknown;
    await act(async () => {
      toolResult = await result.current.executeLocalTool("get_viewport", {});
    });

    expect(toolResult).toHaveProperty("longitude");
    expect(toolResult).toHaveProperty("latitude");
  });

  it("getLocalToolsForMcp should return MCP-compatible format", () => {
    const { result } = renderHookWithStore(() => useLocalMcpServer());

    const mcpTools = result.current.getLocalToolsForMcp();
    expect(mcpTools.length).toBeGreaterThan(0);
    expect(mcpTools[0]).toHaveProperty("name");
    expect(mcpTools[0]).toHaveProperty("description");
    expect(mcpTools[0]).toHaveProperty("inputSchema");
  });

  it("should update Redux state with local server as ready", () => {
    const { store } = renderHookWithStore(() => useLocalMcpServer());

    const state = store.getState();
    const localServer = state.mcp.servers.find(
      (s: { name: string }) => s.name === "Local Viewport Server"
    );
    expect(localServer?.liveConnectionState).toBe("ready");
    expect(localServer?.toolCount).toBeGreaterThan(0);
  });
});
