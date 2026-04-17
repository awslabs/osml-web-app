/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { OSMLAccount } from "./constructs/types";
import { WebAppConfig, WebUIConstruct } from "./constructs/web-ui-construct";

export interface WebAppStackProps extends StackProps {
  /**
   * The VPC ID to import and deploy the construct into
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
   * Configuration for the WebApp Stack (optional).
   * Accepts partial config - construct will apply defaults for missing values.
   */
  config?: Partial<WebAppConfig>;
}

export class WebAppStack extends Stack {
  public webUI: WebUIConstruct;

  constructor(scope: Construct, id: string, props: WebAppStackProps) {
    super(scope, id, {
      terminationProtection: props.isProd,
      ...props
    });

    // Import existing VPC
    const vpc = Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: props.vpcId
    });

    // Create the web app construct
    this.webUI = new WebUIConstruct(this, "WebApp", {
      vpc: vpc,
      isProd: props.isProd,
      account: props.account,
      projectName: props.projectName,
      config: props.config
    });
  }
}
