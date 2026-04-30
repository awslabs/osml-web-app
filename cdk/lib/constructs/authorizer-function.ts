/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { RemovalPolicy } from "aws-cdk-lib";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";

/**
 * Configuration for JWT-based authentication
 */
export interface AuthConfig {
  /**
   * The OIDC authority URL (issuer)
   */
  authority: string;

  /**
   * The expected audience for JWT tokens
   */
  audience: string;
}

/**
 * Properties for the AuthorizerFunction construct
 */
export interface AuthorizerFunctionProps {
  /**
   * The authentication configuration
   */
  auth: AuthConfig;

  /**
   * The name prefix for the authorizer function
   */
  name: string;

  /**
   * The VPC to deploy the authorizer into
   */
  vpc?: IVpc;

  /**
   * The subnet selection for VPC deployment
   */
  vpcSubnets?: SubnetSelection;

  /**
   * Security groups for the Lambda function
   */
  securityGroups?: SecurityGroup[];

  /**
   * Whether this is a production environment
   */
  isProd?: boolean;

  /**
   * Optional IAM role for the Lambda function
   */
  lambdaRole?: IRole;
}

/**
 * Creates a Lambda function for JWT-based API Gateway authorization
 */
export class AuthorizerFunction extends Construct {
  /**
   * The Lambda function used as the authorizer
   */
  public readonly authorizerFunction: Function;

  constructor(scope: Construct, id: string, props: AuthorizerFunctionProps) {
    super(scope, id);

    // Create a managed log group with proper retention and removal policy
    const logGroupName = `/aws/lambda/${props.name}-AuthorizerFunction`;
    const removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
    const logGroup = new LogGroup(this, `AuthorizerFunctionLogGroup${id}`, {
      logGroupName,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy
    });

    this.authorizerFunction = new Function(this, `AuthorizerFunction${id}`, {
      functionName: `${props.name}-AuthorizerFunction`,
      runtime: Runtime.PYTHON_3_13,
      handler: "lambda_function.lambda_handler",
      code: Code.fromAsset(
        join(__dirname, "..", "..", "lambda", "authorizer"),
        {
          bundling: {
            image: Runtime.PYTHON_3_13.bundlingImage,
            command: [
              "/bin/bash",
              "-c",
              "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output"
            ]
          }
        }
      ),
      environment: {
        AUTHORITY: props.auth.authority,
        AUDIENCE: props.auth.audience
      },
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.securityGroups,
      role: props.lambdaRole,
      logGroup: logGroup // Use the imported existing log group
    });

    // When the caller does not supply a custom IAM role, CDK auto-creates a
    // Lambda service role and attaches the AWSLambdaBasicExecutionRole and
    // (because the function runs in a VPC) the AWSLambdaVPCAccessExecutionRole
    // managed policies. Both managed policies are the configurations AWS
    // publishes as the baseline grants for writing logs to CloudWatch and
    // managing Elastic Network Interfaces for a VPC-bound Lambda. Replacing
    // them with customer-managed equivalents offers no security benefit and
    // adds maintenance burden when AWS updates the underlying action set.
    //
    // The python3.13 runtime pin matches the rest of the web-app Lambdas,
    // which share a PyJWT/cryptography dependency stack whose native wheels
    // are not yet published for python3.14 (PyO3-based cryptography cannot
    // build on python3.14 in the current pinned release). python3.13 remains
    // an AWS-supported Lambda runtime.
    const suppressions = [
      {
        id: "AwsSolutions-L1",
        reason:
          "This authorizer Lambda is pinned to python3.13 because its bundled dependency set (PyJWT with the crypto extra, which pulls cryptography/cffi with native wheels) ships wheels that are not yet compatible with python3.14 in the version pinned by this construct. Moving to python3.14 would force a wider dependency upgrade across all web-app Lambdas; python3.13 remains an AWS-supported Lambda runtime."
      }
    ];
    if (!props.lambdaRole) {
      suppressions.push(
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing this managed policy with an inline customer-managed copy would duplicate the grant and drift whenever AWS updates the action set for CloudWatch Logs."
        },
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaVPCAccessExecutionRole is the AWS-published managed policy that allows the Lambda service to create and delete the Elastic Network Interfaces required to run this VPC-bound function. Replacing the managed policy with a customer-managed copy would duplicate the EC2 ENI action set without narrowing its scope."
        }
      );
    }
    NagSuppressions.addResourceSuppressions(
      this.authorizerFunction,
      suppressions,
      true
    );
  }
}
