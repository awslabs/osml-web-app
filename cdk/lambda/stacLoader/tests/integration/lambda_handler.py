# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Lambda handler for running STAC Loader integration tests.

This Lambda function runs pytest-based integration tests against the
deployed STAC Loader MCP server via its internal ALB endpoint.
Test results are output to CloudWatch Logs.

Follows the same pattern as osml-geo-agents integration tests:
uses pytest.main() in-process with a TestResultCollector plugin.

Requirements: 11.1, 11.2, 11.3
"""

import logging
import os
import sys
from typing import Any, Dict

import pytest

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class TestResultCollector:
    """Pytest plugin to collect test results in memory."""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.errors = 0
        self.total = 0
        self.failures: list[str] = []

    def pytest_runtest_logreport(self, report):
        """Called for each test phase (setup, call, teardown)."""
        if report.when == "call":
            self.total += 1
            if report.passed:
                self.passed += 1
            elif report.failed:
                self.failed += 1
                self.failures.append(f"{report.nodeid}: {report.longreprtext[:500]}")
            elif report.skipped:
                self.skipped += 1
        elif report.when == "setup" and report.failed:
            self.errors += 1
            self.failures.append(f"SETUP ERROR {report.nodeid}: {report.longreprtext[:500]}")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Run integration tests and return results.

    The STAC_LOADER_ALB_ENDPOINT environment variable must be set to the
    ALB DNS name of the deployed STAC Loader.

    Requirements: 11.1, 11.2, 11.3
    """
    endpoint = os.environ.get("STAC_LOADER_ALB_ENDPOINT")
    if not endpoint:
        return {
            "status": "failure",
            "error": "STAC_LOADER_ALB_ENDPOINT environment variable not set",
        }

    logger.info("Running STAC Loader integration tests")
    logger.info(f"ALB Endpoint: {endpoint}")

    # Ensure the Lambda task root is on the Python path so that
    # 'tests.integration.*' imports resolve correctly.
    task_root = os.environ.get("LAMBDA_TASK_ROOT", os.getcwd())
    if task_root not in sys.path:
        sys.path.insert(0, task_root)

    collector = TestResultCollector()

    exit_code = pytest.main(
        [
            "-vv",
            "--tb=long",
            "--log-cli-level=INFO",
            "-p",
            "no:cacheprovider",
            "-p",
            "pytest_asyncio",
            "-o",
            "asyncio_mode=auto",
            os.path.join(task_root, "tests", "integration"),
            f"--ignore={os.path.join(task_root, 'tests', 'integration', 'lambda_handler.py')}",
        ],
        plugins=[collector],
    )

    success_pct = (collector.passed / collector.total * 100) if collector.total > 0 else 0.0

    logger.info("\nTest Summary\n-------------------------------------")
    logger.info(
        f"    Tests: {collector.total}, Passed: {collector.passed}, "
        f"Failed: {collector.failed}, Skipped: {collector.skipped}, "
        f"Errors: {collector.errors}, Success: {success_pct:.2f}%"
    )

    if collector.failures:
        logger.error("Failures:")
        for failure in collector.failures:
            logger.error(f"  - {failure}")

    result = {
        "status": "success" if exit_code == 0 else "failure",
        "summary": {
            "total": collector.total,
            "passed": collector.passed,
            "failed": collector.failed,
            "skipped": collector.skipped,
            "errors": collector.errors,
            "success_percentage": round(success_pct, 2),
        },
    }

    if exit_code == 0:
        result["message"] = f"All {collector.total} integration tests passed"
    else:
        result["error"] = f"{collector.failed} of {collector.total} integration tests failed"
        result["failures"] = collector.failures[:10]  # Cap at 10 for response size

    return result
