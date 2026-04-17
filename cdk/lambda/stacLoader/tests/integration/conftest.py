# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Pytest fixtures and configuration for STAC Loader integration tests.

These tests run as a Lambda function and communicate with the deployed
STAC Loader MCP server via its internal Application Load Balancer endpoint.

Requirements: 11.1, 11.2, 11.3
"""

import logging
import os
from urllib.parse import urlparse

import pytest

logger = logging.getLogger(__name__)


def pytest_configure(config):
    """Register custom markers for integration tests."""
    config.addinivalue_line("markers", "integration: mark test as an integration test")


@pytest.fixture(scope="session", autouse=True)
def configure_logging():
    """Configure logging level from environment variable."""
    log_level = os.environ.get("LOG_LEVEL", "INFO")
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )


@pytest.fixture(scope="session")
def alb_endpoint() -> str:
    """Get and validate the STAC Loader ALB endpoint URL from environment variables.

    Reads the STAC_LOADER_ALB_ENDPOINT environment variable, validates that it
    is a well-formed HTTP/HTTPS URL, and returns it for use by test fixtures.

    Requirements: 11.2, 11.3

    Returns:
        The validated ALB endpoint URL string.

    Raises:
        pytest.skip: If the environment variable is not set (not in Lambda env).
        pytest.fail: If the endpoint URL is malformed or uses an invalid scheme.
    """
    endpoint = os.environ.get("STAC_LOADER_ALB_ENDPOINT")
    if not endpoint:
        pytest.skip(
            "STAC_LOADER_ALB_ENDPOINT environment variable not set. "
            "This test must run in the integration test Lambda environment."
        )

    # Validate URL format
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("http", "https"):
        pytest.fail(
            f"STAC_LOADER_ALB_ENDPOINT has invalid scheme '{parsed.scheme}'. " f"Expected 'http' or 'https'. Got: {endpoint}"
        )
    if not parsed.hostname:
        pytest.fail(f"STAC_LOADER_ALB_ENDPOINT has no hostname. Got: {endpoint}")

    logger.info(f"Using ALB endpoint: {endpoint}")
    return endpoint


@pytest.fixture(scope="session")
def mcp_client(alb_endpoint):
    """Create a session-scoped MCPTestClient for the ALB endpoint.

    With the connect-per-call pattern, no async connect/disconnect is needed.
    Each tool call opens and closes its own connection.

    Requirements: 11.4
    """
    from tests.integration.test_client import MCPTestClient

    client = MCPTestClient(endpoint_url=alb_endpoint, timeout=120.0)
    logger.info(f"MCPTestClient ready for {alb_endpoint}")
    return client


@pytest.fixture
def test_collection_name(request):
    """Generate a unique collection name for test isolation.

    Uses the test node ID to create a deterministic but unique name,
    preventing collisions between concurrent test runs.

    Requirements: 11.4
    """
    # Derive a short, safe collection name from the test ID
    node_id = request.node.nodeid.replace("/", "-").replace("::", "-")
    # Truncate to keep it reasonable
    return f"integ-{node_id[:60]}"
