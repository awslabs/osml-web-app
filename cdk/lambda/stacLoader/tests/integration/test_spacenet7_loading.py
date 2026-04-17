# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Integration tests for loading STAC items from the SpaceNet7 catalog.

These tests validate the deployed STAC Loader MCP server against the
publicly accessible SpaceNet7 catalog from Planet.com. Item URLs are
dynamically selected from the collection at test time rather than
hardcoded, making the tests resilient to catalog changes.

Requirements: 9.2, 9.3, 9.4, 9.5
"""

import logging
import random

import httpx
import pytest
from tests.integration.response_validator import validate_full_response
from tests.integration.test_client import MCPTestClient

logger = logging.getLogger(__name__)

# SpaceNet7 train source collection (returns valid JSON, unlike test source)
SPACENET7_COLLECTION_URL = "https://www.planet.com/data/stac/spacenet7/sn7_train_source/collection.json"


@pytest.fixture(scope="session")
def spacenet7_item_urls() -> list[str]:
    """Fetch the SpaceNet7 collection and randomly select item URLs.

    Fetches the collection once per session, extracts all item links,
    and returns a random sample for use across tests.

    Returns:
        List of 3 randomly selected item URLs from the collection.

    Raises:
        pytest.fail: If the collection cannot be fetched or has no items.
    """
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(SPACENET7_COLLECTION_URL)
            response.raise_for_status()
            collection = response.json()
    except Exception as e:
        pytest.fail(f"Failed to fetch SpaceNet7 collection from " f"{SPACENET7_COLLECTION_URL}: {e}")

    item_links = [link["href"] for link in collection.get("links", []) if link.get("rel") == "item" and "href" in link]

    if len(item_links) < 3:
        pytest.fail(f"SpaceNet7 collection has only {len(item_links)} items, " f"need at least 3 for integration tests")

    selected = random.sample(item_links, 3)
    logger.info(f"Selected {len(selected)} random items from " f"{len(item_links)} in SpaceNet7 collection")
    for url in selected:
        logger.info(f"  - {url}")

    return selected


class TestLoadIndividualItems:
    """Test loading individual STAC items from SpaceNet7 catalog.

    Requirements: 9.2, 9.4
    """

    async def test_load_single_item(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Load a single STAC item and verify it is accessible."""
        url = spacenet7_item_urls[0]
        logger.info(f"Testing single item load: {url}")
        result = await mcp_client.call_load_stac_items(
            urls=[url],
            fetch_assets="none",
        )

        validate_full_response(result, expected_successful=1, expected_failed=0)

        item = result["successful"][0]
        assert item["url"] == url
        assert len(item["stac_reference"]) > 0

    async def test_load_single_item_with_collection(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Load a single item into a named collection."""
        logger.info(f"Testing single item with collection: {spacenet7_item_urls[1]}")
        result = await mcp_client.call_load_stac_items(
            urls=[spacenet7_item_urls[1]],
            collection="integration-test-collection",
            fetch_assets="none",
        )

        validate_full_response(result, expected_successful=1, expected_failed=0)


class TestLoadMultipleItems:
    """Test loading multiple STAC items in a single request.

    Requirements: 9.3
    """

    async def test_load_multiple_items(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Load multiple STAC items in one request."""
        urls = spacenet7_item_urls[:2]
        logger.info(f"Testing multiple item load: {urls}")
        result = await mcp_client.call_load_stac_items(
            urls=urls,
            fetch_assets="none",
        )

        validate_full_response(result, expected_successful=len(urls), expected_failed=0)

        returned_urls = {item["url"] for item in result["successful"]}
        for url in urls:
            assert url in returned_urls, f"URL {url} not found in results"

    async def test_load_multiple_items_with_collection(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Load multiple items into a named collection."""
        urls = spacenet7_item_urls[:2]
        logger.info(f"Testing multiple items with collection: {urls}")
        result = await mcp_client.call_load_stac_items(
            urls=urls,
            collection="multi-item-test",
            fetch_assets="none",
        )

        validate_full_response(result, expected_successful=len(urls))


class TestMetadataOnlyMode:
    """Test metadata-only mode (fetch_assets='none').

    Requirements: 9.5
    """

    async def test_metadata_only_no_assets_fetched(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Verify no assets are fetched when fetch_assets='none'."""
        logger.info(f"Testing metadata-only mode: {spacenet7_item_urls[2]}")
        result = await mcp_client.call_load_stac_items(
            urls=[spacenet7_item_urls[2]],
            fetch_assets="none",
        )

        validate_full_response(result, expected_successful=1, expected_failed=0)

        item = result["successful"][0]
        assert item["successful_assets"] == []
        assert item["failed_assets"] == {}

        stats = result["asset_statistics"]
        assert stats["successful_assets"] == 0
        assert stats["failed_assets"] == 0

    async def test_default_mode_is_metadata_only(self, mcp_client: MCPTestClient, spacenet7_item_urls: list[str]):
        """Verify default fetch mode fetches no assets (same as 'none')."""
        logger.info(f"Testing default mode: {spacenet7_item_urls[2]}")
        result = await mcp_client.call_load_stac_items(
            urls=[spacenet7_item_urls[2]],
        )

        validate_full_response(result, expected_successful=1, expected_failed=0)

        item = result["successful"][0]
        assert item["successful_assets"] == []
        assert item["failed_assets"] == {}
