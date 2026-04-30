/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * cdk-nag compliance checks for the Model Runner API stack.
 *
 * Synthesizes the stack, applies AwsSolutionsChecks, and fails the build
 * if any unsuppressed AwsSolutions error or warning is surfaced.
 */

import "source-map-support/register";

import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";

import { ModelRunnerApiConfig } from "../lib/config/app-config";
import { ModelRunnerApiStack } from "../lib/model-runner-api-stack";
import {
  createTestApp,
  createTestDeploymentConfig,
  createTestEnvironment,
  generateNagReport
} from "./test-utils";

describe("cdk-nag Compliance Checks - ModelRunnerApiStack", () => {
  let app: App;
  let stack: ModelRunnerApiStack;

  beforeAll(() => {
    app = createTestApp();
    const deployment = createTestDeploymentConfig();

    const modelRunnerApiConfig = new ModelRunnerApiConfig({
      modelRunnerImageRequestQueueArn:
        deployment.dataplaneConfig!.MODEL_RUNNER_QUEUE_ARN!,
      modelRunnerStatusTopicArn:
        deployment.dataplaneConfig!.MODEL_RUNNER_STATUS_TOPIC_ARN!
    });

    stack = new ModelRunnerApiStack(app, "TestModelRunnerApiStack", {
      env: createTestEnvironment(),
      vpcId: deployment.networkConfig!.VPC_ID!,
      isProd: false,
      projectName: deployment.projectName,
      config: modelRunnerApiConfig,
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
