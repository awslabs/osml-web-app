/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Stack, StackProps } from "aws-cdk-lib";
import { ISecurityGroup, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

import { AuthConfig } from "./constructs/authorizer-function";
import {
  StacLoaderConfig,
  StacLoaderConstruct
} from "./constructs/stac-loader-construct";

export interface StacLoaderStackProps extends StackProps {
  /** The VPC ID for deployment */
  vpcId: string;

  /** Whether this is a production environment */
  isProd: boolean;

  /** Auth configuration for JWT authentication (Keycloak OIDC) */
  auth: AuthConfig;

  /** The project name prefix for resource naming */
  projectName: string;

  /** STAC Loader configuration */
  config?: StacLoaderConfig;

  /** Optional security group ID for the ALB and Fargate service */
  securityGroupId?: string;

  /** CPU units for the Fargate task. @default 2048 */
  mcpServerCpu?: number;

  /** Memory in MB for the Fargate task. @default 4096 */
  mcpServerMemorySize?: number;

  /** Container port for the MCP server. @default 8080 */
  mcpServerPort?: number;

  /** List of origins allowed to access this API via CORS (optional) */
  corsAllowedOrigins?: string[];

  /** Base URL of the internal data catalog for auth token passthrough (optional) */
  dataCatalogBaseUrl?: string;

  /** Route53 hosted zone ID for custom domain (optional) */
  domainHostedZoneId?: string;

  /** Route53 hosted zone domain name for custom domain (optional) */
  domainHostedZoneName?: string;

  /** ACM certificate ARN for custom domain TLS (optional) */
  domainCertificateArn?: string;
}

export class StacLoaderStack extends Stack {
  public readonly stacLoader: StacLoaderConstruct;

  constructor(scope: Construct, id: string, props: StacLoaderStackProps) {
    super(scope, id, {
      terminationProtection: props.isProd,
      ...props
    });

    const vpc = Vpc.fromLookup(this, "ImportedVpc", {
      vpcId: props.vpcId
    });

    let securityGroup: ISecurityGroup | undefined;
    if (props.securityGroupId) {
      securityGroup = SecurityGroup.fromSecurityGroupId(
        this,
        "ImportedSecurityGroup",
        props.securityGroupId
      );
    }

    this.stacLoader = new StacLoaderConstruct(this, "StacLoader", {
      vpc,
      isProd: props.isProd,
      auth: props.auth,
      projectName: props.projectName,
      config: props.config,
      securityGroup,
      mcpServerCpu: props.mcpServerCpu,
      mcpServerMemorySize: props.mcpServerMemorySize,
      mcpServerPort: props.mcpServerPort,
      corsAllowedOrigins: props.corsAllowedOrigins,
      dataCatalogBaseUrl: props.dataCatalogBaseUrl,
      domainHostedZoneId: props.domainHostedZoneId,
      domainHostedZoneName: props.domainHostedZoneName,
      domainCertificateArn: props.domainCertificateArn
    });
  }
}
