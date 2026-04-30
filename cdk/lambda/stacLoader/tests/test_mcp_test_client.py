# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for MCPTestClient.

Tests initialization, parameter passing, error handling, and the
async job polling pattern.

Requirements: 8.4, 8.5
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from tests.integration.test_client import MCPTestClient, MCPTestClientError


class TestMCPTestClientInit:
    """Tests for MCPTestClient initialization."""

    def test_init_stores_endpoint(self):
        client = MCPTestClient("http://localhost:8080")
        assert client._endpoint_url == "http://localhost:8080"

    def test_init_strips_trailing_slash(self):
        client = MCPTestClient("http://localhost:8080/")
        assert client._endpoint_url == "http://localhost:8080"

    def test_init_default_timeout(self):
        client = MCPTestClient("http://localhost:8080")
        assert client._timeout == 120.0

    def test_init_custom_timeout(self):
        client = MCPTestClient("http://localhost:8080", timeout=60.0)
        assert client._timeout == 60.0

    def test_init_empty_url_raises(self):
        with pytest.raises(MCPTestClientError, match="non-empty string"):
            MCPTestClient("")

    def test_init_is_connected(self):
        client = MCPTestClient("http://localhost:8080")
        assert client.is_connected


class TestMCPTestClientCallTool:
    """Tests for the async job polling pattern."""

    def _make_mock_tool_response(self, data: dict):
        """Create a mock MCP tool result with JSON text content."""
        mock_content = MagicMock()
        mock_content.text = json.dumps(data)
        mock_result = MagicMock()
        mock_result.content = [mock_content]
        return mock_result

    def test_call_starts_job_and_polls(self):
        """call_load_stac_items should start a job then poll until completed."""
        client = MCPTestClient("http://localhost:8080", poll_interval=0.01)

        start_response = self._make_mock_tool_response(
            {
                "job_id": "abc123",
                "status": "running",
            }
        )
        status_running = self._make_mock_tool_response(
            {
                "job_id": "abc123",
                "status": "running",
                "items_processed": 0,
                "items_total": 1,
            }
        )
        status_done = self._make_mock_tool_response(
            {
                "job_id": "abc123",
                "status": "completed",
                "items_processed": 1,
                "items_total": 1,
                "successful": [{"url": "https://example.com/item.json"}],
                "failed": [],
            }
        )

        call_count = 0

        async def mock_call_tool(tool_name, arguments):
            nonlocal call_count
            call_count += 1
            if tool_name == "load_stac_items":
                return start_response
            # First poll returns running, second returns completed
            if call_count <= 3:
                return status_running
            return status_done

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.initialize = AsyncMock()
        mock_session.call_tool = AsyncMock(side_effect=mock_call_tool)

        mock_transport = AsyncMock()
        mock_transport.__aenter__ = AsyncMock(return_value=(MagicMock(), MagicMock(), MagicMock()))
        mock_transport.__aexit__ = AsyncMock(return_value=None)

        async def run():
            with patch(
                "tests.integration.test_client.streamablehttp_client",
                return_value=mock_transport,
            ):
                with patch(
                    "tests.integration.test_client.ClientSession",
                    return_value=mock_session,
                ):
                    result = await client.call_load_stac_items(
                        urls=["https://example.com/item.json"],
                    )

            assert result["status"] == "completed"
            assert len(result["successful"]) == 1

        asyncio.run(run())

    def test_call_returns_error_on_validation_failure(self):
        """Validation errors from load_stac_items should raise MCPTestClientError.

        _start_load_job is documented to raise when the tool response contains
        an 'error' key (e.g. invalid fetch_assets value), so call_load_stac_items
        surfaces those as MCPTestClientError for callers to handle.
        """
        client = MCPTestClient("http://localhost:8080")

        error_response = self._make_mock_tool_response({"error": "Invalid fetch_assets value"})

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=None)
        mock_session.initialize = AsyncMock()
        mock_session.call_tool = AsyncMock(return_value=error_response)

        mock_transport = AsyncMock()
        mock_transport.__aenter__ = AsyncMock(return_value=(MagicMock(), MagicMock(), MagicMock()))
        mock_transport.__aexit__ = AsyncMock(return_value=None)

        async def run():
            with patch(
                "tests.integration.test_client.streamablehttp_client",
                return_value=mock_transport,
            ):
                with patch(
                    "tests.integration.test_client.ClientSession",
                    return_value=mock_session,
                ):
                    with pytest.raises(MCPTestClientError, match="Invalid fetch_assets value"):
                        await client.call_load_stac_items(
                            urls=["https://example.com/item.json"],
                            fetch_assets="invalid",
                        )

        asyncio.run(run())

    def test_call_connection_failure_raises(self):
        """Connection failure should raise MCPTestClientError."""
        client = MCPTestClient("http://unreachable:9999")

        async def run():
            with patch("tests.integration.test_client.streamablehttp_client") as mock_transport:
                mock_cm = AsyncMock()
                mock_cm.__aenter__ = AsyncMock(side_effect=ConnectionError("Connection refused"))
                mock_cm.__aexit__ = AsyncMock(return_value=None)
                mock_transport.return_value = mock_cm

                with pytest.raises(MCPTestClientError, match="Failed to call"):
                    await client.call_load_stac_items(urls=["https://example.com/item.json"])

        asyncio.run(run())
