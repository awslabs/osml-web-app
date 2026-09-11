#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for bearer-token scoping.

The token from an incoming request may only be forwarded to the configured
internal catalog, and any token is attached per request by origin equality —
never as a client-wide header that every fetched host would receive.
"""

import asyncio

import httpx
import pytest
from deployed_server import _passthrough_auth_token, _resolve_auth_token
from fetcher import STACFetcher, request_origin

CATALOG_BASE = "https://catalog.example.com/api/stac"
CATALOG_ITEM = "https://catalog.example.com/api/stac/collections/c1/items/i1"


# --- Origin comparison ---


@pytest.mark.parametrize(
    "left,right",
    [
        ("https://x.example.com", "https://x.example.com:443/other/path"),
        ("http://x.example.com:80/a", "http://X.EXAMPLE.COM/b"),
    ],
)
def test_origin_equality_normalizes_default_ports_and_case(left, right):
    assert request_origin(left) == request_origin(right)


@pytest.mark.parametrize(
    "left,right",
    [
        ("https://x.example.com", "http://x.example.com"),
        ("https://x.example.com", "https://x.example.com:8443"),
        ("https://x.example.com", "https://x.example.com.attacker.tld"),
    ],
)
def test_origin_equality_distinguishes_scheme_port_and_host(left, right):
    assert request_origin(left) != request_origin(right)


# --- Token resolution in the MCP server ---


def test_explicit_token_scoped_to_caller_urls():
    urls = ["https://external.example.org/item.json"]
    token, auth_urls = _resolve_auth_token("caller-token", urls, CATALOG_BASE)
    assert token == "caller-token"
    assert auth_urls == urls


def test_passthrough_token_for_catalog_url(monkeypatch):
    _passthrough_auth_token.set("session-token")
    token, auth_urls = _resolve_auth_token(None, [CATALOG_ITEM], CATALOG_BASE)
    assert token == "session-token"
    assert auth_urls == [CATALOG_BASE]


def test_passthrough_scoped_to_catalog_even_with_mixed_urls():
    """A mixed URL list resolves the token, but only the catalog may receive it."""
    _passthrough_auth_token.set("session-token")
    token, auth_urls = _resolve_auth_token(None, [CATALOG_ITEM, "https://evil.example/x"], CATALOG_BASE)
    assert token == "session-token"
    assert auth_urls == [CATALOG_BASE]


@pytest.mark.parametrize(
    "url",
    [
        # Prefix-lookalike host: starts with the catalog host as a string.
        "https://catalog.example.com.attacker.tld/api/stac/items/i1",
        # Userinfo: the catalog base in the credentials position, host is the attacker.
        "https://catalog.example.com@attacker.tld/api/stac/items/i1",
        # Scheme downgrade to plaintext on the real host.
        "http://catalog.example.com/api/stac/items/i1",
        # Different port on the real host.
        "https://catalog.example.com:8443/api/stac/items/i1",
    ],
)
def test_no_passthrough_for_non_catalog_origins(url):
    _passthrough_auth_token.set("session-token")
    token, auth_urls = _resolve_auth_token(None, [url], CATALOG_BASE)
    assert token is None
    assert auth_urls == []


def test_no_passthrough_without_catalog_base():
    _passthrough_auth_token.set("session-token")
    token, auth_urls = _resolve_auth_token(None, [CATALOG_ITEM], "")
    assert token is None
    assert auth_urls == []


def test_no_token_for_public_urls():
    _passthrough_auth_token.set(None)
    token, auth_urls = _resolve_auth_token(None, [CATALOG_ITEM], CATALOG_BASE)
    assert token is None


# --- Per-request attachment in the fetcher ---


def test_auth_token_requires_auth_urls():
    with pytest.raises(ValueError):
        STACFetcher(auth_token="token")


def test_client_has_no_default_authorization_header():
    async def run():
        async with STACFetcher(auth_token="token", auth_urls=[CATALOG_BASE]) as fetcher:
            assert "authorization" not in fetcher._client.headers

    asyncio.run(run())


def _requests_seen(fetcher):
    """Replace the client's get with a recorder; returns the (url, headers) log."""
    seen = []

    async def mock_get(url, *args, headers=None, **kwargs):
        seen.append((str(url), headers))
        return httpx.Response(200, request=httpx.Request("GET", url))

    fetcher._client.get = mock_get
    return seen


def test_token_sent_only_to_scoped_origin():
    async def run():
        async with STACFetcher(auth_token="token", auth_urls=[CATALOG_BASE]) as fetcher:
            seen = _requests_seen(fetcher)
            await fetcher._fetch_with_retry(CATALOG_ITEM)
            await fetcher._fetch_with_retry("https://assets.example.net/data.json")
            await fetcher._fetch_with_retry("https://catalog.example.com.attacker.tld/item.json")
            return seen

    by_url = dict(asyncio.run(run()))
    assert by_url[CATALOG_ITEM] == {"Authorization": "Bearer token"}
    assert by_url["https://assets.example.net/data.json"] is None
    assert by_url["https://catalog.example.com.attacker.tld/item.json"] is None


def test_no_headers_when_no_token():
    async def run():
        async with STACFetcher() as fetcher:
            seen = _requests_seen(fetcher)
            await fetcher._fetch_with_retry(CATALOG_ITEM)
            return seen

    seen = asyncio.run(run())
    assert seen == [(CATALOG_ITEM, None)]
