// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for local-mcp-server.ts.
 * Covers tool registration, execution, lookup, and MCP integration format.
 */

import { configureStore } from "@reduxjs/toolkit";

import { LocalMcpServer } from "@/services/local-mcp-server";
import overlayReducer from "@/store/slices/overlay-slice";
import settingsReducer from "@/store/slices/settings-slice";
import viewportReducer from "@/store/slices/viewport-slice";

// Minimal store that satisfies the tools' needs
const createStore = () =>
  configureStore({
    reducer: {
      overlay: overlayReducer,
      viewport: viewportReducer,
      settings: settingsReducer
    }
  });

describe("LocalMcpServer", () => {
  it("should initialize with all registered tools", () => {
    const server = new LocalMcpServer(createStore());
    const names = server.getToolNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("get_viewport");
    expect(names).toContain("draw_feature");
  });

  it("hasTool should return true for registered tools", () => {
    const server = new LocalMcpServer(createStore());
    expect(server.hasTool("get_viewport")).toBe(true);
    expect(server.hasTool("nonexistent")).toBe(false);
  });

  it("executeTool should run a tool and return result", async () => {
    const server = new LocalMcpServer(createStore());
    const result = (await server.executeTool("get_viewport", {})) as {
      longitude: number;
    };
    expect(result).toHaveProperty("longitude");
  });

  it("executeTool should throw for unknown tool", async () => {
    const server = new LocalMcpServer(createStore());
    await expect(server.executeTool("fake_tool", {})).rejects.toThrow(
      "Tool fake_tool not found"
    );
  });

  it("registerTool should add a custom tool", async () => {
    const server = new LocalMcpServer(createStore());
    server.registerTool({
      name: "custom_tool",
      description: "A custom tool",
      schema: { type: "object", properties: {} },
      handler: () => ({ custom: true })
    });

    expect(server.hasTool("custom_tool")).toBe(true);
    const result = await server.executeTool("custom_tool", {});
    expect(result).toEqual({ custom: true });
  });

  it("getAvailableTools should return tool objects", () => {
    const server = new LocalMcpServer(createStore());
    const tools = server.getAvailableTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty("name");
    expect(tools[0]).toHaveProperty("handler");
  });

  it("getToolsForMcpIntegration should return MCP-compatible format", () => {
    const server = new LocalMcpServer(createStore());
    const mcpTools = server.getToolsForMcpIntegration();
    expect(mcpTools.length).toBeGreaterThan(0);

    const first = mcpTools[0];
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("description");
    expect(first).toHaveProperty("inputSchema");
    // Should NOT have handler (not serializable)
    expect(first).not.toHaveProperty("handler");
  });
});
