/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { RemovalPolicy } from "aws-cdk-lib";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { IRole } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
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
  }
}
