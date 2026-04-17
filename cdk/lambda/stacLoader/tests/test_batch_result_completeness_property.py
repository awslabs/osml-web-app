#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 15: Batch Result Completeness

For any batch operation with N URLs resulting in S successes and F failures
(where S + F = N), the result SHALL contain exactly S successful STACReferences
and exactly F failed URLs with error details.

**Validates: Requirements 7.5**
"""

import asyncio
import tempfile
from datetime import datetime, timezone

from common.workspace import Workspace
from fetcher import FetchError, FetchResult, STACFetcher
from fsspec.implementations.local import LocalFileSystem
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from loader import STACLoader
from pystac import Item
from shapely.geometry import Point

# Strategy: generate random item IDs
item_ids = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_"),
    min_size=1,
    max_size=20,
).filter(lambda s: s[0].isalnum())

# Strategy: generate random URL paths
url_paths = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_/"),
    min_size=1,
    max_size=30,
).filter(lambda s: s[0].isalnum())


def create_workspace():
    """Create a fresh workspace for each test iteration."""
    tmp_dir = tempfile.mkdtemp()
    filesystem = LocalFileSystem()
    return Workspace(filesystem=filesystem, prefix=tmp_dir)


def create_stac_item(item_id: str) -> Item:
    """Create a minimal STAC item with the given ID."""
    return Item(
        id=item_id,
        geometry=Point(0, 0).__geo_interface__,
        bbox=[-1, -1, 1, 1],
        datetime=datetime.now(timezone.utc),
        properties={},
    )


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    num_success=st.integers(min_value=0, max_value=10),
    num_failure=st.integers(min_value=0, max_value=10),
    item_id_base=item_ids,
)
def test_batch_result_counts_match_input(num_success, num_failure, item_id_base):
    """
    Property: Batch result counts exactly match input counts.
    """
    if num_success + num_failure == 0:
        return

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        success_urls = [f"http://test.example.com/success/{i}" for i in range(num_success)]
        failure_urls = [f"http://test.example.com/failure/{i}" for i in range(num_failure)]
        all_urls = success_urls + failure_urls

        async def mock_fetch_item(url: str) -> FetchResult:
            if url in success_urls:
                idx = success_urls.index(url)
                item_id = f"{item_id_base}-s{idx}"
                item = create_stac_item(item_id)
                return FetchResult(item=item, source_url=url, assets_fetched={})
            else:
                raise FetchError(url=url, status_code=500, message="Simulated failure")

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(all_urls, fetcher)

        assert (
            len(result.successful) == num_success
        ), f"Expected exactly {num_success} successful results, got {len(result.successful)}"
        assert len(result.failed) == num_failure, f"Expected exactly {num_failure} failed results, got {len(result.failed)}"
        total = len(result.successful) + len(result.failed)
        assert total == len(all_urls), f"Total results ({total}) must equal input count ({len(all_urls)})"

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    url_paths=st.lists(url_paths, min_size=1, max_size=15, unique=True),
    item_id_base=item_ids,
)
def test_failed_results_contain_error_details(url_paths, item_id_base):
    """
    Property: Failed results contain URL and error details.
    """

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        urls = [f"http://test.example.com/{path}" for path in url_paths]
        error_messages = {url: f"Error for {url}" for url in urls}

        async def mock_fetch_item(url: str) -> FetchResult:
            raise FetchError(url=url, status_code=404, message=error_messages[url])

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(urls, fetcher)

        assert len(result.failed) == len(urls), "All URLs should have failed"
        assert len(result.successful) == 0, "No URLs should have succeeded"

        for url, error in result.failed:
            assert url in urls, f"Failed URL {url} not in original list"
            assert error.url == url, f"Error URL mismatch: {error.url} != {url}"
            assert error.message, "Error message should not be empty"
            assert error.message == error_messages[url], f"Error message mismatch: {error.message} != {error_messages[url]}"

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    url_paths=st.lists(url_paths, min_size=1, max_size=15, unique=True),
    item_id_base=item_ids,
)
def test_successful_results_contain_stac_references(url_paths, item_id_base):
    """
    Property: Successful results contain valid STACReferences.
    """

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        urls = [f"http://test.example.com/{path}" for path in url_paths]

        async def mock_fetch_item(url: str) -> FetchResult:
            idx = urls.index(url)
            item_id = f"{item_id_base}-{idx}"
            item = create_stac_item(item_id)
            return FetchResult(item=item, source_url=url, assets_fetched={})

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(urls, fetcher)

        assert len(result.successful) == len(urls), "All URLs should have succeeded"
        assert len(result.failed) == 0, "No URLs should have failed"

        processed_urls = set()
        for load_result in result.successful:
            assert load_result.source_url in urls, f"Source URL {load_result.source_url} not in original list"
            assert load_result.source_url not in processed_urls, f"Duplicate source URL: {load_result.source_url}"
            processed_urls.add(load_result.source_url)

            stac_ref = load_result.stac_reference
            assert stac_ref is not None, "STACReference should not be None"
            assert stac_ref.item_id, "STACReference should have an item_id"

            retrieved_item = workspace.get_item(stac_ref)
            assert retrieved_item is not None, "Should be able to retrieve item"

    asyncio.run(run())
