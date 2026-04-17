#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 14: Retry Policy

For any HTTP request that fails:
- If the error is a timeout or 5xx status, the request SHALL be retried up to max_retries times
  with exponential backoff
- If the error is a 4xx status, the request SHALL NOT be retried

**Validates: Requirements 7.1, 7.2, 7.3**
"""

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fetcher import FetchError, STACFetcher
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# Strategy: generate 4xx status codes (client errors, no retry)
client_error_codes = st.integers(min_value=400, max_value=499)

# Strategy: generate 5xx status codes (server errors, should retry)
server_error_codes = st.integers(min_value=500, max_value=599)


def _make_mock_response(status_code: int) -> httpx.Response:
    """Create a mock httpx.Response with the given status code."""
    return httpx.Response(status_code=status_code, request=httpx.Request("GET", "http://test.example.com"))


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(status_code=client_error_codes)
def test_no_retry_on_4xx(status_code):
    """4xx client errors must NOT be retried — only one request should be made."""
    call_count = 0

    async def mock_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        return _make_mock_response(status_code)

    async def run():
        nonlocal call_count
        call_count = 0
        async with STACFetcher(timeout=5.0, max_retries=3) as fetcher:
            fetcher._client.get = mock_get
            with pytest.raises(FetchError) as exc_info:
                await fetcher._fetch_with_retry("http://test.example.com/item")

            assert exc_info.value.status_code == status_code
            assert call_count == 1, f"4xx error {status_code} should not be retried, but got {call_count} calls"

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(status_code=server_error_codes)
def test_retry_on_5xx(status_code):
    """5xx server errors must be retried up to max_retries times."""
    max_retries = 3
    call_count = 0

    async def mock_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        return _make_mock_response(status_code)

    async def run():
        nonlocal call_count
        call_count = 0
        async with STACFetcher(timeout=5.0, max_retries=max_retries) as fetcher:
            fetcher._client.get = mock_get
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(FetchError) as exc_info:
                    await fetcher._fetch_with_retry("http://test.example.com/item")

                assert exc_info.value.status_code == status_code
                assert call_count == max_retries + 1, (
                    f"5xx error {status_code} should be retried {max_retries} times "
                    f"(total {max_retries + 1} calls), but got {call_count}"
                )

    asyncio.run(run())


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(max_retries=st.integers(min_value=0, max_value=5))
def test_retry_on_timeout(max_retries):
    """Timeouts must be retried up to max_retries times with exponential backoff."""
    call_count = 0

    async def mock_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        raise httpx.ReadTimeout("Connection timed out")

    async def run():
        nonlocal call_count
        call_count = 0
        async with STACFetcher(timeout=1.0, max_retries=max_retries) as fetcher:
            fetcher._client.get = mock_get
            with patch("asyncio.sleep", new_callable=AsyncMock):
                with pytest.raises(FetchError) as exc_info:
                    await fetcher._fetch_with_retry("http://test.example.com/item")

                assert exc_info.value.status_code is None
                assert "timed out" in exc_info.value.message.lower()
                assert call_count == max_retries + 1, (
                    f"Timeout should be retried {max_retries} times "
                    f"(total {max_retries + 1} calls), but got {call_count}"
                )

    asyncio.run(run())
