#!/usr/bin/env node

/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import "source-map-support/register";

import { App } from "aws-cdk-lib";

import {
  BedrockModelsConfig,
  ModelRunnerApiConfig,
  WebAppUtilityConfig
} from "../lib/config/app-config";
import type { ConfigType } from "../lib/config/base-config";
import { AuthConfig } from "../lib/constructs/authorizer-function";
import { ModelRunnerApiStack } from "../lib/model-runner-api-stack";
import { StacLoaderIntegrationTestStack } from "../lib/stac-loader-integration-test-stack";
import { StacLoaderStack } from "../lib/stac-loader-stack";
import { WebAppUtilityStack } from "../lib/web-app-utility-stack";
import { WebAppStack } from "../lib/web-ui-stack";
import { loadDeploymentConfig } from "./deployment/load-deployment";

const app = new App();
const deploymentConfig = loadDeploymentConfig();
const projectName = deploymentConfig.projectName;

// Require VPC ID from configuration - each stack will import the VPC individually
if (!deploymentConfig.networkConfig?.VPC_ID) {
  throw new Error("networkConfig.VPC_ID must be provided in deployment.json");
}

const vpcId = deploymentConfig.networkConfig.VPC_ID;
const isProd = deploymentConfig.account.prodLike;
const region = deploymentConfig.account.region;

// Create CDK environment
const cdkEnvironment = {
  account: deploymentConfig.account.id,
  region: deploymentConfig.account.region
};

// Create auth configuration object from dataplaneConfig
const authConfig: AuthConfig = {
  authority: deploymentConfig.dataplaneConfig?.authConfig?.authority || "",
  audience:
    deploymentConfig.dataplaneConfig?.authConfig?.audience ||
    deploymentConfig.dataplaneConfig?.authConfig?.clientId ||
    ""
};

// Map dataplaneConfig to ModelRunnerApiConfig
const modelRunnerApiConfig = new ModelRunnerApiConfig({
  modelRunnerImageRequestQueueArn:
    deploymentConfig.dataplaneConfig?.MODEL_RUNNER_QUEUE_ARN || "",
  modelRunnerStatusTopicArn:
    deploymentConfig.dataplaneConfig?.MODEL_RUNNER_STATUS_TOPIC_ARN || "",
  hostedZone:
    deploymentConfig.dataplaneConfig?.modelRunnerApiConfig?.hostedZone,
  domainName: deploymentConfig.dataplaneConfig?.modelRunnerApiConfig?.domainName
});

// Map dataplaneConfig to WebAppUtilityConfig
const webAppUtilityConfig = new WebAppUtilityConfig({
  restrictBucketAccess:
    deploymentConfig.dataplaneConfig?.webAppUtilityConfig?.restrictBucketAccess,
  allowedBucketArns:
    deploymentConfig.dataplaneConfig?.webAppUtilityConfig?.allowedBucketArns,
  hostedZone: deploymentConfig.dataplaneConfig?.webAppUtilityConfig?.hostedZone,
  domainName: deploymentConfig.dataplaneConfig?.webAppUtilityConfig?.domainName,
  stacCatalogUrl: deploymentConfig.dataplaneConfig?.STAC_CATALOG_URL,
  osmlDataIntakeOutputTopic:
    deploymentConfig.dataplaneConfig?.DATA_INTAKE_OUTPUT_TOPIC_ARN,
  bedrockModels: deploymentConfig.dataplaneConfig?.webAppUtilityConfig
    ?.bedrockModels
    ? new BedrockModelsConfig(
        deploymentConfig.dataplaneConfig.webAppUtilityConfig
          .bedrockModels as ConfigType
      )
    : undefined
});

// Get WebApp domain for CORS configuration
// Derive from DOMAIN_HOSTED_ZONE_NAME if webAppConfig.domainName not explicitly set
const webAppDomainName =
  deploymentConfig.dataplaneConfig?.webAppConfig?.domainName ??
  (deploymentConfig.dataplaneConfig?.DOMAIN_HOSTED_ZONE_NAME
    ? `osml.${deploymentConfig.dataplaneConfig.DOMAIN_HOSTED_ZONE_NAME}`
    : undefined);

// Deploy Model Runner API Stack
const modelRunnerApiStack = new ModelRunnerApiStack(
  app,
  `${projectName}-ModelRunnerApi`,
  {
    env: cdkEnvironment,
    description: "OSML Model Runner API [Prototype] ",
    vpcId: vpcId,
    isProd: isProd,
    projectName: projectName,
    config: modelRunnerApiConfig,
    auth: authConfig,
    corsAllowedOrigins: webAppDomainName
      ? [`https://${webAppDomainName}`]
      : undefined
  }
);

// Deploy WebApp Utility Services Stack (handles S3, Bedrock, and other utility functions)
const webAppUtilityApiStack = new WebAppUtilityStack(
  app,
  `${projectName}-WebAppUtilityServices`,
  {
    env: cdkEnvironment,
    description: "OSML WebApp Utility Services [Prototype]",
    vpcId: vpcId,
    isProd: isProd,
    account: deploymentConfig.account,
    projectName: projectName,
    region: region,
    config: webAppUtilityConfig,
    auth: authConfig,
    corsAllowedOrigins: webAppDomainName
      ? [`https://${webAppDomainName}`]
      : undefined
  }
);

// Note: Data catalog ingest bucket ARN is automatically included in allowed buckets
// when restrictBucketAccess is enabled, as it's managed by the same stack

// Derive webapp domain from DOMAIN_HOSTED_ZONE_NAME (consistent with auth-server and osml-apis)
const domainHostedZoneName =
  deploymentConfig.dataplaneConfig?.DOMAIN_HOSTED_ZONE_NAME;
const webAppHostedZone =
  deploymentConfig.dataplaneConfig?.webAppConfig?.hostedZone ??
  domainHostedZoneName;
const webAppDomainNameDerived =
  deploymentConfig.dataplaneConfig?.webAppConfig?.domainName ??
  (domainHostedZoneName ? `osml.${domainHostedZoneName}` : undefined);

// Create dynamic WebApp config with effective API URLs (custom domain if configured, otherwise default)
const dynamicWebAppConfig = {
  buildFromSource:
    deploymentConfig.dataplaneConfig?.webAppConfig?.buildFromSource ?? true,
  artifactLocalPath:
    deploymentConfig.dataplaneConfig?.webAppConfig?.artifactLocalPath,
  artifactUrl: deploymentConfig.dataplaneConfig?.webAppConfig?.artifactUrl,
  hostedZone: webAppHostedZone,
  domainName: webAppDomainNameDerived,
  authSuccessUrl:
    deploymentConfig.dataplaneConfig?.webAppConfig?.authSuccessUrl ??
    (webAppDomainNameDerived
      ? `https://${webAppDomainNameDerived}`
      : undefined),
  authClientId: deploymentConfig.dataplaneConfig?.webAppConfig?.authClientId,
  authSecret: deploymentConfig.dataplaneConfig?.webAppConfig?.authSecret,
  // Service URLs from dependencies
  tileServerUrl: deploymentConfig.dataplaneConfig?.TILE_SERVER_URL,
  stacCatalogUrl: deploymentConfig.dataplaneConfig?.STAC_CATALOG_URL,
  stacLoaderMcpUrl: "", // Will be set after stacLoaderStack is created
  geoAgentsMcpUrl: deploymentConfig.dataplaneConfig?.GEO_AGENTS_MCP_URL,
  // Dynamic URLs from deployed stacks
  webAppUtilityUrl:
    webAppUtilityApiStack.webAppUtility.authorizedRestApi.effectiveUrl,
  modelRunnerApiUrl:
    modelRunnerApiStack.modelRunnerApi.authorizedRestApi.effectiveUrl,
  // Auth authority
  authority: deploymentConfig.dataplaneConfig?.authConfig?.authority,
  // Detection bridge bucket name (set after utility stack is created)
  detectionBridgeBucket:
    webAppUtilityApiStack.webAppUtility.detectionBridgeBucket?.bucketName,
  // Kinesis stream name for Model Runner detection output
  // Explicit config takes precedence; otherwise derive from Model Runner convention
  kinesisStreamName:
    deploymentConfig.dataplaneConfig?.KINESIS_STREAM_NAME ||
    `mr-stream-sink-${deploymentConfig.account.id}`
};

// Deploy STAC Loader Stack (ECS Fargate MCP server)
const stacLoaderStack = new StacLoaderStack(app, `${projectName}-StacLoader`, {
  env: cdkEnvironment,
  description: "OSML STAC Data Loader [Prototype]",
  vpcId: vpcId,
  isProd: isProd,
  auth: authConfig,
  projectName: projectName,
  config: deploymentConfig.dataplaneConfig?.stacLoaderConfig,
  corsAllowedOrigins: webAppDomainName
    ? [`https://${webAppDomainName}`]
    : undefined,
  dataCatalogBaseUrl: deploymentConfig.dataplaneConfig?.STAC_CATALOG_URL,
  domainHostedZoneId: deploymentConfig.dataplaneConfig?.DOMAIN_HOSTED_ZONE_ID,
  domainHostedZoneName:
    deploymentConfig.dataplaneConfig?.DOMAIN_HOSTED_ZONE_NAME
});

// Update dynamic config with STAC loader MCP URL
dynamicWebAppConfig.stacLoaderMcpUrl = stacLoaderStack.stacLoader.mcpUrl;

// Conditionally deploy STAC Loader Integration Test Stack
if (deploymentConfig.dataplaneConfig?.deployIntegrationTests) {
  const integrationTestStack = new StacLoaderIntegrationTestStack(
    app,
    `${projectName}-StacLoaderIntegrationTest`,
    {
      env: cdkEnvironment,
      description: "OSML STAC Loader Integration Tests [Prototype]",
      vpcId: vpcId,
      stacLoaderAlbDnsName: stacLoaderStack.stacLoader.alb.loadBalancerDnsName,
      projectName: projectName,
      isProd: isProd
    }
  );
  integrationTestStack.node.addDependency(stacLoaderStack);
}

// Deploy Web App Stack
const webAppStack = new WebAppStack(app, `${projectName}-WebApp`, {
  env: cdkEnvironment,
  description: "OSML Web App [Prototype]",
  vpcId: vpcId,
  isProd: isProd,
  account: deploymentConfig.account,
  projectName: projectName,
  config: dynamicWebAppConfig
});

// Explicit dependencies ensure API stacks deploy first
webAppStack.node.addDependency(modelRunnerApiStack);
webAppStack.node.addDependency(webAppUtilityApiStack);
webAppStack.node.addDependency(stacLoaderStack);

app.synth();
