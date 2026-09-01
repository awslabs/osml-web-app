#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Destination validation for outbound HTTP fetches.

Caller-supplied URLs are checked at two points. The URL form is validated before a
request is issued, and the resolved address is validated inside the connection
attempt, so the address that is checked is the address that is dialed and a second
DNS answer cannot redirect the connection. Validating at connect time also leaves
the request URL untouched, which keeps TLS verification and connection reuse
scoped to the real hostname.
"""

import functools
import ipaddress
import logging
import os
import socket
from typing import Optional, Union

import httpcore
import httpx

logger = logging.getLogger(__name__)

ALLOW_PRIVATE_HOSTS_VAR = "STAC_LOADER_ALLOW_PRIVATE_HOSTS"

_ALLOWED_SCHEMES = frozenset({"http", "https"})

# Shared address space (RFC 6598) is not covered by ipaddress.is_private.
_SHARED_ADDRESS_SPACE = ipaddress.ip_network("100.64.0.0/10")

_IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]


class UnsafeURLError(Exception):
    """Raised when a URL's destination is not a permitted fetch target."""


@functools.lru_cache(maxsize=1)
def _warn_private_hosts_allowed() -> None:
    """Log that the escape hatch is active, once per process."""
    logger.warning(f"{ALLOW_PRIVATE_HOSTS_VAR} is set; fetches to private addresses are permitted")


def private_hosts_allowed() -> bool:
    """
    Report whether destinations on private addresses are permitted.

    Intended for local development against a catalog on the developer's own
    machine. Unset in deployed environments, where private destinations stay
    blocked.

    Returns:
        True only when the escape hatch is set to the exact value 'true'
    """
    allowed = os.environ.get(ALLOW_PRIVATE_HOSTS_VAR, "").strip().lower() == "true"
    if allowed:
        _warn_private_hosts_allowed()
    return allowed


def _rejection_reason(address: _IPAddress, allow_private: bool) -> Optional[str]:
    """
    Describe why an address is not a permitted destination.

    Args:
        address: A resolved IP address
        allow_private: Whether private destinations are permitted

    Returns:
        A short reason string, or None when the address is permitted
    """
    mapped = getattr(address, "ipv4_mapped", None)
    if mapped is not None:
        address = mapped

    # Denied regardless of the escape hatch: link-local covers the instance and
    # container credential endpoints, and the rest are never fetch targets.
    if address.is_link_local:
        return "link-local address"
    if address.is_multicast:
        return "multicast address"
    if address.is_unspecified:
        return "unspecified address"

    if allow_private:
        return None

    if address.is_loopback:
        return "loopback address"
    if address.is_private:
        return "private address"
    if address.is_reserved:
        return "reserved address"
    if address.version == 4 and address in _SHARED_ADDRESS_SPACE:
        return "shared address space address"
    return None


def validate_url(url: str) -> httpx.URL:
    """
    Check the form of a fetch URL, without resolving it.

    Args:
        url: The URL to fetch

    Returns:
        The parsed URL

    Raises:
        UnsafeURLError: If the URL is malformed, uses a scheme other than HTTP or
            HTTPS, embeds credentials, or has no host
    """
    try:
        parsed = httpx.URL(url)
    except Exception as e:
        raise UnsafeURLError(f"Malformed URL: {e}")

    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"Unsupported URL scheme '{parsed.scheme}'; only http and https are permitted")
    if parsed.userinfo:
        raise UnsafeURLError("URL embeds credentials, which would be sent to the resolved host")
    if not parsed.host:
        raise UnsafeURLError(f"URL '{url}' has no host")
    return parsed


def resolve_allowed_address(host: str, port: int) -> str:
    """
    Resolve a host and return the address to dial.

    Resolution normalizes the octal, decimal, and shortened literals that defeat
    textual URL filtering, and every answer must be permitted before any of them
    is used.

    Args:
        host: The hostname or IP literal to connect to
        port: The port to connect to

    Returns:
        The address to dial

    Raises:
        UnsafeURLError: If the host does not resolve, or any resolved address is
            not a permitted destination
    """
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise UnsafeURLError(f"Could not resolve host '{host}': {e}")

    addresses: list[_IPAddress] = []
    for info in infos:
        # Drop any IPv6 scope suffix, which ip_address does not accept.
        literal = str(info[4][0]).split("%")[0]
        try:
            addresses.append(ipaddress.ip_address(literal))
        except ValueError as e:
            raise UnsafeURLError(f"Host '{host}' resolved to an unparsable address '{literal}': {e}")

    if not addresses:
        raise UnsafeURLError(f"Host '{host}' resolved to no addresses")

    allow_private = private_hosts_allowed()
    for address in addresses:
        reason = _rejection_reason(address, allow_private)
        if reason is not None:
            raise UnsafeURLError(f"Host '{host}' resolves to a {reason} ({address}); refusing to fetch")

    return str(addresses[0])


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    """Network backend that validates the destination before it connects."""

    def __init__(self, delegate: httpcore.AsyncNetworkBackend):
        self._delegate = delegate

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        address = resolve_allowed_address(host, port)
        return await self._delegate.connect_tcp(
            address,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise UnsafeURLError(f"Refusing to connect to unix socket {path}")

    async def sleep(self, seconds: float) -> None:
        await self._delegate.sleep(seconds)


class GuardedAsyncTransport(httpx.AsyncHTTPTransport):
    """HTTP transport that validates the address of every connection it opens."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not hasattr(self._pool, "_network_backend"):
            raise RuntimeError("httpcore connection pool exposes no network backend to guard")
        self._pool._network_backend = _GuardedBackend(self._pool._network_backend)
