// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Shared MCP configuration types. These live in their own module (rather than
 * in `@/hooks/use-mcp`) so the Redux `mcp-slice` and the `use-mcp` hook can
 * each depend on them without importing each other — which previously forced a
 * lazy `require()` in `use-mcp` to break a circular dependency.
 */

export type McpAuthMode = "none" | "session" | "custom";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  description?: string;
  enabled: boolean;
  connectionStatus: "active" | "failed" | "connecting";
  autoApprovedTools: string[];
  disabledTools: string[];
  /** How outbound requests to this server should be authenticated. Treat missing as "none". */
  authMode?: McpAuthMode;
  liveConnectionState?: string;
  toolCount?: number;
}

export interface McpPreferences {
  enabledServers: McpServerConfig[];
  overrideAllApprovals: boolean;
}
