/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { ModelRunnerApiConfig } from "./config/app-config";
import { AuthConfig } from "./constructs/authorizer-function";
import { ModelRunnerApiConstruct } from "./constructs/model-runner-api-construct";

export interface ModelRunnerApiStackProps extends StackProps {
  /**
   * The VPC ID for deployment
   */
  vpcId: string;

  /**
   * Whether this is a production environment
   */
  isProd: boolean;

  /**
   * The project name prefix for resource naming
   */
  projectName: string;

  /**
   * The config for the stack
   */
  config: ModelRunnerApiConfig;

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

export class ModelRunnerApiStack extends Stack {
  public modelRunnerApi: ModelRunnerApiConstruct;

  constructor(scope: Construct, id: string, props: ModelRunnerApiStackProps) {
    super(scope, id, {
      terminationProtection: props.isProd,
      ...props
    });

    // Import existing VPC
    const vpc = Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: props.vpcId
    });

    // Create the model runner API construct
    this.modelRunnerApi = new ModelRunnerApiConstruct(this, "ModelRunnerApi", {
      vpc: vpc,
      isProd: props.isProd,
      projectName: props.projectName,
      config: props.config,
      auth: props.auth,
      corsAllowedOrigins: props.corsAllowedOrigins
    });
  }
}
