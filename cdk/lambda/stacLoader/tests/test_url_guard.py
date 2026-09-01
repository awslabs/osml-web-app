#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for outbound destination validation.

Covers the URL forms rejected before a request is issued, the address forms that
defeat textual URL filtering, the ranges that stay denied regardless of
configuration, and the connect-time enforcement that ties them together.
"""

import asyncio
import socket

import httpx
import pytest
from fetcher import FetchError, STACFetcher
from pystac import StacIO
from url_guard import ALLOW_PRIVATE_HOSTS_VAR, UnsafeURLError, resolve_allowed_address, validate_url

PUBLIC_ADDRESS = "93.184.216.34"


def _stub_resolver(mapping):
    """Build a getaddrinfo replacement that resolves only the given hosts."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        addresses = mapping.get(host)
        if addresses is None:
            raise socket.gaierror(-5, "No address associated with hostname")
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port)) for address in addresses]

    return fake_getaddrinfo


def _resolving_to(monkeypatch, host, addresses):
    """Point the guard's resolver at a fixed answer for one host."""
    monkeypatch.setattr(socket, "getaddrinfo", _stub_resolver({host: addresses}))


# --- URL form, checked before any request is issued ---


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/x", "s3://bucket/key"])
def test_non_http_schemes_rejected(url):
    with pytest.raises(UnsafeURLError) as raised:
        validate_url(url)
    assert "scheme" in str(raised.value)


def test_embedded_credentials_rejected():
    """A trusted prefix in the userinfo position must not authorize the real host."""
    with pytest.raises(UnsafeURLError) as raised:
        validate_url("https://catalog.example.com@evil.example/x")
    assert "credentials" in str(raised.value)


def test_url_without_host_rejected():
    with pytest.raises(UnsafeURLError):
        validate_url("http:///item.json")


@pytest.mark.parametrize("url", ["https://catalog.example.com/collection.json", "http://catalog.example.com:8080/x?a=1"])
def test_well_formed_urls_accepted_without_resolving(url):
    """Form validation must not perform DNS; the address check happens at connect."""
    assert str(validate_url(url)) == url


# --- Resolved address, checked inside each connection ---


@pytest.mark.parametrize("host", ["127.0.0.1", "0177.0.0.1", "2130706433", "127.1", "::1", "::ffff:127.0.0.1"])
def test_loopback_forms_rejected(host):
    """Octal, decimal, short, and IPv6 spellings of loopback are all refused."""
    with pytest.raises(UnsafeURLError):
        resolve_allowed_address(host, 80)


@pytest.mark.parametrize(
    "host,reason",
    [
        ("169.254.169.254", "link-local"),
        ("169.254.170.2", "link-local"),
        ("10.0.0.1", "private"),
        ("192.168.1.1", "private"),
        ("172.16.0.1", "private"),
        ("100.64.0.1", "shared address space"),
        ("0.0.0.0", "unspecified"),
        ("224.0.0.1", "multicast"),
    ],
)
def test_non_public_addresses_rejected(host, reason):
    with pytest.raises(UnsafeURLError) as raised:
        resolve_allowed_address(host, 80)
    assert reason in str(raised.value)


def test_unresolvable_host_rejected(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", _stub_resolver({}))
    with pytest.raises(UnsafeURLError) as raised:
        resolve_allowed_address("nope.invalid", 443)
    assert "Could not resolve" in str(raised.value)


def test_hostname_resolving_to_private_rejected(monkeypatch):
    """A public-looking name is judged by what it resolves to, not how it reads."""
    _resolving_to(monkeypatch, "catalog.invalid", ["10.0.0.5"])
    with pytest.raises(UnsafeURLError) as raised:
        resolve_allowed_address("catalog.invalid", 443)
    assert "private address" in str(raised.value)


def test_all_resolved_addresses_must_be_public(monkeypatch):
    """One private answer among several is enough to refuse the connection."""
    _resolving_to(monkeypatch, "split.invalid", [PUBLIC_ADDRESS, "127.0.0.1"])
    with pytest.raises(UnsafeURLError):
        resolve_allowed_address("split.invalid", 443)


def test_public_host_returns_the_resolved_address(monkeypatch):
    """The dialed address comes from the answer that was checked."""
    _resolving_to(monkeypatch, "catalog.invalid", [PUBLIC_ADDRESS])
    assert resolve_allowed_address("catalog.invalid", 443) == PUBLIC_ADDRESS


# --- Local development escape hatch ---


@pytest.mark.parametrize("value", ["true", "TRUE", " true "])
def test_escape_hatch_permits_private_addresses(monkeypatch, value):
    monkeypatch.setenv(ALLOW_PRIVATE_HOSTS_VAR, value)
    assert resolve_allowed_address("127.0.0.1", 8080) == "127.0.0.1"


@pytest.mark.parametrize("value", ["", "false", "0", "1", "yes", "truthy"])
def test_escape_hatch_requires_the_exact_value_true(monkeypatch, value):
    monkeypatch.setenv(ALLOW_PRIVATE_HOSTS_VAR, value)
    with pytest.raises(UnsafeURLError):
        resolve_allowed_address("127.0.0.1", 80)


def test_private_addresses_denied_when_escape_hatch_unset(monkeypatch):
    monkeypatch.delenv(ALLOW_PRIVATE_HOSTS_VAR, raising=False)
    with pytest.raises(UnsafeURLError):
        resolve_allowed_address("127.0.0.1", 80)


@pytest.mark.parametrize("host", ["169.254.170.2", "169.254.169.254"])
def test_escape_hatch_still_denies_link_local(monkeypatch, host):
    """The credential endpoints stay unreachable even in local development."""
    monkeypatch.setenv(ALLOW_PRIVATE_HOSTS_VAR, "true")
    with pytest.raises(UnsafeURLError) as raised:
        resolve_allowed_address(host, 80)
    assert "link-local" in str(raised.value)


# --- Enforcement through the fetcher's client ---


def test_guarded_transport_refuses_private_destination(monkeypatch):
    """The check runs inside the connection, so no request reaches the address."""
    sleeps = []

    async def record_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", record_sleep)

    async def run():
        async with STACFetcher(max_retries=2) as fetcher:
            with pytest.raises(FetchError) as raised:
                await fetcher._fetch_with_retry("http://169.254.170.2/v2/credentials")
            assert raised.value.status_code is None
            # The guard's own wording, not a transport error wrapped as retryable.
            assert raised.value.message.startswith("Host '169.254.170.2' resolves to a link-local address")

    asyncio.run(run())
    assert sleeps == []


def test_fetcher_rejects_non_http_scheme_without_connecting():
    async def run():
        async with STACFetcher() as fetcher:
            with pytest.raises(FetchError) as raised:
                await fetcher._fetch_with_retry("file:///etc/passwd")
            assert "scheme" in raised.value.message

    asyncio.run(run())


def test_fetcher_request_url_is_left_intact():
    """Leaving the URL alone keeps TLS verification scoped to the real hostname."""

    async def run():
        async with STACFetcher() as fetcher:
            seen = []

            async def mock_get(url, *args, **kwargs):
                seen.append(str(url))
                return httpx.Response(200, request=httpx.Request("GET", url))

            fetcher._client.get = mock_get
            await fetcher._fetch_with_retry("https://catalog.example.com/collection.json")
            assert seen == ["https://catalog.example.com/collection.json"]

    asyncio.run(run())


def test_fetcher_client_does_not_follow_redirects():
    """A redirect target would reach the network without being validated."""

    async def run():
        async with STACFetcher() as fetcher:
            assert fetcher._client.follow_redirects is False

    asyncio.run(run())


def test_pystac_default_io_refuses_network_reads():
    """pystac link resolution must not become a second, unguarded egress path."""
    with pytest.raises(UnsafeURLError):
        StacIO.default().read_text("http://169.254.169.254/latest/meta-data/")
