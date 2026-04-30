#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""STACFetcher - Fetches STAC items and assets from URL references."""

import asyncio
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
from urllib.parse import urljoin

import boto3
import httpx
from botocore.exceptions import ClientError
from pystac import Collection, Item

logger = logging.getLogger(__name__)


class AssetFetchMode(str, Enum):
    """Controls which types of assets to fetch."""

    NONE = "none"
    TEXT = "text"
    IMAGE = "image"
    ALL = "all"


# Text-based MIME types (exact matches and prefixes)
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_MIME_EXACT = frozenset({"application/json", "application/xml", "application/geo+json"})

# Image MIME type prefix
_IMAGE_MIME_PREFIXES = ("image/",)

# File extension to type mapping
_TEXT_EXTENSIONS = frozenset({".txt", ".json", ".xml", ".geojson"})
_IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".tif", ".tiff"})


def classify_mime_type(mime_type: str) -> str:
    """
    Classify a MIME type as 'text', 'image', or 'unknown'.

    Args:
        mime_type: A MIME type string (e.g. 'image/tiff', 'application/json')

    Returns:
        'text', 'image', or 'unknown'
    """
    lower = mime_type.lower().strip()
    if any(lower.startswith(prefix) for prefix in _TEXT_MIME_PREFIXES) or lower in _TEXT_MIME_EXACT:
        return "text"
    if any(lower.startswith(prefix) for prefix in _IMAGE_MIME_PREFIXES):
        return "image"
    return "unknown"


def infer_type_from_extension(file_path: str) -> str:
    """
    Infer asset type from file extension when MIME type is missing.

    Args:
        file_path: A file path or URL to extract the extension from

    Returns:
        'text', 'image', or 'unknown'
    """
    import os

    # Strip query params and fragments before extracting extension
    clean = file_path.split("?")[0].split("#")[0]
    ext = os.path.splitext(clean)[1].lower()
    if ext in _TEXT_EXTENSIONS:
        return "text"
    if ext in _IMAGE_EXTENSIONS:
        return "image"
    return "unknown"


def detect_protocol(url: str) -> str:
    """
    Detect the protocol of an asset URL.

    Args:
        url: An asset URL string

    Returns:
        'http' for HTTP/HTTPS URLs, 's3' for S3 URLs, or 'unsupported' for others
    """
    lower = url.lower().strip()
    if lower.startswith("http://") or lower.startswith("https://"):
        return "http"
    if lower.startswith("s3://"):
        return "s3"
    return "unsupported"


@dataclass
class FetchResult:
    """Result of fetching a STAC item from a URL."""

    item: Item
    source_url: str
    assets_fetched: dict[str, bytes]
    successful_assets: list[str] = field(default_factory=list)
    failed_assets: dict[str, str] = field(default_factory=dict)


@dataclass
class FetchError(Exception):
    """Error information for a failed fetch."""

    url: str
    status_code: Optional[int]
    message: str


class STACFetcher:
    """Fetches STAC items and assets from URL references using async HTTP."""

    def __init__(
        self,
        timeout: float = 30.0,
        max_retries: int = 3,
        assume_role_arn: Optional[str] = None,
        auth_token: Optional[str] = None,
    ):
        self.timeout = timeout
        self.max_retries = max_retries
        self.assume_role_arn = assume_role_arn
        self.auth_token = auth_token
        self._s3_client = None

        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        self._client = httpx.AsyncClient(
            timeout=self.timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            headers=headers,
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def fetch_item(self, url: str, fetch_assets: AssetFetchMode = AssetFetchMode.NONE) -> FetchResult:
        """
        Fetch a STAC item from a URL reference.

        Args:
            url: HTTP/HTTPS URL pointing to a STAC item
            fetch_assets: Controls which assets to fetch (default: NONE)

        Returns:
            FetchResult containing the parsed item and fetched asset bytes

        Raises:
            FetchError: If the fetch fails after retries
        """
        response = await self._fetch_with_retry(url)
        try:
            item_dict = response.json()
            logger.info(
                f"Parsing STAC item from {url} "
                f"(type={item_dict.get('type', 'unknown')}, "
                f"id={item_dict.get('id', 'unknown')})"
            )
            # Clear links to prevent pystac from resolving them via unauthenticated HTTP.
            item_dict["links"] = []
            item = Item.from_dict(item_dict)
        except Exception as e:
            # Log response details to aid debugging parse failures
            content_type = response.headers.get("content-type", "unknown")
            body_preview = response.text[:500] if response.text else "(empty)"
            logger.info(
                f"Failed to parse STAC item from {url}: {e}\n"
                f"  Content-Type: {content_type}\n"
                f"  Body preview: {body_preview}"
            )
            raise FetchError(url=url, status_code=None, message=f"Failed to parse STAC item: {e}")

        assets_fetched, successful_assets, failed_assets = await self._fetch_assets(item, fetch_assets)
        return FetchResult(
            item=item,
            source_url=url,
            assets_fetched=assets_fetched,
            successful_assets=successful_assets,
            failed_assets=failed_assets,
        )

    async def fetch_collection(self, url: str, max_items: int = 100, concurrency_limit: int = 5) -> list[FetchResult]:
        """
        Fetch all items from a STAC collection URL.

        Args:
            url: HTTP/HTTPS URL pointing to a STAC collection
            max_items: Maximum number of items to fetch (raises error if exceeded)
            concurrency_limit: Maximum number of concurrent item fetches

        Returns:
            List of FetchResults for each item

        Raises:
            FetchError: If the collection exceeds max_items or fetch fails
        """
        response = await self._fetch_with_retry(url)
        try:
            collection_dict = response.json()
            collection = Collection.from_dict(collection_dict)
        except Exception as e:
            raise FetchError(url=url, status_code=None, message=f"Failed to parse STAC collection: {e}")

        item_links = await self._extract_item_links_async(collection, url)

        if len(item_links) > max_items:
            raise FetchError(
                url=url,
                status_code=None,
                message=f"Collection contains {len(item_links)} items, exceeds max_items={max_items}. "
                f"Consider using pagination or increasing the threshold.",
            )

        # Fetch items concurrently with a semaphore for limiting
        semaphore = asyncio.Semaphore(concurrency_limit)
        results: list[FetchResult] = []
        errors: list[tuple[str, Exception]] = []

        async def _fetch_one(item_url: str) -> None:
            async with semaphore:
                try:
                    result = await self.fetch_item(item_url)
                    results.append(result)
                except Exception as e:
                    errors.append((item_url, e))
                    logger.warning(f"Failed to fetch item {item_url}: {e}")

        await asyncio.gather(*[_fetch_one(link) for link in item_links])

        if errors:
            logger.warning(f"Failed to fetch {len(errors)} items from collection")

        return results

    def _extract_item_links(self, collection: Collection, base_url: str) -> list[str]:
        """
        Extract item URLs from a STAC collection.

        Args:
            collection: A PySTAC Collection object
            base_url: The base URL of the collection for resolving relative links

        Returns:
            List of absolute URLs to STAC items
        """
        item_urls: list[str] = []

        for link in collection.links:
            if link.rel == "item":
                item_url = self._resolve_url(link.href, base_url)
                item_urls.append(item_url)

        if not item_urls:
            for link in collection.links:
                if link.rel == "items":
                    items_url = self._resolve_url(link.href, base_url)
                    # Note: this path requires sync fetch; callers should
                    # use fetch_collection which handles this async.
                    # For link extraction we store the URL for later fetching.
                    item_urls.append(items_url)

        return item_urls

    async def _extract_item_links_async(self, collection: Collection, base_url: str) -> list[str]:
        """
        Extract item URLs from a STAC collection, fetching items endpoints as needed.

        Args:
            collection: A PySTAC Collection object
            base_url: The base URL of the collection for resolving relative links

        Returns:
            List of absolute URLs to STAC items
        """
        item_urls = self._collect_direct_item_links(collection, base_url)

        if not item_urls:
            item_urls = await self._collect_items_from_endpoints(collection, base_url)

        return item_urls

    def _collect_direct_item_links(self, collection: Collection, base_url: str) -> list[str]:
        """Collect URLs from direct 'item' rel links in the collection."""
        item_urls: list[str] = []
        for link in collection.links:
            if link.rel == "item":
                item_url = self._resolve_url(link.href, base_url)
                item_urls.append(item_url)
        return item_urls

    async def _collect_items_from_endpoints(self, collection: Collection, base_url: str) -> list[str]:
        """Fetch 'items' endpoints and extract individual item URLs."""
        item_urls: list[str] = []
        for link in collection.links:
            if link.rel == "items":
                items_url = self._resolve_url(link.href, base_url)
                urls = await self._fetch_items_endpoint(items_url)
                item_urls.extend(urls)
        return item_urls

    async def _fetch_items_endpoint(self, items_url: str) -> list[str]:
        """Fetch a single items endpoint and extract item URLs from it."""
        item_urls: list[str] = []
        try:
            items_response = await self._fetch_with_retry(items_url)
            items_data = items_response.json()
            if items_data.get("type") == "FeatureCollection":
                for feature in items_data.get("features", []):
                    url = self._extract_feature_url(feature, items_url)
                    if url:
                        item_urls.append(url)
        except Exception as e:
            logger.warning(f"Failed to fetch items endpoint {items_url}: {e}")
        return item_urls

    @staticmethod
    def _extract_feature_url(feature: dict, items_url: str) -> Optional[str]:
        """Extract a self URL from a feature, falling back to ID-based URL."""
        for feat_link in feature.get("links", []):
            if feat_link.get("rel") == "self":
                return feat_link["href"]
        item_id = feature.get("id")
        if item_id:
            return f"{items_url.rstrip('/')}/{item_id}"
        return None

    @staticmethod
    def _resolve_url(href: str, base_url: str) -> str:
        """Resolve a potentially relative URL against a base URL."""
        if href.startswith(("http://", "https://")):
            return href
        return urljoin(base_url, href)

    @staticmethod
    def _should_fetch_asset(
        mime_type: Optional[str],
        file_extension: Optional[str],
        fetch_mode: AssetFetchMode,
    ) -> bool:
        """
        Determine if an asset should be fetched based on MIME type and fetch mode.

        Args:
            mime_type: The asset's MIME type (may be None)
            file_extension: The asset's file path/URL for extension inference (may be None)
            fetch_mode: The current fetch mode

        Returns:
            True if the asset should be fetched
        """
        if fetch_mode == AssetFetchMode.ALL:
            return True
        if fetch_mode == AssetFetchMode.NONE:
            return False

        # Determine asset type from MIME type first, then fall back to extension
        asset_type = "unknown"
        if mime_type:
            asset_type = classify_mime_type(mime_type)

        if asset_type == "unknown" and file_extension:
            asset_type = infer_type_from_extension(file_extension)

        # When filtering is active and type is still unknown, skip the asset
        if asset_type == "unknown":
            return False

        if fetch_mode == AssetFetchMode.TEXT:
            return asset_type == "text"
        if fetch_mode == AssetFetchMode.IMAGE:
            return asset_type == "image"

        return False

    @staticmethod
    def _parse_s3_url(s3_url: str) -> tuple[str, str]:
        """
        Parse an S3 URL into bucket and key components.

        Args:
            s3_url: URL in the format s3://bucket/key

        Returns:
            Tuple of (bucket, key)

        Raises:
            ValueError: If the URL is not a valid s3:// URL
        """
        if not s3_url.startswith("s3://"):
            raise ValueError(f"Not a valid S3 URL (must start with s3://): {s3_url}")

        path = s3_url[5:]  # Strip "s3://"
        if not path or path == "/":
            raise ValueError(f"S3 URL missing bucket name: {s3_url}")

        parts = path.split("/", 1)
        bucket = parts[0]
        if not bucket:
            raise ValueError(f"S3 URL missing bucket name: {s3_url}")

        key = parts[1] if len(parts) > 1 else ""
        if not key:
            raise ValueError(f"S3 URL missing object key: {s3_url}")

        return bucket, key

    # ARN format: arn:aws:iam::<account-id>:role/<role-name>
    _ARN_PATTERN = re.compile(r"^arn:aws:iam::\d{12}:role/.+$")

    async def _assume_role(self, role_arn: str) -> dict:
        """
        Assume an IAM role and return temporary credentials.

        Args:
            role_arn: The ARN of the IAM role to assume

        Returns:
            Dict with AccessKeyId, SecretAccessKey, SessionToken

        Raises:
            FetchError: If role assumption fails
        """
        if not self._ARN_PATTERN.match(role_arn):
            raise FetchError(
                url="",
                status_code=None,
                message=f"Invalid assume_role_arn format: {role_arn}",
            )

        try:
            sts_client = boto3.client("sts")
            response = sts_client.assume_role(
                RoleArn=role_arn,
                RoleSessionName="stac-fetcher-session",
            )
            return response["Credentials"]
        except ClientError as e:
            raise FetchError(
                url="",
                status_code=None,
                message=f"Failed to assume role {role_arn}: {e}",
            )

    async def _get_s3_client(self):
        """
        Get or create an S3 client, using assumed role credentials if configured.

        Returns:
            A boto3 S3 client

        Raises:
            FetchError: If role assumption fails
        """
        if self._s3_client is not None:
            return self._s3_client

        if self.assume_role_arn:
            credentials = await self._assume_role(self.assume_role_arn)
            self._s3_client = boto3.client(
                "s3",
                aws_access_key_id=credentials["AccessKeyId"],
                aws_secret_access_key=credentials["SecretAccessKey"],
                aws_session_token=credentials["SessionToken"],
            )
        else:
            self._s3_client = boto3.client("s3")

        return self._s3_client

    async def _fetch_s3_asset(self, s3_url: str) -> bytes:
        """
        Fetch an asset from S3 using boto3.

        Uses assumed role credentials if assume_role_arn was provided,
        otherwise uses default IAM role. Retries on throttling and server
        errors with the same exponential backoff as HTTP fetches.

        Args:
            s3_url: URL in the format s3://bucket/key

        Returns:
            Asset content as bytes

        Raises:
            FetchError: If the fetch fails after retries
        """
        bucket, key = self._parse_s3_url(s3_url)
        s3_client = await self._get_s3_client()

        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                response = s3_client.get_object(Bucket=bucket, Key=key)
                return response["Body"].read()
            except ClientError as e:
                error_code = e.response["Error"]["Code"]
                message = e.response["Error"].get("Message", str(e))

                # Non-retryable errors
                if error_code in ("NoSuchBucket", "NoSuchKey", "AccessDenied", "403", "404"):
                    raise FetchError(
                        url=s3_url,
                        status_code=None,
                        message=f"S3 error ({error_code}): {message}",
                    )

                # Retryable errors (throttling, server errors)
                last_error = FetchError(
                    url=s3_url,
                    status_code=None,
                    message=f"S3 error ({error_code}): {message}",
                )
            except Exception as e:
                last_error = FetchError(
                    url=s3_url,
                    status_code=None,
                    message=f"S3 fetch error: {e}",
                )

            if attempt < self.max_retries:
                backoff = 2**attempt
                logger.info(f"Retrying S3 fetch {s3_url} in {backoff}s (attempt {attempt + 1}/{self.max_retries})")
                await asyncio.sleep(backoff)

        # Invariant: loop body always sets last_error on failure paths before
        # exiting, or returns on success. Reaching this point with last_error
        # unset indicates a logic error, not a retry exhaustion.
        if last_error is None:
            raise RuntimeError(f"S3 retry loop for {s3_url} exited without capturing an error")
        raise last_error

    async def _fetch_with_retry(self, url: str) -> httpx.Response:
        """
        Fetch a URL with exponential backoff retry for timeouts and 5xx errors.

        Retries up to max_retries times with exponential backoff (1s, 2s, 4s, ...).
        Does NOT retry on 4xx client errors.

        Args:
            url: The URL to fetch

        Returns:
            httpx.Response on success

        Raises:
            FetchError: If all retries are exhausted or a non-retryable error occurs
        """
        last_error: Optional[Exception] = None

        for attempt in range(self.max_retries + 1):
            try:
                response = await self._client.get(url)

                if response.status_code < 400:
                    return response

                if 400 <= response.status_code < 500:
                    raise FetchError(
                        url=url,
                        status_code=response.status_code,
                        message=f"Client error: HTTP {response.status_code}",
                    )

                last_error = FetchError(
                    url=url,
                    status_code=response.status_code,
                    message=f"Server error: HTTP {response.status_code}",
                )

            except FetchError:
                raise
            except httpx.TimeoutException:
                last_error = FetchError(
                    url=url,
                    status_code=None,
                    message="Request timed out",
                )
            except httpx.RequestError as e:
                last_error = FetchError(
                    url=url,
                    status_code=None,
                    message=f"Request error: {e}",
                )

            if attempt < self.max_retries:
                backoff = 2**attempt
                logger.info(f"Retrying {url} in {backoff}s (attempt {attempt + 1}/{self.max_retries})")
                await asyncio.sleep(backoff)

        # Invariant: loop body always sets last_error on failure paths before
        # exiting, or returns on success. Reaching this point with last_error
        # unset indicates a logic error, not a retry exhaustion.
        if last_error is None:
            raise RuntimeError(f"Retry loop for {url} exited without capturing an error")
        raise last_error

    async def _fetch_assets(
        self, item: Item, fetch_mode: AssetFetchMode = AssetFetchMode.NONE
    ) -> tuple[dict[str, bytes], list[str], dict[str, str]]:
        """
        Fetch assets referenced in a STAC item, filtered by fetch mode.

        Individual asset failures are handled gracefully — the fetcher continues
        with remaining assets and tracks failures separately.

        Args:
            item: A PySTAC Item with asset references
            fetch_mode: Controls which assets to fetch

        Returns:
            Tuple of (assets_fetched, successful_assets, failed_assets)
        """
        assets: dict[str, bytes] = {}
        successful: list[str] = []
        failed: dict[str, str] = {}

        for asset_key, asset in item.assets.items():
            mime_type = asset.media_type if hasattr(asset, "media_type") else None
            href = asset.href

            if not self._should_fetch_asset(mime_type, href, fetch_mode):
                continue

            protocol = detect_protocol(href)

            try:
                if protocol == "s3":
                    data = await self._fetch_s3_asset(href)
                elif protocol == "http":
                    response = await self._fetch_with_retry(href)
                    data = response.content
                else:
                    raise FetchError(
                        url=href,
                        status_code=None,
                        message=f"Unsupported protocol for asset URL: {href}",
                    )
                assets[asset_key] = data
                successful.append(asset_key)
            except (FetchError, Exception) as e:
                error_msg = str(e) if not isinstance(e, FetchError) else e.message
                logger.warning(f"Failed to fetch asset '{asset_key}' from {href}: {error_msg}")
                failed[asset_key] = error_msg

        return assets, successful, failed
