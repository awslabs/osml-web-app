/**
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * Utility to load and validate the deployment configuration file.
 *
 * This module provides a strongly typed interface for reading the `deployment.json`
 * configuration, performing required validations, and returning a structured result.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Network configuration for VPC and subnet settings.
 */
export interface NetworkConfig {
  /** VPC ID to deploy into. */
  VPC_ID?: string;
  /** Target subnet IDs for deployment. */
  TARGET_SUBNETS?: string[];
  /** Security group ID to use. */
  SECURITY_GROUP_ID?: string;
}

/**
 * Authentication configuration for OIDC/JWT.
 */
export interface AuthConfig {
  /** OIDC authority URL (e.g., Keycloak realm URL). */
  authority: string;
  /** JWT audience claim for validation. */
  audience: string;
  /** OAuth client ID. */
  clientId?: string;
  /** OAuth client secret. */
  clientSecret?: string;
}

/**
 * WebApp-specific configuration.
 */
export interface WebAppConfig {
  /** Whether to build the web app from source. */
  buildFromSource?: boolean;
  /** Local path to pre-built artifact. */
  artifactLocalPath?: string;
  /** URL to download artifact from. */
  artifactUrl?: string;
  /** Route53 hosted zone name. */
  hostedZone?: string;
  /** Domain name for the web app. */
  domainName?: string;
  /** URL to redirect after successful auth. */
  authSuccessUrl?: string;
  /** Auth client ID for the web app. */
  authClientId?: string;
}

/**
 * Model Runner API configuration.
 */
export interface ModelRunnerApiConfig {
  /** Route53 hosted zone name. */
  hostedZone?: string;
  /** Domain name for the API. */
  domainName?: string;
}

/**
 * Bedrock models configuration.
 */
export interface BedrockModelsConfig {
  /** List of enabled Bedrock model IDs. */
  enabledModels?: string[];
}

/**
 * WebApp Utility API configuration.
 */
export interface WebAppUtilityConfig {
  /** Whether to restrict S3 bucket access. */
  restrictBucketAccess?: boolean;
  /** List of allowed S3 bucket ARNs. */
  allowedBucketArns?: string[];
  /** Route53 hosted zone name. */
  hostedZone?: string;
  /** Domain name for the utility API. */
  domainName?: string;
  /** Bedrock models configuration. */
  bedrockModels?: BedrockModelsConfig;
}

/**
 * MCP server pre-registered with the web app at deploy time.
 * Custom auth tokens cannot be set via deploy config; users add them in the UI.
 */
export interface DefaultMcpServerConfig {
  id: string;
  name: string;
  url: string;
  description?: string;
  authMode: "none" | "session";
  enabled?: boolean;
}

/**
 * STAC Loader configuration for deployment.
 */
export interface StacLoaderDeploymentConfig {
  /** S3 lifecycle retention period in days. */
  retentionDays?: number;
  /** Name of an existing workspace S3 bucket. */
  workspaceBucketName?: string;
}

/**
 * WAFv2 configuration applied to public ALB and REST APIs.
 */
export interface WafConfig {
  /** Whether per-stack WAFv2 WebACLs are created and associated. @default true */
  enabled?: boolean;
  /** Per-IP rate limit within a 5-minute sliding window. @default 2000 */
  requestsPer5Min?: number;
}

/**
 * Dataplane configuration containing all service-specific settings.
 */
export interface DataplaneConfig {
  /** Authentication configuration. */
  authConfig?: AuthConfig;
  /** WebApp configuration. */
  webAppConfig?: WebAppConfig;
  /** Model Runner API configuration. */
  modelRunnerApiConfig?: ModelRunnerApiConfig;
  /** WebApp Utility configuration. */
  webAppUtilityConfig?: WebAppUtilityConfig;
  /** WAFv2 configuration applied to public ALB and REST APIs. */
  wafConfig?: WafConfig;

  // Domain configuration (shared across components)
  /** Route53 hosted zone ID. */
  DOMAIN_HOSTED_ZONE_ID?: string;
  /** Route53 hosted zone name. */
  DOMAIN_HOSTED_ZONE_NAME?: string;

  // Service URLs (injected from dependencies)
  /** Tile server URL. */
  TILE_SERVER_URL?: string;
  /** STAC catalog URL. */
  STAC_CATALOG_URL?: string;
  /** Data intake output SNS topic ARN. */
  DATA_INTAKE_OUTPUT_TOPIC_ARN?: string;
  /** Model runner SQS queue ARN. */
  MODEL_RUNNER_QUEUE_ARN?: string;
  /** Model runner status SNS topic ARN. */
  MODEL_RUNNER_STATUS_TOPIC_ARN?: string;
  /**
   * MCP servers pre-registered in the web app on deploy. Listed in the UI
   * and editable per-user; tokens for "custom" mode are never set here.
   */
  MCP_DEFAULT_SERVERS?: DefaultMcpServerConfig[];
  /**
   * Comma-separated host patterns permitted as MCP server URLs.
   * Empty/unset uses the web app's default list. Set to "*" to permit any
   * host. HTTPS is always required for non-localhost regardless of allowlist.
   */
  MCP_HOST_ALLOWLIST?: string;
  /** Kinesis stream name for Model Runner detection output. */
  KINESIS_STREAM_NAME?: string;
  /** STAC Loader configuration. */
  stacLoaderConfig?: StacLoaderDeploymentConfig;
  /** Whether to deploy STAC Loader integration tests as a Lambda function. */
  deployIntegrationTests?: boolean;
}

/**
 * Represents the structure of the deployment configuration file.
 */
export interface DeploymentConfig {
  /** Logical name of the project, used for the CDK stack ID. */
  projectName: string;

  /** AWS account configuration. */
  account: {
    /** AWS Account ID. */
    id: string;
    /** AWS region for deployment. */
    region: string;
    /** Whether the account is prod-like. */
    prodLike: boolean;
    /** Whether this is an ADC (Application Data Center) environment. */
    isAdc: boolean;
  };

  /** Networking configuration. If VPC_ID is provided, an existing VPC will be imported. */
  networkConfig?: NetworkConfig;

  /** WebApp dataplane configuration. */
  dataplaneConfig?: DataplaneConfig;
}

/**
 * Validation error class for deployment configuration issues.
 */
export class DeploymentConfigError extends Error {
  /**
   * Creates a new DeploymentConfigError.
   *
   * @param message - The error message
   * @param field - Optional field name that caused the error
   */
  constructor(
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = "DeploymentConfigError";
  }
}

/**
 * Validates and trims a string field, checking for required value and whitespace.
 */
function validateStringField(
  value: unknown,
  fieldName: string,
  isRequired: boolean = true
): string {
  if (value === undefined || value === null) {
    if (isRequired) {
      throw new DeploymentConfigError(
        `Missing required field: ${fieldName}`,
        fieldName
      );
    }
    return "";
  }

  if (typeof value !== "string") {
    throw new DeploymentConfigError(
      `Field '${fieldName}' must be a string, got ${typeof value}`,
      fieldName
    );
  }

  const trimmed = value.trim();
  if (isRequired && trimmed === "") {
    throw new DeploymentConfigError(
      `Field '${fieldName}' cannot be empty or contain only whitespace`,
      fieldName
    );
  }

  return trimmed;
}

/**
 * Validates a boolean field, checking for correct type.
 */
function validateBooleanField(
  value: unknown,
  fieldName: string,
  isRequired: boolean = true,
  defaultValue?: boolean
): boolean {
  if (value === undefined || value === null) {
    if (isRequired) {
      throw new DeploymentConfigError(
        `Missing required field: ${fieldName}`,
        fieldName
      );
    }
    return defaultValue ?? false;
  }

  if (typeof value !== "boolean") {
    throw new DeploymentConfigError(
      `Field '${fieldName}' must be a boolean, got ${typeof value}`,
      fieldName
    );
  }

  return value;
}

/**
 * Validates AWS account ID format.
 */
function validateAccountId(accountId: string): string {
  if (!/^\d{12}$/.test(accountId)) {
    throw new DeploymentConfigError(
      `Invalid AWS account ID format: '${accountId}'. Must be exactly 12 digits.`,
      "account.id"
    );
  }
  return accountId;
}

/**
 * Validates AWS region format using pattern matching.
 */
function validateRegion(region: string): string {
  if (!/^[a-z0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region)) {
    throw new DeploymentConfigError(
      `Invalid AWS region format: '${region}'. Must follow pattern like 'us-east-1', 'eu-west-2', etc.`,
      "account.region"
    );
  }
  return region;
}

/**
 * Validates VPC ID format.
 */
function validateVpcId(vpcId: string): string {
  if (!/^vpc-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(vpcId)) {
    throw new DeploymentConfigError(
      `Invalid VPC ID format: '${vpcId}'. Must start with 'vpc-' followed by 8 or 17 hexadecimal characters.`,
      "networkConfig.VPC_ID"
    );
  }
  return vpcId;
}

/**
 * Validates security group ID format.
 */
function validateSecurityGroupId(securityGroupId: string): string {
  if (!/^sg-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(securityGroupId)) {
    throw new DeploymentConfigError(
      `Invalid security group ID format: '${securityGroupId}'. Must start with 'sg-' followed by 8 or 17 hexadecimal characters.`,
      "networkConfig.SECURITY_GROUP_ID"
    );
  }
  return securityGroupId;
}

/**
 * Validates subnet ID format.
 */
function validateSubnetId(subnetId: string): string {
  if (!/^subnet-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(subnetId)) {
    throw new DeploymentConfigError(
      `Invalid Subnet ID format: '${subnetId}'. Must start with 'subnet-' followed by 8 or 17 hexadecimal characters.`,
      "networkConfig.TARGET_SUBNETS"
    );
  }
  return subnetId;
}

/**
 * Validates a URL format.
 */
function validateUrl(url: string, fieldName: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new DeploymentConfigError(
      `Invalid URL format for '${fieldName}': '${url}'.`,
      fieldName
    );
  }
}

/**
 * Enforces the same scheme rules as the runtime validator: https/wss for any
 * non-loopback host; http/ws only for localhost; local:// permitted as-is.
 */
function validateMcpServerScheme(url: string, fieldName: string): void {
  if (url.startsWith("local://")) return;
  const parsed = new URL(url);
  const scheme = parsed.protocol.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const isLocal = localHosts.has(parsed.hostname.toLowerCase());

  if (scheme !== "https:" && scheme !== "wss:" && !isLocal) {
    throw new DeploymentConfigError(
      `MCP server URL '${url}' at '${fieldName}' must use https:// or wss:// for non-localhost hosts.`,
      fieldName
    );
  }
  if (
    scheme !== "http:" &&
    scheme !== "https:" &&
    scheme !== "ws:" &&
    scheme !== "wss:"
  ) {
    throw new DeploymentConfigError(
      `MCP server URL '${url}' at '${fieldName}' has unsupported scheme '${scheme}'.`,
      fieldName
    );
  }
}

/**
 * Validates MCP_DEFAULT_SERVERS. Rejects authMode "custom" (tokens never live
 * in deploy config), enforces unique ids, and requires non-empty id/name/url.
 */
function validateMcpDefaultServers(value: unknown): DefaultMcpServerConfig[] {
  const fieldName = "dataplaneConfig.MCP_DEFAULT_SERVERS";
  if (!Array.isArray(value)) {
    throw new DeploymentConfigError(
      `Field '${fieldName}' must be an array.`,
      fieldName
    );
  }

  const seenIds = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new DeploymentConfigError(
        `Entry at '${fieldName}[${index}]' must be an object.`,
        `${fieldName}[${index}]`
      );
    }
    const e = entry as Record<string, unknown>;
    const path = `${fieldName}[${index}]`;

    const id = validateStringField(e.id, `${path}.id`, true);
    if (seenIds.has(id)) {
      throw new DeploymentConfigError(
        `Duplicate MCP server id '${id}' at '${path}.id'.`,
        `${path}.id`
      );
    }
    seenIds.add(id);

    const name = validateStringField(e.name, `${path}.name`, true);
    const url = validateStringField(e.url, `${path}.url`, true);
    validateUrl(url, `${path}.url`);
    validateMcpServerScheme(url, `${path}.url`);

    const authModeRaw = validateStringField(
      e.authMode,
      `${path}.authMode`,
      true
    );
    if (authModeRaw === "custom") {
      throw new DeploymentConfigError(
        `authMode 'custom' is not allowed in deploy config; users add custom-token servers in the UI.`,
        `${path}.authMode`
      );
    }
    if (authModeRaw !== "none" && authModeRaw !== "session") {
      throw new DeploymentConfigError(
        `'${path}.authMode' must be 'none' or 'session', got '${authModeRaw}'.`,
        `${path}.authMode`
      );
    }
    const authMode: "none" | "session" = authModeRaw;

    const description =
      e.description !== undefined
        ? validateStringField(e.description, `${path}.description`, false)
        : undefined;

    const enabled =
      e.enabled !== undefined
        ? validateBooleanField(e.enabled, `${path}.enabled`, false, true)
        : undefined;

    return {
      id,
      name,
      url,
      authMode,
      ...(description ? { description } : {}),
      ...(enabled !== undefined ? { enabled } : {})
    };
  });
}

/**
 * Validates and parses the authConfig section.
 */
function validateAuthConfig(authConfigData: unknown): AuthConfig | undefined {
  if (!authConfigData || typeof authConfigData !== "object") {
    return undefined;
  }

  const authConfig = authConfigData as Record<string, unknown>;

  // Authority is required if authConfig is provided
  const authority = validateStringField(
    authConfig.authority,
    "dataplaneConfig.authConfig.authority",
    true
  );
  validateUrl(authority, "dataplaneConfig.authConfig.authority");

  // Audience is required if authConfig is provided
  const audience = validateStringField(
    authConfig.audience,
    "dataplaneConfig.authConfig.audience",
    true
  );

  const result: AuthConfig = { authority, audience };

  // Optional fields
  const clientId = validateStringField(
    authConfig.clientId,
    "dataplaneConfig.authConfig.clientId",
    false
  );
  if (clientId) result.clientId = clientId;

  const clientSecret = validateStringField(
    authConfig.clientSecret,
    "dataplaneConfig.authConfig.clientSecret",
    false
  );
  if (clientSecret) result.clientSecret = clientSecret;

  return result;
}

/**
 * Validates and parses the webAppConfig section.
 */
function validateWebAppConfig(webAppData: unknown): WebAppConfig | undefined {
  if (!webAppData || typeof webAppData !== "object") {
    return undefined;
  }

  const webApp = webAppData as Record<string, unknown>;
  const result: WebAppConfig = {};

  if (webApp.buildFromSource !== undefined) {
    result.buildFromSource = validateBooleanField(
      webApp.buildFromSource,
      "dataplaneConfig.webAppConfig.buildFromSource",
      false,
      false
    );
  }

  const artifactLocalPath = validateStringField(
    webApp.artifactLocalPath,
    "dataplaneConfig.webAppConfig.artifactLocalPath",
    false
  );
  if (artifactLocalPath) result.artifactLocalPath = artifactLocalPath;

  const artifactUrl = validateStringField(
    webApp.artifactUrl,
    "dataplaneConfig.webAppConfig.artifactUrl",
    false
  );
  if (artifactUrl) {
    validateUrl(artifactUrl, "dataplaneConfig.webAppConfig.artifactUrl");
    result.artifactUrl = artifactUrl;
  }

  const hostedZone = validateStringField(
    webApp.hostedZone,
    "dataplaneConfig.webAppConfig.hostedZone",
    false
  );
  if (hostedZone) result.hostedZone = hostedZone;

  const domainName = validateStringField(
    webApp.domainName,
    "dataplaneConfig.webAppConfig.domainName",
    false
  );
  if (domainName) result.domainName = domainName;

  const authSuccessUrl = validateStringField(
    webApp.authSuccessUrl,
    "dataplaneConfig.webAppConfig.authSuccessUrl",
    false
  );
  if (authSuccessUrl) {
    validateUrl(authSuccessUrl, "dataplaneConfig.webAppConfig.authSuccessUrl");
    result.authSuccessUrl = authSuccessUrl;
  }

  const authClientId = validateStringField(
    webApp.authClientId,
    "dataplaneConfig.webAppConfig.authClientId",
    false
  );
  if (authClientId) result.authClientId = authClientId;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validates and parses the modelRunnerApiConfig section.
 */
function validateModelRunnerApiConfig(
  modelRunnerData: unknown
): ModelRunnerApiConfig | undefined {
  if (!modelRunnerData || typeof modelRunnerData !== "object") {
    return undefined;
  }

  const modelRunner = modelRunnerData as Record<string, unknown>;
  const result: ModelRunnerApiConfig = {};

  const hostedZone = validateStringField(
    modelRunner.hostedZone,
    "dataplaneConfig.modelRunnerApiConfig.hostedZone",
    false
  );
  if (hostedZone) result.hostedZone = hostedZone;

  const domainName = validateStringField(
    modelRunner.domainName,
    "dataplaneConfig.modelRunnerApiConfig.domainName",
    false
  );
  if (domainName) result.domainName = domainName;

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validates and parses the webAppUtilityConfig section.
 */
function validateWebAppUtilityConfig(
  utilityData: unknown
): WebAppUtilityConfig | undefined {
  if (!utilityData || typeof utilityData !== "object") {
    return undefined;
  }

  const utility = utilityData as Record<string, unknown>;
  const result: WebAppUtilityConfig = {};

  if (utility.restrictBucketAccess !== undefined) {
    result.restrictBucketAccess = validateBooleanField(
      utility.restrictBucketAccess,
      "dataplaneConfig.webAppUtilityConfig.restrictBucketAccess",
      false,
      false
    );
  }

  if (utility.allowedBucketArns !== undefined) {
    if (!Array.isArray(utility.allowedBucketArns)) {
      throw new DeploymentConfigError(
        "Field 'dataplaneConfig.webAppUtilityConfig.allowedBucketArns' must be an array",
        "dataplaneConfig.webAppUtilityConfig.allowedBucketArns"
      );
    }
    result.allowedBucketArns = utility.allowedBucketArns as string[];
  }

  const hostedZone = validateStringField(
    utility.hostedZone,
    "dataplaneConfig.webAppUtilityConfig.hostedZone",
    false
  );
  if (hostedZone) result.hostedZone = hostedZone;

  const domainName = validateStringField(
    utility.domainName,
    "dataplaneConfig.webAppUtilityConfig.domainName",
    false
  );
  if (domainName) result.domainName = domainName;

  // Parse bedrockModels if present
  if (utility.bedrockModels && typeof utility.bedrockModels === "object") {
    const bedrockData = utility.bedrockModels as Record<string, unknown>;
    if (bedrockData.enabledModels && Array.isArray(bedrockData.enabledModels)) {
      result.bedrockModels = {
        enabledModels: bedrockData.enabledModels as string[]
      };
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validates and parses the wafConfig section.
 */
function validateWafConfig(wafData: unknown): WafConfig | undefined {
  if (!wafData || typeof wafData !== "object") {
    return undefined;
  }

  const waf = wafData as Record<string, unknown>;
  const result: WafConfig = {};

  if (waf.enabled !== undefined) {
    result.enabled = validateBooleanField(
      waf.enabled,
      "dataplaneConfig.wafConfig.enabled",
      false,
      true
    );
  }

  if (waf.requestsPer5Min !== undefined) {
    if (typeof waf.requestsPer5Min !== "number" || waf.requestsPer5Min <= 0) {
      throw new DeploymentConfigError(
        `Field 'dataplaneConfig.wafConfig.requestsPer5Min' must be a positive number`,
        "dataplaneConfig.wafConfig.requestsPer5Min"
      );
    }
    result.requestsPer5Min = waf.requestsPer5Min;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Validates and parses the dataplaneConfig section.
 */
function validateDataplaneConfig(
  dataplaneData: unknown
): DataplaneConfig | undefined {
  if (!dataplaneData || typeof dataplaneData !== "object") {
    return undefined;
  }

  const dataplane = dataplaneData as Record<string, unknown>;
  const result: DataplaneConfig = {};

  // Validate nested config sections
  const authConfig = validateAuthConfig(dataplane.authConfig);
  if (authConfig) result.authConfig = authConfig;

  const webAppConfig = validateWebAppConfig(dataplane.webAppConfig);
  if (webAppConfig) result.webAppConfig = webAppConfig;

  const modelRunnerApiConfig = validateModelRunnerApiConfig(
    dataplane.modelRunnerApiConfig
  );
  if (modelRunnerApiConfig) result.modelRunnerApiConfig = modelRunnerApiConfig;

  const webAppUtilityConfig = validateWebAppUtilityConfig(
    dataplane.webAppUtilityConfig
  );
  if (webAppUtilityConfig) result.webAppUtilityConfig = webAppUtilityConfig;

  const wafConfig = validateWafConfig(dataplane.wafConfig);
  if (wafConfig) result.wafConfig = wafConfig;

  // Validate domain configuration (shared across components)
  const domainHostedZoneId = validateStringField(
    dataplane.DOMAIN_HOSTED_ZONE_ID,
    "dataplaneConfig.DOMAIN_HOSTED_ZONE_ID",
    false
  );
  if (domainHostedZoneId) result.DOMAIN_HOSTED_ZONE_ID = domainHostedZoneId;

  const domainHostedZoneName = validateStringField(
    dataplane.DOMAIN_HOSTED_ZONE_NAME,
    "dataplaneConfig.DOMAIN_HOSTED_ZONE_NAME",
    false
  );
  if (domainHostedZoneName)
    result.DOMAIN_HOSTED_ZONE_NAME = domainHostedZoneName;

  // Validate service URLs (injected from dependencies)
  const tileServerUrl = validateStringField(
    dataplane.TILE_SERVER_URL,
    "dataplaneConfig.TILE_SERVER_URL",
    false
  );
  if (tileServerUrl) {
    validateUrl(tileServerUrl, "dataplaneConfig.TILE_SERVER_URL");
    result.TILE_SERVER_URL = tileServerUrl;
  }

  const stacCatalogUrl = validateStringField(
    dataplane.STAC_CATALOG_URL,
    "dataplaneConfig.STAC_CATALOG_URL",
    false
  );
  if (stacCatalogUrl) {
    validateUrl(stacCatalogUrl, "dataplaneConfig.STAC_CATALOG_URL");
    result.STAC_CATALOG_URL = stacCatalogUrl;
  }

  const dataIntakeTopicArn = validateStringField(
    dataplane.DATA_INTAKE_OUTPUT_TOPIC_ARN,
    "dataplaneConfig.DATA_INTAKE_OUTPUT_TOPIC_ARN",
    false
  );
  if (dataIntakeTopicArn)
    result.DATA_INTAKE_OUTPUT_TOPIC_ARN = dataIntakeTopicArn;

  const modelRunnerQueueArn = validateStringField(
    dataplane.MODEL_RUNNER_QUEUE_ARN,
    "dataplaneConfig.MODEL_RUNNER_QUEUE_ARN",
    false
  );
  if (modelRunnerQueueArn) result.MODEL_RUNNER_QUEUE_ARN = modelRunnerQueueArn;

  const modelRunnerStatusTopicArn = validateStringField(
    dataplane.MODEL_RUNNER_STATUS_TOPIC_ARN,
    "dataplaneConfig.MODEL_RUNNER_STATUS_TOPIC_ARN",
    false
  );
  if (modelRunnerStatusTopicArn)
    result.MODEL_RUNNER_STATUS_TOPIC_ARN = modelRunnerStatusTopicArn;

  if (dataplane.MCP_DEFAULT_SERVERS !== undefined) {
    result.MCP_DEFAULT_SERVERS = validateMcpDefaultServers(
      dataplane.MCP_DEFAULT_SERVERS
    );
  }

  const mcpHostAllowlist = validateStringField(
    dataplane.MCP_HOST_ALLOWLIST,
    "dataplaneConfig.MCP_HOST_ALLOWLIST",
    false
  );
  if (mcpHostAllowlist) result.MCP_HOST_ALLOWLIST = mcpHostAllowlist;

  // Validate STAC Loader config
  if (
    dataplane.stacLoaderConfig &&
    typeof dataplane.stacLoaderConfig === "object"
  ) {
    const slConfig = dataplane.stacLoaderConfig as Record<string, unknown>;
    const stacLoaderConfig: StacLoaderDeploymentConfig = {};
    if (slConfig.retentionDays !== undefined) {
      stacLoaderConfig.retentionDays = slConfig.retentionDays as number;
    }
    if (slConfig.workspaceBucketName !== undefined) {
      stacLoaderConfig.workspaceBucketName = validateStringField(
        slConfig.workspaceBucketName,
        "dataplaneConfig.stacLoaderConfig.workspaceBucketName",
        false
      );
    }
    if (Object.keys(stacLoaderConfig).length > 0) {
      result.stacLoaderConfig = stacLoaderConfig;
    }
  }

  // Validate deployIntegrationTests flag
  result.deployIntegrationTests = validateBooleanField(
    dataplane.deployIntegrationTests,
    "dataplaneConfig.deployIntegrationTests",
    false,
    true
  );

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Loads and validates the deployment configuration from `deployment/deployment.json`.
 *
 * @returns A validated {@link DeploymentConfig} object
 * @throws {DeploymentConfigError} If the file is missing, malformed, or contains invalid values
 */
export function loadDeploymentConfig(): DeploymentConfig {
  const deploymentPath = join(__dirname, "deployment.json");

  if (!existsSync(deploymentPath)) {
    throw new DeploymentConfigError(
      `Missing deployment.json file at ${deploymentPath}. Please create it by copying deployment.json.example`
    );
  }

  let parsed: unknown;
  try {
    const rawContent = readFileSync(deploymentPath, "utf-8");
    parsed = JSON.parse(rawContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DeploymentConfigError(
        `Invalid JSON format in deployment.json: ${error.message}`
      );
    }
    throw new DeploymentConfigError(
      `Failed to read deployment.json: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  // Validate top-level structure
  if (!parsed || typeof parsed !== "object") {
    throw new DeploymentConfigError(
      "deployment.json must contain a valid JSON object"
    );
  }

  const rawConfig = parsed as Record<string, unknown>;

  // Validate project name
  const projectName = validateStringField(rawConfig.projectName, "projectName");
  if (projectName.length === 0) {
    throw new DeploymentConfigError("projectName cannot be empty");
  }

  // Validate account section
  if (!rawConfig.account || typeof rawConfig.account !== "object") {
    throw new DeploymentConfigError(
      "Missing or invalid account section in deployment.json",
      "account"
    );
  }

  const accountConfig = rawConfig.account as Record<string, unknown>;

  const accountId = validateAccountId(
    validateStringField(accountConfig.id, "account.id")
  );
  const region = validateRegion(
    validateStringField(accountConfig.region, "account.region")
  );
  const prodLike = validateBooleanField(
    accountConfig.prodLike,
    "account.prodLike",
    false,
    false
  );
  const isAdc = validateBooleanField(
    accountConfig.isAdc,
    "account.isAdc",
    false,
    false
  );

  // Parse optional Network configuration
  let networkConfig: NetworkConfig | undefined = undefined;
  if (
    rawConfig.networkConfig &&
    typeof rawConfig.networkConfig === "object" &&
    rawConfig.networkConfig !== null
  ) {
    const networkConfigData = rawConfig.networkConfig as Record<
      string,
      unknown
    >;

    networkConfig = {};

    // Validate VPC_ID format if provided
    if (networkConfigData.VPC_ID !== undefined) {
      const vpcId = validateStringField(
        networkConfigData.VPC_ID,
        "networkConfig.VPC_ID"
      );
      validateVpcId(vpcId);
      networkConfig.VPC_ID = vpcId;
    }

    // Validate TARGET_SUBNETS is an array if provided
    if (networkConfigData.TARGET_SUBNETS !== undefined) {
      if (!Array.isArray(networkConfigData.TARGET_SUBNETS)) {
        throw new DeploymentConfigError(
          "Field 'networkConfig.TARGET_SUBNETS' must be an array",
          "networkConfig.TARGET_SUBNETS"
        );
      }
      // Validate each subnet ID format
      const subnets: string[] = [];
      for (const subnetId of networkConfigData.TARGET_SUBNETS) {
        const validated = validateStringField(
          subnetId,
          "networkConfig.TARGET_SUBNETS[]"
        );
        validateSubnetId(validated);
        subnets.push(validated);
      }
      networkConfig.TARGET_SUBNETS = subnets;
    }

    // Validate SECURITY_GROUP_ID format if provided
    if (networkConfigData.SECURITY_GROUP_ID !== undefined) {
      const sgId = validateStringField(
        networkConfigData.SECURITY_GROUP_ID,
        "networkConfig.SECURITY_GROUP_ID"
      );
      validateSecurityGroupId(sgId);
      networkConfig.SECURITY_GROUP_ID = sgId;
    }

    // Validate that TARGET_SUBNETS is required when VPC_ID is provided
    if (
      networkConfig.VPC_ID &&
      (!networkConfig.TARGET_SUBNETS ||
        networkConfig.TARGET_SUBNETS.length === 0)
    ) {
      throw new DeploymentConfigError(
        "When VPC_ID is provided, TARGET_SUBNETS must also be specified with at least one subnet ID",
        "networkConfig.TARGET_SUBNETS"
      );
    }
  }

  // Parse optional dataplaneConfig section
  const dataplaneConfig = validateDataplaneConfig(rawConfig.dataplaneConfig);

  const validatedConfig: DeploymentConfig = {
    projectName,
    account: {
      id: accountId,
      region: region,
      prodLike: prodLike,
      isAdc: isAdc
    },
    networkConfig,
    dataplaneConfig
  };

  // Only log non-sensitive configuration details
  // eslint-disable-next-line no-console
  console.log(
    `Using environment from deployment.json: projectName=${validatedConfig.projectName}, region=${validatedConfig.account.region}`
  );

  return validatedConfig;
}
