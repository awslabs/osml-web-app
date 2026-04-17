# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Stress tests for the STAC Loader MCP server.

These tests validate that the deployed service can handle larger batch
loads without socket contention (EBUSY) or resource exhaustion. They
exercise the full async job pattern (load_stac_items + get_load_status
polling) under sustained load, which was the scenario that triggered
the original [Errno 16] Device or resource busy failure.

The tests use the SpaceNet7 catalog as a source of real STAC items,
selecting random samples to avoid hardcoding URLs.
"""

import logging
import random
import time

import httpx
import pytest
from tests.integration.response_validator import validate_full_response
from tests.integration.test_client import MCPTestClient

logger = logging.getLogger(__name__)

SPACENET7_COLLECTION_URL = "https://www.planet.com/data/stac/spacenet7/sn7_train_source/collection.json"

# Batch sizes for stress tests
MEDIUM_BATCH_SIZE = 25
LARGE_BATCH_SIZE = 50


@pytest.fixture(scope="session")
def spacenet7_stress_urls() -> list[str]:
    """Fetch the SpaceNet7 collection and select items for stress testing.

    Returns a pool of item URLs large enough for the largest batch test.

    Returns:
        List of randomly selected item URLs.

    Raises:
        pytest.fail: If the collection cannot be fetched or has too few items.
    """
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(SPACENET7_COLLECTION_URL)
            response.raise_for_status()
            collection = response.json()
    except Exception as e:
        pytest.fail(f"Failed to fetch SpaceNet7 collection: {e}")

    item_links = [link["href"] for link in collection.get("links", []) if link.get("rel") == "item" and "href" in link]

    required = LARGE_BATCH_SIZE
    if len(item_links) < required:
        pytest.skip(f"SpaceNet7 collection has only {len(item_links)} items, " f"need at least {required} for stress tests")

    selected = random.sample(item_links, required)
    logger.info(f"Selected {len(selected)} items from {len(item_links)} " f"for stress testing")
    return selected


class TestMediumBatchLoad:
    """Load a medium batch (25 items) to validate sustained throughput."""

    async def test_load_25_items(
        self,
        mcp_client: MCPTestClient,
        spacenet7_stress_urls: list[str],
    ):
        """Load 25 STAC items in a single job and verify all succeed."""
        urls = spacenet7_stress_urls[:MEDIUM_BATCH_SIZE]
        logger.info(f"Stress test: loading {len(urls)} items")

        start = time.time()
        result = await mcp_client.call_load_stac_items(
            urls=urls,
            collection="stress-test-medium",
            fetch_assets="none",
        )
        elapsed = time.time() - start

        logger.info(f"Medium batch completed in {elapsed:.1f}s " f"({len(urls) / elapsed:.1f} items/s)")

        validate_full_response(result, expected_successful=len(urls), expected_failed=0)

        # Verify all URLs are accounted for
        returned_urls = {item["url"] for item in result["successful"]}
        for url in urls:
            assert url in returned_urls, f"URL {url} missing from results"


class TestLargeBatchLoad:
    """Load a large batch (50 items) to stress the service."""

    async def test_load_50_items(
        self,
        mcp_client: MCPTestClient,
        spacenet7_stress_urls: list[str],
    ):
        """Load 50 STAC items in a single job and verify all succeed.

        This is the primary regression test for the EBUSY socket
        contention fix. The original failure occurred at 9 items;
        50 items provides a strong confidence margin.
        """
        urls = spacenet7_stress_urls[:LARGE_BATCH_SIZE]
        logger.info(f"Stress test: loading {len(urls)} items")

        start = time.time()
        result = await mcp_client.call_load_stac_items(
            urls=urls,
            collection="stress-test-large",
            fetch_assets="none",
        )
        elapsed = time.time() - start

        logger.info(f"Large batch completed in {elapsed:.1f}s " f"({len(urls) / elapsed:.1f} items/s)")

        validate_full_response(result, expected_successful=len(urls), expected_failed=0)

        returned_urls = {item["url"] for item in result["successful"]}
        for url in urls:
            assert url in returned_urls, f"URL {url} missing from results"

        # Log throughput for performance tracking
        stats = result.get("asset_statistics", {})
        logger.info(
            f"Asset stats: {stats.get('successful_assets', 0)} successful, " f"{stats.get('failed_assets', 0)} failed"
        )
