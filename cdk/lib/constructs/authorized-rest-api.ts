/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AccessLogFormat,
  AuthorizationType,
  Cors,
  DomainName,
  EndpointType,
  GatewayResponse,
  IdentitySource,
  Integration,
  LogGroupLogDestination,
  MethodLoggingLevel,
  RequestAuthorizer,
  ResponseType,
  RestApi
} from "aws-cdk-lib/aws-apigateway";
import {
  Certificate,
  CertificateValidation
} from "aws-cdk-lib/aws-certificatemanager";
import { IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { IRole, Role } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

import { WafConfig } from "../config/app-config";
import { AuthConfig, AuthorizerFunction } from "./authorizer-function";
import { WebAppWaf } from "./web-app-waf";

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

  /**
   * WAFv2 configuration for the REST API stage (optional).
   */
  wafConfig?: WafConfig;

  /**
   * Name prefix used for the WAF WebACL and its log group.
   * Required when wafConfig.enabled is true.
   */
  wafNamePrefix?: string;
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

    // Dedicated CloudWatch Log Group for API Gateway access logs. Retention is
    // bounded to 30 days so the log volume stays manageable; the group is
    // destroyed with the stack in non-prod environments and retained in prod.
    const accessLogGroup = new LogGroup(this, `AccessLogs${id}`, {
      logGroupName: `/aws/apigateway/${props.name}-access-logs`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: props.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    // Create the REST API. Explicit request validation is attached below so
    // every method on the proxy resource validates parameters and bodies
    // before the Lambda integration runs.
    this.restApi = new RestApi(this, `RestApi${id}`, {
      restApiName: `${props.name}-RestApi`,
      deployOptions: {
        stageName: props.apiStageName,
        // Emit structured access logs for every request so operators can audit
        // calls and troubleshoot failures without relying on integration logs.
        accessLogDestination: new LogGroupLogDestination(accessLogGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true
        }),
        // Enable method-level CloudWatch execution logging at INFO.
        // dataTraceEnabled stays false so request/response bodies are NOT
        // written to logs, which would otherwise risk capturing sensitive
        // payload data that transits this API.
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true
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

    // The custom JWT authorizer (Keycloak OIDC) is the authentication
    // mechanism for this API by design; Amazon Cognito User Pools is not
    // part of the deployment topology. The WAFv2 integration is also out
    // of scope for the guidance stack.
    //
    // Suppressions that target the RestApi itself. The method-level
    // AwsSolutions-COG4 suppression is applied after addProxy() so the
    // proxy methods are already in the tree when applyToChildren walks it.

    // Scope the API Gateway CloudWatch logs role suppression to the exact
    // managed-policy finding. The role is auto-created by the RestApi
    // construct when stage-level CloudWatch logging is enabled, and the
    // AmazonAPIGatewayPushToCloudWatchLogs managed policy is the AWS
    // service-recommended grant for that role.
    const cloudWatchRole = this.restApi.node.tryFindChild("CloudWatchRole") as
      | Role
      | undefined;
    if (cloudWatchRole) {
      NagSuppressions.addResourceSuppressions(cloudWatchRole, [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "The AmazonAPIGatewayPushToCloudWatchLogs managed policy is attached to the role that API Gateway assumes when pushing execution and access logs to CloudWatch Logs. This role is auto-created by the RestApi construct whenever stage-level logging is enabled, and the managed policy is the configuration AWS publishes for this exact purpose.",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
          ]
        }
      ]);
    }

    // Explicitly attach a request validator so AwsSolutions-APIG2 detects a
    // CfnRequestValidator in the synthesized template regardless of whether
    // individual methods opt in via defaultMethodOptions.
    this.restApi.addRequestValidator(`DefaultRequestValidator${id}`, {
      requestValidatorName: `${props.name}-DefaultRequestValidator`,
      validateRequestBody: true,
      validateRequestParameters: true
    });

    // Add proxy resource to handle all paths
    this.restApi.root.addProxy({
      anyMethod: true
    });

    // Per-stack WAFv2 WebACL associated with the deployment stage.
    const wafEnabled =
      props.wafConfig?.enabled !== false && !!props.wafNamePrefix;
    if (wafEnabled) {
      const stageArn = Stack.of(this).formatArn({
        service: "apigateway",
        account: "",
        resource: "/restapis",
        resourceName: `${this.restApi.restApiId}/stages/${this.restApi.deploymentStage.stageName}`
      });
      new WebAppWaf(this, "RestApiWaf", {
        resourceArn: stageArn,
        namePrefix: props.wafNamePrefix!,
        isProd: props.isProd,
        requestsPer5Min: props.wafConfig?.requestsPer5Min
      });
    }

    // Suppress COG4 (Cognito authorizer requirement) across the RestApi, its
    // methods, and the deployment stage. APIG3 (WAFv2 web ACL requirement)
    // is suppressed only when WAF is disabled via wafConfig; when WAF is
    // enabled the stage is associated with a WebACL above and APIG3 no
    // longer fires. Methods are added via addProxy above; applying
    // suppressions after that so applyToChildren walks the full method
    // tree.
    const suppressions = [
      {
        id: "AwsSolutions-COG4",
        reason:
          "This API is intentionally fronted by a custom Lambda-based JWT authorizer that validates OIDC tokens issued by the project Keycloak instance. Cognito User Pools are not part of the authentication architecture, so COG4 does not apply to the methods on this API."
      }
    ];
    if (!wafEnabled) {
      suppressions.push({
        id: "AwsSolutions-APIG3",
        reason:
          "WAFv2 web ACL integration is disabled for this deployment via wafConfig.enabled=false. Access control is enforced by the custom JWT authorizer on every method, and CloudWatch access logs are enabled on the deployment stage to provide an audit trail for abuse investigation."
      });
    }
    NagSuppressions.addResourceSuppressions(this.restApi, suppressions, true);

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
