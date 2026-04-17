#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for MCP tool parameter validation.

Tests invalid fetch_assets values and invalid assume_role_arn formats.
Requirements: 12.5, 12.6
"""

import asyncio
import json
import os

import pytest
from deployed_server import _ARN_PATTERN, _VALID_FETCH_ASSETS, create_mcp_server


def _get_load_tool():
    """Create an MCP server and return the load_stac_items tool function."""
    os.environ.setdefault("WORKSPACE_BUCKET_NAME", "test-workspace-bucket")
    mcp = create_mcp_server("test-workspace-bucket")
    tools = mcp._tool_manager._tools
    return tools["load_stac_items"].fn


class TestFetchAssetsValidation:
    """Tests for fetch_assets parameter validation (Requirement 12.5)."""

    def test_valid_fetch_assets_values(self):
        """All valid fetch_assets values should be accepted by the validation set."""
        for value in ("none", "text", "image", "all"):
            assert value in _VALID_FETCH_ASSETS

    @pytest.mark.parametrize(
        "invalid_value",
        [
            "invalid",
            "NONE",
            "Text",
            "ALL",
            "everything",
            "",
            "images",
            "texts",
            "binary",
            "fetch_all",
        ],
    )
    def test_invalid_fetch_assets_rejected(self, invalid_value):
        """Invalid fetch_assets values should not be in the valid set."""
        assert invalid_value not in _VALID_FETCH_ASSETS

    @pytest.mark.parametrize(
        "invalid_value",
        ["invalid", "NONE", "everything", "", "images"],
    )
    def test_invalid_fetch_assets_returns_error(self, invalid_value):
        """MCP tool should return a clear error for invalid fetch_assets values (12.5)."""
        load_tool = _get_load_tool()

        async def run():
            return await load_tool(
                urls=["https://example.com/item.json"],
                collection=None,
                fetch_assets=invalid_value,
                assume_role_arn=None,
            )

        result = asyncio.run(run())
        parsed = json.loads(result)
        assert "error" in parsed
        assert "Invalid fetch_assets value" in parsed["error"]
        assert invalid_value in parsed["error"]


class TestAssumeRoleArnValidation:
    """Tests for assume_role_arn parameter validation (Requirement 12.6)."""

    @pytest.mark.parametrize(
        "valid_arn",
        [
            "arn:aws:iam::123456789012:role/MyRole",
            "arn:aws:iam::000000000000:role/some-role-name",
            "arn:aws:iam::999999999999:role/path/to/role",
        ],
    )
    def test_valid_arn_formats_accepted(self, valid_arn):
        """Valid ARN formats should match the pattern."""
        assert _ARN_PATTERN.match(valid_arn) is not None

    @pytest.mark.parametrize(
        "invalid_arn",
        [
            "not-an-arn",
            "arn:aws:iam::12345:role/TooShort",
            "arn:aws:iam::1234567890123:role/TooLong",
            "arn:aws:iam::abcdefghijkl:role/NotDigits",
            "arn:aws:iam::123456789012:user/NotARole",
            "arn:aws:iam::123456789012:role/",
            "arn:aws:s3:::my-bucket",
            "",
        ],
    )
    def test_invalid_arn_formats_rejected(self, invalid_arn):
        """Invalid ARN formats should not match the pattern."""
        assert _ARN_PATTERN.match(invalid_arn) is None

    @pytest.mark.parametrize(
        "invalid_arn",
        [
            "not-an-arn",
            "arn:aws:iam::12345:role/TooShort",
            "arn:aws:iam::abcdefghijkl:role/NotDigits",
            "arn:aws:s3:::my-bucket",
        ],
    )
    def test_invalid_arn_returns_error(self, invalid_arn):
        """MCP tool should return a clear error for invalid assume_role_arn formats (12.6)."""
        load_tool = _get_load_tool()

        async def run():
            return await load_tool(
                urls=["https://example.com/item.json"],
                collection=None,
                fetch_assets="none",
                assume_role_arn=invalid_arn,
            )

        result = asyncio.run(run())
        parsed = json.loads(result)
        assert "error" in parsed
        assert "Invalid assume_role_arn format" in parsed["error"]
        assert invalid_arn in parsed["error"]

    def test_none_arn_passes_validation(self):
        """None assume_role_arn should pass validation (it's optional)."""
        load_tool = _get_load_tool()

        async def run():
            return await load_tool(
                urls=["https://example.com/item.json"],
                collection=None,
                fetch_assets="none",
                assume_role_arn=None,
            )

        result = asyncio.run(run())
        parsed = json.loads(result)
        # Should not have a validation error - may fail at fetch stage, but not at validation
        if "error" in parsed:
            assert "Invalid assume_role_arn" not in parsed["error"]
            assert "Invalid fetch_assets" not in parsed["error"]
