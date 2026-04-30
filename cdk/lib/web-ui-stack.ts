/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { WafConfig } from "./config/app-config";
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

  /**
   * WAFv2 configuration for the internet-facing ALB (optional).
   */
  wafConfig?: WafConfig;
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
      config: props.config,
      wafConfig: props.wafConfig
    });

    // The WebUIConstruct uses AwsCustomResource to flip the web app Launch
    // Template's default version to $Latest after each deployment. CDK's
    // AwsCustomResource helper auto-provisions a generic Lambda at the stack
    // root whose logical id is fixed by aws-cdk-lib (AWS679f53fac00...). This
    // helper Lambda's runtime is managed entirely by aws-cdk-lib and will
    // advance with CDK releases; the consumer cannot override it without
    // replacing AwsCustomResource with a hand-written CustomResource + Provider.
    // Co-location is therefore impossible — the resource is neither owned nor
    // declared in any construct file in this package.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource`,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "CDK's AwsCustomResource helper auto-provisions a generic Lambda at the stack root whose logical id is fixed by aws-cdk-lib (AWS679f53fac00...). The runtime of this helper Lambda is managed by aws-cdk-lib and will advance with CDK releases; the consumer cannot override it without replacing AwsCustomResource with a hand-written CustomResource and Provider pair."
        }
      ]
    );

    // CDK's AwsCustomResource helper also auto-provisions a ServiceRole at the
    // stack root whose logical id is fixed by aws-cdk-lib. That role is attached
    // to the AWS-published AWSLambdaBasicExecutionRole managed policy for
    // CloudWatch Logs access. The helper does not expose a hook to substitute a
    // customer-managed log policy, so co-location in a construct file is
    // impossible and the suppression lives on the stack path.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "CDK's AwsCustomResource helper at the stack root uses the AWS-published AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs access. The helper's ServiceRole is created by aws-cdk-lib and co-location is impossible."
        }
      ]
    );

    // The SetDefaultWebAppLaunchTemplate AwsCustomResource uses
    // AwsCustomResourcePolicy.ANY_RESOURCE, which emits Resource::* on the
    // auto-generated CustomResourcePolicy because the target LaunchTemplate id
    // is not known until synth time. The runtime SDK call (EC2:ModifyLaunchTemplate)
    // is parameterised with the specific LaunchTemplate id, so the effective
    // call is scoped to one resource even though the IAM policy is not.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/WebApp/SetDefaultWebAppLaunchTemplate/CustomResourcePolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          appliesTo: ["Resource::*"],
          reason:
            "AwsCustomResourcePolicy.ANY_RESOURCE emits Resource::* because the SDK call performed by the custom resource (EC2:ModifyLaunchTemplate) targets a LaunchTemplate whose id is not known until synth time. The runtime SDK call itself targets the specific LaunchTemplate id."
        }
      ]
    );
  }
}
