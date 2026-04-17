// Copyright Amazon.com, Inc. or its affiliates.
import { Store } from "@reduxjs/toolkit";

/** Arguments passed to a tool handler — a JSON-serializable key/value map. */
export type ToolArgs = Record<string, unknown>;

// JSON Schema type for tool schemas
export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface LocalMcpTool {
  name: string;
  description: string;
  schema: JsonSchema;
  handler: (args: ToolArgs, store: Store) => Promise<unknown> | unknown;
}

export interface LocalMcpServerConfig {
  id: string;
  name: string;
  description: string;
  tools: LocalMcpTool[];
}

export interface LocalMcpExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
