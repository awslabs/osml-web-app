// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Runtime configuration values read from the environment at server boot,
 * injected into the SSR'd HTML by the root layout, and consumed by both
 * server- and client-rendered code through `siteConfig`.
 *
 * Only values that the client browser is permitted to see belong here.
 * Server-only secrets (e.g., NEXTAUTH_SECRET, OIDC_AUTHORITY) are read
 * directly from `process.env` by the code that needs them.
 */
export interface OsmlRuntimeConfig {
  tileServerUrl: string;
  stacCatalogUrl: string;
  stacLoaderMcpUrl: string;
  modelRunnerApiUrl: string;
  utilityApiUrl: string;
  mcpServerUrl: string;
  geoAgentsMcpUrl: string;
  detectionBridgeBucket: string;
  kinesisStreamName: string;
  toolCallLimit: string;
}

const DEFAULTS = {
  mcpServerUrl: "http://localhost:3001",
  toolCallLimit: "20"
} as const;

/** Read runtime config from `process.env`. Server-side only. */
export function readRuntimeConfigFromEnv(): OsmlRuntimeConfig {
  return {
    tileServerUrl: process.env.TILE_SERVER_URL ?? "",
    stacCatalogUrl: process.env.STAC_CATALOG_URL ?? "",
    stacLoaderMcpUrl: process.env.STAC_LOADER_MCP_URL ?? "",
    modelRunnerApiUrl: process.env.MODEL_RUNNER_API_URL ?? "",
    utilityApiUrl: process.env.UTILITY_API_URL ?? "",
    mcpServerUrl: process.env.MCP_SERVER_URL ?? DEFAULTS.mcpServerUrl,
    geoAgentsMcpUrl: process.env.GEO_AGENTS_MCP_URL ?? "",
    detectionBridgeBucket: process.env.DETECTION_BRIDGE_BUCKET ?? "",
    kinesisStreamName: process.env.KINESIS_STREAM_NAME ?? "",
    toolCallLimit: process.env.TOOL_CALL_LIMIT ?? DEFAULTS.toolCallLimit
  };
}

/**
 * Returns the runtime config from `window.__OSML_CONFIG__` on the client and
 * from `process.env` on the server.
 */
export function getRuntimeConfig(): OsmlRuntimeConfig {
  if (typeof window !== "undefined" && window.__OSML_CONFIG__) {
    return window.__OSML_CONFIG__;
  }
  return readRuntimeConfigFromEnv();
}
