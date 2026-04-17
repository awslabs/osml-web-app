# Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
MCP Test Client for STAC Loader integration tests.

Uses the MCP Python SDK ClientSession with streamablehttp_client transport
to communicate with the deployed STAC Loader MCP server via its ALB endpoint.

Follows the same connect-per-call pattern as osml-geo-agents integration tests,
which is required for stateless_http servers.

The server uses an async job pattern: load_stac_items returns a job_id
immediately, and get_load_status is polled until the job completes.
This client abstracts that into a single call_load_stac_items method.

Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
"""

import asyncio
import json
import logging
import traceback
from typing import Any, Optional

from mcp.client.streamable_http import streamablehttp_client

from mcp import ClientSession

logger = logging.getLogger(__name__)


class MCPTestClientError(Exception):
    """Raised when the MCPTestClient encounters an error."""

    pass


class MCPTestClient:
    """Test client using MCP Python SDK for integration tests.

    Uses a connect-per-call pattern: each tool invocation opens a fresh
    streamablehttp_client and ClientSession. Abstracts the async job
    pattern (load_stac_items + get_load_status polling) into a single
    call for test convenience.
    """

    def __init__(
        self,
        endpoint_url: str,
        timeout: float = 120.0,
        poll_interval: float = 1.0,
    ):
        """Initialize test client.

        Args:
            endpoint_url: ALB endpoint URL for the deployed MCP server.
            timeout: Maximum seconds for the entire load operation.
            poll_interval: Seconds between status polls.
        """
        if not endpoint_url:
            raise MCPTestClientError("endpoint_url must be a non-empty string")

        self._endpoint_url = endpoint_url.rstrip("/")
        self._timeout = timeout
        self._poll_interval = poll_interval

    @property
    def is_connected(self) -> bool:
        """Return True. With connect-per-call, we are always 'ready'."""
        return True

    async def connect(self) -> None:
        """No-op for connect-per-call pattern. Kept for API compatibility."""
        logger.info(f"MCPTestClient ready (connect-per-call) for {self._endpoint_url}")

    async def disconnect(self) -> None:
        """No-op for connect-per-call pattern. Kept for API compatibility."""
        logger.info("MCPTestClient disconnected (no-op for connect-per-call)")

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a single MCP tool with a fresh connection.

        Args:
            tool_name: Name of the tool to invoke.
            arguments: Tool arguments dict.

        Returns:
            Parsed JSON response.
        """

        async def _invoke():
            async with streamablehttp_client(self._endpoint_url) as (
                read_stream,
                write_stream,
                _,
            ):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    return await session.call_tool(tool_name, arguments=arguments)

        result = await asyncio.wait_for(_invoke(), timeout=30.0)

        if hasattr(result, "content") and result.content:
            for block in result.content:
                if hasattr(block, "text"):
                    return json.loads(block.text)

        return {"error": "No text content in response"}

    def _build_load_arguments(
        self,
        urls: list[str],
        collection: Optional[str],
        fetch_assets: str,
        assume_role_arn: Optional[str],
    ) -> dict[str, Any]:
        """Build the arguments dict for load_stac_items."""
        arguments: dict[str, Any] = {
            "urls": urls,
            "fetch_assets": fetch_assets,
        }
        if collection is not None:
            arguments["collection"] = collection
        if assume_role_arn is not None:
            arguments["assume_role_arn"] = assume_role_arn
        return arguments

    async def _start_load_job(self, arguments: dict[str, Any]) -> str:
        """Start a load job and return the job_id.

        Raises:
            MCPTestClientError: If the response contains an error or no job_id.
        """
        start_result = await self._call_tool("load_stac_items", arguments)

        if "error" in start_result:
            raise MCPTestClientError(f"load_stac_items returned error: {start_result['error']}")

        job_id = start_result.get("job_id")
        if not job_id:
            raise MCPTestClientError("No job_id in load_stac_items response")

        return job_id

    async def _poll_until_done(self, job_id: str) -> dict[str, Any]:
        """Poll get_load_status until the job completes or times out.

        Raises:
            MCPTestClientError: If the job does not complete within the timeout.
        """
        deadline = asyncio.get_event_loop().time() + self._timeout
        status_result: dict[str, Any] = {}

        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(self._poll_interval)

            status_result = await self._call_tool("get_load_status", {"job_id": job_id})

            job_status = status_result.get("status")
            processed = status_result.get("items_processed", 0)
            total = status_result.get("items_total", 0)
            logger.info(f"Job {job_id}: {job_status} ({processed}/{total})")

            if job_status in ("completed", "failed"):
                return status_result

        raise MCPTestClientError(f"Job {job_id} did not complete within {self._timeout}s")

    async def call_load_stac_items(
        self,
        urls: list[str],
        collection: Optional[str] = None,
        fetch_assets: str = "none",
        assume_role_arn: Optional[str] = None,
    ) -> dict[str, Any]:
        """Load STAC items and poll until the job completes.

        Calls load_stac_items to start the job, then polls get_load_status
        until the job finishes or the timeout is reached.

        Args:
            urls: List of URL references to STAC items.
            collection: Optional collection name.
            fetch_assets: Asset fetch mode.
            assume_role_arn: Optional IAM role ARN for S3 access.

        Returns:
            Final job result with successful/failed items.

        Raises:
            MCPTestClientError: If the job fails or times out.
        """
        arguments = self._build_load_arguments(urls, collection, fetch_assets, assume_role_arn)

        try:
            logger.info(f"Calling load_stac_items with {len(urls)} URL(s), " f"fetch_assets={fetch_assets}")

            job_id = await self._start_load_job(arguments)
            logger.info(f"Job started: {job_id}")

            return await self._poll_until_done(job_id)

        except MCPTestClientError:
            raise
        except asyncio.TimeoutError:
            raise MCPTestClientError(f"Tool call timed out after {self._timeout}s")
        except json.JSONDecodeError as e:
            raise MCPTestClientError(f"Invalid JSON in server response: {e}") from e
        except Exception as e:
            logger.error(f"Error: {type(e).__name__}: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            raise MCPTestClientError(f"Failed to call load_stac_items: {e}") from e
