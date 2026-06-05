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
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  EventType
} from "aws-cdk-lib/aws-s3";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { Provider } from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { join } from "path";

import { WebAppUtilityConfig } from "../config/app-config";
import { WafConfig } from "../config/app-config";
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

  /**
   * WAFv2 configuration for the REST API stage (optional).
   */
  wafConfig?: WafConfig;
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
  /**
   * Shared S3 bucket that receives server access logs for every utility
   * bucket in this construct (quota codes, data catalog ingest, detection
   * bridge). Using a single log bucket keeps the log-retention configuration
   * in one place and avoids fanning out one log bucket per target bucket.
   */
  public accessLogsBucket!: Bucket;

  constructor(scope: Construct, id: string, props: WebAppUtilityProps) {
    super(scope, id);

    this.setup(props);

    // Create the shared access-log bucket first so every utility bucket that
    // follows can reference it as its serverAccessLogsBucket target.
    this.createAccessLogsBucket();

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
      corsAllowedOrigins: props.corsAllowedOrigins,
      wafConfig: props.wafConfig,
      wafNamePrefix: `${props.projectName}-utility-api`
    });

    this.api = this.authorizedRestApi.restApi;
  }

  private setup(props: WebAppUtilityProps): void {
    this.config = props.config ?? new WebAppUtilityConfig();
    this.removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
  }

  private createAccessLogsBucket(): void {
    // Shared target for S3 server access logs produced by every utility
    // bucket in this construct. Security controls enabled here:
    //   - S3-managed encryption at rest
    //   - public access fully blocked
    //   - versioning (so accidental overwrites / deletes are recoverable)
    //   - SSL/TLS-only access via bucket policy
    //   - a 90-day expiration lifecycle rule to bound log growth
    // The suppression below records the logging-recursion constraint: an
    // access-log target bucket cannot itself have server access logging
    // enabled without creating an infinite logging loop.
    this.accessLogsBucket = new Bucket(this, "WebAppUtilityAccessLogsBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: Duration.days(90) }]
    });

    NagSuppressions.addResourceSuppressions(this.accessLogsBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "This bucket is the target of server access logs for sibling utility buckets (quota codes, data catalog ingest, detection bridge). Enabling access logs on the access-log bucket itself would create an infinite logging recursion. The bucket has public access blocked, enforces SSL/TLS in transit, is encrypted with S3-managed keys, has versioning enabled, and has a 90-day expiration lifecycle rule to bound log growth, so its security posture is acceptable without an additional logging layer."
      }
    ]);
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
      versioned: props.isProd,
      // Enforce SSL/TLS for every request; the accompanying auto-generated
      // bucket policy denies any request made over plain HTTP.
      enforceSSL: true,
      // Ship S3 server access logs to the shared utility log bucket under a
      // bucket-specific prefix so operators can audit access per bucket.
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: "data-catalog/"
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

    // CDK auto-creates a Lambda service role for this function and attaches
    // the AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs
    // access. AWS publishes that managed policy as the baseline CloudWatch
    // Logs grant for any Lambda that writes to its own log group; replacing
    // it with a customer-managed copy would duplicate the grant and drift
    // whenever AWS updates the log action set.
    NagSuppressions.addResourceSuppressions(
      this.geojsonIngestTranslatorLambda,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing this managed policy with an inline customer-managed copy would duplicate the grant and drift whenever AWS updates the action set for CloudWatch Logs."
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to python3.13 to stay consistent with the shared web-app Lambda runtime policy. The pinned Python dependency set across the web-app Lambdas (boto3, botocore, fastapi, mangum, pydantic) uses versions whose native-wheel dependencies may not yet be compatible with python3.14; bumping this single handler to python3.14 would drift it from the rest of the fleet. python3.13 remains an AWS-supported Lambda runtime."
        }
      ],
      true
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
      bucketName:
        this.config.detectionBridgeBucketName ||
        `webapp-detection-bridge-${props.account.id}`,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: !props.isProd,
      versioned: props.isProd,
      // Enforce SSL/TLS for every request; the accompanying auto-generated
      // bucket policy denies any request made over plain HTTP.
      enforceSSL: true,
      // Ship S3 server access logs to the shared utility log bucket under a
      // bucket-specific prefix so operators can audit access per bucket.
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: "detection-bridge/"
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

    // CDK auto-creates a Lambda service role for this function and attaches
    // the AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs
    // access. The Bucket.grantRead() call above emits an inline default
    // policy statement that uses s3:GetObject*, s3:GetBucket*, and s3:List*
    // action-prefix wildcards together with a bucket-scoped object ARN
    // (bucket/*). Those action wildcards are the exact shape the CDK
    // grantRead helper produces and the object-ARN wildcard is the idiomatic
    // bucket-object scope for any bucket-scoped read grant; neither can be
    // narrowed without hand-writing a replacement policy that would drift
    // from the grantRead helper.
    NagSuppressions.addResourceSuppressions(
      this.translationLambda,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing this managed policy with an inline customer-managed copy would duplicate the grant and drift whenever AWS updates the action set for CloudWatch Logs."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Action::s3:GetObject*",
            "Action::s3:GetBucket*",
            "Action::s3:List*",
            "Resource::<WebAppUtilityDetectionBridgeBucket18A00D2B.Arn>/*"
          ],
          reason:
            "Bucket.grantRead() emits s3:GetObject*, s3:GetBucket*, and s3:List* action-prefix wildcards together with a bucket/* object-ARN wildcard. These are the CDK-emitted shape for a bucket-scoped read grant and the object ARN is already scoped to the single detection bridge bucket that the Translation Lambda must read to translate S3 events into SNSRequest messages."
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to python3.13 to stay consistent with the shared web-app Lambda runtime policy. The pinned Python dependency set across the web-app Lambdas (boto3, botocore, fastapi, mangum, pydantic) uses versions whose native-wheel dependencies may not yet be compatible with python3.14; bumping this single handler to python3.14 would drift it from the rest of the fleet. python3.13 remains an AWS-supported Lambda runtime."
        }
      ],
      true
    );

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
  }

  private createQuotaCodesBucket(props: WebAppUtilityProps): void {
    // Create S3 bucket for quota codes storage with project name
    this.quotaCodesBucket = new Bucket(this, "QuotaCodesBucket", {
      bucketName: `web-app-quota-codes-${props.account.id}`,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: true, // Always auto-delete objects since they're generated at deploy time
      // Enforce SSL/TLS for every request; the accompanying auto-generated
      // bucket policy denies any request made over plain HTTP.
      enforceSSL: true,
      // Ship S3 server access logs to the shared utility log bucket under a
      // bucket-specific prefix so operators can audit access per bucket.
      serverAccessLogsBucket: this.accessLogsBucket,
      serverAccessLogsPrefix: "quota-codes/"
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
        actions: ["servicequotas:ListServiceQuotas"],
        resources: ["*"]
      })
    );

    // CDK auto-creates a Lambda service role for this function and attaches
    // the AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs
    // access. The Bucket.grantWrite() call above emits s3:DeleteObject* and
    // s3:Abort* action-prefix wildcards (so multipart uploads can be aborted
    // as part of a write grant) together with a bucket/* object-ARN wildcard
    // and a single s3:GetBucketLocation statement whose Resource must be *
    // per the S3 service contract (GetBucketLocation only accepts Resource:
    // *). The servicequotas:ListServiceQuotas service-contract describe/list
    // action likewise only accepts Resource: * because it is an
    // account-scoped call that does not take a resource ARN.
    NagSuppressions.addResourceSuppressions(
      quotaGeneratorLambda,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing this managed policy with an inline customer-managed copy would duplicate the grant and drift whenever AWS updates the action set for CloudWatch Logs."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Action::s3:DeleteObject*",
            "Action::s3:Abort*",
            "Resource::<WebAppUtilityQuotaCodesBucket7C6F13EF.Arn>/*",
            "Resource::*"
          ],
          reason:
            "Bucket.grantWrite() emits s3:DeleteObject* and s3:Abort* action-prefix wildcards so multipart uploads can be aborted, together with a bucket/* object-ARN wildcard scoped to the single quota codes bucket and a single s3:GetBucketLocation statement whose Resource is * because S3 only accepts Resource: * for GetBucketLocation. The Resource: * also covers the servicequotas:ListServiceQuotas describe/list action which is account-scoped and does not accept a resource ARN."
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to python3.13 to stay consistent with the shared web-app Lambda runtime policy. The pinned Python dependency set across the web-app Lambdas (boto3, botocore, fastapi, mangum, pydantic) uses versions whose native-wheel dependencies may not yet be compatible with python3.14; bumping this single handler to python3.14 would drift it from the rest of the fleet. python3.13 remains an AWS-supported Lambda runtime."
        }
      ],
      true
    );

    // Create Custom Resource Provider
    const quotaCodesProvider = new Provider(this, "QuotaCodesProvider", {
      onEventHandler: quotaGeneratorLambda,
      logGroup: quotaGeneratorLogGroup
    });

    // The CDK Provider construct internally creates a framework-onEvent
    // Lambda whose service role is attached to the AWSLambdaBasicExecutionRole
    // managed policy for CloudWatch Logs and whose default policy grants
    // lambda:InvokeFunction on the inner onEventHandler Lambda's ARN using a
    // name:qualifier wildcard (Arn:*). Both shapes are fixed by the Provider
    // construct contract and cannot be narrowed from the consumer side.
    NagSuppressions.addResourceSuppressions(
      quotaCodesProvider,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "The CDK Provider framework Lambda uses the AWS-published AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs access. The Provider construct creates this framework function on the consumer's behalf and does not expose a hook to substitute a customer-managed log policy."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Resource::<WebAppUtilityQuotaCodesGeneratorLambda59936CC0.Arn>:*"
          ],
          reason:
            "The CDK Provider framework grants lambda:InvokeFunction on the inner onEventHandler Lambda using an ARN:version-qualifier wildcard (Arn:*) so it can invoke any published version or $LATEST of the handler. The qualifier wildcard is fixed by the Provider construct contract and the resource is scoped to the single quota codes generator Lambda."
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "The CDK Provider framework-onEvent Lambda has its runtime set by the aws-cdk-lib Provider construct internals; the consumer cannot override the framework Lambda's runtime without replacing the Provider. The framework runtime advances with aws-cdk-lib releases. Currently the framework Lambda uses a runtime that cdk-nag may flag as not-latest-family."
        }
      ],
      true
    );

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

    // Build the list of CORS origins for both the FastAPI middleware and the
    // bucket CORS rules emitted by ensure_bucket_cors(). The web app domain
    // is always included (passed in via props); localhost:3000 is added for
    // non-prod so the Next.js dev server can exercise the same CORS path.
    const corsOrigins = [...(props.corsAllowedOrigins ?? [])];
    if (!props.isProd && !corsOrigins.includes("http://localhost:3000")) {
      corsOrigins.push("http://localhost:3000");
    }

    // Build environment variables object
    const environment: { [key: string]: string } = {
      RESTRICT_BUCKET_ACCESS: this.config.restrictBucketAccess.toString(),
      ALLOWED_BUCKET_ARNS: (this.config.allowedBucketArns || []).join(","),
      ENABLE_CORS: (!props.isProd).toString(),
      CORS_ALLOWED_ORIGINS: corsOrigins.join(","),
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

    // This Lambda runs in a customer VPC so CDK auto-creates a Lambda service
    // role and attaches both AWSLambdaBasicExecutionRole (CloudWatch Logs)
    // and AWSLambdaVPCAccessExecutionRole (ENI lifecycle) managed policies.
    // The default policy on that role is built from multiple CDK grant
    // helpers plus an explicit s3:ListAllMyBuckets statement:
    //   - Bucket.grantRead() on the quota codes bucket and the detection
    //     bridge bucket each emit s3:GetObject* / s3:GetBucket* / s3:List*
    //     action-prefix wildcards together with a bucket/* object-ARN.
    //   - The s3:ListAllMyBuckets action accepts only Resource: * (S3
    //     service contract), so the bucket-browsing feature that lets a
    //     signed-in user enumerate their visible buckets in the web UI can
    //     only be expressed as Resource: *.
    //   - The bedrock:* / servicequotas:* / sagemaker:ListEndpoints / ec2
    //     ENI describe actions added inside addLambdaPermissions() are all
    //     account-scoped describe/list calls that likewise only accept
    //     Resource: *.
    NagSuppressions.addResourceSuppressions(
      webAppUtilityLambda,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing this managed policy with an inline customer-managed copy would duplicate the grant and drift whenever AWS updates the action set for CloudWatch Logs."
        },
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
          ],
          reason:
            "AWSLambdaVPCAccessExecutionRole is the AWS-published managed policy that allows the Lambda service to create and delete the Elastic Network Interfaces required to run this VPC-bound function. Replacing the managed policy with a customer-managed copy would duplicate the EC2 ENI action set without narrowing its scope."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Action::s3:GetObject*",
            "Action::s3:GetBucket*",
            "Action::s3:List*",
            "Resource::<WebAppUtilityQuotaCodesBucket7C6F13EF.Arn>/*",
            "Resource::<WebAppUtilityDetectionBridgeBucket18A00D2B.Arn>/*",
            "Resource::*"
          ],
          reason:
            "Bucket.grantRead() on the quota codes and detection bridge buckets emits s3:GetObject*, s3:GetBucket*, and s3:List* action-prefix wildcards together with bucket/* object-ARN wildcards scoped to those two buckets. The Resource: * entry covers s3:ListAllMyBuckets (S3 service contract requires Resource: * for the account-scoped bucket enumeration the web UI uses), bedrock:ListFoundationModels / GetFoundationModel / GetFoundationModelAvailability / InvokeModel*, servicequotas:GetServiceQuota / ListServiceQuotas, sagemaker:ListEndpoints, and the ec2 ENI describe actions required to attach a VPC-bound Lambda - all of which are account-scoped describe/list calls that only accept Resource: * per their respective service contracts."
        },
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to python3.13 to stay consistent with the shared web-app Lambda runtime policy. The pinned Python dependency set across the web-app Lambdas (boto3, botocore, fastapi, mangum, pydantic) uses versions whose native-wheel dependencies may not yet be compatible with python3.14; bumping this single handler to python3.14 would drift it from the rest of the fleet. python3.13 remains an AWS-supported Lambda runtime."
        }
      ],
      true
    );

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
      // Unrestricted mode (no allowedBucketArns configured): grant read-only
      // browsing across buckets. Mutating actions (s3:DeleteObject,
      // s3:PutBucketCors) are intentionally NOT granted on Resource "*"; they
      // are only available in restricted mode, scoped to allowedBucketArns.
      lambda.addToRolePolicy(
        new PolicyStatement({
          actions: [
            "s3:ListBucket",
            "s3:ListAllMyBuckets",
            "s3:GetObject",
            "s3:GetBucketCors"
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
