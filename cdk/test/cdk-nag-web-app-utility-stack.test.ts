/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * cdk-nag compliance checks for the Web App Utility services stack. The
 * stack is synthesized under a test app, AwsSolutionsChecks is applied
 * as a CDK aspect, and every AwsSolutions finding is collected via
 * Annotations.fromStack. Both assertions require zero unsuppressed
 * errors and zero unsuppressed warnings; every finding the stack
 * emits must either be remediated in the construct source or
 * accompanied by a scoped NagSuppressions entry with a justification.
 */

import "source-map-support/register";

import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";

import { WebAppUtilityConfig } from "../lib/config/app-config";
import { WebAppUtilityStack } from "../lib/web-app-utility-stack";
import {
  createTestApp,
  createTestDeploymentConfig,
  createTestEnvironment,
  generateNagReport
} from "./test-utils";

describe("cdk-nag Compliance Checks - WebAppUtilityStack", () => {
  let app: App;
  let stack: WebAppUtilityStack;

  beforeAll(() => {
    app = createTestApp();
    const deployment = createTestDeploymentConfig();

    const webAppUtilityConfig = new WebAppUtilityConfig({
      restrictBucketAccess:
        deployment.dataplaneConfig!.webAppUtilityConfig!.restrictBucketAccess,
      allowedBucketArns:
        deployment.dataplaneConfig!.webAppUtilityConfig!.allowedBucketArns,
      stacCatalogUrl: deployment.dataplaneConfig!.STAC_CATALOG_URL,
      osmlDataIntakeOutputTopic:
        deployment.dataplaneConfig!.DATA_INTAKE_OUTPUT_TOPIC_ARN
    });

    stack = new WebAppUtilityStack(app, "TestWebAppUtilityStack", {
      env: createTestEnvironment(),
      vpcId: deployment.networkConfig!.VPC_ID!,
      isProd: false,
      account: deployment.account,
      projectName: deployment.projectName,
      region: deployment.account.region,
      config: webAppUtilityConfig,
      auth: {
        authority: deployment.dataplaneConfig!.authConfig!.authority,
        audience: deployment.dataplaneConfig!.authConfig!.audience
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
