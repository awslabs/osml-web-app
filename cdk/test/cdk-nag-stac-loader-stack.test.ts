/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * cdk-nag compliance checks for the STAC Loader stack. The stack is
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

import { StacLoaderStack } from "../lib/stac-loader-stack";
import {
  createTestApp,
  createTestDeploymentConfig,
  createTestEnvironment,
  generateNagReport
} from "./test-utils";

describe("cdk-nag Compliance Checks - StacLoaderStack", () => {
  let app: App;
  let stack: StacLoaderStack;

  beforeAll(() => {
    app = createTestApp();
    const deployment = createTestDeploymentConfig();

    stack = new StacLoaderStack(app, "TestStacLoaderStack", {
      env: createTestEnvironment(),
      vpcId: deployment.networkConfig!.VPC_ID!,
      isProd: false,
      projectName: deployment.projectName,
      config: deployment.dataplaneConfig!.stacLoaderConfig,
      auth: {
        authority: deployment.dataplaneConfig!.authConfig!.authority,
        audience: deployment.dataplaneConfig!.authConfig!.audience
      },
      dataCatalogBaseUrl: deployment.dataplaneConfig!.STAC_CATALOG_URL
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
