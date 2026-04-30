/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { BaseConfig, ConfigType } from "./base-config";

/**
 * @deprecated Use AuthConfig from ../constructs/authorizer-function instead.
 * This class is kept for backward compatibility with existing constructs.
 */
export class AuthConfig extends BaseConfig {
  public authority?: string;
  public audience?: string;
  public clientId?: string;
  public clientSecret?: string;

  constructor(config: ConfigType = {}) {
    super(config);
  }
}

export class WebAppConfig extends BaseConfig {
  public buildFromSource!: boolean;
  public artifactLocalPath?: string;
  public artifactUrl?: string;
  public artifactGithubOwner?: string;
  public artifactGithubRepo?: string;
  public hostedZone?: string;
  public domainName?: string;
  public albSecurityGroupId?: string;
  public ec2SecurityGroupId?: string;
  public tileServerUrl?: string;
  public stacCatalogUrl?: string;
  public webAppUtilityUrl?: string;
  public modelRunnerApiUrl?: string;
  public authSuccessUrl?: string;
  public authClientId?: string;
  public authSecret?: string;
  public authority?: string;

  constructor(config: ConfigType = {}) {
    super(config);
  }
}

export class ModelRunnerApiConfig extends BaseConfig {
  public modelRunnerImageRequestQueueArn!: string;
  public modelRunnerStatusTopicArn!: string;
  public securityGroupId?: string;
  public hostedZone?: string;
  public domainName?: string;

  constructor(config: ConfigType = {}) {
    super(config);
  }
}

export class BedrockModelsConfig extends BaseConfig {
  public enabledModels?: string[];

  constructor(config: ConfigType = {}) {
    super(config);
  }
}

export class WafConfig extends BaseConfig {
  /** Whether per-stack WAFv2 WebACLs are created and associated. @default true */
  public enabled?: boolean;
  /** Per-IP rate limit within a 5-minute sliding window. @default 2000 */
  public requestsPer5Min?: number;

  constructor(config: ConfigType = {}) {
    super(config);
    if (this.enabled === undefined) {
      this.enabled = true;
    }
    if (this.requestsPer5Min === undefined) {
      this.requestsPer5Min = 2000;
    }
  }
}

export class WebAppUtilityConfig extends BaseConfig {
  public restrictBucketAccess!: boolean;
  public allowedBucketArns?: string[];
  public securityGroupId?: string;
  public hostedZone?: string;
  public domainName?: string;
  public dataCatalogIngestBucketName?: string;
  public osmlDataIntakeOutputTopic?: string;
  public stacCatalogUrl?: string;
  public bedrockModels?: BedrockModelsConfig;

  /**
   * Name of the SNS topic that the data-catalog-intake Lambda subscribes to.
   * Used by the detection bridge to publish translated S3 events.
   * Defaults to "data-catalog-intake".
   */
  public intakeTopicName?: string;

  /**
   * STAC collection identifier for detection results.
   * Defaults to "model-runner-detections".
   */
  public detectionCollectionId?: string;

  constructor(config: ConfigType = {}) {
    super(config);
    // Set defaults only if not provided in config
    if (this.restrictBucketAccess === undefined) {
      this.restrictBucketAccess = false;
    }
    // Initialize bedrockModels if provided
    if (config.bedrockModels) {
      this.bedrockModels = new BedrockModelsConfig(
        config.bedrockModels as ConfigType
      );
    }
  }
}
