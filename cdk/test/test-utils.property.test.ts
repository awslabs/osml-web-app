/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * Property-based tests for the shared test-utilities module. These cases
 * use fast-check to assert universal properties over the factory merge
 * logic, the suppression extraction fold, the suppression round-trip
 * through the final report, the content-quality rules for suppression
 * reasons, and determinism of repeated extraction and report generation.
 */

import { App, CfnResource, Stack } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { randomUUID } from "crypto";
import fc from "fast-check";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  createTestDeploymentConfig,
  createTestEnvironment,
  extractSuppressedViolations,
  SuppressedNagViolation,
  writeSuppressedViolationsReportWithData
} from "./test-utils";

/**
 * Content-quality check for suppression reasons. Returns true when the
 * reason has at least twenty non-whitespace characters after trimming
 * and does not match one of the placeholder strings disallowed by the
 * suppression content rules.
 */
function isValidSuppressionReason(reason: string): boolean {
  const placeholderDenylist = new Set(["TODO", "N/A", "n/a", "fix later", ""]);
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (placeholderDenylist.has(trimmed)) {
    return false;
  }
  const nonWhitespace = reason.replace(/\s+/g, "");
  return nonWhitespace.length >= 20;
}

/**
 * Arbitrary for a generic AwsSolutions rule id.
 */
const ruleIdArb = fc.constantFrom(
  "AwsSolutions-S1",
  "AwsSolutions-IAM4",
  "AwsSolutions-IAM5",
  "AwsSolutions-L1",
  "AwsSolutions-SQS3",
  "AwsSolutions-SNS2",
  "AwsSolutions-APIG2",
  "AwsSolutions-CW1"
);

/**
 * Arbitrary for a reason string known to pass the content quality bar:
 * at least 20 non-whitespace characters, not a placeholder value.
 */
const validReasonArb = fc
  .string({ minLength: 40, maxLength: 200 })
  .filter((s) => isValidSuppressionReason(s));

/**
 * Silences stdout writes for the duration of the provided callback so
 * the property-test iterations do not flood the Jest output.
 */
function withSilencedStdout<T>(fn: () => T): T {
  const spy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation((): boolean => true);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

// No global afterEach cleanup: the property tests in this file do not
// write to the shared `.cdk-nag-suppressions-temp.json` file. They use
// direct in-memory data maps and tmpdir-scoped report paths, which
// means they never leak state into or out of the Jest-process-wide
// aggregation state that the cdk-nag test suites populate and that
// Jest's globalTeardown consumes to emit the consolidated report.

describe("test-utils property tests", () => {
  test("factory override-merge preserves both overrides and defaults", () => {
    const envOverrideArb = fc.record(
      {
        account: fc.string({ minLength: 12, maxLength: 12 }).map((s) =>
          // 12 digit account-like string
          s
            .split("")
            .map((c) => (c.charCodeAt(0) % 10).toString())
            .join("")
        ),
        region: fc.constantFrom(
          "us-east-1",
          "us-east-2",
          "us-west-1",
          "eu-west-1",
          "ap-southeast-1"
        )
      },
      { requiredKeys: [] }
    );

    fc.assert(
      fc.property(envOverrideArb, (override) => {
        const result = createTestEnvironment(override);
        // Overridden fields appear with the supplied value.
        if (override.account !== undefined) {
          expect(result.account).toBe(override.account);
        } else {
          expect(result.account).toBe("123456789012");
        }
        if (override.region !== undefined) {
          expect(result.region).toBe(override.region);
        } else {
          expect(result.region).toBe("us-west-2");
        }
      }),
      { numRuns: 100 }
    );

    const accountOverrideArb = fc.record({
      id: fc.string({ minLength: 12, maxLength: 12 }).map((s) =>
        s
          .split("")
          .map((c) => (c.charCodeAt(0) % 10).toString())
          .join("")
      ),
      region: fc.constantFrom("us-east-1", "eu-west-1", "us-west-2"),
      prodLike: fc.boolean(),
      isAdc: fc.boolean()
    });
    // The factory spreads overrides at the top level only for `account`,
    // `networkConfig`, and `dataplaneConfig` (and nested fields inside
    // those); `projectName` is a fixed default so it is not part of the
    // override arbitrary.
    const deploymentOverrideArb = fc.record(
      {
        account: accountOverrideArb,
        dataplaneConfig: fc.record(
          {
            TILE_SERVER_URL: fc
              .string({ minLength: 1, maxLength: 40 })
              .map((s) => `https://${encodeURIComponent(s)}.example`),
            STAC_CATALOG_URL: fc
              .string({ minLength: 1, maxLength: 40 })
              .map((s) => `https://${encodeURIComponent(s)}.example`),
            KINESIS_STREAM_NAME: fc.string({ minLength: 1, maxLength: 30 })
          },
          { requiredKeys: [] }
        )
      },
      { requiredKeys: [] }
    );

    fc.assert(
      fc.property(deploymentOverrideArb, (override) => {
        const result = createTestDeploymentConfig(override);

        // projectName is always the factory default.
        expect(result.projectName).toBe("test-project");

        // account merge: when override.account is provided it is a full
        // account object, so the result carries those values; otherwise
        // the default account is present.
        const defaultAccount = {
          id: "123456789012",
          region: "us-west-2",
          prodLike: false,
          isAdc: false
        };
        if (override.account !== undefined) {
          expect(result.account).toEqual(override.account);
        } else {
          expect(result.account).toEqual(defaultAccount);
        }

        // dataplaneConfig.TILE_SERVER_URL
        if (override.dataplaneConfig?.TILE_SERVER_URL !== undefined) {
          expect(result.dataplaneConfig?.TILE_SERVER_URL).toBe(
            override.dataplaneConfig.TILE_SERVER_URL
          );
        } else {
          expect(result.dataplaneConfig?.TILE_SERVER_URL).toBe(
            "https://test-tile-server.example.com"
          );
        }

        // dataplaneConfig.STAC_CATALOG_URL
        if (override.dataplaneConfig?.STAC_CATALOG_URL !== undefined) {
          expect(result.dataplaneConfig?.STAC_CATALOG_URL).toBe(
            override.dataplaneConfig.STAC_CATALOG_URL
          );
        } else {
          expect(result.dataplaneConfig?.STAC_CATALOG_URL).toBe(
            "https://test-stac-catalog.example.com"
          );
        }

        // dataplaneConfig.KINESIS_STREAM_NAME
        if (override.dataplaneConfig?.KINESIS_STREAM_NAME !== undefined) {
          expect(result.dataplaneConfig?.KINESIS_STREAM_NAME).toBe(
            override.dataplaneConfig.KINESIS_STREAM_NAME
          );
        } else {
          expect(result.dataplaneConfig?.KINESIS_STREAM_NAME).toBe(
            "test-mr-stream"
          );
        }

        // Non-overridden defaults still present.
        expect(result.dataplaneConfig?.MODEL_RUNNER_QUEUE_ARN).toBe(
          "arn:aws:sqs:us-west-2:123456789012:test-mr-queue"
        );
        expect(result.dataplaneConfig?.deployIntegrationTests).toBe(false);
        expect(result.networkConfig?.VPC_ID).toBe("vpc-12345678");
      }),
      { numRuns: 100 }
    );
  });

  test("extraction fold preserves every rules_to_suppress record", () => {
    const rulesArb = fc.array(
      fc.record({
        id: ruleIdArb,
        reason: validReasonArb,
        applies_to: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
          maxLength: 4
        })
      }),
      { maxLength: 5 }
    );

    // Each resource slot is either a rules array or null (no metadata).
    const resourceArb = fc.oneof(rulesArb, fc.constant(null));
    const resourcesArb = fc.array(resourceArb, { maxLength: 6 });

    fc.assert(
      fc.property(resourcesArb, (resources) => {
        const app = new App();
        const stack = new Stack(app, `ExtractTestStack-${randomUUID()}`);

        const inputRecords: Array<{
          id: string;
          reason: string;
          applies_to: string[];
        }> = [];

        resources.forEach((rules, idx) => {
          const cfn = new CfnResource(stack, `Res${idx}`, {
            type: "AWS::CloudFormation::WaitConditionHandle"
          });
          if (rules !== null) {
            cfn.cfnOptions.metadata = {
              cdk_nag: {
                rules_to_suppress: rules
              }
            };
            inputRecords.push(...rules);
          }
        });

        const extracted = extractSuppressedViolations(stack);

        expect(extracted.length).toBe(inputRecords.length);

        // Build a multiset-style comparison keyed on (rule, reason,
        // appliesTo) since resource ordering is not guaranteed.
        const toKey = (r: string, reason: string, applies: string[]): string =>
          JSON.stringify({ r, reason, applies: applies ?? [] });

        const inputCounts = new Map<string, number>();
        for (const rec of inputRecords) {
          const key = toKey(rec.id, rec.reason, rec.applies_to);
          inputCounts.set(key, (inputCounts.get(key) ?? 0) + 1);
        }

        const extractedCounts = new Map<string, number>();
        for (const e of extracted) {
          const key = toKey(e.rule, e.reason, e.appliesTo ?? []);
          extractedCounts.set(key, (extractedCounts.get(key) ?? 0) + 1);
        }

        expect(extractedCounts.size).toBe(inputCounts.size);
        for (const [k, v] of inputCounts) {
          expect(extractedCounts.get(k)).toBe(v);
        }

        // Every extracted entry carries the stack name.
        for (const e of extracted) {
          expect(e.stackName).toBe(stack.stackName);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("suppressions round-trip from source to report with no loss", () => {
    type SuppressionInput = {
      stackName: string;
      resourceId: string;
      rule: string;
      reason: string;
      appliesTo: string[];
    };

    const suppressionInputArb = fc.record({
      stackName: fc
        .string({ minLength: 1, maxLength: 10 })
        .map((s) => `Stack${s.replace(/[^a-zA-Z0-9]/g, "")}`)
        .filter((s) => s.length > 5),
      resourceId: fc
        .string({ minLength: 1, maxLength: 10 })
        .map((s) => `Res${s.replace(/[^a-zA-Z0-9]/g, "")}`)
        .filter((s) => s.length > 3),
      rule: ruleIdArb,
      reason: validReasonArb,
      appliesTo: fc.array(fc.string({ minLength: 1, maxLength: 15 }), {
        maxLength: 3
      })
    });

    const inputsArb = fc.array(suppressionInputArb, {
      minLength: 1,
      maxLength: 6
    });

    fc.assert(
      fc.property(inputsArb, (inputs: SuppressionInput[]) => {
        // Group inputs by stack name so each logical stack materialises
        // as one real Stack with all of its suppressed resources.
        const byStack = new Map<string, SuppressionInput[]>();
        for (const inp of inputs) {
          if (!byStack.has(inp.stackName)) {
            byStack.set(inp.stackName, []);
          }
          byStack.get(inp.stackName)!.push(inp);
        }

        // A resourceId may repeat per (stackName, resourceId); collapse
        // duplicates so we create one CfnResource per logical resource
        // and stack suppressions onto it.
        const stacksCreated: Stack[] = [];
        for (const [stackName, stackInputs] of byStack.entries()) {
          const app = new App();
          const stack = new Stack(app, stackName);
          stacksCreated.push(stack);

          const resourceIds = new Set<string>();
          for (const inp of stackInputs) {
            if (!resourceIds.has(inp.resourceId)) {
              new CfnResource(stack, inp.resourceId, {
                type: "AWS::CloudFormation::WaitConditionHandle"
              });
              resourceIds.add(inp.resourceId);
            }
          }

          for (const inp of stackInputs) {
            NagSuppressions.addResourceSuppressions(
              stack.node.findChild(inp.resourceId),
              [
                {
                  id: inp.rule,
                  reason: inp.reason,
                  appliesTo:
                    inp.appliesTo.length > 0 ? inp.appliesTo : undefined
                }
              ]
            );
          }
        }

        // Extract the suppressions from every stack directly into an
        // in-memory map and generate the report from that map. This
        // deliberately bypasses `generateNagReport` (which would append
        // to the shared `.cdk-nag-suppressions-temp.json` file used by
        // the cdk-nag test suites) and also bypasses the
        // temp-file-reading branch of `generateFinalSuppressedViolationsReport`.
        // The result: this property never reads from, writes to, or
        // deletes the Jest-process-wide aggregation file, so it cannot
        // be contaminated by sibling test suites and cannot contaminate
        // the consolidated report that Jest's globalTeardown emits.
        const violationsByStack = new Map<string, SuppressedNagViolation[]>();
        for (const stack of stacksCreated) {
          const extracted = extractSuppressedViolations(stack);
          if (!violationsByStack.has(stack.stackName)) {
            violationsByStack.set(stack.stackName, []);
          }
          violationsByStack.get(stack.stackName)!.push(...extracted);
        }

        const reportPath = join(tmpdir(), `suppressions-${randomUUID()}.txt`);

        try {
          withSilencedStdout(() => {
            writeSuppressedViolationsReportWithData(
              violationsByStack,
              reportPath
            );
          });

          expect(existsSync(reportPath)).toBe(true);
          const report = readFileSync(reportPath, "utf-8");

          // Header totals.
          const distinctStackNames = new Set(inputs.map((i) => i.stackName));
          expect(report).toContain(`Total Stacks: ${distinctStackNames.size}`);
          expect(report).toContain(
            `Total Suppressed Violations: ${inputs.length}`
          );

          // Every input tuple is findable.
          for (const inp of inputs) {
            expect(report).toContain(`Stack: ${inp.stackName}`);
            expect(report).toContain(inp.resourceId);
            expect(report).toContain(inp.reason);
            if (inp.appliesTo.length > 0) {
              expect(report).toContain(
                `Applies To: ${inp.appliesTo.join(", ")}`
              );
            }
          }

          // Summary-by-rule occurrence counts and descending-count order.
          const ruleCounts = new Map<string, number>();
          for (const inp of inputs) {
            ruleCounts.set(inp.rule, (ruleCounts.get(inp.rule) ?? 0) + 1);
          }

          const summaryHeader = "Summary by Rule";
          const summaryStart = report.indexOf(summaryHeader);
          expect(summaryStart).toBeGreaterThan(-1);
          const afterSummary = report.slice(summaryStart);

          // Each rule appears with its correct count in the summary.
          for (const [rule, count] of ruleCounts.entries()) {
            const pattern = new RegExp(
              `${rule.replace(/-/g, "\\-")}:\\s*${count}\\s+suppression`
            );
            expect(pattern.test(afterSummary)).toBe(true);
          }

          // Extract summary lines in order and verify non-increasing counts.
          const lineRegex =
            /^(AwsSolutions-[A-Za-z0-9]+):\s*(\d+)\s+suppression/gm;
          const foundCounts: number[] = [];
          let match: RegExpExecArray | null;
          // Scope to the summary portion by stopping at the next big
          // separator after the summary header but before the first
          // per-stack detail section.
          const summaryEnd = afterSummary.indexOf("\nStack: ");
          const summarySection =
            summaryEnd > -1 ? afterSummary.slice(0, summaryEnd) : afterSummary;
          while ((match = lineRegex.exec(summarySection)) !== null) {
            foundCounts.push(parseInt(match[2], 10));
          }
          for (let i = 1; i < foundCounts.length; i++) {
            expect(foundCounts[i - 1]).toBeGreaterThanOrEqual(foundCounts[i]);
          }
        } finally {
          if (existsSync(reportPath)) {
            unlinkSync(reportPath);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  test("every suppression reason passes content quality bars", () => {
    // Any generated string of length >= 20 whose non-whitespace length
    // is also >= 20 and which is not a placeholder must be classified
    // as passing by the content-rule function.
    fc.assert(
      fc.property(
        fc.string({ minLength: 20, maxLength: 300 }),
        (reason: string) => {
          const trimmed = reason.trim();
          const nonWhitespaceLen = reason.replace(/\s+/g, "").length;
          const isPlaceholder =
            trimmed === "" ||
            trimmed === "TODO" ||
            trimmed === "N/A" ||
            trimmed === "n/a" ||
            trimmed === "fix later";
          const shouldPass = nonWhitespaceLen >= 20 && !isPlaceholder;
          expect(isValidSuppressionReason(reason)).toBe(shouldPass);
        }
      ),
      { numRuns: 100 }
    );

    // Any value in the placeholder denylist must be classified as failing.
    const placeholderArb = fc.constantFrom(
      "TODO",
      "N/A",
      "n/a",
      "fix later",
      "",
      "   ",
      "\t\n   \t"
    );
    fc.assert(
      fc.property(placeholderArb, (placeholder: string) => {
        expect(isValidSuppressionReason(placeholder)).toBe(false);
      }),
      { numRuns: 100 }
    );

    // Any string shorter than 20 non-whitespace characters must fail.
    const shortReasonArb = fc
      .string({ maxLength: 40 })
      .filter((s) => s.replace(/\s+/g, "").length < 20);
    fc.assert(
      fc.property(shortReasonArb, (reason: string) => {
        expect(isValidSuppressionReason(reason)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test("extraction and report generation are deterministic", () => {
    const inputsArb = fc.array(
      fc.record({
        resourceId: fc
          .string({ minLength: 1, maxLength: 10 })
          .map((s) => `Res${s.replace(/[^a-zA-Z0-9]/g, "")}`)
          .filter((s) => s.length > 3),
        rule: ruleIdArb,
        reason: validReasonArb,
        appliesTo: fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
          maxLength: 3
        })
      }),
      { minLength: 1, maxLength: 5 }
    );

    fc.assert(
      fc.property(inputsArb, (inputs) => {
        const app = new App();
        const stack = new Stack(app, `DetermStack-${randomUUID()}`);

        const seen = new Set<string>();
        for (const inp of inputs) {
          if (!seen.has(inp.resourceId)) {
            new CfnResource(stack, inp.resourceId, {
              type: "AWS::CloudFormation::WaitConditionHandle"
            });
            seen.add(inp.resourceId);
          }
        }
        for (const inp of inputs) {
          NagSuppressions.addResourceSuppressions(
            stack.node.findChild(inp.resourceId),
            [
              {
                id: inp.rule,
                reason: inp.reason,
                appliesTo: inp.appliesTo.length > 0 ? inp.appliesTo : undefined
              }
            ]
          );
        }

        // Within-process determinism: two back-to-back extractions match.
        const firstExtract: SuppressedNagViolation[] =
          extractSuppressedViolations(stack);
        const secondExtract: SuppressedNagViolation[] =
          extractSuppressedViolations(stack);
        expect(secondExtract).toEqual(firstExtract);

        // Cross-run approximation: generate two reports from the same
        // in-memory data map and compare byte-for-byte modulo the
        // timestamp line. This bypasses the shared temp file entirely,
        // so it cannot be contaminated by sibling test suites and
        // cannot contaminate the Jest-global aggregation state that
        // feeds the consolidated Suppressions_Report.
        const violationsByStack = new Map<string, SuppressedNagViolation[]>([
          [stack.stackName, firstExtract]
        ]);

        const reportPathA = join(tmpdir(), `rpt-a-${randomUUID()}.txt`);
        withSilencedStdout(() => {
          writeSuppressedViolationsReportWithData(
            violationsByStack,
            reportPathA
          );
        });

        const reportPathB = join(tmpdir(), `rpt-b-${randomUUID()}.txt`);
        withSilencedStdout(() => {
          writeSuppressedViolationsReportWithData(
            violationsByStack,
            reportPathB
          );
        });

        try {
          const textA = readFileSync(reportPathA, "utf-8").replace(
            /^Generated: .*$/m,
            "Generated: <timestamp>"
          );
          const textB = readFileSync(reportPathB, "utf-8").replace(
            /^Generated: .*$/m,
            "Generated: <timestamp>"
          );
          expect(textB).toBe(textA);
        } finally {
          if (existsSync(reportPathA)) unlinkSync(reportPathA);
          if (existsSync(reportPathB)) unlinkSync(reportPathB);
        }
      }),
      { numRuns: 100 }
    );
  });
});
