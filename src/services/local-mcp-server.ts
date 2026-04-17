// Copyright Amazon.com, Inc. or its affiliates.
import { Store } from "@reduxjs/toolkit";

import { getLocalToolsList } from "@/mcp/local-server/tool-registry";
import { LocalMcpTool } from "@/mcp/local-server/types";

export class LocalMcpServer {
  private tools: Map<string, LocalMcpTool> = new Map();

  constructor(private store: Store) {
    this.initializeTools();
  }

  private initializeTools(): void {
    const tools = getLocalToolsList();

    tools.forEach((tool) => {
      this.tools.set(tool.name, tool);
    });
  }

  registerTool(tool: LocalMcpTool): void {
    this.tools.set(tool.name, tool);
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Tool ${toolName} not found in local MCP server`);
    }

    return await tool.handler(args, this.store);
  }

  getAvailableTools(): LocalMcpTool[] {
    return Array.from(this.tools.values());
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  // Get tools in format compatible with existing MCP infrastructure
  getToolsForMcpIntegration(): Array<{
    name: string;
    description: string;
    inputSchema: LocalMcpTool["schema"];
  }> {
    return this.getAvailableTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema
    }));
  }
}

// Singleton pattern for local MCP server
let localMcpServerInstance: LocalMcpServer | null = null;

export function getLocalMcpServer(store: Store): LocalMcpServer {
  if (!localMcpServerInstance) {
    localMcpServerInstance = new LocalMcpServer(store);
  }

  return localMcpServerInstance;
}
