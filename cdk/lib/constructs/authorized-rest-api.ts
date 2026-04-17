/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Duration } from "aws-cdk-lib";
import {
  AuthorizationType,
  Cors,
  DomainName,
  EndpointType,
  GatewayResponse,
  IdentitySource,
  Integration,
  RequestAuthorizer,
  ResponseType,
  RestApi
} from "aws-cdk-lib/aws-apigateway";
import {
  Certificate,
  CertificateValidation
} from "aws-cdk-lib/aws-certificatemanager";
import { IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { IRole } from "aws-cdk-lib/aws-iam";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

import { AuthConfig, AuthorizerFunction } from "./authorizer-function";

/**
 * Properties for the AuthorizedRestApi construct
 */
export interface AuthorizedRestApiProps {
  /**
   * The name of the service
   */
  name: string;

  /**
   * The name of the stage deployment for RestApi
   */
  apiStageName: string;

  /**
   * The integration for the handler of the RestApi
   */
  integration: Integration;

  /**
   * The configuration for the authentication
   */
  auth: AuthConfig;

  /**
   * Whether this is a production environment
   */
  isProd: boolean;

  /**
   * The VPC to deploy the authorizer into (optional)
   */
  vpc?: IVpc;

  /**
   * The subnet selection for VPC deployment (optional)
   */
  vpcSubnets?: SubnetSelection;

  /**
   * The IAM role for the Lambda authorizer function (optional)
   */
  lambdaRole?: IRole;

  /**
   * The hosted zone name for custom domain (optional)
   */
  hostedZone?: string;

  /**
   * The custom domain name for the API (optional)
   */
  domainName?: string;

  /**
   * List of origins that should be allowed to access this API via CORS (optional)
   * - Development (isProd=false): Always allows all origins (*) regardless of this setting
   * - Production (isProd=true):
   *   - If omitted or empty array: No CORS headers (same-origin only)
   *   - ["*"]: Allow all origins (wildcard)
   *   - ["https://domain.com", "https://other.com"]: Specific origins only
   */
  corsAllowedOrigins?: string[];
}

/**
 * Creates a REST API with JWT-based authorization
 */
export class AuthorizedRestApi extends Construct {
  /**
   * The request authorizer for the API
   */
  public readonly requestAuthorizer: RequestAuthorizer;

  /**
   * The REST API
   */
  public readonly restApi: RestApi;

  /**
   * The authorizer function
   */
  public readonly authorizerFunction: AuthorizerFunction;

  /**
   * The effective URL for the API - uses custom domain if configured, otherwise API Gateway URL
   */
  public readonly effectiveUrl: string;

  constructor(scope: Construct, id: string, props: AuthorizedRestApiProps) {
    super(scope, id);

    // Create the authorizer function
    this.authorizerFunction = new AuthorizerFunction(this, `Authorizer${id}`, {
      auth: props.auth,
      name: props.name,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      isProd: props.isProd,
      lambdaRole: props.lambdaRole
    });

    // Create the request authorizer
    this.requestAuthorizer = new RequestAuthorizer(
      this,
      `RequestAuthorizer${id}`,
      {
        authorizerName: `${props.name}-Authorizer`,
        handler: this.authorizerFunction.authorizerFunction,
        identitySources: [IdentitySource.header("Authorization")],
        resultsCacheTtl: Duration.minutes(0)
      }
    );

    // Configure CORS origins based on environment and corsAllowedOrigins parameter
    let corsOrigins: string[] = [];

    if (!props.isProd) {
      // Development: Always allow all origins for easy development
      corsOrigins = Cors.ALL_ORIGINS;
    } else if (
      props.corsAllowedOrigins &&
      props.corsAllowedOrigins.length > 0
    ) {
      // Production: Use specified origins
      if (props.corsAllowedOrigins.includes("*")) {
        corsOrigins = Cors.ALL_ORIGINS;
      } else {
        corsOrigins = props.corsAllowedOrigins;
      }
    } else {
      // Production with no origins specified: No CORS headers (same-origin only)
      corsOrigins = [];
    }

    // Create the REST API
    this.restApi = new RestApi(this, `RestApi${id}`, {
      restApiName: `${props.name}-RestApi`,
      deployOptions: {
        stageName: props.apiStageName
      },
      endpointTypes: [EndpointType.REGIONAL],
      defaultIntegration: props.integration,
      defaultMethodOptions: {
        requestParameters: {
          "method.request.path.proxy": true,
          "method.request.header.Accept": true
        },
        authorizer: this.requestAuthorizer,
        authorizationType: AuthorizationType.CUSTOM
      },
      // Configure CORS based on corsAllowedOrigins
      defaultCorsPreflightOptions:
        corsOrigins.length > 0
          ? {
              allowOrigins: corsOrigins,
              allowHeaders: [
                ...Cors.DEFAULT_HEADERS,
                "Authorization",
                "X-Api-Key",
                "X-Requested-With"
              ],
              allowMethods: Cors.ALL_METHODS,
              allowCredentials: corsOrigins !== Cors.ALL_ORIGINS, // Only allow credentials for specific origins
              maxAge: Duration.hours(1) // Cache preflight for performance
            }
          : undefined
    });

    // Add proxy resource to handle all paths
    this.restApi.root.addProxy({
      anyMethod: true
    });

    // Add Gateway Responses to ensure CORS headers are included in error responses
    if (corsOrigins.length > 0) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": `'${corsOrigins === Cors.ALL_ORIGINS ? "*" : corsOrigins.join(",")}'`,
        "Access-Control-Allow-Headers": `'${[
          ...Cors.DEFAULT_HEADERS,
          "Authorization",
          "X-Api-Key",
          "X-Requested-With"
        ].join(",")}'`,
        "Access-Control-Allow-Methods": `'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'`
      };

      // Add CORS headers to common error responses
      const errorResponseTypes = [
        ResponseType.BAD_REQUEST_BODY,
        ResponseType.BAD_REQUEST_PARAMETERS,
        ResponseType.UNAUTHORIZED,
        ResponseType.ACCESS_DENIED,
        ResponseType.RESOURCE_NOT_FOUND,
        ResponseType.REQUEST_TOO_LARGE,
        ResponseType.THROTTLED,
        ResponseType.DEFAULT_4XX,
        ResponseType.DEFAULT_5XX
      ];

      errorResponseTypes.forEach((responseType, index) => {
        new GatewayResponse(
          this,
          `GatewayResponse${responseType}${id}${index}`,
          {
            restApi: this.restApi,
            type: responseType,
            responseHeaders: corsHeaders
          }
        );
      });
    }

    // Initialize effectiveUrl - will be updated if custom domain is configured successfully
    this.effectiveUrl = this.restApi.url;

    // Set up custom domain if both hostedZone and domainName are provided
    if (props.hostedZone && props.domainName) {
      try {
        // Import the hosted zone
        const hostedZone = HostedZone.fromLookup(this, `HostedZone${id}`, {
          domainName: props.hostedZone
        });

        // Create SSL certificate for the domain
        const certificate = new Certificate(this, `Certificate${id}`, {
          domainName: props.domainName,
          validation: CertificateValidation.fromDns(hostedZone),
          subjectAlternativeNames: [`*.${props.domainName}`]
        });

        // Create custom domain name
        const customDomain = new DomainName(this, `CustomDomain${id}`, {
          domainName: props.domainName,
          certificate: certificate,
          endpointType: EndpointType.REGIONAL
        });

        // Ensure the domain is deleted before the certificate on stack teardown
        customDomain.node.addDependency(certificate);

        // Map the custom domain to the API
        customDomain.addBasePathMapping(this.restApi, {
          stage: this.restApi.deploymentStage
        });

        // Create Route53 alias record pointing to the custom domain
        new ARecord(this, `AliasRecord${id}`, {
          zone: hostedZone,
          recordName: props.domainName,
          target: RecordTarget.fromAlias(new ApiGatewayDomain(customDomain))
        });

        // Update effectiveUrl to use custom domain since setup was successful
        this.effectiveUrl = `https://${props.domainName}`;
      } catch {
        void 0;
      }
    }
  }
}
