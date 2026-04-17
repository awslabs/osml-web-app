/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { WebAppUtilityConfig } from "./config/app-config";
import { AuthConfig } from "./constructs/authorizer-function";
import { OSMLAccount } from "./constructs/types";
import { WebAppUtilityConstruct } from "./constructs/web-app-utility-construct";

export interface WebAppUtilityStackProps extends StackProps {
  /**
   * The VPC ID for deployment
   */
  vpcId: string;

  /**
   * Whether this is a production environment
   */
  isProd: boolean;

  /**
   * The OSML deployment account.
   */
  account: OSMLAccount;

  /**
   * The project name prefix for resource naming
   */
  projectName: string;

  /**
   * AWS region for deployment
   */
  region: string;

  /**
   * The config for the stack
   */
  config: WebAppUtilityConfig;

  /**
   * Auth configuration for API authentication
   */
  auth: AuthConfig;

  /**
   * List of origins that should be allowed to access this API via CORS (optional)
   * - If omitted or empty array: No CORS headers (same-origin only)
   * - ["*"]: Allow all origins (wildcard)
   * - ["https://domain.com", "https://other.com"]: Specific origins only
   */
  corsAllowedOrigins?: string[];
}

export class WebAppUtilityStack extends Stack {
  public webAppUtility: WebAppUtilityConstruct;

  // Expose data catalog ingest bucket ARN for allowed bucket configuration
  public get dataCatalogIngestBucketArn(): string | undefined {
    return this.webAppUtility.dataCatalogIngestBucket?.bucketArn;
  }

  constructor(scope: Construct, id: string, props: WebAppUtilityStackProps) {
    super(scope, id, {
      terminationProtection: props.isProd,
      ...props
    });

    // Import existing VPC
    const vpc = Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: props.vpcId
    });

    // Create the WebApp Utility construct
    this.webAppUtility = new WebAppUtilityConstruct(this, "WebAppUtility", {
      vpc: vpc,
      isProd: props.isProd,
      account: props.account,
      projectName: props.projectName,
      region: props.region,
      config: props.config,
      auth: props.auth,
      corsAllowedOrigins: props.corsAllowedOrigins
    });
  }
}
