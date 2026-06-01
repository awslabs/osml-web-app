/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * cdk-nag compliance checks for the Web App stack. The stack is
 * synthesized under a test app, AwsSolutionsChecks is applied as a CDK
 * aspect, and every AwsSolutions finding is collected via
 * Annotations.fromStack. Both assertions require zero unsuppressed
 * errors and zero unsuppressed warnings; every finding the stack
 * emits must either be remediated in the construct source or
 * accompanied by a scoped NagSuppressions entry with a justification.
 */

import "source-map-support/register";

import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";

import { WebAppStack } from "../lib/web-ui-stack";
import {
  createTestApp,
  createTestDeploymentConfig,
  createTestEnvironment,
  generateNagReport,
  TEST_FABRICATED
} from "./test-utils";

describe("cdk-nag Compliance Checks - WebAppStack", () => {
  let app: App;
  let stack: WebAppStack;

  beforeAll(() => {
    app = createTestApp();
    const deployment = createTestDeploymentConfig();

    stack = new WebAppStack(app, "TestWebAppStack", {
      env: createTestEnvironment(),
      vpcId: deployment.networkConfig!.VPC_ID!,
      isProd: false,
      account: deployment.account,
      projectName: deployment.projectName,
      config: {
        buildFromSource: false,
        artifactUrl: deployment.dataplaneConfig!.webAppConfig!.artifactUrl,
        hostedZone: deployment.dataplaneConfig!.webAppConfig!.hostedZone,
        domainName: deployment.dataplaneConfig!.webAppConfig!.domainName,
        authSuccessUrl:
          deployment.dataplaneConfig!.webAppConfig!.authSuccessUrl,
        tileServerUrl: deployment.dataplaneConfig!.TILE_SERVER_URL,
        stacCatalogUrl: deployment.dataplaneConfig!.STAC_CATALOG_URL,
        mcpDefaultServers:
          deployment.dataplaneConfig!.MCP_DEFAULT_SERVERS ?? [],
        webAppUtilityUrl: TEST_FABRICATED.webAppUtilityUrl,
        modelRunnerApiUrl: TEST_FABRICATED.modelRunnerApiUrl,
        authority: deployment.dataplaneConfig!.authConfig!.authority,
        detectionBridgeBucket: TEST_FABRICATED.detectionBridgeBucketName,
        kinesisStreamName: TEST_FABRICATED.kinesisStreamName
      }
    });

    Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));

    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*")
    );
    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*")
    );
    generateNagReport(stack, errors, warnings);
  });

  test("No unsuppressed Warnings", () => {
    const warnings = Annotations.fromStack(stack).findWarning(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*")
    );
    expect(warnings).toHaveLength(0);
  });

  test("No unsuppressed Errors", () => {
    const errors = Annotations.fromStack(stack).findError(
      "*",
      Match.stringLikeRegexp("AwsSolutions-.*")
    );
    expect(errors).toHaveLength(0);
  });
});
