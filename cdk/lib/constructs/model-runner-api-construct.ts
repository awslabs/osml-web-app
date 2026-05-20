/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { IVpc, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";

import { ModelRunnerApiConfig } from "../config/app-config";
import { WafConfig } from "../config/app-config";
import { AuthorizedRestApi } from "./authorized-rest-api";
import { AuthConfig } from "./authorizer-function";

export interface ModelRunnerApiProps {
  /**
   * The VPC to deploy the construct into
   */
  vpc: IVpc;

  /**
   * The subnet selection for deployment
   */
  vpcSubnets?: SubnetSelection;

  /**
   * Whether this is a production environment
   */
  isProd: boolean;

  /**
   * The project name prefix for resource naming
   */
  projectName: string;

  /**
   * Custom configuration for the ModelRunnerApi Construct (optional).
   */
  config?: ModelRunnerApiConfig;

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
   * WAFv2 configuration for the REST API stage (optional).
   */
  wafConfig?: WafConfig;
}

export class ModelRunnerApiConstruct extends Construct {
  public config!: ModelRunnerApiConfig;
  public removalPolicy!: RemovalPolicy;
  public api: RestApi;
  public jobsTable: Table;
  public authorizedRestApi: AuthorizedRestApi;

  constructor(scope: Construct, id: string, props: ModelRunnerApiProps) {
    super(scope, id);

    this.setup(props);

    // DynamoDB table
    this.jobsTable = new Table(this, "MRApiJobsTable", {
      partitionKey: { name: "job_id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: "ttl",
      // Enable point-in-time recovery so the jobs table can be restored to
      // any second within the last 35 days if an operator or client wipes
      // data unintentionally.
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });

    this.jobsTable.addGlobalSecondaryIndex({
      indexName: "status-index",
      partitionKey: { name: "status", type: AttributeType.STRING },
      sortKey: { name: "created_at", type: AttributeType.STRING }
    });

    // Image request SQS
    const modelRunnerQueue = Queue.fromQueueArn(
      this,
      "ModelRunnerQueue",
      this.config.modelRunnerImageRequestQueueArn
    );

    // Status SNS
    const modelRunnerTopic = Topic.fromTopicArn(
      this,
      "ModelRunnerTopic",
      this.config.modelRunnerStatusTopicArn
    );

    // Roles
    const apiRole = new Role(this, "ApiRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com")
    });

    const statusMonitorRole = new Role(this, "ApiStatusMonitorRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com")
    });

    // API dependencies layer
    const pythonDependenciesLayer = new LayerVersion(
      this,
      "MRApiPythonDependencies",
      {
        code: Code.fromAsset(join(__dirname, "layer"), {
          bundling: {
            image: Runtime.PYTHON_3_13.bundlingImage,
            command: [
              "bash",
              "-c",
              "pip install fastapi==0.104.1 mangum==0.17.0 pydantic==2.9.2 -t /asset-output/python && " +
                "cd /asset-output/python && find . -type d -name '__pycache__' -exec rm -rf {} + && " +
                "find . -type f -name '*.pyc' -delete"
            ],
            user: "root"
          }
        }),
        compatibleRuntimes: [Runtime.PYTHON_3_13],
        description: "FastAPI and dependencies for Model Runner API"
      }
    );

    const apiLogGroup = new LogGroup(this, "MRApiLogGroup", {
      logGroupName: `/aws/lambda/${props.projectName}-ModelRunnerApi`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: this.removalPolicy
    });

    const apiFunction = new Function(this, "MRApi", {
      functionName: `${props.projectName}-ModelRunnerApi`,
      description:
        "Proxies image processing requests to the OSML Model Runner queue",
      runtime: Runtime.PYTHON_3_13,
      handler: "index.handler",
      code: Code.fromAsset(
        join(__dirname, "..", "..", "lambda", "modelRunnerApi")
      ),
      layers: [pythonDependenciesLayer],
      environment: {
        DDB_TABLE: this.jobsTable.tableName,
        IMAGE_REQUEST_QUEUE_URL: modelRunnerQueue.queueUrl,
        ENABLE_CORS: (!props.isProd).toString()
      },
      timeout: Duration.seconds(60),
      memorySize: 1024,
      role: apiRole,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      logGroup: apiLogGroup
    });

    // The Lambda runtime is pinned to Python 3.13 because the bundled
    // dependency stack (pydantic-core 2.23.4, compiled via PyO3 0.22) does
    // not yet support Python 3.14: building the layer on python3.14 fails
    // with "the configured Python interpreter version (3.14) is newer than
    // PyO3's maximum supported version (3.13)". Bumping pydantic-core to a
    // PyO3-0.23-based release is a dependency-tree change outside the scope
    // of this construct, and 3.13 remains an AWS-supported Lambda runtime.
    NagSuppressions.addResourceSuppressions(apiFunction, [
      {
        id: "AwsSolutions-L1",
        reason:
          "This Lambda is pinned to python3.13 because its bundled dependency stack (pydantic-core 2.23.4 compiled through PyO3 0.22) does not support python3.14 — the layer build fails when PyO3 refuses to target an interpreter newer than 3.13. Upgrading the dependency set to a PyO3 0.23 release is an API-contract change outside the scope of this construct, and python3.13 remains an AWS-supported Lambda runtime."
      }
    ]);

    const statusMonitorLogGroup = new LogGroup(
      this,
      "MRApiStatusMonitorLogGroup",
      {
        logGroupName: `/aws/lambda/${props.projectName}-ModelRunnerStatusMonitor`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    const statusMonitorFunction = new Function(this, "MRApiStatusMonitor", {
      functionName: `${props.projectName}-ModelRunnerStatusMonitor`,
      description:
        "Monitors Model Runner job status updates via SNS notifications",
      runtime: Runtime.PYTHON_3_13,
      handler: "status_monitor.handler",
      code: Code.fromAsset(
        join(__dirname, "..", "..", "lambda", "modelRunnerApi")
      ),
      environment: {
        DDB_TABLE: this.jobsTable.tableName
      },
      timeout: Duration.seconds(60),
      memorySize: 1024,
      role: statusMonitorRole,
      logGroup: statusMonitorLogGroup
    });

    // Same PyO3/pydantic-core constraint as the MRApi function above keeps
    // the status monitor on python3.13. The two functions share the deployed
    // lambda source tree and would need to upgrade together.
    NagSuppressions.addResourceSuppressions(statusMonitorFunction, [
      {
        id: "AwsSolutions-L1",
        reason:
          "This Lambda is pinned to python3.13 because it shares a code base and dependency set with the Model Runner API function. The pydantic-core 2.23.4 wheel used by that code cannot be built against python3.14 (PyO3 0.22 does not support it), so both functions must move in lockstep when the dependency tree is upgraded; python3.13 remains an AWS-supported Lambda runtime."
      }
    ]);

    // Subscribe to SNS topic
    modelRunnerTopic.addSubscription(
      new LambdaSubscription(statusMonitorFunction)
    );

    // Create the Lambda integration
    const apiIntegration = new LambdaIntegration(apiFunction, {
      proxy: true
    });

    // Create AuthorizedRestApi with authentication
    this.authorizedRestApi = new AuthorizedRestApi(this, "ModelRunnerApi", {
      name: "MR",
      apiStageName: "prod",
      integration: apiIntegration,
      auth: props.auth,
      isProd: props.isProd,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      hostedZone: this.config.hostedZone,
      domainName: this.config.domainName,
      corsAllowedOrigins: props.corsAllowedOrigins,
      wafConfig: props.wafConfig,
      wafNamePrefix: `${props.projectName}-modelrunner-api`
    });

    this.api = this.authorizedRestApi.restApi;

    // Permissions
    this.jobsTable.grantReadWriteData(apiFunction);
    this.jobsTable.grantReadWriteData(statusMonitorFunction);
    modelRunnerQueue.grantSendMessages(apiFunction);

    // S3 permissions for deleting job output files, scoped to allowed buckets
    const bucketArns = this.config.allowedBucketArns ?? [];
    if (bucketArns.length > 0) {
      const s3DeletePolicy = new PolicyStatement({
        actions: ["s3:ListBucket", "s3:DeleteObject"],
        resources: [...bucketArns, ...bucketArns.map((arn) => `${arn}/*`)]
      });
      apiFunction.addToRolePolicy(s3DeletePolicy);
    }

    // CloudWatch Logs permissions
    const cloudWatchPolicy = new PolicyStatement({
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      resources: ["arn:aws:logs:*:*:*"]
    });

    // VPC permissions for Lambda functions deployed in VPC
    const vpcPolicy = new PolicyStatement({
      actions: [
        "ec2:CreateNetworkInterface",
        "ec2:DeleteNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:AttachNetworkInterface",
        "ec2:DetachNetworkInterface"
      ],
      resources: ["*"]
    });

    apiFunction.addToRolePolicy(cloudWatchPolicy);
    apiFunction.addToRolePolicy(vpcPolicy);
    statusMonitorFunction.addToRolePolicy(cloudWatchPolicy);

    // The API Lambda role carries a small set of wildcards that cannot be
    // tightened without breaking the runtime contract with the job record:
    //   - `dynamodb:Query` on the table's GSIs uses `/index/*` because the
    //     construct fans out Query calls across every index that serves an
    //     API endpoint; individual index ARNs are intentionally not known
    //     to the policy layer.
    //   - `s3:ListBucket` + `s3:DeleteObject` are scoped to the allowed
    //     bucket ARNs passed in via config (with /* object-key suffixes).
    //   - `logs:*` uses `arn:aws:logs:*:*:*` so the function can create and
    //     write to its own log group regardless of region/account; this is
    //     the standard shape published by AWS for Lambda CloudWatch Logs
    //     permissions.
    NagSuppressions.addResourceSuppressions(
      apiRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Query against the jobs table is intentionally fanned out across all Global Secondary Indexes that serve API endpoints. The /index/* suffix matches only indexes of this specific table, so the blast radius of the wildcard is constrained to the table's own index ARNs.",
          appliesTo: [
            "Resource::<ModelRunnerApiMRApiJobsTableFE43AAD8.Arn>/index/*"
          ]
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "The Model Runner API deletes job output objects from S3 buckets listed in the allowed bucket ARNs config. The /* suffix on each bucket ARN is required to match object keys within those buckets. The action set is limited to s3:ListBucket and s3:DeleteObject.",
          appliesTo: bucketArns.map((arn) => `Resource::${arn}/*`)
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "VPC networking permissions (ec2:CreateNetworkInterface, ec2:DeleteNetworkInterface, ec2:DescribeNetworkInterfaces, ec2:AttachNetworkInterface, ec2:DetachNetworkInterface) require Resource: * because the ENI ARN is not known until the Lambda is invoked. This is the standard AWS-recommended grant for Lambda functions deployed in a VPC.",
          appliesTo: ["Resource::*"]
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CloudWatch Logs permissions use arn:aws:logs:*:*:* because the Lambda creates and writes to its own log group at invocation time, and the CreateLogGroup/CreateLogStream/PutLogEvents action set is the standard AWS-recommended grant for Lambda logging.",
          appliesTo: ["Resource::arn:aws:logs:*:*:*"]
        }
      ],
      true
    );

    // The status monitor Lambda role has the same GSI and logs wildcards as
    // the API role, suppressed here with the same rationale scoped to the
    // status monitor's default policy.
    NagSuppressions.addResourceSuppressions(
      statusMonitorRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "The status monitor updates job records via the jobs table's Global Secondary Indexes. The /index/* suffix is constrained to indexes of this specific table, so the wildcard only matches index ARNs belonging to the jobs table itself.",
          appliesTo: [
            "Resource::<ModelRunnerApiMRApiJobsTableFE43AAD8.Arn>/index/*"
          ]
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "CloudWatch Logs permissions use arn:aws:logs:*:*:* because the status monitor Lambda creates and writes to its own log group at invocation time. The action set is limited to CreateLogGroup/CreateLogStream/PutLogEvents, which is the standard AWS-recommended grant for Lambda logging.",
          appliesTo: ["Resource::arn:aws:logs:*:*:*"]
        }
      ],
      true
    );
  }

  private setup(props: ModelRunnerApiProps): void {
    this.config = props.config ?? new ModelRunnerApiConfig();
    this.removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
  }
}
