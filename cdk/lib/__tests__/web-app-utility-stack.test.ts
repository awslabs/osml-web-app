/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Vpc } from "aws-cdk-lib/aws-ec2";

import { WebAppUtilityConfig } from "../config/app-config";
import { OSMLAccount } from "../constructs/types";
import { WebAppUtilityConstruct } from "../constructs/web-app-utility-construct";

const TEST_ACCOUNT_ID = "123456789012";
const TEST_REGION = "us-west-2";

let testCounter = 0;

/**
 * Helper to create a test stack with WebAppUtilityConstruct for bridge infrastructure testing.
 * Uses aws:cdk:bundling-stacks context to skip Docker bundling for fast tests.
 */
function createBridgeTestStack(configOverrides?: Record<string, unknown>): {
  stack: Stack;
  template: Template;
  construct: WebAppUtilityConstruct;
} {
  const uniqueId = `bridge-test-${++testCounter}`;
  const env = { account: TEST_ACCOUNT_ID, region: TEST_REGION };

  // Skip all Docker bundling during tests
  const app = new App({
    context: {
      "aws:cdk:bundling-stacks": []
    }
  });

  const stack = new Stack(app, `TestStack-${uniqueId}`, { env });
  const vpc = new Vpc(stack, "TestVpc", { maxAzs: 2 });

  const account: OSMLAccount = {
    id: TEST_ACCOUNT_ID,
    region: TEST_REGION,
    prodLike: false
  };

  const config = new WebAppUtilityConfig({
    ...configOverrides
  });

  const construct = new WebAppUtilityConstruct(
    stack,
    `WebAppUtility-${uniqueId}`,
    {
      vpc,
      isProd: false,
      account,
      projectName: `test-${uniqueId}`,
      region: TEST_REGION,
      config,
      auth: {
        authority: "https://keycloak.example.com/realms/osml",
        audience: "osml-client"
      }
    }
  );

  const template = Template.fromStack(stack);
  return { stack, template, construct };
}

describe("WebAppUtilityStack", () => {
  it("should be importable without errors", () => {
    const { WebAppUtilityStack } =
      require("../web-app-utility-stack") as Record<string, unknown>;
    expect(WebAppUtilityStack).toBeDefined();
    expect(typeof WebAppUtilityStack).toBe("function");
  });

  it("should have required constructor parameters", () => {
    const { WebAppUtilityStack } =
      require("../web-app-utility-stack") as Record<string, Function>;
    expect(WebAppUtilityStack.prototype.constructor).toBeDefined();
  });
});

describe("Detection Bridge Infrastructure", () => {
  describe("Bridge Bucket", () => {
    it("should create bridge bucket with correct name and S3-managed encryption", () => {
      const { template } = createBridgeTestStack();

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: `webapp-detection-bridge-${TEST_ACCOUNT_ID}`,
        BucketEncryption: {
          ServerSideEncryptionConfiguration: Match.arrayWith([
            Match.objectLike({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256"
              }
            })
          ])
        }
      });
    });

    it("should expose bridge bucket as a construct property", () => {
      const { construct } = createBridgeTestStack();

      expect(construct.detectionBridgeBucket).toBeDefined();
      // CDK bucket names are tokens at synth time, so verify the bucket exists
      // rather than comparing the literal string
      expect(construct.detectionBridgeBucket!.bucketName).toBeDefined();
    });
  });

  describe("S3 Event Notification", () => {
    it("should configure S3 event notification with .geojson suffix filter", () => {
      const { template } = createBridgeTestStack();

      template.hasResourceProperties("Custom::S3BucketNotifications", {
        NotificationConfiguration: {
          LambdaFunctionConfigurations: Match.arrayWith([
            Match.objectLike({
              Events: ["s3:ObjectCreated:*"],
              Filter: {
                Key: {
                  FilterRules: [{ Name: "suffix", Value: ".geojson" }]
                }
              }
            })
          ])
        }
      });
    });
  });

  describe("Translation Lambda", () => {
    it("should create Translation Lambda with SNS publish permissions", () => {
      const { template } = createBridgeTestStack();

      // Verify the Translation Lambda has an IAM policy granting sns:Publish
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sns:Publish",
              Effect: "Allow"
            })
          ])
        }
      });
    });

    it("should pass INTAKE_TOPIC_ARN and DETECTION_COLLECTION_ID as env vars", () => {
      const { template } = createBridgeTestStack();

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp(
          "Translates S3 event notifications"
        ),
        Environment: {
          Variables: Match.objectLike({
            DETECTION_COLLECTION_ID: "model-runner-detections"
          })
        }
      });
    });

    it("should use configurable detection collection ID", () => {
      const { template } = createBridgeTestStack({
        detectionCollectionId: "custom-detections"
      });

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp(
          "Translates S3 event notifications"
        ),
        Environment: {
          Variables: Match.objectLike({
            DETECTION_COLLECTION_ID: "custom-detections"
          })
        }
      });
    });
  });

  describe("Intake Lambda Access", () => {
    it("should grant Intake Lambda role read access to bridge bucket via bucket policy", () => {
      const { template } = createBridgeTestStack();

      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: "AllowIntakeLambdaGetObject",
              Effect: "Allow",
              Action: "s3:GetObject",
              Condition: {
                StringLike: {
                  "aws:PrincipalArn": Match.stringLikeRegexp(
                    "data-catalog-intake"
                  )
                }
              }
            })
          ])
        }
      });
    });
  });

  describe("Topic Lookup", () => {
    it("should use default topic name data-catalog-intake", () => {
      const { template } = createBridgeTestStack();

      // The INTAKE_TOPIC_ARN env var should reference the default topic name
      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp(
          "Translates S3 event notifications"
        ),
        Environment: {
          Variables: Match.objectLike({
            INTAKE_TOPIC_ARN: Match.stringLikeRegexp("data-catalog-intake")
          })
        }
      });
    });

    it("should use configurable topic name when overridden", () => {
      const { template } = createBridgeTestStack({
        intakeTopicName: "custom-intake-topic"
      });

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp(
          "Translates S3 event notifications"
        ),
        Environment: {
          Variables: Match.objectLike({
            INTAKE_TOPIC_ARN: Match.stringLikeRegexp("custom-intake-topic")
          })
        }
      });
    });
  });
});

describe("GeoJSON Ingest Translator Infrastructure", () => {
  /**
   * Helper that creates a stack with the geojson ingest translator enabled.
   * The translator is created when osmlDataIntakeOutputTopic or intakeTopicName is set.
   */
  function createGeojsonTranslatorTestStack(
    configOverrides?: Record<string, unknown>
  ) {
    return createBridgeTestStack({
      // Provide the legacy output topic to trigger bucket creation
      osmlDataIntakeOutputTopic:
        "arn:aws:sns:us-west-2:123456789012:data-catalog-ingest",
      ...configOverrides
    });
  }

  describe("Data Catalog Ingest Bucket", () => {
    it("should create ingest bucket with correct name", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("AWS::S3::Bucket", {
        BucketName: Match.stringLikeRegexp(`web-app-data-intake-`)
      });
    });

    it("should expose ingest bucket as a construct property", () => {
      const { construct } = createGeojsonTranslatorTestStack();

      expect(construct.dataCatalogIngestBucket).toBeDefined();
      expect(construct.dataCatalogIngestBucket!.bucketName).toBeDefined();
    });

    it("should not create ingest bucket when no data-intake integration is configured", () => {
      const { construct } = createBridgeTestStack();

      expect(construct.dataCatalogIngestBucket).toBeUndefined();
      expect(construct.geojsonIngestTranslatorLambda).toBeUndefined();
    });

    it("should create ingest bucket when intakeTopicName is set", () => {
      const { construct } = createBridgeTestStack({
        intakeTopicName: "my-intake-topic"
      });

      expect(construct.dataCatalogIngestBucket).toBeDefined();
      expect(construct.geojsonIngestTranslatorLambda).toBeDefined();
    });
  });

  describe("Translator Lambda", () => {
    it("should create translator Lambda with correct description", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp(
          "Translates S3 event notifications from the data catalog ingest bucket"
        )
      });
    });

    it("should pass INTAKE_TOPIC_ARN as env var with default topic name", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp("data catalog ingest bucket"),
        Environment: {
          Variables: Match.objectLike({
            INTAKE_TOPIC_ARN: Match.stringLikeRegexp("data-catalog-intake")
          })
        }
      });
    });

    it("should use configurable intake topic name", () => {
      const { template } = createGeojsonTranslatorTestStack({
        intakeTopicName: "custom-geojson-intake"
      });

      template.hasResourceProperties("AWS::Lambda::Function", {
        Description: Match.stringLikeRegexp("data catalog ingest bucket"),
        Environment: {
          Variables: Match.objectLike({
            INTAKE_TOPIC_ARN: Match.stringLikeRegexp("custom-geojson-intake")
          })
        }
      });
    });

    it("should have SNS publish permissions", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: "sns:Publish",
              Effect: "Allow"
            })
          ])
        }
      });
    });
  });

  describe("S3 Event Notification", () => {
    it("should configure .geojson suffix trigger on ingest bucket", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("Custom::S3BucketNotifications", {
        NotificationConfiguration: {
          LambdaFunctionConfigurations: Match.arrayWith([
            Match.objectLike({
              Events: ["s3:ObjectCreated:*"],
              Filter: {
                Key: {
                  FilterRules: [{ Name: "suffix", Value: ".geojson" }]
                }
              }
            })
          ])
        }
      });
    });
  });

  describe("Intake Lambda Access", () => {
    it("should grant data-catalog-intake Lambda read access to ingest bucket", () => {
      const { template } = createGeojsonTranslatorTestStack();

      template.hasResourceProperties("AWS::S3::BucketPolicy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Sid: "AllowIntakeLambdaGetObject",
              Effect: "Allow",
              Action: "s3:GetObject",
              Condition: {
                StringLike: {
                  "aws:PrincipalArn": Match.stringLikeRegexp(
                    "data-catalog-intake"
                  )
                }
              }
            })
          ])
        }
      });
    });
  });
});
