/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { Annotations, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CustomResource } from "aws-cdk-lib";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { IVpc, SecurityGroup, SubnetSelection } from "aws-cdk-lib/aws-ec2";
import { Effect, PolicyStatement, StarPrincipal } from "aws-cdk-lib/aws-iam";
import { Code, Function, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket, BucketEncryption, EventType } from "aws-cdk-lib/aws-s3";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";

import { WebAppUtilityConfig } from "../config/app-config";
import { AuthorizedRestApi } from "./authorized-rest-api";
import { AuthConfig } from "./authorizer-function";
import { OSMLAccount } from "./types";

export interface WebAppUtilityProps {
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
   * The OSML deployment account.
   */
  account: OSMLAccount;

  /**
   * The project name prefix for resource naming
   */
  projectName: string;

  /**
   * AWS region for deployment
   */
  region: string;

  /**
   * Custom configuration for the WebAppUtility Construct (optional).
   */
  config?: WebAppUtilityConfig;

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

export class WebAppUtilityConstruct extends Construct {
  public config!: WebAppUtilityConfig;
  public removalPolicy!: RemovalPolicy;
  public api: RestApi;
  public authorizedRestApi: AuthorizedRestApi;
  public dataCatalogIngestBucket?: Bucket;
  public geojsonIngestTranslatorLambda?: Function;
  public quotaCodesBucket!: Bucket;
  public quotaTrackingTable!: Table;
  public detectionBridgeBucket?: Bucket;
  public translationLambda?: Function;

  constructor(scope: Construct, id: string, props: WebAppUtilityProps) {
    super(scope, id);

    this.setup(props);

    // Create DynamoDB table for quota tracking
    this.createQuotaTrackingTable();

    // Create S3 bucket for quota codes storage
    this.createQuotaCodesBucket(props);

    // Create quota codes generator (Custom Resource)
    this.createQuotaCodesGenerator(props);

    // Create data catalog ingest bucket if osml-data-intake integration is configured
    // (either via the legacy output topic ARN or the intake topic name)
    if (this.config.osmlDataIntakeOutputTopic || this.config.intakeTopicName) {
      this.createDataCatalogIngestBucket(props);
    }

    // Create detection bridge bucket and Translation Lambda
    this.createDetectionBridge(props);

    // Create layer with dependencies
    const pythonDependenciesLayer = new LayerVersion(
      this,
      "WebAppUtilityPythonDependencies",
      {
        code: Code.fromAsset(join(__dirname, "layer"), {
          bundling: {
            image: Runtime.PYTHON_3_13.bundlingImage,
            command: [
              "bash",
              "-c",
              "pip install fastapi==0.104.1 mangum==0.17.0 pydantic==2.9.2 boto3>=1.38.43 botocore>=1.38.43 -t /asset-output/python && " +
                "cd /asset-output/python && find . -type d -name '__pycache__' -exec rm -rf {} + && " +
                "find . -type f -name '*.pyc' -delete"
            ],
            user: "root"
          }
        }),
        compatibleRuntimes: [Runtime.PYTHON_3_13],
        description: "FastAPI and dependencies for WebApp Utility API"
      }
    );

    // Create the Lambda function with DynamoDB integration
    const webAppUtilityLambda = this.createWebAppUtilityLambda(
      props,
      pythonDependenciesLayer
    );

    // Create the Lambda integration
    const apiIntegration = new LambdaIntegration(webAppUtilityLambda, {
      proxy: true
    });

    // Create AuthorizedRestApi with authentication
    this.authorizedRestApi = new AuthorizedRestApi(this, "WebAppUtilityApi", {
      name: "WA",
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
  }

  private setup(props: WebAppUtilityProps): void {
    this.config = props.config ?? new WebAppUtilityConfig();
    this.removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
  }

  private createQuotaTrackingTable(): void {
    // Create DynamoDB table for rolling window quota tracking
    this.quotaTrackingTable = new Table(this, "QuotaTrackingTable", {
      partitionKey: { name: "model_id", type: AttributeType.STRING },
      sortKey: { name: "request_timestamp", type: AttributeType.NUMBER },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: "ttl", // TTL-based expiration for individual requests
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });
  }

  private createDataCatalogIngestBucket(props: WebAppUtilityProps): void {
    // Create S3 bucket for GeoJSON uploads
    this.dataCatalogIngestBucket = new Bucket(this, "DataCatalogIngestBucket", {
      bucketName: `web-app-data-intake-${props.account.id}`,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: !props.isProd,
      versioned: props.isProd
    });

    // Look up the data-catalog-intake SNS input topic
    const intakeTopicName =
      this.config.intakeTopicName ?? "data-catalog-intake";

    let intakeTopic: ITopic;
    try {
      const topicArn = `arn:aws:sns:${Stack.of(this).region}:${Stack.of(this).account}:${intakeTopicName}`;
      intakeTopic = Topic.fromTopicArn(
        this,
        "GeojsonIntakeInputTopic",
        topicArn
      );
    } catch {
      Annotations.of(this).addWarningV2(
        "GeojsonIngestTranslator",
        `Could not resolve SNS topic "${intakeTopicName}". ` +
          "Skipping GeoJSON ingest translator creation."
      );
      return;
    }

    const translatorLogGroup = new LogGroup(
      this,
      "GeojsonIngestTranslatorLogGroup",
      {
        logGroupName: `/aws/lambda/${props.projectName}-GeojsonIngestTranslator`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    // Create translator Lambda that converts S3 events to SNSRequest messages
    // for the official osml-data-intake pipeline
    this.geojsonIngestTranslatorLambda = new Function(
      this,
      "GeojsonIngestTranslatorLambda",
      {
        functionName: `${props.projectName}-GeojsonIngestTranslator`,
        description:
          "Translates S3 event notifications from the data catalog ingest bucket into SNSRequest messages for the data-catalog-intake pipeline",
        runtime: Runtime.PYTHON_3_13,
        handler: "handler.handler",
        code: Code.fromAsset(
          join(__dirname, "..", "..", "lambda", "geojsonIngestTranslator")
        ),
        environment: {
          INTAKE_TOPIC_ARN: intakeTopic.topicArn
        },
        timeout: Duration.seconds(30),
        logGroup: translatorLogGroup
      }
    );

    // Grant translator Lambda permission to publish to the intake topic
    this.geojsonIngestTranslatorLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [intakeTopic.topicArn]
      })
    );

    // Add S3 trigger for GeoJSON files
    this.dataCatalogIngestBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(this.geojsonIngestTranslatorLambda),
      { suffix: ".geojson" }
    );

    // Grant the data-catalog-intake Lambda read access to the ingest bucket
    // so it can download GeoJSON files referenced in the SNSRequest
    this.dataCatalogIngestBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowIntakeLambdaGetObject",
        effect: Effect.ALLOW,
        principals: [new StarPrincipal()],
        actions: ["s3:GetObject"],
        resources: [this.dataCatalogIngestBucket.arnForObjects("*")],
        conditions: {
          StringLike: {
            "aws:PrincipalArn": `arn:aws:iam::${props.account.id}:role/*data-catalog-intake*`
          }
        }
      })
    );
  }

  private createDetectionBridge(props: WebAppUtilityProps): void {
    // Look up the existing data-catalog-intake SNS topic
    const intakeTopicName =
      this.config.intakeTopicName ?? "data-catalog-intake";
    const detectionCollectionId =
      this.config.detectionCollectionId ?? "model-runner-detections";

    let intakeTopic: ITopic;
    try {
      const topicArn = `arn:aws:sns:${Stack.of(this).region}:${Stack.of(this).account}:${intakeTopicName}`;
      intakeTopic = Topic.fromTopicArn(this, "IntakeInputTopic", topicArn);
    } catch {
      Annotations.of(this).addWarningV2(
        "DetectionBridge",
        `Could not resolve SNS topic "${intakeTopicName}". ` +
          "Skipping detection bridge bucket and Translation Lambda creation."
      );
      return;
    }

    // Create the detection bridge S3 bucket
    this.detectionBridgeBucket = new Bucket(this, "DetectionBridgeBucket", {
      bucketName: `webapp-detection-bridge-${props.account.id}`,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: !props.isProd,
      versioned: props.isProd
    });

    // Create log group for Translation Lambda
    const translationLogGroup = new LogGroup(
      this,
      "DetectionBridgeTranslatorLogGroup",
      {
        logGroupName: `/aws/lambda/${props.projectName}-DetectionBridgeTranslator`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    // Create Translation Lambda
    this.translationLambda = new Function(
      this,
      "DetectionBridgeTranslatorLambda",
      {
        functionName: `${props.projectName}-DetectionBridgeTranslator`,
        description:
          "Translates S3 event notifications from the detection bridge bucket into SNSRequest messages for the data-catalog-intake pipeline",
        runtime: Runtime.PYTHON_3_13,
        handler: "handler.handler",
        code: Code.fromAsset(
          join(__dirname, "..", "..", "lambda", "detectionBridgeTranslator")
        ),
        environment: {
          INTAKE_TOPIC_ARN: intakeTopic.topicArn,
          DETECTION_COLLECTION_ID: detectionCollectionId
        },
        timeout: Duration.seconds(30),
        logGroup: translationLogGroup
      }
    );

    // Grant Translation Lambda permission to publish to the intake topic
    this.translationLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [intakeTopic.topicArn]
      })
    );

    // Grant Translation Lambda read access to the bridge bucket
    this.detectionBridgeBucket.grantRead(this.translationLambda);

    // Configure S3 event notification on .geojson suffix → triggers Translation Lambda
    this.detectionBridgeBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(this.translationLambda),
      { suffix: ".geojson" }
    );

    // Grant Model Runner task role s3:PutObject on bridge bucket via bucket policy.
    // We use a broad principal condition since we don't have direct access to the MR role.
    this.detectionBridgeBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowModelRunnerPutObject",
        effect: Effect.ALLOW,
        principals: [new StarPrincipal()],
        actions: ["s3:PutObject"],
        resources: [this.detectionBridgeBucket.arnForObjects("*")],
        conditions: {
          StringLike: {
            "aws:PrincipalArn": `arn:aws:iam::${props.account.id}:role/*model-runner*`
          }
        }
      })
    );

    // Grant Intake Lambda role s3:GetObject on bridge bucket via bucket policy.
    // The data-catalog-intake Lambda needs to download GeoJSON files referenced in the SNSRequest.
    this.detectionBridgeBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowIntakeLambdaGetObject",
        effect: Effect.ALLOW,
        principals: [new StarPrincipal()],
        actions: ["s3:GetObject"],
        resources: [this.detectionBridgeBucket.arnForObjects("*")],
        conditions: {
          StringLike: {
            "aws:PrincipalArn": `arn:aws:iam::${props.account.id}:role/*data-catalog-intake*`
          }
        }
      })
    );

    // Auto-add bridge bucket to the allowed bucket list so it appears in the
    // output bucket dropdown and the utility Lambda can generate presigned URLs for it.
    if (!this.config.allowedBucketArns) {
      this.config.allowedBucketArns = [];
    }
    if (
      !this.config.allowedBucketArns.includes(
        this.detectionBridgeBucket.bucketArn
      )
    ) {
      this.config.allowedBucketArns.push(this.detectionBridgeBucket.bucketArn);
    }
  }

  private createQuotaCodesBucket(props: WebAppUtilityProps): void {
    // Create S3 bucket for quota codes storage with project name
    this.quotaCodesBucket = new Bucket(this, "QuotaCodesBucket", {
      bucketName: `web-app-quota-codes-${props.account.id}`,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: true // Always auto-delete objects since they're generated at deploy time
    });
  }

  private createQuotaCodesGenerator(props: WebAppUtilityProps): void {
    const quotaGeneratorLogGroup = new LogGroup(
      this,
      "QuotaCodesGeneratorLogGroup",
      {
        logGroupName: `/aws/lambda/${props.projectName}-QuotaCodesGenerator`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    // Create Custom Resource Lambda for quota codes generation
    const quotaGeneratorLambda = new Function(
      this,
      "QuotaCodesGeneratorLambda",
      {
        functionName: `${props.projectName}-QuotaCodesGenerator`,
        description: "Generates AWS Service Quotas codes for API rate limiting",
        runtime: Runtime.PYTHON_3_13,
        handler: "app.lambda_handler",
        code: Code.fromAsset(
          join(__dirname, "..", "..", "lambda", "quotaCodesGenerator")
        ),
        timeout: Duration.minutes(10), // Longer timeout for Service Quotas API calls and parsing
        environment: {
          REGION: props.region
        },
        logGroup: quotaGeneratorLogGroup
      }
    );

    // Grant permissions for quota codes generator
    this.quotaCodesBucket.grantWrite(quotaGeneratorLambda);

    quotaGeneratorLambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "bedrock:ListFoundationModels",
          "servicequotas:ListServiceQuotas"
        ],
        resources: ["*"]
      })
    );

    // Create Custom Resource Provider
    const quotaCodesProvider = new Provider(this, "QuotaCodesProvider", {
      onEventHandler: quotaGeneratorLambda,
      logGroup: quotaGeneratorLogGroup
    });

    // Create Custom Resource to trigger quota codes generation
    const quotaCodesCustomResource = new CustomResource(
      this,
      "QuotaCodesGenerator",
      {
        serviceToken: quotaCodesProvider.serviceToken,
        properties: {
          Region: props.region,
          BucketName: this.quotaCodesBucket.bucketName,
          // Force update on every deployment
          Timestamp: Date.now().toString()
        }
      }
    );

    // Ensure custom resource runs after bucket is created
    quotaCodesCustomResource.node.addDependency(this.quotaCodesBucket);
  }

  private createWebAppUtilityLambda(
    props: WebAppUtilityProps,
    pythonDependenciesLayer: LayerVersion
  ): Function {
    // Quota tracking is always enabled
    const enableQuotaTracking = true;

    // Build environment variables object
    const environment: { [key: string]: string } = {
      RESTRICT_BUCKET_ACCESS: this.config.restrictBucketAccess.toString(),
      ALLOWED_BUCKET_ARNS: (this.config.allowedBucketArns || []).join(","),
      ENABLE_CORS: (!props.isProd).toString(),
      SHOW_ALL_MODEL_VARIANTS: "false",
      ENABLE_QUOTA_TRACKING: enableQuotaTracking.toString(),
      QUOTA_CODES_BUCKET: this.quotaCodesBucket.bucketName,
      QUOTA_TRACKING_TABLE: this.quotaTrackingTable.tableName
    };

    // Add ENABLED_MODELS if bedrockModels configuration is provided
    if (
      this.config.bedrockModels?.enabledModels &&
      this.config.bedrockModels.enabledModels.length > 0
    ) {
      environment.ENABLED_MODELS =
        this.config.bedrockModels.enabledModels.join(",");
    }

    const utilityLogGroup = new LogGroup(this, "WebAppUtilityLogGroup", {
      logGroupName: `/aws/lambda/${props.projectName}-UtilityApi`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: this.removalPolicy
    });

    // Create the Lambda function (reads quota codes from S3 + writes to DynamoDB)
    const webAppUtilityLambda = new Function(this, "WebAppUtilityLambda", {
      functionName: `${props.projectName}-UtilityApi`,
      description:
        "Handles S3 browsing, Bedrock AI, and utility API requests for the web app",
      runtime: Runtime.PYTHON_3_13,
      handler: "index.handler",
      code: Code.fromAsset(
        join(__dirname, "..", "..", "lambda", "webAppUtility"),
        {
          exclude: [
            "**/__pycache__",
            "**/*.pyc",
            ".tox",
            ".hypothesis",
            "conda",
            "htmlcov",
            "tests",
            ".coverage",
            ".coveragerc",
            "pytest.ini",
            "tox.ini",
            "requirements-dev.txt"
          ]
        }
      ),
      layers: [pythonDependenciesLayer],
      environment,
      timeout: Duration.seconds(30),
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: this.config.securityGroupId
        ? [
            SecurityGroup.fromSecurityGroupId(
              this,
              "WebAppUtilityLambdaSecurityGroup",
              this.config.securityGroupId
            )
          ]
        : undefined,
      logGroup: utilityLogGroup
    });

    // Grant access to quota tracking DynamoDB table
    this.quotaTrackingTable.grantReadWriteData(webAppUtilityLambda);

    // Grant read access to quota codes bucket
    this.quotaCodesBucket.grantRead(webAppUtilityLambda);

    // Add permissions and return
    this.addLambdaPermissions(webAppUtilityLambda);

    return webAppUtilityLambda;
  }

  private addLambdaPermissions(lambda: Function): void {
    // Add S3 permissions
    if (
      this.config.restrictBucketAccess &&
      this.config.allowedBucketArns?.length
    ) {
      lambda.addToRolePolicy(
        new PolicyStatement({
          actions: ["s3:ListBucket", "s3:GetObject", "s3:DeleteObject"],
          resources: [
            ...this.config.allowedBucketArns,
            ...this.config.allowedBucketArns.map((arn: string) => `${arn}/*`)
          ]
        })
      );
      // CORS configuration permissions for allowed buckets
      lambda.addToRolePolicy(
        new PolicyStatement({
          actions: ["s3:GetBucketCors", "s3:PutBucketCors"],
          resources: this.config.allowedBucketArns
        })
      );
      lambda.addToRolePolicy(
        new PolicyStatement({
          actions: ["s3:ListAllMyBuckets"],
          resources: ["*"]
        })
      );
    } else {
      lambda.addToRolePolicy(
        new PolicyStatement({
          actions: [
            "s3:ListBucket",
            "s3:ListAllMyBuckets",
            "s3:GetObject",
            "s3:DeleteObject",
            "s3:GetBucketCors",
            "s3:PutBucketCors"
          ],
          resources: ["*"]
        })
      );
    }

    // Add Bedrock permissions
    lambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel",
          "bedrock:GetFoundationModelAvailability",
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ],
        resources: ["*"]
      })
    );

    // Add Service Quotas permissions
    lambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "servicequotas:GetServiceQuota",
          "servicequotas:ListServiceQuotas"
        ],
        resources: ["*"]
      })
    );

    // Add SageMaker permissions for listing endpoints
    lambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["sagemaker:ListEndpoints"],
        resources: ["*"]
      })
    );

    // Add CloudWatch and VPC permissions
    lambda.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:AttachNetworkInterface",
          "ec2:DetachNetworkInterface"
        ],
        resources: ["*"]
      })
    );
  }
}
