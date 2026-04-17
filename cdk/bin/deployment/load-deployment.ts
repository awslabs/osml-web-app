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
  /** Auth secret for the web app. */
  authSecret?: string;
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
 * STAC Loader configuration for deployment.
 */
export interface StacLoaderDeploymentConfig {
  /** S3 lifecycle retention period in days. */
  retentionDays?: number;
  /** Name of an existing workspace S3 bucket. */
  workspaceBucketName?: string;
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
  /** Geo agents MCP URL. */
  GEO_AGENTS_MCP_URL?: string;
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

  const authSecret = validateStringField(
    webApp.authSecret,
    "dataplaneConfig.webAppConfig.authSecret",
    false
  );
  if (authSecret) result.authSecret = authSecret;

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

  const geoAgentsMcpUrl = validateStringField(
    dataplane.GEO_AGENTS_MCP_URL,
    "dataplaneConfig.GEO_AGENTS_MCP_URL",
    false
  );
  if (geoAgentsMcpUrl) {
    validateUrl(geoAgentsMcpUrl, "dataplaneConfig.GEO_AGENTS_MCP_URL");
    result.GEO_AGENTS_MCP_URL = geoAgentsMcpUrl;
  }

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
