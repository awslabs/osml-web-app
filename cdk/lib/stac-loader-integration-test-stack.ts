/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  ISecurityGroup,
  SecurityGroup,
  SubnetType,
  Vpc
} from "aws-cdk-lib/aws-ec2";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { DockerImageCode, DockerImageFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { join } from "path";

/**
 * Properties for the StacLoaderIntegrationTestStack.
 */
export interface StacLoaderIntegrationTestStackProps extends StackProps {
  /** The VPC ID for deployment (must match the STAC Loader VPC). */
  vpcId: string;

  /** The DNS name of the STAC Loader's internal ALB. */
  stacLoaderAlbDnsName: string;

  /** The project name prefix for resource naming. */
  projectName: string;

  /** Whether this is a production environment. */
  isProd: boolean;

  /** Optional security group for the test Lambda. */
  securityGroup?: ISecurityGroup;
}

/**
 * CDK stack that deploys integration tests as a Docker-based Lambda function.
 *
 * The test Lambda acts as an MCP client that communicates with the
 * STAC Loader via its internal Application Load Balancer endpoint.
 * This stack is conditionally deployed based on the deployIntegrationTests
 * flag in deployment.json.
 *
 * Follows the same pattern as osml-geo-agents integration tests:
 * - Docker image with all test dependencies baked in
 * - pytest.main() in-process execution
 * - Results output to CloudWatch Logs
 */
export class StacLoaderIntegrationTestStack extends Stack {
  /** The integration test Lambda function. */
  public readonly testFunction: DockerImageFunction;

  constructor(
    scope: Construct,
    id: string,
    props: StacLoaderIntegrationTestStackProps
  ) {
    super(scope, id, {
      terminationProtection: false, // Never protect test infrastructure
      ...props
    });

    const removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // Import the VPC (same VPC as the STAC Loader)
    const vpc = Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: props.vpcId
    });

    // Create a dedicated security group for the test Lambda
    const testSecurityGroup =
      props.securityGroup ??
      new SecurityGroup(this, "IntegrationTestSecurityGroup", {
        vpc,
        description: "Security group for STAC Loader integration test Lambda",
        allowAllOutbound: true
      });

    // Create a dedicated log group for test output
    const logGroup = new LogGroup(this, "IntegrationTestLogGroup", {
      logGroupName: `/aws/lambda/${props.projectName}-StacLoaderIntegrationTest`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy
    });

    // IAM role for the test Lambda using AWS managed policies
    const testRole = new Role(this, "IntegrationTestRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Allows the STAC Loader integration test Lambda to access necessary AWS services (VPC, CloudWatch)",
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        )
      ]
    });

    // Build Docker image from the stacLoader directory using Dockerfile.integ
    const testImageCode = DockerImageCode.fromImageAsset(
      join(__dirname, "..", "lambda", "stacLoader"),
      {
        file: "docker/Dockerfile.integ",
        target: "integ"
      }
    );

    // Create the integration test Lambda function (Docker-based)
    this.testFunction = new DockerImageFunction(
      this,
      "IntegrationTestFunction",
      {
        functionName: `${props.projectName}-StacLoaderIntegrationTest`,
        code: testImageCode,
        timeout: Duration.minutes(10),
        memorySize: 1024,
        vpc,
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [testSecurityGroup],
        role: testRole,
        logGroup,
        environment: {
          STAC_LOADER_ALB_ENDPOINT: `http://${props.stacLoaderAlbDnsName}`,
          LOG_LEVEL: "INFO",
          PYTHONUNBUFFERED: "1"
        }
      }
    );
  }
}
