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
import { Construct } from "constructs";
import { join } from "path";

import { ModelRunnerApiConfig } from "../config/app-config";
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
      timeToLiveAttribute: "ttl"
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
      corsAllowedOrigins: props.corsAllowedOrigins
    });

    this.api = this.authorizedRestApi.restApi;

    // Permissions
    this.jobsTable.grantReadWriteData(apiFunction);
    this.jobsTable.grantReadWriteData(statusMonitorFunction);
    modelRunnerQueue.grantSendMessages(apiFunction);

    // S3 permissions for deleting job output files
    const s3DeletePolicy = new PolicyStatement({
      actions: ["s3:ListBucket", "s3:DeleteObject"],
      resources: ["*"] // Allow deletion from any bucket (job record contains bucket name)
    });
    apiFunction.addToRolePolicy(s3DeletePolicy);

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
  }

  private setup(props: ModelRunnerApiProps): void {
    this.config = props.config ?? new ModelRunnerApiConfig();
    this.removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
  }
}
