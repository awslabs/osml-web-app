#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property tests for asset fetch result reporting.

Property 11: Successful assets list completeness
**Validates: Requirements 5.1**

Property 12: Failed assets reporting
**Validates: Requirements 5.2**

Property 13: Empty failed assets on complete success
**Validates: Requirements 5.3**
"""

import asyncio
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fetcher import AssetFetchMode, FetchError, STACFetcher
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pystac import Asset, Item
from shapely.geometry import Point

# --- Strategies ---

asset_mimes = st.sampled_from(
    [
        "text/plain",
        "application/json",
        "application/geo+json",
        "image/tiff",
        "image/png",
        "image/jpeg",
    ]
)

asset_hrefs = st.sampled_from(
    [
        "https://example.com/data.json",
        "https://example.com/data.xml",
        "https://example.com/image.tif",
        "https://example.com/image.png",
    ]
)


def _make_item_with_assets(asset_specs: list[tuple[str, str, str | None]]) -> Item:
    """Create a STAC Item with assets from a list of (key, href, mime_type) tuples."""
    item = Item(
        id="test-item",
        geometry=Point(0, 0).__geo_interface__,
        bbox=[-1, -1, 1, 1],
        datetime=datetime(2024, 1, 1, tzinfo=timezone.utc),
        properties={},
    )
    for key, href, mime in asset_specs:
        item.add_asset(key, Asset(href=href, media_type=mime))
    return item


# --- Property 11: Successful assets list completeness ---
# Feature: stac-loader-enhancements, Property 11: Successful assets list completeness


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_assets=st.integers(min_value=1, max_value=6),
    data=st.data(),
)
def test_successful_assets_list_completeness(n_assets, data):
    """
    For any fetch operation, the successful_assets list in the FetchResult
    should contain exactly the keys present in the assets_fetched dictionary.

    **Validates: Requirements 5.1**
    """
    specs = []
    for i in range(n_assets):
        mime = data.draw(asset_mimes)
        href = data.draw(asset_hrefs)
        specs.append((f"asset_{i}", href, mime))

    item = _make_item_with_assets(specs)

    async def _run():
        async with STACFetcher() as fetcher:

            async def mock_fetch(url):
                resp = MagicMock()
                resp.content = b"fake-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item, AssetFetchMode.ALL)

    assets_fetched, successful_assets, failed_assets = asyncio.run(_run())

    # successful_assets should contain exactly the keys in assets_fetched
    assert set(successful_assets) == set(assets_fetched.keys())
    assert len(successful_assets) == len(assets_fetched)


# --- Property 12: Failed assets reporting ---
# Feature: stac-loader-enhancements, Property 12: Failed assets reporting


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_good=st.integers(min_value=0, max_value=3),
    n_bad=st.integers(min_value=1, max_value=4),
    data=st.data(),
)
def test_failed_assets_reporting(n_good, n_bad, data):
    """
    For any fetch operation where one or more assets fail, the failed_assets
    dictionary in the FetchResult should map each failed asset key to its error message.

    **Validates: Requirements 5.2**
    """
    specs = []
    good_keys = set()
    bad_keys = set()

    for i in range(n_good):
        mime = data.draw(asset_mimes)
        specs.append((f"good_{i}", f"https://example.com/good_{i}.json", mime))
        good_keys.add(f"good_{i}")

    for i in range(n_bad):
        mime = data.draw(asset_mimes)
        specs.append((f"bad_{i}", f"https://example.com/bad_{i}.json", mime))
        bad_keys.add(f"bad_{i}")

    item = _make_item_with_assets(specs)

    async def _run():
        async with STACFetcher() as fetcher:

            async def mock_fetch(url):
                if "/bad_" in url:
                    raise FetchError(url=url, status_code=500, message="Simulated failure")
                resp = MagicMock()
                resp.content = b"good-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item, AssetFetchMode.ALL)

    assets_fetched, successful_assets, failed_assets = asyncio.run(_run())

    # Every bad key should appear in failed_assets with a non-empty error message
    assert set(failed_assets.keys()) == bad_keys
    for key in bad_keys:
        assert isinstance(failed_assets[key], str)
        assert len(failed_assets[key]) > 0

    # Good keys should be in successful_assets
    assert set(successful_assets) == good_keys


# --- Property 13: Empty failed assets on complete success ---
# Feature: stac-loader-enhancements, Property 13: Empty failed assets on complete success


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_assets=st.integers(min_value=1, max_value=6),
    data=st.data(),
)
def test_empty_failed_assets_on_complete_success(n_assets, data):
    """
    For any fetch operation where all assets are fetched successfully,
    the failed_assets dictionary in the FetchResult should be empty.

    **Validates: Requirements 5.3**
    """
    specs = []
    for i in range(n_assets):
        mime = data.draw(asset_mimes)
        href = data.draw(asset_hrefs)
        specs.append((f"asset_{i}", href, mime))

    item = _make_item_with_assets(specs)

    async def _run():
        async with STACFetcher() as fetcher:

            async def mock_fetch(url):
                resp = MagicMock()
                resp.content = b"fake-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item, AssetFetchMode.ALL)

    assets_fetched, successful_assets, failed_assets = asyncio.run(_run())

    # When all assets succeed, failed_assets should be empty
    assert failed_assets == {}
    # And all asset keys should be in successful_assets
    assert set(successful_assets) == set(item.assets.keys())
