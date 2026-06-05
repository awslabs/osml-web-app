// Copyright Amazon.com, Inc. or its affiliates.
import { McpServerConfig } from "@/types/mcp";

interface DefaultMcpServerEnvEntry {
  id: string;
  name: string;
  url: string;
  description?: string;
  authMode: "none" | "session";
  enabled?: boolean;
}

function isValidEntry(entry: unknown): entry is DefaultMcpServerEnvEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.name === "string" &&
    e.name.length > 0 &&
    typeof e.url === "string" &&
    e.url.length > 0 &&
    (e.authMode === "none" || e.authMode === "session")
  );
}

/**
 * Parses the JSON-encoded MCP_DEFAULT_SERVERS env value into McpServerConfig
 * entries. On parse failure or invalid shape, returns [] and warns.
 */
export function parseMcpDefaultServers(raw: string): McpServerConfig[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("MCP_DEFAULT_SERVERS is not valid JSON; ignoring.", err);
    return [];
  }

  if (!Array.isArray(parsed)) {
    // eslint-disable-next-line no-console
    console.warn("MCP_DEFAULT_SERVERS must be an array; ignoring.");
    return [];
  }

  return parsed.filter(isValidEntry).map((e) => ({
    id: e.id,
    name: e.name,
    url: e.url,
    description: e.description,
    enabled: e.enabled ?? true,
    connectionStatus: "active",
    autoApprovedTools: [],
    disabledTools: [],
    authMode: e.authMode
  }));
}
