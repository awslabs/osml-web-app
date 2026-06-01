// Copyright Amazon.com, Inc. or its affiliates.
import { getRuntimeConfig } from "@/config/runtime-config";

export type SiteConfig = typeof siteConfig;

const runtime = getRuntimeConfig();

export const siteConfig = {
  name: "OversightML",
  description:
    "View and process large scale satellite and aerial images in the cloud.",
  links: {
    github:
      "https://github.com/aws-solutions-library-samples/guidance-for-processing-overhead-imagery-on-aws",
    docs: "https://heroui.com"
  },
  tile_server_base_url: runtime.tileServerUrl,
  stac_catalog_url: runtime.stacCatalogUrl,
  model_runner_api_base_url: runtime.modelRunnerApiUrl,
  utility_api_base_url: runtime.utilityApiUrl,
  mcp: {
    default_server_url: runtime.mcpServerUrl,
    defaultServersRaw: runtime.mcpDefaultServers,
    hostAllowlist: runtime.mcpHostAllowlist,
    timeout: 10000,
    reconnect_interval: 5000
  },
  detection_bridge_bucket: runtime.detectionBridgeBucket,
  kinesis_stream_name: runtime.kinesisStreamName,
  chat: {
    tool_call_limit: parseInt(runtime.toolCallLimit, 10)
  }
};
