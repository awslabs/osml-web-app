/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * Example-based tests for the shared test-utilities module. These cases
 * verify the concrete, non-property-based acceptance criteria for the
 * helpers exported from test-utils.ts: App factory distinctness, VPC
 * availability-zone count, stdout summary content in the Nag report,
 * the default-exported teardown being a function, and the temp-file
 * cleanup behavior of the final report generator.
 */

import { App, Stack } from "aws-cdk-lib";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import teardown, {
  createTestApp,
  createTestVpc,
  generateFinalSuppressedViolationsReport,
  generateNagReport
} from "./test-utils";

const TEMP_SUPPRESSIONS_FILE = join(
  process.cwd(),
  ".cdk-nag-suppressions-temp.json"
);

describe("test-utils helpers", () => {
  // Snapshot the shared temp suppressions file before any test in this
  // describe block runs so the tests in this file can exercise
  // `generateNagReport` and `generateFinalSuppressedViolationsReport`
  // (both of which write to or delete the shared file as part of their
  // contract) without destroying the aggregation state that the
  // cdk-nag test suites populate and that Jest's globalTeardown
  // consumes to emit the consolidated Suppressions_Report.
  let tempFileSnapshot: string | null = null;

  beforeAll(() => {
    tempFileSnapshot = existsSync(TEMP_SUPPRESSIONS_FILE)
      ? readFileSync(TEMP_SUPPRESSIONS_FILE, "utf-8")
      : null;
  });

  afterAll(() => {
    if (tempFileSnapshot !== null) {
      writeFileSync(TEMP_SUPPRESSIONS_FILE, tempFileSnapshot, "utf-8");
    } else if (existsSync(TEMP_SUPPRESSIONS_FILE)) {
      unlinkSync(TEMP_SUPPRESSIONS_FILE);
    }
  });

  test("createTestApp returns a distinct App instance on each call", () => {
    const first = createTestApp();
    const second = createTestApp();

    expect(first).toBeInstanceOf(App);
    expect(second).toBeInstanceOf(App);
    expect(first).not.toBe(second);
  });

  test("createTestVpc produces a VPC with two availability zones", () => {
    const app = createTestApp();
    const stack = new Stack(app, "ThrowawayStackForVpc");

    const vpc = createTestVpc(stack);

    expect(vpc.availabilityZones.length).toBe(2);
  });

  test("generateNagReport writes a compliance summary to stdout", () => {
    const app = createTestApp();
    const stack = new Stack(app, "ReportSummaryTestStack");

    const writes: string[] = [];
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });

    try {
      generateNagReport(stack, [], []);
    } finally {
      spy.mockRestore();
    }

    const captured = writes.join("");

    expect(captured).toContain("CDK-NAG Compliance Report");
    expect(captured).toContain(stack.stackName);
    expect(captured).toContain("Total Errors: 0");
    expect(captured).toContain("Total Warnings: 0");
    expect(captured).toContain("Total Suppressed: 0");

    // The temp file is restored to its pre-suite snapshot by the
    // afterAll hook, so the `ReportSummaryTestStack: []` entry this
    // test just appended will be scrubbed before subsequent test
    // suites (and Jest's globalTeardown) observe the temp file.
  });

  test("teardown default export exists and is a function", () => {
    expect(typeof teardown).toBe("function");
  });

  test("generateFinalSuppressedViolationsReport deletes the temp file", () => {
    const stagedSuppressions = {
      TestStack: [
        {
          rule: "AwsSolutions-S1",
          resource: "Bucket",
          reason:
            "Test reason long enough to pass content quality checks and explain the technical constraint",
          appliesTo: [],
          stackName: "TestStack"
        }
      ]
    };
    writeFileSync(
      TEMP_SUPPRESSIONS_FILE,
      JSON.stringify(stagedSuppressions),
      "utf-8"
    );
    expect(existsSync(TEMP_SUPPRESSIONS_FILE)).toBe(true);

    const reportPath = join(tmpdir(), `test-report-${randomUUID()}.txt`);

    // Silence the stdout message emitted by the function under test so
    // the Jest output stays clean; we care about the filesystem effect.
    const stdoutSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((): boolean => true);

    try {
      generateFinalSuppressedViolationsReport(reportPath);
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(existsSync(TEMP_SUPPRESSIONS_FILE)).toBe(false);

    // Clean up the generated report file so it does not leak into /tmp.
    if (existsSync(reportPath)) {
      unlinkSync(reportPath);
    }
  });
});
