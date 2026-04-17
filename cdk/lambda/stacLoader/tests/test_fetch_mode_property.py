#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property tests for asset fetch mode control and graceful failure handling.

Property 1: Fetch mode "none" skips all assets
**Validates: Requirements 1.2**

Property 2: Fetch mode "text" fetches only text assets
**Validates: Requirements 1.3, 3.1**

Property 3: Fetch mode "image" fetches only image assets
**Validates: Requirements 1.4, 3.2**

Property 4: Fetch mode "all" fetches all assets
**Validates: Requirements 1.5**

Property 5: Default fetch mode is "none"
**Validates: Requirements 1.6, 12.1**

Property 9: MIME filtering ignored in "all" and "none" modes
**Validates: Requirements 3.7**

Property 10: Partial asset fetch failure resilience
**Validates: Requirements 4.1, 4.3**
"""

import asyncio
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fetcher import AssetFetchMode, FetchError, STACFetcher, classify_mime_type, infer_type_from_extension
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st
from pystac import Asset, Item
from shapely.geometry import Point

# --- Strategies ---

text_mimes = st.sampled_from(
    [
        "text/plain",
        "text/csv",
        "text/html",
        "application/json",
        "application/xml",
        "application/geo+json",
    ]
)

image_mimes = st.sampled_from(
    [
        "image/tiff",
        "image/png",
        "image/jpeg",
        "image/gif",
    ]
)

unknown_mimes = st.sampled_from(
    [
        "application/octet-stream",
        "application/zip",
        "video/mp4",
    ]
)

text_hrefs = st.sampled_from(
    [
        "https://example.com/data.json",
        "https://example.com/data.xml",
        "https://example.com/data.txt",
        "https://example.com/data.geojson",
    ]
)

image_hrefs = st.sampled_from(
    [
        "https://example.com/image.tif",
        "https://example.com/image.png",
        "https://example.com/image.jpg",
        "https://example.com/image.jpeg",
        "https://example.com/image.tiff",
    ]
)

neutral_hrefs = st.sampled_from(
    [
        "https://example.com/data.bin",
        "https://example.com/file.dat",
    ]
)

# Strategy for generating a dict of assets with known types


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


@st.composite
def mixed_asset_specs(draw):
    """Generate a list of asset specs with a mix of text, image, and unknown types."""
    n_text = draw(st.integers(min_value=0, max_value=3))
    n_image = draw(st.integers(min_value=0, max_value=3))
    n_unknown = draw(st.integers(min_value=0, max_value=2))
    assume(n_text + n_image + n_unknown > 0)

    specs = []
    for i in range(n_text):
        mime = draw(text_mimes)
        href = draw(text_hrefs)
        specs.append((f"text_{i}", href, mime))
    for i in range(n_image):
        mime = draw(image_mimes)
        href = draw(image_hrefs)
        specs.append((f"image_{i}", href, mime))
    for i in range(n_unknown):
        mime = draw(unknown_mimes)
        href = draw(neutral_hrefs)
        specs.append((f"unknown_{i}", href, mime))
    return specs


def _run_fetch_assets(item, fetch_mode):
    """Helper to run _fetch_assets with mocked HTTP responses."""

    async def _run():
        async with STACFetcher() as fetcher:
            # Mock _fetch_with_retry to return fake content
            async def mock_fetch(url):
                resp = MagicMock()
                resp.content = b"fake-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item, fetch_mode)

    return asyncio.run(_run())


# --- Property 1: Fetch mode "none" skips all assets ---
# Feature: stac-loader-enhancements, Property 1: Fetch mode "none" skips all assets


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_fetch_mode_none_skips_all_assets(specs):
    """**Validates: Requirements 1.2**"""
    item = _make_item_with_assets(specs)
    assets, successful, failed = _run_fetch_assets(item, AssetFetchMode.NONE)
    assert assets == {}
    assert successful == []
    assert failed == {}


# --- Property 2: Fetch mode "text" fetches only text assets ---
# Feature: stac-loader-enhancements, Property 2: Fetch mode "text" fetches only text assets


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_fetch_mode_text_fetches_only_text(specs):
    """**Validates: Requirements 1.3, 3.1**"""
    item = _make_item_with_assets(specs)
    assets, successful, failed = _run_fetch_assets(item, AssetFetchMode.TEXT)

    for key in assets:
        asset = item.assets[key]
        mime = asset.media_type
        href = asset.href
        if mime:
            assert classify_mime_type(mime) == "text", f"Non-text asset {key} with mime {mime} was fetched"
        else:
            assert infer_type_from_extension(href) == "text", f"Non-text asset {key} with href {href} was fetched"


# --- Property 3: Fetch mode "image" fetches only image assets ---
# Feature: stac-loader-enhancements, Property 3: Fetch mode "image" fetches only image assets


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_fetch_mode_image_fetches_only_image(specs):
    """**Validates: Requirements 1.4, 3.2**"""
    item = _make_item_with_assets(specs)
    assets, successful, failed = _run_fetch_assets(item, AssetFetchMode.IMAGE)

    for key in assets:
        asset = item.assets[key]
        mime = asset.media_type
        href = asset.href
        if mime:
            assert classify_mime_type(mime) == "image", f"Non-image asset {key} with mime {mime} was fetched"
        else:
            assert infer_type_from_extension(href) == "image", f"Non-image asset {key} with href {href} was fetched"


# --- Property 4: Fetch mode "all" fetches all assets ---
# Feature: stac-loader-enhancements, Property 4: Fetch mode "all" fetches all assets


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_fetch_mode_all_fetches_all_assets(specs):
    """**Validates: Requirements 1.5**"""
    item = _make_item_with_assets(specs)
    assets, successful, failed = _run_fetch_assets(item, AssetFetchMode.ALL)

    # All assets should be fetched (no failures since HTTP is mocked)
    assert len(assets) == len(item.assets)
    assert set(successful) == set(item.assets.keys())
    assert failed == {}


# --- Property 5: Default fetch mode is "none" ---
# Feature: stac-loader-enhancements, Property 5: Default fetch mode is "none"


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_default_fetch_mode_is_none(specs):
    """**Validates: Requirements 1.6, 12.1**"""
    item = _make_item_with_assets(specs)

    # Call _fetch_assets without specifying fetch_mode (uses default)
    async def _run():
        async with STACFetcher() as fetcher:

            async def mock_fetch(url):
                resp = MagicMock()
                resp.content = b"fake-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item)

    default_assets, default_successful, default_failed = asyncio.run(_run())

    # Should behave identically to NONE
    none_assets, none_successful, none_failed = _run_fetch_assets(item, AssetFetchMode.NONE)

    assert default_assets == none_assets
    assert default_successful == none_successful
    assert default_failed == none_failed


# --- Property 9: MIME filtering ignored in "all" and "none" modes ---
# Feature: stac-loader-enhancements, Property 9: MIME filtering ignored in "all" and "none" modes


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(specs=mixed_asset_specs())
def test_mime_filtering_ignored_in_all_and_none(specs):
    """**Validates: Requirements 3.7**"""
    item = _make_item_with_assets(specs)

    # In NONE mode, no assets fetched regardless of MIME type
    none_assets, _, _ = _run_fetch_assets(item, AssetFetchMode.NONE)
    assert none_assets == {}

    # In ALL mode, all assets fetched regardless of MIME type
    all_assets, _, _ = _run_fetch_assets(item, AssetFetchMode.ALL)
    assert set(all_assets.keys()) == set(item.assets.keys())


# --- Property 10: Partial asset fetch failure resilience ---
# Feature: stac-loader-enhancements, Property 10: Partial asset fetch failure resilience


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_good=st.integers(min_value=1, max_value=4),
    n_bad=st.integers(min_value=1, max_value=3),
)
def test_partial_failure_resilience(n_good, n_bad):
    """**Validates: Requirements 4.1, 4.3**"""
    # Build an item with some good and some bad assets
    specs = []
    good_keys = set()
    bad_keys = set()
    for i in range(n_good):
        key = f"good_{i}"
        specs.append((key, f"https://example.com/good_{i}.json", "application/json"))
        good_keys.add(key)
    for i in range(n_bad):
        key = f"bad_{i}"
        specs.append((key, f"https://example.com/bad_{i}.json", "application/json"))
        bad_keys.add(key)

    item = _make_item_with_assets(specs)

    async def _run():
        async with STACFetcher() as fetcher:

            async def mock_fetch(url):
                # Fail for "bad" URLs
                if "/bad_" in url:
                    raise FetchError(url=url, status_code=500, message="Simulated failure")
                resp = MagicMock()
                resp.content = b"good-content"
                return resp

            fetcher._fetch_with_retry = mock_fetch
            return await fetcher._fetch_assets(item, AssetFetchMode.ALL)

    assets, successful, failed = asyncio.run(_run())

    # Good assets should be fetched successfully
    assert set(successful) == good_keys
    assert set(assets.keys()) == good_keys

    # Bad assets should be in failed dict
    assert set(failed.keys()) == bad_keys
    for key in bad_keys:
        assert failed[key]  # error message is non-empty
