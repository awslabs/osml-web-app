#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 11: Caching Behavior

For any URL reference that has been previously loaded and exists in the workspace,
loading the same URL SHALL return the existing STACReference without making an
HTTP request to fetch the item.

**Validates: Requirements 6.1, 6.2**
"""

import tempfile
from datetime import datetime, timezone

from common.workspace import Workspace
from fetcher import FetchResult
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
    max_size=30,
).filter(lambda s: s[0].isalnum())

# Strategy: generate random URL paths
url_paths = st.text(
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Nd"), whitelist_characters="-_/"),
    min_size=1,
    max_size=50,
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
    item_id=item_ids,
    url_path=url_paths,
)
def test_caching_returns_existing_reference(item_id, url_path):
    """
    Property: Loading the same URL twice returns the cached reference on second load.

    For any randomly generated item and URL:
    1. Load the item the first time (should create new entry)
    2. Load the same URL again (should return cached reference)
    3. Verify the second load returns reused_existing=True
    4. Verify both loads return the same STACReference
    """
    # Create fresh workspace for this iteration
    workspace = create_workspace()

    # Create the STAC item
    item = create_stac_item(item_id)
    source_url = f"http://test.example.com/{url_path}"

    # Create FetchResult
    fetch_result = FetchResult(
        item=item,
        source_url=source_url,
        assets_fetched={},
    )

    # Load into workspace - first time
    loader = STACLoader(workspace)
    first_result = loader.load_item(fetch_result)

    # Verify first load created a new entry
    assert first_result.reused_existing is False, "First load should not reuse existing"

    # Load the same URL again - second time
    second_result = loader.load_item(fetch_result)

    # Verify second load reused the existing entry
    assert second_result.reused_existing is True, "Second load should reuse existing"

    # Verify both return the same STACReference
    assert (
        first_result.stac_reference == second_result.stac_reference
    ), f"STACReference mismatch: first={first_result.stac_reference}, second={second_result.stac_reference}"


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    item_id=item_ids,
    url_path=url_paths,
)
def test_find_existing_returns_cached_reference(item_id, url_path):
    """
    Property: find_existing returns the cached STACReference for a previously loaded URL.

    For any randomly generated item and URL:
    1. Verify find_existing returns None before loading
    2. Load the item
    3. Verify find_existing returns the correct STACReference after loading
    """
    # Create fresh workspace for this iteration
    workspace = create_workspace()

    # Create the STAC item
    item = create_stac_item(item_id)
    source_url = f"http://test.example.com/{url_path}"

    # Create FetchResult
    fetch_result = FetchResult(
        item=item,
        source_url=source_url,
        assets_fetched={},
    )

    # Create loader and verify URL is not in cache
    loader = STACLoader(workspace)
    assert loader.find_existing(source_url) is None, "URL should not exist before loading"

    # Load the item
    load_result = loader.load_item(fetch_result)

    # Verify find_existing now returns the correct reference
    cached_ref = loader.find_existing(source_url)
    assert cached_ref is not None, "URL should exist after loading"
    assert (
        cached_ref == load_result.stac_reference
    ), f"Cached reference mismatch: expected {load_result.stac_reference}, got {cached_ref}"


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    item_id1=item_ids,
    item_id2=item_ids,
    url_path1=url_paths,
    url_path2=url_paths,
)
def test_different_urls_not_cached_together(item_id1, item_id2, url_path1, url_path2):
    """
    Property: Different URLs are cached independently.

    For any two different URLs:
    1. Load item from first URL
    2. Verify second URL is not in cache
    3. Load item from second URL
    4. Verify both URLs have their own cached references
    """
    # Skip if URLs would be the same
    if url_path1 == url_path2:
        return

    # Create fresh workspace for this iteration
    workspace = create_workspace()

    # Create two different items
    item1 = create_stac_item(item_id1)
    item2 = create_stac_item(item_id2)
    source_url1 = f"http://test.example.com/{url_path1}"
    source_url2 = f"http://test.example.com/{url_path2}"

    fetch_result1 = FetchResult(item=item1, source_url=source_url1, assets_fetched={})
    fetch_result2 = FetchResult(item=item2, source_url=source_url2, assets_fetched={})

    loader = STACLoader(workspace)

    # Load first item
    result1 = loader.load_item(fetch_result1)

    # Verify second URL is not cached
    assert loader.find_existing(source_url2) is None, "Second URL should not be cached yet"

    # Load second item
    result2 = loader.load_item(fetch_result2)

    # Verify both URLs have their own cached references
    assert loader.find_existing(source_url1) == result1.stac_reference
    assert loader.find_existing(source_url2) == result2.stac_reference
