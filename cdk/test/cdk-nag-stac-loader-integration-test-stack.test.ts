/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * cdk-nag compliance checks for the STAC Loader integration test stack.
 * The stack is synthesized under a test app, AwsSolutionsChecks is
 * applied as a CDK aspect, and every AwsSolutions finding is collected
 * via Annotations.fromStack. Both assertions require zero unsuppressed
 * errors and zero unsuppressed warnings; every finding the stack
 * emits must either be remediated in the construct source or
 * accompanied by a scoped NagSuppressions entry with a justification.
 */

import "source-map-support/register";

import { App, Aspects } from "aws-cdk-lib";
import { Annotations, Match } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";

import { StacLoaderIntegrationTestStack } from "../lib/stac-loader-integration-test-stack";
import {
  createTestApp,
  createTestDeploymentConfig,
  createTestEnvironment,
  generateNagReport,
  TEST_FABRICATED
} from "./test-utils";

describe("cdk-nag Compliance Checks - StacLoaderIntegrationTestStack", () => {
  let app: App;
  let stack: StacLoaderIntegrationTestStack;

  beforeAll(() => {
    app = createTestApp();
    const deployment = createTestDeploymentConfig();

    stack = new StacLoaderIntegrationTestStack(
      app,
      "TestStacLoaderIntegrationTestStack",
      {
        env: createTestEnvironment(),
        vpcId: deployment.networkConfig!.VPC_ID!,
        stacLoaderAlbDnsName: TEST_FABRICATED.stacLoaderAlbDnsName,
        projectName: deployment.projectName,
        isProd: false
      }
    );

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
