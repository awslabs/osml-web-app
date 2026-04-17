/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import {
  CfnOutput,
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack
} from "aws-cdk-lib";
import {
  AccessLogFormat,
  AuthorizationType,
  BasePathMapping,
  ConnectionType,
  Cors,
  DomainName,
  EndpointType,
  GatewayResponse,
  HttpIntegration,
  IdentitySource,
  LogGroupLogDestination,
  RequestAuthorizer,
  ResponseType,
  RestApi,
  SecurityPolicy,
  VpcLink
} from "aws-cdk-lib/aws-apigateway";
import {
  Certificate,
  CertificateValidation,
  ICertificate
} from "aws-cdk-lib/aws-certificatemanager";
import { ISecurityGroup, IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  AwsLogDriver,
  AwsLogDriverMode,
  Cluster,
  ContainerImage,
  ContainerInsights,
  FargateTaskDefinition,
  Protocol as EcsProtocol
} from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import {
  ApplicationLoadBalancer,
  ApplicationLoadBalancerProps,
  NetworkLoadBalancer,
  Protocol as ElbProtocol
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { AlbArnTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGatewayDomain } from "aws-cdk-lib/aws-route53-targets";
import { Bucket, BucketEncryption, IBucket } from "aws-cdk-lib/aws-s3";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";

import { AuthConfig, AuthorizerFunction } from "./authorizer-function";

/**
 * Configuration for the STAC Loader construct
 */
export interface StacLoaderConfig {
  /**
   * S3 lifecycle retention period in days for loaded STAC items.
   * @default 7
   */
  retentionDays?: number;

  /**
   * Name of an existing S3 bucket to use as the workspace bucket.
   * If not provided, a new bucket will be created.
   */
  workspaceBucketName?: string;
}

/**
 * Properties for the StacLoaderConstruct
 */
export interface StacLoaderConstructProps {
  /** The VPC to deploy into */
  vpc: IVpc;

  /** Whether this is a production environment */
  isProd: boolean;

  /** Auth configuration (Keycloak OIDC) for the API Gateway authorizer */
  auth: AuthConfig;

  /** The project name prefix for resource naming */
  projectName: string;

  /** STAC Loader configuration */
  config?: StacLoaderConfig;

  /** Security group for the ALB and Fargate service */
  securityGroup?: ISecurityGroup;

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

  /** ACM certificate ARN for custom domain TLS (optional, created if not provided) */
  domainCertificateArn?: string;
}

export class StacLoaderConstruct extends Construct {
  /** The ECS cluster for the MCP server. */
  public readonly cluster: Cluster;

  /** The Fargate service for the MCP server. */
  public readonly fargateService: ApplicationLoadBalancedFargateService;

  /** The Application Load Balancer for the MCP server. */
  public readonly alb: ApplicationLoadBalancer;

  /** The workspace S3 bucket */
  public readonly workspaceBucket: IBucket;

  /** The API Gateway REST API with JWT auth */
  public readonly restApi: RestApi;

  /** The effective API URL for client configuration (API Gateway URL). */
  public readonly mcpUrl: string;

  constructor(scope: Construct, id: string, props: StacLoaderConstructProps) {
    super(scope, id);

    const retentionDays = props.config?.retentionDays ?? 7;
    const stackId = Stack.of(this).stackName;
    const mcpServerCpu = props.mcpServerCpu ?? 2048;
    const mcpServerMemorySize = props.mcpServerMemorySize ?? 4096;
    const mcpServerPort = props.mcpServerPort ?? 8080;

    const removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    // --- S3 Workspace Bucket ---
    if (props.config?.workspaceBucketName) {
      this.workspaceBucket = Bucket.fromBucketName(
        this,
        "WorkspaceBucket",
        props.config.workspaceBucketName
      );

      const lifecycleMergerLogGroup = new LogGroup(
        this,
        "LifecycleMergerFnLogGroup",
        {
          logGroupName: `/aws/lambda/${props.projectName}-StacLoaderLifecycleMerger`,
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: removalPolicy
        }
      );

      const lifecycleMergerFn = new Function(this, "LifecycleMergerFn", {
        functionName: `${props.projectName}-StacLoaderLifecycleMerger`,
        description:
          "Manages S3 lifecycle rules for STAC loader workspace bucket",
        runtime: Runtime.PYTHON_3_13,
        handler: "index.handler",
        logGroup: lifecycleMergerLogGroup,
        code: Code.fromInline(`
import boto3
import json
import cfnresponse

s3 = boto3.client("s3")

def handler(event, context):
    try:
        bucket = event["ResourceProperties"]["BucketName"]
        rule_id = event["ResourceProperties"]["RuleId"]
        prefix = event["ResourceProperties"]["Prefix"]
        expiration_days = int(event["ResourceProperties"]["ExpirationDays"])

        request_type = event["RequestType"]

        if request_type == "Delete":
            try:
                resp = s3.get_bucket_lifecycle_configuration(Bucket=bucket)
                rules = [r for r in resp.get("Rules", []) if r.get("ID") != rule_id]
                if rules:
                    s3.put_bucket_lifecycle_configuration(
                        Bucket=bucket,
                        LifecycleConfiguration={"Rules": rules}
                    )
                else:
                    s3.delete_bucket_lifecycle(Bucket=bucket)
            except s3.exceptions.ClientError as e:
                if "NoSuchLifecycleConfiguration" not in str(e):
                    raise
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return

        existing_rules = []
        try:
            resp = s3.get_bucket_lifecycle_configuration(Bucket=bucket)
            existing_rules = resp.get("Rules", [])
        except s3.exceptions.ClientError as e:
            if "NoSuchLifecycleConfiguration" not in str(e):
                raise

        merged = [r for r in existing_rules if r.get("ID") != rule_id]
        merged.append({
            "ID": rule_id,
            "Status": "Enabled",
            "Filter": {"Prefix": prefix},
            "Expiration": {"Days": expiration_days}
        })

        s3.put_bucket_lifecycle_configuration(
            Bucket=bucket,
            LifecycleConfiguration={"Rules": merged}
        )

        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {e}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {"Error": str(e)})
`),
        timeout: Duration.seconds(60)
      });

      lifecycleMergerFn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "s3:GetLifecycleConfiguration",
            "s3:PutLifecycleConfiguration",
            "s3:DeleteLifecycleConfiguration"
          ],
          resources: [this.workspaceBucket.bucketArn]
        })
      );

      const lifecycleProvider = new Provider(this, "LifecycleMergerProvider", {
        onEventHandler: lifecycleMergerFn,
        logGroup: lifecycleMergerLogGroup
      });

      new CustomResource(this, "WorkspaceBucketLifecycle", {
        serviceToken: lifecycleProvider.serviceToken,
        properties: {
          BucketName: props.config.workspaceBucketName,
          RuleId: "stac-loader-cleanup",
          Prefix: "stac/",
          ExpirationDays: retentionDays.toString()
        }
      });

      new CustomResource(this, "DatasetsBucketLifecycle", {
        serviceToken: lifecycleProvider.serviceToken,
        properties: {
          BucketName: props.config.workspaceBucketName,
          RuleId: "stac-loader-datasets-cleanup",
          Prefix: "datasets/",
          ExpirationDays: retentionDays.toString()
        }
      });
    } else {
      const bucket = new Bucket(this, "WorkspaceBucket", {
        bucketName: `${stackId.toLowerCase()}-stac-loader-workspace`,
        encryption: BucketEncryption.S3_MANAGED,
        removalPolicy: removalPolicy,
        lifecycleRules: [
          {
            id: "stac-loader-cleanup",
            enabled: true,
            prefix: "stac/",
            expiration: Duration.days(retentionDays)
          },
          {
            id: "stac-loader-datasets-cleanup",
            enabled: true,
            prefix: "datasets/",
            expiration: Duration.days(retentionDays)
          }
        ]
      });
      this.workspaceBucket = bucket;
    }

    // --- ECS Infrastructure ---

    const logGroup = new LogGroup(this, "MCPServerLogGroup", {
      logGroupName: `/aws/ecs/${stackId}-StacLoaderMCP`,
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: removalPolicy
    });

    const taskRole = new Role(this, "MCPServerTaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        S3WorkspaceAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:ListBucket", "s3:GetBucketLocation"],
              resources: [this.workspaceBucket.bucketArn]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
              resources: [`${this.workspaceBucket.bucketArn}/*`]
            })
          ]
        })
      }
    });

    const executionRole = new Role(this, "MCPServerExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        ECSTaskExecution: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage"
              ],
              resources: ["*"]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroup.logGroupArn]
            })
          ]
        })
      }
    });

    // Pre-create the Container Insights log group so CDK manages retention and removal
    const containerInsightsLogGroup = new LogGroup(
      this,
      "ContainerInsightsLogGroup",
      {
        logGroupName: `/aws/ecs/containerinsights/${stackId}-StacLoaderMCPCluster/performance`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: removalPolicy
      }
    );

    this.cluster = new Cluster(this, "MCPServerCluster", {
      clusterName: `${stackId}-StacLoaderMCPCluster`,
      vpc: props.vpc,
      containerInsightsV2: props.isProd
        ? ContainerInsights.ENABLED
        : ContainerInsights.ENHANCED
    });

    this.cluster.node.addDependency(containerInsightsLogGroup);

    const taskDefinition = new FargateTaskDefinition(
      this,
      "MCPServerTaskDefinition",
      {
        memoryLimitMiB: mcpServerMemorySize,
        cpu: mcpServerCpu,
        taskRole: taskRole,
        executionRole: executionRole
      }
    );

    const containerDefinition = taskDefinition.addContainer(
      "MCPServerContainer",
      {
        image: ContainerImage.fromAsset(
          join(__dirname, "..", "..", "lambda", "stacLoader"),
          {
            file: "docker/Dockerfile.mcp",
            target: "mcp-server",
            buildArgs: { BUILDKIT_INLINE_CACHE: "true" },
            platform: Platform.LINUX_AMD64
          }
        ),
        memoryLimitMiB: mcpServerMemorySize,
        logging: new AwsLogDriver({
          streamPrefix: "StacLoaderMCP",
          logGroup: logGroup,
          mode: AwsLogDriverMode.NON_BLOCKING
        }),
        environment: {
          WORKSPACE_BUCKET_NAME: this.workspaceBucket.bucketName,
          AWS_DEFAULT_REGION: Stack.of(this).region,
          ...(props.dataCatalogBaseUrl
            ? { DATA_CATALOG_BASE_URL: props.dataCatalogBaseUrl }
            : {})
        },
        healthCheck: {
          command: [
            "CMD-SHELL",
            `curl -f http://localhost:${mcpServerPort}/health || exit 1`
          ],
          interval: Duration.seconds(30),
          retries: 3,
          timeout: Duration.seconds(10),
          startPeriod: Duration.seconds(30)
        }
      }
    );

    containerDefinition.addPortMappings({
      containerPort: mcpServerPort,
      protocol: EcsProtocol.TCP
    });

    // --- Internal ALB ---
    const albProps: ApplicationLoadBalancerProps = {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      internetFacing: false,
      ...(props.securityGroup && { securityGroup: props.securityGroup })
    };

    this.alb = new ApplicationLoadBalancer(this, "MCPServerALB", albProps);

    this.fargateService = new ApplicationLoadBalancedFargateService(
      this,
      "MCPServerService",
      {
        cluster: this.cluster,
        taskDefinition: taskDefinition,
        serviceName: `${stackId}-StacLoaderMCPService`,
        desiredCount: 1,
        minHealthyPercent: 100,
        assignPublicIp: false,
        listenerPort: 80,
        publicLoadBalancer: false,
        taskSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        loadBalancer: this.alb
      }
    );

    this.fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      port: mcpServerPort.toString(),
      protocol: ElbProtocol.HTTP,
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      timeout: Duration.seconds(10),
      interval: Duration.seconds(30)
    });

    // --- API Gateway Layer (API GW → VPC Link → NLB → ALB → Fargate) ---

    // NLB bridges API Gateway to the internal ALB
    const nlb = new NetworkLoadBalancer(this, "NLB", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      internetFacing: false,
      crossZoneEnabled: true,
      securityGroups: []
    });

    const nlbListener = nlb.addListener("NLBListener", {
      port: 80,
      protocol: ElbProtocol.TCP
    });

    nlbListener.addTargets("ALBTarget", {
      targets: [new AlbArnTarget(this.alb.loadBalancerArn, 80)],
      port: 80
    });

    // VPC Link allows API Gateway to reach the internal NLB
    const vpcLink = new VpcLink(this, "VpcLink", {
      targets: [nlb],
      vpcLinkName: `${stackId}-StacLoader-VpcLink`
    });

    // Lambda authorizer for JWT validation
    const authorizerFn = new AuthorizerFunction(this, "Authorizer", {
      auth: props.auth,
      name: `${props.projectName}-StacLoader`,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      isProd: props.isProd
    });

    const requestAuthorizer = new RequestAuthorizer(this, "RequestAuthorizer", {
      authorizerName: `${stackId}-StacLoader-Authorizer`,
      handler: authorizerFn.authorizerFunction,
      identitySources: [IdentitySource.header("Authorization")],
      resultsCacheTtl: Duration.minutes(0)
    });

    // CORS configuration
    let corsOrigins: string[] = [];
    if (!props.isProd) {
      corsOrigins = Cors.ALL_ORIGINS;
    } else if (
      props.corsAllowedOrigins &&
      props.corsAllowedOrigins.length > 0
    ) {
      corsOrigins = props.corsAllowedOrigins.includes("*")
        ? Cors.ALL_ORIGINS
        : props.corsAllowedOrigins;
    }

    // API Gateway access logs
    const apiAccessLogGroup = new LogGroup(this, "ApiAccessLogGroup", {
      logGroupName: `/aws/apigateway/${stackId}-StacLoader-RestApi`,
      retention: props.isProd ? RetentionDays.ONE_YEAR : RetentionDays.ONE_WEEK,
      removalPolicy: removalPolicy
    });

    // REST API
    this.restApi = new RestApi(this, "RestApi", {
      restApiName: `${stackId}-StacLoader-RestApi`,
      description:
        "API Gateway for STAC Data Loader MCP with JWT authorization",
      deployOptions: {
        stageName: "api",
        accessLogDestination: new LogGroupLogDestination(apiAccessLogGroup),
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
        })
      },
      endpointTypes: [EndpointType.REGIONAL],
      defaultMethodOptions: {
        requestParameters: {
          "method.request.path.proxy": true,
          "method.request.header.Accept": true,
          "method.request.header.Content-Type": true,
          "method.request.header.Authorization": true
        },
        authorizer: requestAuthorizer,
        authorizationType: AuthorizationType.CUSTOM
      },
      defaultCorsPreflightOptions:
        corsOrigins.length > 0
          ? {
              allowOrigins: corsOrigins,
              allowHeaders: [
                ...Cors.DEFAULT_HEADERS,
                "Authorization",
                "X-Api-Key",
                "X-Requested-With",
                "mcp-session-id",
                "mcp-protocol-version"
              ],
              allowMethods: Cors.ALL_METHODS,
              exposeHeaders: ["Mcp-Session-Id"],
              allowCredentials: corsOrigins !== Cors.ALL_ORIGINS,
              maxAge: Duration.hours(1)
            }
          : undefined
    });

    const nlbUrl = `http://${nlb.loadBalancerDnsName}`;

    // Create HTTP integration pointing to the NLB via VPC Link
    // The {proxy} path parameter captures all path segments
    // Set Host header to custom domain so backend constructs URLs correctly
    const httpIntegration = new HttpIntegration(`${nlbUrl}/{proxy}`, {
      httpMethod: "ANY",
      proxy: true,
      options: {
        vpcLink: vpcLink,
        connectionType: ConnectionType.VPC_LINK,
        requestParameters: {
          "integration.request.header.Host": "context.domainName",
          "integration.request.path.proxy": "method.request.path.proxy",
          "integration.request.header.Accept": "method.request.header.Accept",
          "integration.request.header.Content-Type":
            "method.request.header.Content-Type",
          "integration.request.header.Authorization":
            "method.request.header.Authorization",
          "integration.request.header.X-Forwarded-Path":
            "method.request.path.proxy",
          "integration.request.header.X-Forwarded-Host": "context.domainName",
          "integration.request.header.X-Forwarded-Proto": "'https'"
        }
      }
    });

    const proxyResource = this.restApi.root.addProxy({
      anyMethod: false,
      defaultIntegration: httpIntegration
    });

    proxyResource.addMethod("ANY", httpIntegration, {
      requestParameters: {
        "method.request.path.proxy": true,
        "method.request.header.Accept": true,
        "method.request.header.Content-Type": true,
        "method.request.header.Authorization": true
      },
      authorizer: requestAuthorizer,
      authorizationType: AuthorizationType.CUSTOM
    });

    // Root path integration (MCP POST goes to /)
    const rootIntegration = new HttpIntegration(nlbUrl, {
      httpMethod: "ANY",
      proxy: true,
      options: {
        vpcLink: vpcLink,
        connectionType: ConnectionType.VPC_LINK,
        requestParameters: {
          "integration.request.header.Accept": "method.request.header.Accept",
          "integration.request.header.Content-Type":
            "method.request.header.Content-Type",
          "integration.request.header.Authorization":
            "method.request.header.Authorization"
        }
      }
    });

    // Add specific HTTP methods to root to avoid conflict with CORS OPTIONS
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]) {
      this.restApi.root.addMethod(method, rootIntegration, {
        requestParameters: {
          "method.request.header.Accept": true,
          "method.request.header.Content-Type": true,
          "method.request.header.Authorization": true
        },
        authorizer: requestAuthorizer,
        authorizationType: AuthorizationType.CUSTOM
      });
    }

    // CORS gateway responses for error cases
    if (corsOrigins.length > 0) {
      const corsHeaders = {
        "Access-Control-Allow-Origin": `'${
          corsOrigins === Cors.ALL_ORIGINS ? "*" : corsOrigins.join(",")
        }'`,
        "Access-Control-Allow-Headers": `'${[
          ...Cors.DEFAULT_HEADERS,
          "Authorization",
          "X-Api-Key",
          "X-Requested-With",
          "mcp-session-id",
          "mcp-protocol-version"
        ].join(",")}'`,
        "Access-Control-Allow-Methods":
          "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'"
      };

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
        new GatewayResponse(this, `GatewayResponse${index}`, {
          restApi: this.restApi,
          type: responseType,
          responseHeaders: corsHeaders
        });
      });
    }

    // The effective MCP URL is the API Gateway URL (may be overridden by custom domain below)
    this.mcpUrl = this.restApi.url;

    // --- Custom Domain (matching osml-apis LoadBalancerIntegration pattern) ---
    if (props.domainHostedZoneId && props.domainHostedZoneName) {
      const hostedZone = HostedZone.fromHostedZoneAttributes(
        this,
        "HostedZone",
        {
          hostedZoneId: props.domainHostedZoneId,
          zoneName: props.domainHostedZoneName
        }
      );

      let certificate: ICertificate;
      if (props.domainCertificateArn) {
        certificate = Certificate.fromCertificateArn(
          this,
          "ImportedCertificate",
          props.domainCertificateArn
        );
      } else {
        certificate = new Certificate(this, "ApiCertificate", {
          domainName: `*.${props.domainHostedZoneName}`,
          validation: CertificateValidation.fromDns(hostedZone)
        });
      }

      const customDomainName = `stac-loader.${props.domainHostedZoneName}`;

      const domain = new DomainName(this, "CustomDomainName", {
        domainName: customDomainName,
        certificate: certificate,
        endpointType: EndpointType.REGIONAL,
        securityPolicy: SecurityPolicy.TLS_1_2
      });

      // Ensure the domain name is deleted before the certificate on stack teardown
      domain.node.addDependency(certificate);

      new BasePathMapping(this, "BasePathMapping", {
        domainName: domain,
        restApi: this.restApi,
        stage: this.restApi.deploymentStage
      });

      new ARecord(this, "ARecord", {
        zone: hostedZone,
        recordName: customDomainName,
        target: RecordTarget.fromAlias(new ApiGatewayDomain(domain))
      });

      this.mcpUrl = `https://${customDomainName}/`;
    }

    // --- Stack Outputs ---
    new CfnOutput(this, "StacLoaderMcpUrl", {
      value: this.mcpUrl,
      description: "STAC Loader MCP Server URL (API Gateway)"
    });

    new CfnOutput(this, "StacLoaderAlbArn", {
      value: this.alb.loadBalancerArn,
      description: "STAC Loader ALB ARN"
    });

    new CfnOutput(this, "WorkspaceBucketName", {
      value: this.workspaceBucket.bucketName,
      description: "Workspace S3 bucket name"
    });
  }
}
