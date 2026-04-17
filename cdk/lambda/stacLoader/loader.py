#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""STACLoader - Loads fetched STAC items into the workspace."""

import json
import logging
from dataclasses import dataclass
from typing import Optional

from common.stac_reference import STACReference
from common.workspace import Workspace
from fetcher import FetchError, FetchResult, STACFetcher

logger = logging.getLogger(__name__)

INDEX_FILENAME = "stac-loader-index.json"


@dataclass
class LoadResult:
    """Result of loading a STAC item into the workspace."""

    stac_reference: STACReference
    source_url: str
    reused_existing: bool


@dataclass
class BatchLoadResult:
    """Result of loading multiple STAC items."""

    successful: list[LoadResult]
    failed: list[tuple[str, FetchError]]  # (url, error)

    def to_response(self) -> str:
        """Format as human-readable response for MCP tool."""
        lines = []
        if self.successful:
            lines.append(f"Successfully loaded {len(self.successful)} items:")
            for result in self.successful:
                status = "(reused)" if result.reused_existing else "(new)"
                lines.append(f"  - {result.stac_reference} {status}")
        if self.failed:
            lines.append(f"Failed to load {len(self.failed)} items:")
            for url, error in self.failed:
                lines.append(f"  - {url}: {error.message}")
        return "\n".join(lines)


class STACLoader:
    """Loads STAC items into the geo-agent workspace."""

    def __init__(self, workspace: Workspace):
        self.workspace = workspace
        self._url_index: dict[str, STACReference] = {}
        self._load_index()

    def _index_path(self) -> str:
        """Return the filesystem path for the index file."""
        return f"{self.workspace.prefix}/stac/{INDEX_FILENAME}"

    def _load_index(self) -> None:
        """Load the URL-to-STACReference index from workspace.

        Handles missing or corrupted index gracefully by starting with
        an empty index.
        """
        index_path = self._index_path()
        try:
            if self.workspace.filesystem.exists(index_path):
                with self.workspace.filesystem.open(index_path, "r") as f:
                    raw = json.loads(f.read())
                self._url_index = {url: STACReference(encoded_value=ref_str) for url, ref_str in raw.items()}
                logger.info(f"Loaded URL index with {len(self._url_index)} entries")
        except Exception as e:
            logger.warning(f"Failed to load URL index, starting fresh: {e}")
            self._url_index = {}

    def _save_index(self) -> None:
        """Save the URL-to-STACReference index to workspace."""
        index_path = self._index_path()
        raw = {url: str(ref) for url, ref in self._url_index.items()}
        try:
            stac_dir = f"{self.workspace.prefix}/stac"
            self.workspace._safe_makedirs(stac_dir)
            with self.workspace.filesystem.open(index_path, "w") as f:
                f.write(json.dumps(raw))
            logger.info(f"Saved URL index with {len(self._url_index)} entries")
        except Exception as e:
            logger.warning(f"Failed to save URL index: {e}")
            raise

    def _update_index(self, source_url: str, stac_ref: STACReference) -> None:
        """Add an entry to the index and persist it."""
        self._url_index[source_url] = stac_ref
        self._save_index()

    def find_existing(self, source_url: str) -> Optional[STACReference]:
        """Check if an item from this source URL already exists.

        Uses in-memory index for O(1) lookup.

        Args:
            source_url: Original URL the item was fetched from

        Returns:
            STACReference if found, None otherwise
        """
        return self._url_index.get(source_url)

    def load_item(
        self,
        fetch_result: FetchResult,
        collections: Optional[list[str]] = None,
    ) -> LoadResult:
        """Load a fetched STAC item into the workspace.

        Checks for an existing item first (caching). If not cached,
        writes asset bytes directly to the workspace filesystem (no temp
        files), updates the URL index, and returns a LoadResult.

        Args:
            fetch_result: Result from STACFetcher
            collections: Optional collection hierarchy for organization

        Returns:
            LoadResult with the STACReference
        """
        # Check cache first
        existing = self.find_existing(fetch_result.source_url)
        if existing is not None:
            logger.info(f"Reusing existing item for {fetch_result.source_url}")
            return LoadResult(
                stac_reference=existing,
                source_url=fetch_result.source_url,
                reused_existing=True,
            )

        # Write asset bytes directly to workspace (no temp files)
        assets_bytes = fetch_result.assets_fetched if fetch_result.assets_fetched else None

        stac_ref = self.workspace.create_item_from_bytes(
            item=fetch_result.item,
            assets_bytes=assets_bytes,
            collections=collections,
        )

        # Update index
        self._update_index(fetch_result.source_url, stac_ref)

        return LoadResult(
            stac_reference=stac_ref,
            source_url=fetch_result.source_url,
            reused_existing=False,
        )

    async def load_batch(
        self,
        urls: list[str],
        fetcher: STACFetcher,
        collections: Optional[list[str]] = None,
    ) -> BatchLoadResult:
        """Load multiple STAC items from URLs into the workspace.

        Processes each URL independently, continuing on individual failures.
        Collects successful LoadResults and failed (url, error) pairs.

        Args:
            urls: List of URL references to STAC items
            fetcher: STACFetcher instance for fetching items
            collections: Optional collection hierarchy for organization

        Returns:
            BatchLoadResult with successful and failed lists
        """
        successful: list[LoadResult] = []
        failed: list[tuple[str, FetchError]] = []

        for url in urls:
            try:
                # Fetch the STAC item (async)
                fetch_result = await fetcher.fetch_item(url)

                # Load into workspace
                load_result = self.load_item(fetch_result, collections)
                successful.append(load_result)

            except FetchError as e:
                logger.warning(f"Failed to fetch {url}: {e.message}")
                failed.append((url, e))
            except Exception as e:
                # Wrap unexpected errors in FetchError
                error = FetchError(url=url, status_code=None, message=str(e))
                logger.warning(f"Failed to process {url}: {e}")
                failed.append((url, error))

        return BatchLoadResult(successful=successful, failed=failed)

    async def load_collection(
        self,
        collection_url: str,
        fetcher: STACFetcher,
        max_items: int = 100,
        concurrency_limit: int = 5,
        parent_collections: Optional[list[str]] = None,
    ) -> list[STACReference]:
        """Load all items from a STAC collection into the workspace.

        Fetches the collection, extracts the collection name, and loads all
        items organized under the collection name in the STACReference path.

        Args:
            collection_url: URL pointing to a STAC collection
            fetcher: STACFetcher instance for fetching items
            max_items: Maximum number of items to fetch (raises error if exceeded)
            concurrency_limit: Maximum number of concurrent item fetches
            parent_collections: Optional parent collection hierarchy

        Returns:
            List of STACReferences for all loaded items

        Raises:
            FetchError: If the collection exceeds max_items or fetch fails
        """
        # Fetch collection to get its name/ID
        response = await fetcher._fetch_with_retry(collection_url)
        try:
            collection_dict = response.json()
            collection_id = collection_dict.get("id", "unknown-collection")
        except Exception as e:
            raise FetchError(
                url=collection_url,
                status_code=None,
                message=f"Failed to parse collection metadata: {e}",
            )

        # Build the collection hierarchy
        collections = list(parent_collections) if parent_collections else []
        collections.append(collection_id)

        # Fetch all items from the collection (async)
        fetch_results = await fetcher.fetch_collection(
            url=collection_url,
            max_items=max_items,
            concurrency_limit=concurrency_limit,
        )

        # Load each item with the collection hierarchy
        stac_references: list[STACReference] = []
        for fetch_result in fetch_results:
            try:
                load_result = self.load_item(fetch_result, collections=collections)
                stac_references.append(load_result.stac_reference)
            except Exception as e:
                logger.warning(f"Failed to load item {fetch_result.source_url}: {e}")
                # Continue with other items

        return stac_references
