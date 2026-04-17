// Copyright Amazon.com, Inc. or its affiliates.
export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "OversightML",
  description:
    "View and process large scale satellite and aerial images in the cloud.",
  links: {
    github:
      "https://github.com/aws-solutions-library-samples/guidance-for-processing-overhead-imagery-on-aws",
    docs: "https://heroui.com"
  },
  tile_server_base_url: process.env.NEXT_PUBLIC_TILE_SERVER_URL || "",
  stac_catalog_url: process.env.NEXT_PUBLIC_STAC_CATALOG_URL || "",
  stac_loader_mcp_url: process.env.NEXT_PUBLIC_STAC_LOADER_MCP_URL || "",
  model_runner_api_base_url: process.env.NEXT_PUBLIC_MODEL_RUNNER_API_URL || "",
  utility_api_base_url: process.env.NEXT_PUBLIC_UTILITY_API_URL || "",
  mcp: {
    default_server_url:
      process.env.NEXT_PUBLIC_MCP_SERVER_URL || "http://localhost:3001",
    geo_agents_url: process.env.NEXT_PUBLIC_GEO_AGENTS_MCP_URL || "",
    timeout: 10000,
    reconnect_interval: 5000
  },
  bedrock: {
    model_id:
      process.env.NEXT_PUBLIC_BEDROCK_MODEL_ID ||
      "us.anthropic.claude-opus-4-6-v1",
    region: process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1",
    max_tokens: 4000
  },
  detection_bridge_bucket:
    process.env.NEXT_PUBLIC_DETECTION_BRIDGE_BUCKET || "",
  kinesis_stream_name: process.env.NEXT_PUBLIC_KINESIS_STREAM_NAME || "",
  chat: {
    tool_call_limit: parseInt(
      process.env.NEXT_PUBLIC_TOOL_CALL_LIMIT || "20",
      10
    )
  }
};
