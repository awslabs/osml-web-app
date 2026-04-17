#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Configuration for the STAC Data Loader."""

from dataclasses import dataclass


@dataclass
class DataLoaderConfig:
    """Configuration for the STAC Data Loader."""

    # Fetch settings
    request_timeout: float = 30.0
    max_retries: int = 3

    # Collection settings
    max_collection_items: int = 100
    concurrency_limit: int = 5

    # Lifecycle settings
    retention_days: int = 7

    # Metadata keys
    source_url_key: str = "stac_loader_source_url"
    timestamp_key: str = "stac_loader_timestamp"

    def validate(self) -> None:
        """Validate configuration values."""
        if self.request_timeout <= 0:
            raise ValueError("request_timeout must be positive")
        if self.max_retries < 0:
            raise ValueError("max_retries cannot be negative")
        if self.max_collection_items <= 0:
            raise ValueError("max_collection_items must be positive")
        if self.concurrency_limit <= 0:
            raise ValueError("concurrency_limit must be positive")
        if self.retention_days <= 0:
            raise ValueError("retention_days must be positive")
