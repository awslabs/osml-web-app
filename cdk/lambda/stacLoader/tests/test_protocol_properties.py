#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property tests for mixed protocol support, HTTP assume_role_arn handling,
and MCP response statistics.

Property 15: Mixed protocol support
**Validates: Requirements 2.5**

Property 17: HTTP assets ignore assume_role_arn
**Validates: Requirements 6A.9**

Property 14: MCP response includes fetch statistics
**Validates: Requirements 5.5**
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fetcher import AssetFetchMode, FetchResult, STACFetcher
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from pystac import Asset, Item
from shapely.geometry import Point

# --- Strategies ---

http_protocols = st.sampled_from(["http://", "https://"])
http_domains = st.sampled_from(["example.com", "data.org", "cdn.test.io"])
http_paths = st.sampled_from(
    [
        "data.json",
        "image.tif",
        "metadata.xml",
        "scene.png",
        "info.txt",
    ]
)

s3_buckets = st.sampled_from(["my-bucket", "data-store", "stac-assets"])
s3_keys = st.sampled_from(
    [
        "data/file.json",
        "images/scene.tif",
        "meta/info.xml",
        "tiles/tile.png",
        "docs/readme.txt",
    ]
)

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


# --- Property 15: Mixed protocol support ---
# Feature: stac-loader-enhancements, Property 15: Mixed protocol support


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_http=st.integers(min_value=1, max_value=4),
    n_s3=st.integers(min_value=1, max_value=4),
    data=st.data(),
)
def test_mixed_protocol_support(n_http, n_s3, data):
    """
    For any STAC item containing both HTTP/HTTPS and S3 asset URLs,
    all assets should be fetched successfully regardless of protocol
    (assuming network and permissions allow).

    **Validates: Requirements 2.5**
    """
    specs = []

    # Generate HTTP assets
    for i in range(n_http):
        proto = data.draw(http_protocols)
        domain = data.draw(http_domains)
        path = data.draw(http_paths)
        mime = data.draw(asset_mimes)
        specs.append((f"http_{i}", f"{proto}{domain}/{path}", mime))

    # Generate S3 assets
    for i in range(n_s3):
        bucket = data.draw(s3_buckets)
        key = data.draw(s3_keys)
        mime = data.draw(asset_mimes)
        specs.append((f"s3_{i}", f"s3://{bucket}/{key}", mime))

    item = _make_item_with_assets(specs)
    expected_keys = {s[0] for s in specs}

    async def _run():
        async with STACFetcher() as fetcher:
            # Mock HTTP fetching
            async def mock_http_fetch(url):
                resp = MagicMock()
                resp.content = b"http-content"
                return resp

            # Mock S3 fetching
            async def mock_s3_fetch(s3_url):
                return b"s3-content"

            fetcher._fetch_with_retry = mock_http_fetch
            fetcher._fetch_s3_asset = mock_s3_fetch
            return await fetcher._fetch_assets(item, AssetFetchMode.ALL)

    assets_fetched, successful_assets, failed_assets = asyncio.run(_run())

    # All assets should be fetched successfully regardless of protocol
    assert set(assets_fetched.keys()) == expected_keys
    assert set(successful_assets) == expected_keys
    assert failed_assets == {}

    # Verify HTTP assets got HTTP content and S3 assets got S3 content
    for key in assets_fetched:
        if key.startswith("http_"):
            assert assets_fetched[key] == b"http-content"
        elif key.startswith("s3_"):
            assert assets_fetched[key] == b"s3-content"


# --- Property 17: HTTP assets ignore assume_role_arn ---
# Feature: stac-loader-enhancements, Property 17: HTTP assets ignore assume_role_arn


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_assets=st.integers(min_value=1, max_value=6),
    data=st.data(),
)
def test_http_assets_ignore_assume_role_arn(n_assets, data):
    """
    For any STAC item with HTTP/HTTPS assets, providing an assume_role_arn
    parameter should not affect the fetching of those assets.

    **Validates: Requirements 6A.9**
    """
    specs = []
    for i in range(n_assets):
        proto = data.draw(http_protocols)
        domain = data.draw(http_domains)
        path = data.draw(http_paths)
        mime = data.draw(asset_mimes)
        specs.append((f"asset_{i}", f"{proto}{domain}/{path}", mime))

    item = _make_item_with_assets(specs)
    expected_keys = {s[0] for s in specs}

    async def _run():
        # Create fetcher WITH an assume_role_arn
        async with STACFetcher(assume_role_arn="arn:aws:iam::123456789012:role/TestRole") as fetcher:
            # Mock HTTP fetching to succeed
            async def mock_http_fetch(url):
                resp = MagicMock()
                resp.content = b"http-content"
                return resp

            fetcher._fetch_with_retry = mock_http_fetch

            # Spy on _get_s3_client and _assume_role to verify they are NOT called
            s3_client_called = False
            assume_role_called = False

            original_get_s3 = fetcher._get_s3_client
            original_assume = fetcher._assume_role

            async def spy_get_s3():
                nonlocal s3_client_called
                s3_client_called = True
                return await original_get_s3()

            async def spy_assume(arn):
                nonlocal assume_role_called
                assume_role_called = True
                return await original_assume(arn)

            fetcher._get_s3_client = spy_get_s3
            fetcher._assume_role = spy_assume

            result = await fetcher._fetch_assets(item, AssetFetchMode.ALL)
            return result, s3_client_called, assume_role_called

    (assets_fetched, successful_assets, failed_assets), s3_called, assume_called = asyncio.run(_run())

    # All HTTP assets should be fetched successfully
    assert set(assets_fetched.keys()) == expected_keys
    assert set(successful_assets) == expected_keys
    assert failed_assets == {}

    # S3 client and assume_role should NOT have been called for HTTP-only assets
    assert not s3_called, "S3 client should not be used for HTTP assets"
    assert not assume_called, "assume_role should not be called for HTTP assets"


# --- Property 14: MCP response includes fetch statistics ---
# Feature: stac-loader-enhancements, Property 14: MCP response includes fetch statistics


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(
    n_urls=st.integers(min_value=1, max_value=3),
    n_assets_per_item=st.integers(min_value=0, max_value=4),
    n_failures_per_item=st.integers(min_value=0, max_value=2),
    data=st.data(),
)
def test_mcp_response_includes_fetch_statistics(n_urls, n_assets_per_item, n_failures_per_item, data):
    """
    For any load_stac_items call, the response should include asset fetch
    statistics (successful count, failed count) for each loaded item.

    **Validates: Requirements 5.5**
    """
    # Ensure failures don't exceed total assets
    n_failures = min(n_failures_per_item, n_assets_per_item)
    n_successes = n_assets_per_item - n_failures

    urls = [f"https://example.com/item_{i}.json" for i in range(n_urls)]

    # Build mock fetch results and load results
    mock_fetch_results = []
    for i in range(n_urls):
        item = _make_item_with_assets([])  # Minimal item
        successful_keys = [f"ok_{j}" for j in range(n_successes)]
        failed_dict = {f"fail_{j}": "Simulated error" for j in range(n_failures)}
        assets_data = {k: b"content" for k in successful_keys}

        fr = FetchResult(
            item=item,
            source_url=urls[i],
            assets_fetched=assets_data,
            successful_assets=successful_keys,
            failed_assets=failed_dict,
        )
        mock_fetch_results.append(fr)

    # Get the MCP tool functions
    os.environ.setdefault("WORKSPACE_BUCKET_NAME", "test-workspace-bucket")
    from deployed_server import create_mcp_server

    mcp = create_mcp_server("test-workspace-bucket")
    tools = mcp._tool_manager._tools
    load_tool = tools["load_stac_items"].fn
    status_tool = tools["get_load_status"].fn

    async def _run():
        # Patch STACFetcher and STACLoader to avoid real network/S3 calls
        with patch("deployed_server.STACFetcher") as MockFetcherClass, patch(
            "deployed_server.STACLoader"
        ) as MockLoaderClass:

            # Set up the mock fetcher as an async context manager
            mock_fetcher_instance = AsyncMock()
            MockFetcherClass.return_value.__aenter__ = AsyncMock(return_value=mock_fetcher_instance)
            MockFetcherClass.return_value.__aexit__ = AsyncMock(return_value=False)

            # Make fetch_item return our pre-built results in order
            mock_fetcher_instance.fetch_item = AsyncMock(side_effect=mock_fetch_results)

            # Set up the mock loader
            mock_loader_instance = MagicMock()
            MockLoaderClass.return_value = mock_loader_instance

            mock_load_result = MagicMock()
            mock_load_result.stac_reference = "test-ref"
            mock_load_result.reused_existing = False
            mock_loader_instance.load_item.return_value = mock_load_result

            # Start the job
            start_str = await load_tool(
                urls=urls,
                collection=None,
                fetch_assets="all",
                assume_role_arn=None,
            )
            start_result = json.loads(start_str)
            job_id = start_result["job_id"]

            # Let the background task run
            await asyncio.sleep(0.1)

            # Poll for completion
            for _ in range(50):
                status_str = await status_tool(job_id=job_id)
                status_result = json.loads(status_str)
                if status_result.get("status") in ("completed", "failed"):
                    return status_str
                await asyncio.sleep(0.05)

            return status_str

    result_str = asyncio.run(_run())
    result = json.loads(result_str)

    # Response must include top-level asset_statistics
    assert "asset_statistics" in result, "Response must include asset_statistics"
    stats = result["asset_statistics"]
    assert "successful_assets" in stats, "asset_statistics must include successful_assets count"
    assert "failed_assets" in stats, "asset_statistics must include failed_assets count"

    # Verify aggregate counts match expectations
    expected_total_successful = n_successes * n_urls
    expected_total_failed = n_failures * n_urls
    assert stats["successful_assets"] == expected_total_successful
    assert stats["failed_assets"] == expected_total_failed

    # Each successful item must include per-item statistics
    assert "successful" in result
    for item_result in result["successful"]:
        assert "successful_assets" in item_result, "Each item must include successful_assets"
        assert "failed_assets" in item_result, "Each item must include failed_assets"
        assert isinstance(item_result["successful_assets"], list)
        assert isinstance(item_result["failed_assets"], dict)
