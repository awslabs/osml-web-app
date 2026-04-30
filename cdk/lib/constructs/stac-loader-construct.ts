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
  MethodLoggingLevel,
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
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket
} from "aws-cdk-lib/aws-s3";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";

import { WafConfig } from "../config/app-config";
import { AuthConfig, AuthorizerFunction } from "./authorizer-function";
import { WebAppWaf } from "./web-app-waf";

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

  /** WAFv2 configuration for the REST API stage (optional). */
  wafConfig?: WafConfig;
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
    const account = Stack.of(this).account;
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
import cfnresponse

s3 = boto3.client("s3")

def handler(event, context):
    try:
        bucket = event["ResourceProperties"]["BucketName"]
        rules_in = event["ResourceProperties"].get("Rules", [])
        managed_ids = {r["RuleId"] for r in rules_in}

        existing_rules = []
        try:
            resp = s3.get_bucket_lifecycle_configuration(Bucket=bucket)
            existing_rules = resp.get("Rules", [])
        except s3.exceptions.ClientError as e:
            if "NoSuchLifecycleConfiguration" not in str(e):
                raise

        # Drop any rules we manage so we can rewrite them (or remove them on Delete).
        preserved = [r for r in existing_rules if r.get("ID") not in managed_ids]

        if event["RequestType"] == "Delete":
            merged = preserved
        else:
            merged = preserved + [
                {
                    "ID": r["RuleId"],
                    "Status": "Enabled",
                    "Filter": {"Prefix": r["Prefix"]},
                    "Expiration": {"Days": int(r["ExpirationDays"])}
                }
                for r in rules_in
            ]

        if merged:
            s3.put_bucket_lifecycle_configuration(
                Bucket=bucket,
                LifecycleConfiguration={"Rules": merged}
            )
        else:
            try:
                s3.delete_bucket_lifecycle(Bucket=bucket)
            except s3.exceptions.ClientError as e:
                if "NoSuchLifecycleConfiguration" not in str(e):
                    raise

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
          Rules: [
            {
              RuleId: "stac-loader-cleanup",
              Prefix: "stac/",
              ExpirationDays: retentionDays.toString()
            },
            {
              RuleId: "stac-loader-datasets-cleanup",
              Prefix: "datasets/",
              ExpirationDays: retentionDays.toString()
            }
          ]
        }
      });
    } else {
      // Access-log bucket receives server access logs from the workspace
      // bucket. It has to sit next to the workspace bucket so that the
      // workspace bucket can point its logging prefix at it.
      const workspaceAccessLogsBucket = new Bucket(
        this,
        "WorkspaceBucketAccessLogs",
        {
          bucketName: `${stackId.toLowerCase()}-workspace-access-logs-${account}`,
          encryption: BucketEncryption.S3_MANAGED,
          blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
          versioned: true,
          enforceSSL: true,
          removalPolicy: removalPolicy,
          lifecycleRules: [{ expiration: Duration.days(90) }]
        }
      );
      // The access-log bucket is itself an S3 bucket, so the S1 rule fires
      // against it too. Turning server access logs on for the access-log
      // bucket would route its own access events back into itself, creating
      // an infinite logging loop. The bucket has public access blocked,
      // versioning enabled, SSL enforced, and S3-managed encryption, so its
      // security posture already matches the target configuration for an
      // access-log sink.
      NagSuppressions.addResourceSuppressions(workspaceAccessLogsBucket, [
        {
          id: "AwsSolutions-S1",
          reason:
            "This bucket is the target of server access logs for WorkspaceBucket. Enabling server access logs on the access-log bucket itself would cause its own access events to be written back into the same bucket and create an infinite logging recursion. The bucket has public access blocked, versioning enabled, SSL enforced, and S3-managed encryption, so the security posture required by this rule is already in place without a further logging layer."
        }
      ]);

      const bucket = new Bucket(this, "WorkspaceBucket", {
        bucketName: `${stackId.toLowerCase()}-workspace-${account}`,
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        serverAccessLogsBucket: workspaceAccessLogsBucket,
        serverAccessLogsPrefix: "workspace/",
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

    // The task role grants S3 object-level actions under `${bucketArn}/*` so
    // the MCP server can read, write, and delete STAC items and datasets at
    // any key inside the workspace bucket. Individual object keys are not
    // known at synth time because the MCP server chooses keys at runtime
    // based on the incoming request. The action set is limited to three
    // object-level operations, and the resource prefix is constrained to
    // the workspace bucket itself.
    NagSuppressions.addResourceSuppressions(
      taskRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "The MCP server task reads, writes, and deletes STAC items and datasets at object keys inside the workspace bucket that are chosen at runtime based on the incoming request. The wildcard matches only keys under this single bucket ARN, and the action set is limited to s3:GetObject, s3:PutObject, and s3:DeleteObject so the grant cannot reach any other bucket or action."
        }
      ],
      true
    );

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

    // The container `environment` entries are non-sensitive deployment-time
    // constants that the MCP server reads at startup:
    //   - HOST is the bind address (0.0.0.0 so the task is reachable
    //     through the internal ALB; this is also the only place 0.0.0.0
    //     is specified — the server's in-process default is 127.0.0.1);
    //   - PORT mirrors mcpServerPort so the container, ALB target group,
    //     and health check agree on a single value;
    //   - WORKSPACE_BUCKET_NAME is the public logical name of the workspace
    //     bucket (bucket names are globally discoverable by design);
    //   - AWS_DEFAULT_REGION is the well-known AWS region identifier;
    //   - DATA_CATALOG_BASE_URL is the public URL of the internal data
    //     catalog that the server calls through with the caller's bearer
    //     token — not a credential or secret.
    // None of these values carry secret material, so routing them through
    // Secrets Manager or SSM Parameter Store would add an unnecessary IAM
    // grant and an extra fetch round-trip at container start without any
    // security benefit.
    NagSuppressions.addResourceSuppressions(taskDefinition, [
      {
        id: "AwsSolutions-ECS2",
        reason:
          "The container environment variables (HOST, PORT, WORKSPACE_BUCKET_NAME, AWS_DEFAULT_REGION, DATA_CATALOG_BASE_URL) are non-sensitive deployment-time constants: a bind address, a port number, a bucket name that is globally discoverable by design, a well-known AWS region string, and the public URL of the data catalog that the server reaches with the caller's bearer token. Routing them through Secrets Manager or SSM Parameter Store would add IAM grants and a fetch round-trip at container start without protecting any secret material."
      }
    ]);

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
          // HOST=0.0.0.0 is required here so the server binds to the Fargate
          // task ENI and is reachable through the internal (non-internet-
          // facing) ALB. Exposure is controlled by the task security group
          // and the private subnet placement — not by the bind address. The
          // server's in-process default is 127.0.0.1 (safe for local dev),
          // so this explicit override is the only place 0.0.0.0 is set.
          HOST: "0.0.0.0",
          PORT: String(mcpServerPort),
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

    // Access-log bucket for the ALB and NLB. ELB/NLB access logs are
    // written by AWS's service principal, which requires an S3 bucket
    // that permits PutObject from the ELB delivery logs service. CDK's
    // `logAccessLogs` helper takes care of attaching the necessary bucket
    // policy on our behalf. The bucket is scoped to ELB log delivery so
    // there is no reason to enable versioning (ELB log objects are
    // immutable and delivered once), and S3-managed encryption satisfies
    // encryption-at-rest without introducing a KMS dependency that the
    // ELB delivery service would have to be granted on.
    const loadBalancerAccessLogsBucket = new Bucket(
      this,
      "LoadBalancerAccessLogs",
      {
        bucketName: `${stackId.toLowerCase()}-lb-access-logs-${account}`,
        encryption: BucketEncryption.S3_MANAGED,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        removalPolicy: removalPolicy,
        lifecycleRules: [{ expiration: Duration.days(90) }]
      }
    );
    // The access-log bucket is itself an S3 bucket, so the S1 rule fires
    // against it. Enabling server access logs on an access-log bucket
    // would route its own access events into itself and create an
    // infinite logging loop. Public access is blocked, SSL is enforced,
    // and S3-managed encryption is in place, so the security posture
    // already matches the target configuration for a log-delivery sink.
    NagSuppressions.addResourceSuppressions(loadBalancerAccessLogsBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "This bucket is the delivery target for ALB and NLB access logs. Enabling server access logs on the access-log bucket itself would cause its own access events to be written back into the same bucket and create an infinite logging recursion. The bucket has public access blocked, SSL enforced, and S3-managed encryption, so the security posture required by this rule is already in place without a further logging layer."
      }
    ]);

    // Route ALB access logs to the delivery bucket so every request that
    // reaches the listener produces an audit record with the caller CIDR,
    // request path, target response code, and latency.
    this.alb.logAccessLogs(loadBalancerAccessLogsBucket, "alb");

    // When no explicit security group is provided, the ALB construct
    // creates a default security group whose listener-port ingress rule
    // opens 0.0.0.0/0 because that is the default the elbv2 L2 emits for
    // any ALB listener. The ALB is deployed with internetFacing: false
    // and attached only to PRIVATE_WITH_EGRESS subnets, so that default
    // rule reaches only workloads already inside the VPC. Narrowing the
    // ingress CIDR would also prevent the AWS-managed NLB-to-ALB routing
    // used by the AlbArnTarget that this stack wires up from API Gateway
    // → VPC Link → NLB → ALB → Fargate; AWS routes that traffic through
    // its own internal fabric and the ALB's security group must accept
    // the listener port from the VPC as a whole. Downstream deployments
    // that need a tighter ingress CIDR can pass an explicit security
    // group through the construct's `securityGroup` prop.
    const albSecurityGroup = this.alb.connections.securityGroups[0];
    if (albSecurityGroup) {
      NagSuppressions.addResourceSuppressions(albSecurityGroup, [
        {
          id: "AwsSolutions-EC23",
          reason:
            "This security group protects an internal ApplicationLoadBalancer (internetFacing: false) that is attached only to PRIVATE_WITH_EGRESS subnets and receives traffic exclusively from a NetworkLoadBalancer via AlbArnTarget on the API Gateway → VPC Link → NLB → ALB → Fargate path. The listener-port ingress rule that cdk-nag flags is never reachable from the public internet because the ALB has no public IP, and narrowing the CIDR would block AWS-managed NLB-to-ALB traffic on that same listener port. Callers that need a tighter CIDR can pass an explicit security group via the construct's `securityGroup` prop."
        }
      ]);
    }

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

    // ECR GetAuthorizationToken does not accept a resource ARN in its
    // policy statement and requires Resource: * per the ECR service
    // contract; the same is true for BatchCheckLayerAvailability,
    // GetDownloadUrlForLayer, and BatchGetImage when called against the
    // ECR authorization endpoint. ECS task execution roles must grant
    // those actions so Fargate can pull the task container image. The
    // grant is scoped to the four ECR read actions needed for image
    // pull; no ECR write or registry admin actions are allowed. The
    // suppression is applied after the Fargate service is created so
    // both the inline policy on the role itself and the CDK-managed
    // default policy that the service attaches to the execution role
    // are visible as children at the time of propagation.
    NagSuppressions.addResourceSuppressions(
      executionRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "ECR GetAuthorizationToken, BatchCheckLayerAvailability, GetDownloadUrlForLayer, and BatchGetImage must be granted with Resource: * because the ECR authorization endpoint does not accept a resource ARN in the policy statement. The grant is the set of actions Fargate needs to pull the task container image, with no ECR write actions and no registry admin actions in the statement.",
          appliesTo: ["Resource::*"]
        }
      ],
      true
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

    // Emit NLB access logs to the shared load-balancer log bucket so every
    // TCP connection handled by the NLB produces an audit record alongside
    // the ALB logs above.
    nlb.logAccessLogs(loadBalancerAccessLogsBucket, "nlb");

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
        }),
        // Enable method-level CloudWatch execution logging at INFO.
        // dataTraceEnabled stays false so request/response bodies are not
        // written to logs, which would otherwise risk capturing sensitive
        // payload data that transits this API.
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true
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

    // Attach a request validator so every method under this RestApi
    // validates parameters and bodies before the backend integration
    // runs. Without this explicit validator the synthesized template
    // does not contain a CfnRequestValidator resource and the APIG2
    // rule treats the API as missing input validation.
    this.restApi.addRequestValidator("DefaultRequestValidator", {
      requestValidatorName: `${stackId}-StacLoader-DefaultRequestValidator`,
      validateRequestBody: true,
      validateRequestParameters: true
    });

    // API Gateway auto-creates a CloudWatchRole when stage-level CloudWatch
    // logging is enabled on a RestApi. The role is scoped to API Gateway's
    // own service principal, and AWS publishes AmazonAPIGatewayPushToCloudWatchLogs
    // as the recommended grant for that role. Replacing the managed policy
    // with an inline customer-managed copy would duplicate the same
    // permissions and drift whenever AWS updates the action set.
    const apiGatewayCloudWatchRole = this.restApi.node.tryFindChild(
      "CloudWatchRole"
    ) as Role | undefined;
    if (apiGatewayCloudWatchRole) {
      NagSuppressions.addResourceSuppressions(apiGatewayCloudWatchRole, [
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

    // Every method on this RestApi is guarded by the custom Lambda-based
    // JWT authorizer attached through defaultMethodOptions and explicitly
    // re-applied on each root method and on the {proxy+} method. The API
    // is not fronted by a Cognito User Pool because authentication is
    // delegated to the project's Keycloak OIDC instance, so COG4 does not
    // apply to these methods. APIG3 (WAFv2 web ACL requirement) is
    // suppressed only when WAF is disabled via wafConfig; when WAF is
    // enabled below the stage is associated with a WebACL and APIG3 no
    // longer fires.
    const wafEnabled = props.wafConfig?.enabled !== false;
    if (wafEnabled) {
      const stageArn = Stack.of(this).formatArn({
        service: "apigateway",
        account: "",
        resource: "/restapis",
        resourceName: `${this.restApi.restApiId}/stages/${this.restApi.deploymentStage.stageName}`
      });
      new WebAppWaf(this, "RestApiWaf", {
        resourceArn: stageArn,
        namePrefix: `${props.projectName}-stac-loader-api`,
        isProd: props.isProd,
        requestsPer5Min: props.wafConfig?.requestsPer5Min
      });
    }

    const stacLoaderSuppressions = [
      {
        id: "AwsSolutions-COG4",
        reason:
          "This API is intentionally fronted by a custom Lambda-based JWT authorizer that validates OIDC tokens issued by the project Keycloak instance. Cognito User Pools are not part of the authentication architecture for this deployment, so COG4 does not apply to the methods on this API. Every method wires the custom authorizer via defaultMethodOptions and re-applies it on the root and {proxy+} methods."
      }
    ];
    if (!wafEnabled) {
      stacLoaderSuppressions.push({
        id: "AwsSolutions-APIG3",
        reason:
          "WAFv2 web ACL integration is disabled for this deployment via wafConfig.enabled=false. Access control is enforced by the custom JWT authorizer on every method, CloudWatch access logs are enabled on the deployment stage with caller/IP/path/status fields, and method-level execution logging at INFO is enabled to provide an audit trail for abuse investigation."
      });
    }
    NagSuppressions.addResourceSuppressions(
      this.restApi,
      stacLoaderSuppressions,
      true
    );

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
