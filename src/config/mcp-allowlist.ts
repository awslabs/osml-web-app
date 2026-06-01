// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Default host patterns permitted for MCP server registration. Replaced (not
 * extended) when MCP_HOST_ALLOWLIST is set. Pattern syntax: exact host,
 * "*.domain" subdomain wildcard, or "*" for any host.
 */
export const DEFAULT_MCP_HOST_ALLOWLIST: readonly string[] = [
  "*.amazonaws.com",
  "*.aws.dev",
  "*.amazon.com",
  "localhost",
  "127.0.0.1"
];
