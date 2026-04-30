/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { WebAppUtilityConfig } from "./config/app-config";
import { WafConfig } from "./config/app-config";
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

  /**
   * WAFv2 configuration for the REST API (optional).
   */
  wafConfig?: WafConfig;
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
      corsAllowedOrigins: props.corsAllowedOrigins,
      wafConfig: props.wafConfig
    });

    // When the WebAppUtility construct wires S3 event notifications on any
    // of its buckets (data catalog ingest, detection bridge), CDK auto-
    // provisions a stack-root BucketNotificationsHandler Lambda whose id is
    // fixed by aws-cdk-lib and therefore cannot be co-located with any
    // construct we declare. That helper Lambda uses the AWS-published
    // AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs access,
    // which is the same baseline-log grant we accept on every other Lambda
    // in this stack. This is the only stack-path suppression in this file;
    // every other nag suppression lives next to its construct declaration.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/BucketNotificationsHandler050a0587b7544547bf325f094a3db834/Role/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "CDK auto-provisions this BucketNotificationsHandler Lambda at the stack root whenever Bucket.addEventNotification is used; its logical id and service role are fixed by aws-cdk-lib. The role is attached to the AWS-published AWSLambdaBasicExecutionRole managed policy which is the baseline CloudWatch Logs grant for any Lambda. Replacing it with a customer-managed copy would duplicate the grant and drift whenever AWS updates the CloudWatch Logs action set."
        }
      ]
    );
  }
}
