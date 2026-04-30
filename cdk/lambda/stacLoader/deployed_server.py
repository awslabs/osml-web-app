#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""FastMCP server for the STAC Data Loader, deployed as an ECS Fargate service."""

import asyncio
import contextlib
import contextvars
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import uvicorn
from common.workspace import Workspace
from fetcher import AssetFetchMode, FetchError, STACFetcher
from loader import STACLoader
from mcp.server.fastmcp import FastMCP
from pydantic import Field
from s3fs import S3FileSystem
from starlette import status
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount, Route

from config import DataLoaderConfig

# Valid values for the fetch_assets parameter
_VALID_FETCH_ASSETS = frozenset({"none", "text", "image", "all"})

# Regex pattern for validating IAM role ARNs
_ARN_PATTERN = re.compile(r"^arn:aws:iam::\d{12}:role/.+$")

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Auth token passthrough via contextvars
# ---------------------------------------------------------------------------

# Stores the Bearer token extracted from the incoming MCP request so that
# tool handlers can forward it to the internal data catalog without the
# LLM needing to know about authentication.
_passthrough_auth_token: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "_passthrough_auth_token", default=None
)


class AuthTokenMiddleware:
    """ASGI middleware that extracts the Authorization Bearer token from
    incoming requests and stores it in a contextvar for downstream use."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            auth_value = headers.get(b"authorization", b"").decode("utf-8", errors="ignore")
            token = None
            if auth_value.lower().startswith("bearer "):
                token = auth_value[7:]  # Strip "Bearer " prefix
            _passthrough_auth_token.set(token)
        await self.app(scope, receive, send)


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------


class JobStatus(str, Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Job:
    job_id: str
    status: JobStatus = JobStatus.RUNNING
    items_total: int = 0
    items_processed: int = 0
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


# In-memory job store (single ECS container, no need for external state)
_jobs: dict[str, Job] = {}

# Auto-cleanup jobs older than 1 hour
_JOB_TTL_SECONDS = 3600


def _cleanup_old_jobs() -> None:
    now = time.time()
    expired = [jid for jid, j in _jobs.items() if now - j.created_at > _JOB_TTL_SECONDS]
    for jid in expired:
        del _jobs[jid]


# ---------------------------------------------------------------------------
# Workspace helpers
# ---------------------------------------------------------------------------


def get_workspace_bucket_name() -> str:
    """Get the workspace bucket name from environment."""
    bucket_name = os.environ.get("WORKSPACE_BUCKET_NAME")
    if not bucket_name:
        raise RuntimeError("WORKSPACE_BUCKET_NAME environment variable not set")
    return bucket_name


def create_workspace(bucket_name: str) -> Workspace:
    """Create a fresh S3-backed workspace instance.

    Uses the same prefix pattern as osml-geo-agents: s3://{bucket_name}
    """
    filesystem = S3FileSystem()
    return Workspace(filesystem=filesystem, prefix=f"s3://{bucket_name}")


# ---------------------------------------------------------------------------
# Background job worker
# ---------------------------------------------------------------------------


def _run_in_isolated_loop(coro) -> None:
    """Run an async coroutine on a dedicated event loop in the current thread.

    This isolates the httpx connection pool used for STAC fetching from
    the MCP server's uvicorn/starlette event loop, preventing socket
    contention (EBUSY) when the server is handling concurrent poll
    requests from the MCP client.
    """
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(coro)
    finally:
        loop.close()


async def _run_load_job_async(
    job: Job,
    urls: list[str],
    workspace_bucket: str,
    collection: Optional[str],
    fetch_mode: AssetFetchMode,
    assume_role_arn: Optional[str],
    auth_token: Optional[str],
    config: DataLoaderConfig,
) -> None:
    """Execute the STAC loading work using a dedicated httpx client.

    This coroutine is designed to run on a dedicated event loop in a
    separate thread (via _run_load_job_in_thread), isolating its httpx
    connection pool from the MCP server's uvicorn/starlette connections.
    """
    try:
        workspace = create_workspace(workspace_bucket)
        loader = STACLoader(workspace)
        successful: list[dict] = []
        failed: list[dict] = []

        async with STACFetcher(
            timeout=config.request_timeout,
            max_retries=config.max_retries,
            assume_role_arn=assume_role_arn,
            auth_token=auth_token,
        ) as fetcher:
            for url in urls:
                item_start = time.time()
                try:
                    fetch_result = await fetcher.fetch_item(url, fetch_assets=fetch_mode)
                    fetch_duration = time.time() - item_start

                    # Resolve collections: explicit parameter > item's collection field > None
                    item_collections = [collection] if collection else None
                    if item_collections is None and fetch_result.item.collection_id:
                        item_collections = [fetch_result.item.collection_id]

                    upload_start = time.time()
                    load_result = loader.load_item(fetch_result, item_collections)
                    upload_duration = time.time() - upload_start

                    data_size = sum(len(v) for v in fetch_result.assets_fetched.values())
                    logger.info(
                        f"Processed {url}: fetch={fetch_duration:.2f}s, "
                        f"upload={upload_duration:.2f}s, data_size={data_size} bytes, "
                        f"reused={load_result.reused_existing}"
                    )

                    successful.append(
                        {
                            "url": url,
                            "stac_reference": str(load_result.stac_reference),
                            "reused": load_result.reused_existing,
                            "successful_assets": fetch_result.successful_assets,
                            "failed_assets": fetch_result.failed_assets,
                        }
                    )

                except FetchError as e:
                    logger.error(f"Failed to fetch {url}: {e.message}")
                    failed.append({"url": url, "error": e.message, "status_code": e.status_code})

                except Exception as e:
                    logger.error(f"Failed to process {url}: {str(e)}")
                    failed.append({"url": url, "error": str(e), "status_code": None})

                job.items_processed += 1

        total_successful_assets = sum(len(s["successful_assets"]) for s in successful)
        total_failed_assets = sum(len(s["failed_assets"]) for s in successful)

        job.result = {
            "successful": successful,
            "failed": failed,
            "summary": f"Loaded {len(successful)} items, {len(failed)} failed",
            "asset_statistics": {
                "successful_assets": total_successful_assets,
                "failed_assets": total_failed_assets,
            },
        }
        job.status = JobStatus.COMPLETED
        logger.info(f"Job {job.job_id} completed: {len(successful)} succeeded, {len(failed)} failed")

    except Exception as e:
        job.status = JobStatus.FAILED
        job.error = str(e)
        logger.error(f"Job {job.job_id} failed: {e}")


def _run_load_job_in_thread(
    job: Job,
    urls: list[str],
    workspace_bucket: str,
    collection: Optional[str],
    fetch_mode: AssetFetchMode,
    assume_role_arn: Optional[str],
    auth_token: Optional[str],
    config: DataLoaderConfig,
) -> None:
    """Run the STAC item load job in an isolated event loop."""
    _run_in_isolated_loop(
        _run_load_job_async(job, urls, workspace_bucket, collection, fetch_mode, assume_role_arn, auth_token, config)
    )


async def _run_geojson_job_async(
    job: Job,
    urls: list[str],
    workspace_bucket: str,
    output_name: str,
    auth_token: Optional[str],
    config: DataLoaderConfig,
) -> None:
    """Fetch STAC items and write them as a combined GeoJSON FeatureCollection."""
    try:
        features: list[dict] = []
        failed: list[dict] = []

        async with STACFetcher(
            timeout=config.request_timeout,
            max_retries=config.max_retries,
            auth_token=auth_token,
        ) as fetcher:
            for url in urls:
                try:
                    response = await fetcher._fetch_with_retry(url)
                    item_dict = response.json()

                    # Extract the GeoJSON Feature from the STAC item
                    feature = {
                        "type": "Feature",
                        "id": item_dict.get("id"),
                        "geometry": item_dict.get("geometry"),
                        "properties": item_dict.get("properties", {}),
                    }
                    if "bbox" in item_dict:
                        feature["bbox"] = item_dict["bbox"]

                    features.append(feature)
                except FetchError as e:
                    failed.append({"url": url, "error": e.message})
                except Exception as e:
                    failed.append({"url": url, "error": str(e)})

                job.items_processed += 1

        if not features:
            job.status = JobStatus.FAILED
            job.error = f"No items fetched successfully. {len(failed)} failed."
            return

        # Build the FeatureCollection
        feature_collection = {
            "type": "FeatureCollection",
            "features": features,
        }

        # Write to workspace bucket
        workspace_path = f"s3://{workspace_bucket}/datasets/{output_name}.geojson"
        filesystem = S3FileSystem()
        with filesystem.open(workspace_path, "w") as f:
            f.write(json.dumps(feature_collection))

        logger.info(f"Job {job.job_id}: wrote {len(features)} features to {workspace_path}")

        job.result = {
            "workspace_path": workspace_path,
            "features_written": len(features),
            "failed": failed,
            "summary": f"Wrote {len(features)} features to {workspace_path}" + (f", {len(failed)} failed" if failed else ""),
        }
        job.status = JobStatus.COMPLETED

    except Exception as e:
        job.status = JobStatus.FAILED
        job.error = str(e)
        logger.error(f"Job {job.job_id} failed: {e}")


def _run_geojson_job_in_thread(
    job: Job,
    urls: list[str],
    workspace_bucket: str,
    output_name: str,
    auth_token: Optional[str],
    config: DataLoaderConfig,
) -> None:
    """Run the GeoJSON export job in an isolated event loop."""
    _run_in_isolated_loop(_run_geojson_job_async(job, urls, workspace_bucket, output_name, auth_token, config))


# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------


def _validate_load_params(
    urls: list[str],
    fetch_assets: str,
    assume_role_arn: Optional[str],
) -> Optional[str]:
    """Validate load_stac_items parameters. Returns JSON error string or None."""
    if not urls:
        return json.dumps({"error": "urls parameter is required and must be non-empty"})

    if fetch_assets not in _VALID_FETCH_ASSETS:
        return json.dumps(
            {
                "error": f"Invalid fetch_assets value: '{fetch_assets}'. "
                f"Must be one of: {', '.join(sorted(_VALID_FETCH_ASSETS))}"
            }
        )

    if assume_role_arn is not None and not _ARN_PATTERN.match(assume_role_arn):
        return json.dumps(
            {
                "error": f"Invalid assume_role_arn format: '{assume_role_arn}'. "
                "Must match pattern: arn:aws:iam::<12-digit-account-id>:role/<role-name>"
            }
        )

    return None


def _resolve_auth_token(
    auth_token: Optional[str],
    urls: list[str],
    internal_catalog_base: str,
) -> Optional[str]:
    """Resolve the effective auth token using the layered approach.

    Priority:
    1. Explicit auth_token parameter (external authenticated catalogs)
    2. Passthrough from incoming request (internal catalog, domain-matched)
    3. None (public catalogs)
    """
    if auth_token is not None:
        return auth_token

    if internal_catalog_base:
        has_internal_url = any(url.startswith(internal_catalog_base) for url in urls)
        if has_internal_url:
            return _passthrough_auth_token.get()

    return None


def create_mcp_server(workspace_bucket: str) -> FastMCP:
    """Create and configure the STAC Data Loader MCP server."""
    mcp = FastMCP("STAC Data Loader MCP Server")
    mcp.settings.streamable_http_path = "/"

    config = DataLoaderConfig()
    config.validate()

    # Domain pattern for the internal data catalog — auth tokens from
    # incoming requests are only forwarded to URLs matching this base.
    _internal_catalog_base = os.environ.get("DATA_CATALOG_BASE_URL", "")

    @mcp.tool()
    async def load_stac_items(
        urls: list[str] = Field(description="List of URL references to STAC items"),
        collection: Optional[str] = Field(description="Optional collection name to organize loaded items", default=None),
        fetch_assets: str = Field(
            description="Asset fetch mode: 'none', 'text', 'image', or 'all' (default: 'none')",
            default="none",
        ),
        assume_role_arn: Optional[str] = Field(
            description="Optional IAM role ARN to assume for S3 access",
            default=None,
        ),
        auth_token: Optional[str] = Field(
            description="Optional Bearer token for authenticated STAC catalogs. "
            "Not needed for the OversightML data catalog "
            "or public catalogs. Only provide this if the user specifies credentials "
            "for an external authenticated STAC server.",
            default=None,
        ),
    ) -> str:
        """
        Start loading STAC items from URL references into the workspace.

        This tool starts an asynchronous loading job and returns a job_id
        immediately. You MUST then call get_load_status with the returned
        job_id to poll for progress. Keep calling get_load_status every
        few seconds until the status is 'completed' or 'failed'.

        Example workflow:
        1. Call load_stac_items(urls=[...]) → returns {"job_id": "abc123", "status": "running"}
        2. Call get_load_status(job_id="abc123") → returns {"status": "running", "items_processed": 1, "items_total": 3}
        3. Call get_load_status(job_id="abc123") → returns {"status": "completed", "successful": [...], "failed": [...]}

        The final completed response contains:
        - successful: list of loaded items with stac_reference, successful_assets, failed_assets
        - failed: list of items that could not be loaded with error details
        - asset_statistics: counts of successful and failed asset fetches
        """
        _cleanup_old_jobs()

        validation_error = _validate_load_params(urls, fetch_assets, assume_role_arn)
        if validation_error:
            return validation_error

        fetch_mode = AssetFetchMode(fetch_assets)
        job_id = str(uuid.uuid4())[:8]
        job = Job(job_id=job_id, items_total=len(urls))
        _jobs[job_id] = job

        effective_token = _resolve_auth_token(auth_token, urls, _internal_catalog_base)

        logger.info(
            f"Job {job_id}: starting load of {len(urls)} URL(s), "
            f"collection={collection}, fetch_assets={fetch_assets}, "
            f"auth={'passthrough' if effective_token and not auth_token else 'explicit' if auth_token else 'none'}"
        )

        asyncio.get_event_loop().run_in_executor(
            None,
            _run_load_job_in_thread,
            job,
            urls,
            workspace_bucket,
            collection,
            fetch_mode,
            assume_role_arn,
            effective_token,
            config,
        )

        return json.dumps(
            {
                "job_id": job_id,
                "status": "running",
                "items_total": len(urls),
                "message": f"Loading {len(urls)} item(s). Use get_load_status with job_id='{job_id}' to check progress.",
            }
        )

    @mcp.tool()
    async def get_load_status(
        job_id: str = Field(description="Job ID returned by load_stac_items"),
    ) -> str:
        """
        Check the status of a STAC loading job started by load_stac_items.

        Call this after load_stac_items returns a job_id. Poll every few
        seconds until status is 'completed' or 'failed'.

        Possible status values:
        - 'running': Job is still processing. items_processed/items_total show progress.
        - 'completed': Job finished. Response includes successful, failed, and asset_statistics.
        - 'failed': Job encountered a fatal error. Response includes error message.

        When status is 'completed', the response contains the same fields as
        the old synchronous load_stac_items response: successful items with
        stac_references, failed items with errors, and asset fetch statistics.
        """
        job = _jobs.get(job_id)
        if job is None:
            return json.dumps({"error": f"Unknown job_id: '{job_id}'"})

        response: dict[str, Any] = {
            "job_id": job.job_id,
            "status": job.status.value,
            "items_total": job.items_total,
            "items_processed": job.items_processed,
        }

        if job.status == JobStatus.COMPLETED and job.result is not None:
            response.update(job.result)
        elif job.status == JobStatus.FAILED:
            response["error"] = job.error

        return json.dumps(response)

    @mcp.tool()
    async def load_stac_as_geojson(
        urls: list[str] = Field(description="List of URL references to STAC items"),
        dataset_name: Optional[str] = Field(
            description="Name for the output GeoJSON file (without extension). "
            "Defaults to 'stac-export-{job_id}' if not provided.",
            default=None,
        ),
        auth_token: Optional[str] = Field(
            description="Optional Bearer token for authenticated STAC catalogs. "
            "Not needed for the OversightML data catalog "
            "or public catalogs. Only provide this if the user specifies credentials "
            "for an external authenticated STAC server.",
            default=None,
        ),
    ) -> str:
        """
        Fetch STAC items and combine them into a single GeoJSON FeatureCollection
        in the workspace. Each item's geometry and properties are extracted and
        written as features in the output file.

        Use this when you need to perform spatial operations on the data (filter,
        sample, correlate) rather than storing individual STAC item metadata.

        Returns a workspace file path (s3://...) that can be passed directly to
        geo-agent tools like filter_dataset, sample_features, or correlate_datasets.

        This tool starts an asynchronous job and returns a job_id. Poll
        get_load_status with the job_id until status is 'completed'.
        The completed response includes the workspace_path to the GeoJSON file.
        """
        _cleanup_old_jobs()

        if not urls:
            return json.dumps({"error": "urls parameter is required and must be non-empty"})

        job_id = str(uuid.uuid4())[:8]
        job = Job(job_id=job_id, items_total=len(urls))
        _jobs[job_id] = job

        effective_token = _resolve_auth_token(auth_token, urls, _internal_catalog_base)

        output_name = dataset_name or f"stac-export-{job_id}"

        logger.info(
            f"Job {job_id}: loading {len(urls)} item(s) as GeoJSON '{output_name}', "
            f"auth={'passthrough' if effective_token and not auth_token else 'explicit' if auth_token else 'none'}"
        )

        asyncio.get_event_loop().run_in_executor(
            None,
            _run_geojson_job_in_thread,
            job,
            urls,
            workspace_bucket,
            output_name,
            effective_token,
            config,
        )

        return json.dumps(
            {
                "job_id": job_id,
                "status": "running",
                "items_total": len(urls),
                "message": (
                    f"Loading {len(urls)} item(s) as GeoJSON. "
                    f"Use get_load_status with job_id='{job_id}' to check progress."
                ),
            }
        )

    return mcp


async def health_check(request) -> Response:
    """Health check endpoint for ECS and ALB health checks."""
    return JSONResponse({"status": "OK", "service": "stac-data-loader-mcp"})


async def reject_sse_requests(request) -> Response:
    """Handle GET requests — reject SSE but allow other GET requests."""
    accept_header = request.headers.get("accept", "")
    if "text/event-stream" in accept_header:
        logger.info(f"Rejecting SSE GET request from {request.client}")
        return Response(
            content="Method Not Allowed: Server-Sent Events not supported",
            status_code=status.HTTP_405_METHOD_NOT_ALLOWED,
            headers={"Allow": "POST, OPTIONS"},
        )
    return await health_check(request)


def main() -> None:
    """Main entrypoint for the deployed FastMCP server."""
    log_level = os.environ.get("LOG_LEVEL", "INFO")
    logging.basicConfig(
        level=getattr(logging, log_level),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    logger.info("Starting STAC Data Loader MCP Server")

    workspace_bucket = get_workspace_bucket_name()
    mcp = create_mcp_server(workspace_bucket)
    mcp.settings.stateless_http = True
    mcp.settings.streamable_http_path = "/"
    mcp.settings.json_response = True

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        async with mcp.session_manager.run():
            yield

    app = Starlette(
        routes=[
            Route("/health", health_check, methods=["GET"]),
            Route("/", reject_sse_requests, methods=["GET"]),
            Mount("/", app=mcp.streamable_http_app()),
        ],
        lifespan=lifespan,
    )

    # AuthTokenMiddleware extracts the Bearer token from incoming requests
    # and stores it in a contextvar for passthrough to the internal catalog.
    # Applied before CORS so the token is available to all request handlers.
    app = AuthTokenMiddleware(app)

    app = CORSMiddleware(
        app,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "Accept",
            "X-Requested-With",
            "mcp-session-id",
            "mcp-protocol-version",
        ],
        expose_headers=["Mcp-Session-Id"],
        allow_credentials=False,
        max_age=600,
    )

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))

    logger.info(f"Starting persistent FastMCP server on {host}:{port}")
    uvicorn.run(app, host=host, port=port, log_level=log_level.lower())


if __name__ == "__main__":
    main()
