#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 7: Batch Processing

For any list of N URL references, the loader SHALL process all N URLs and return
results for each, regardless of individual failures.

**Validates: Requirements 4.5, 7.4**
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

# Strategy: generate lists of URLs with success/failure flags
url_with_success = st.tuples(url_paths, st.booleans())
url_lists = st.lists(url_with_success, min_size=1, max_size=10)


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


@settings(max_examples=100, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    url_success_pairs=url_lists,
    item_id_base=item_ids,
)
def test_batch_processes_all_urls(url_success_pairs, item_id_base):
    """
    Property: Batch loading processes all URLs regardless of individual failures.
    """

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        urls = []
        expected_success = []
        expected_failure = []

        for i, (url_path, should_succeed) in enumerate(url_success_pairs):
            url = f"http://test.example.com/{url_path}/{i}"
            urls.append(url)
            if should_succeed:
                expected_success.append(url)
            else:
                expected_failure.append(url)

        async def mock_fetch_item(url: str) -> FetchResult:
            if url in expected_success:
                idx = urls.index(url)
                item_id = f"{item_id_base}-{idx}"
                item = create_stac_item(item_id)
                return FetchResult(item=item, source_url=url, assets_fetched={})
            else:
                raise FetchError(url=url, status_code=500, message="Simulated failure")

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(urls, fetcher)

        total_processed = len(result.successful) + len(result.failed)
        assert total_processed == len(urls), (
            f"Expected {len(urls)} total results, got {total_processed} "
            f"(successful={len(result.successful)}, failed={len(result.failed)})"
        )
        assert len(result.successful) == len(
            expected_success
        ), f"Expected {len(expected_success)} successful, got {len(result.successful)}"
        assert len(result.failed) == len(
            expected_failure
        ), f"Expected {len(expected_failure)} failed, got {len(result.failed)}"

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    url_paths=st.lists(url_paths, min_size=1, max_size=10, unique=True),
    item_id_base=item_ids,
)
def test_batch_continues_after_failure(url_paths, item_id_base):
    """
    Property: Batch processing continues after individual failures.
    """
    if len(url_paths) < 2:
        return

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        urls = [f"http://test.example.com/{path}" for path in url_paths]
        fail_url = urls[0]

        async def mock_fetch_item(url: str) -> FetchResult:
            if url == fail_url:
                raise FetchError(url=url, status_code=404, message="Not found")
            idx = urls.index(url)
            item_id = f"{item_id_base}-{idx}"
            item = create_stac_item(item_id)
            return FetchResult(item=item, source_url=url, assets_fetched={})

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(urls, fetcher)

        assert len(result.failed) >= 1, "First URL should have failed"
        failed_urls = [url for url, _ in result.failed]
        assert fail_url in failed_urls, f"Expected {fail_url} in failed list"
        assert len(result.successful) == len(urls) - 1, f"Expected {len(urls) - 1} successful, got {len(result.successful)}"
        total = len(result.successful) + len(result.failed)
        assert total == len(urls), f"Expected {len(urls)} total, got {total}"

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    url_paths=st.lists(url_paths, min_size=1, max_size=10, unique=True),
    item_id_base=item_ids,
)
def test_batch_all_failures_still_returns_results(url_paths, item_id_base):
    """
    Property: Batch processing returns results even when all URLs fail.
    """

    async def run():
        workspace = create_workspace()
        loader = STACLoader(workspace)

        urls = [f"http://test.example.com/{path}" for path in url_paths]

        async def mock_fetch_item(url: str) -> FetchResult:
            raise FetchError(url=url, status_code=500, message="Server error")

        async with STACFetcher() as fetcher:
            fetcher.fetch_item = mock_fetch_item
            result = await loader.load_batch(urls, fetcher)

        assert len(result.successful) == 0, "Expected no successful results"
        assert len(result.failed) == len(urls), f"Expected {len(urls)} failures, got {len(result.failed)}"
        failed_urls = {url for url, _ in result.failed}
        for url in urls:
            assert url in failed_urls, f"Expected {url} in failed list"

    asyncio.run(run())
