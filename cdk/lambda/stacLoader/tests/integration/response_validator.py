# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Response validation helpers for STAC Loader integration tests.

Provides functions to validate the structure and content of responses
from the load_stac_items MCP tool, ensuring they conform to the
expected schema.

Requirements: 11.5
"""

from typing import Any


class ResponseValidationError(AssertionError):
    """Raised when a response fails structural or content validation."""

    pass


def validate_load_response(response: dict[str, Any]) -> None:
    """Validate the top-level structure of a load_stac_items response.

    Checks that the response contains the required keys with correct types:
    - successful: list of successfully loaded items
    - failed: list of failed items
    - summary: human-readable summary string
    - asset_statistics: dict with successful_assets and failed_assets counts

    Args:
        response: Parsed JSON response from load_stac_items.

    Raises:
        ResponseValidationError: If the response structure is invalid.
    """
    if "error" in response:
        raise ResponseValidationError(f"Response contains an error: {response['error']}")

    _require_key(response, "successful", list)
    _require_key(response, "failed", list)
    _require_key(response, "summary", str)
    _require_key(response, "asset_statistics", dict)

    stats = response["asset_statistics"]
    _require_key(stats, "successful_assets", int, parent="asset_statistics")
    _require_key(stats, "failed_assets", int, parent="asset_statistics")


def validate_successful_item(item: dict[str, Any]) -> None:
    """Validate the structure of a single successful item entry.

    Checks that the item contains:
    - url: non-empty string
    - stac_reference: non-empty string
    - reused: boolean
    - successful_assets: list of strings
    - failed_assets: dict mapping string keys to string error messages

    Args:
        item: A single entry from the 'successful' list.

    Raises:
        ResponseValidationError: If the item structure is invalid.
    """
    _require_key(item, "url", str)
    _require_key(item, "stac_reference", str)
    _require_key(item, "reused", bool)
    _require_key(item, "successful_assets", list)
    _require_key(item, "failed_assets", dict)

    if not item["url"]:
        raise ResponseValidationError("Item 'url' must be non-empty")
    if not item["stac_reference"]:
        raise ResponseValidationError("Item 'stac_reference' must be non-empty")

    # Validate successful_assets entries are strings
    for i, asset_key in enumerate(item["successful_assets"]):
        if not isinstance(asset_key, str):
            raise ResponseValidationError(f"successful_assets[{i}] must be a string, got {type(asset_key).__name__}")

    # Validate failed_assets entries are string -> string
    for key, msg in item["failed_assets"].items():
        if not isinstance(key, str):
            raise ResponseValidationError(f"failed_assets key must be a string, got {type(key).__name__}")
        if not isinstance(msg, str):
            raise ResponseValidationError(f"failed_assets['{key}'] value must be a string, got {type(msg).__name__}")


def validate_failed_item(item: dict[str, Any]) -> None:
    """Validate the structure of a single failed item entry.

    Checks that the item contains:
    - url: non-empty string
    - error: non-empty string

    Args:
        item: A single entry from the 'failed' list.

    Raises:
        ResponseValidationError: If the item structure is invalid.
    """
    _require_key(item, "url", str)
    _require_key(item, "error", str)

    if not item["url"]:
        raise ResponseValidationError("Failed item 'url' must be non-empty")
    if not item["error"]:
        raise ResponseValidationError("Failed item 'error' must be non-empty")


def validate_asset_statistics_consistency(response: dict[str, Any]) -> None:
    """Validate that asset_statistics counts match the actual item data.

    Sums up successful_assets and failed_assets across all successful items
    and verifies they match the aggregate counts in asset_statistics.

    Args:
        response: Parsed JSON response from load_stac_items.

    Raises:
        ResponseValidationError: If the counts are inconsistent.
    """
    stats = response.get("asset_statistics", {})
    expected_successful = stats.get("successful_assets", 0)
    expected_failed = stats.get("failed_assets", 0)

    actual_successful = sum(len(item.get("successful_assets", [])) for item in response.get("successful", []))
    actual_failed = sum(len(item.get("failed_assets", {})) for item in response.get("successful", []))

    if actual_successful != expected_successful:
        raise ResponseValidationError(
            f"asset_statistics.successful_assets ({expected_successful}) does not "
            f"match sum of item successful_assets ({actual_successful})"
        )
    if actual_failed != expected_failed:
        raise ResponseValidationError(
            f"asset_statistics.failed_assets ({expected_failed}) does not "
            f"match sum of item failed_assets ({actual_failed})"
        )


def validate_full_response(
    response: dict[str, Any],
    expected_successful: int | None = None,
    expected_failed: int | None = None,
) -> None:
    """Perform comprehensive validation of a load_stac_items response.

    Validates the top-level structure, each successful and failed item,
    and the consistency of asset statistics.

    Args:
        response: Parsed JSON response from load_stac_items.
        expected_successful: If set, assert this many items succeeded.
        expected_failed: If set, assert this many items failed.

    Raises:
        ResponseValidationError: If any validation check fails.
    """
    validate_load_response(response)

    if expected_successful is not None:
        actual = len(response["successful"])
        if actual != expected_successful:
            raise ResponseValidationError(f"Expected {expected_successful} successful items, got {actual}")

    if expected_failed is not None:
        actual = len(response["failed"])
        if actual != expected_failed:
            raise ResponseValidationError(f"Expected {expected_failed} failed items, got {actual}")

    for item in response["successful"]:
        validate_successful_item(item)

    for item in response["failed"]:
        validate_failed_item(item)

    validate_asset_statistics_consistency(response)


def _require_key(data: dict, key: str, expected_type: type, parent: str = "") -> None:
    """Check that a key exists in a dict and has the expected type."""
    context = f"{parent}.{key}" if parent else key
    if key not in data:
        raise ResponseValidationError(f"Missing required key: '{context}'")
    if not isinstance(data[key], expected_type):
        raise ResponseValidationError(
            f"Key '{context}' must be {expected_type.__name__}, " f"got {type(data[key]).__name__}"
        )
