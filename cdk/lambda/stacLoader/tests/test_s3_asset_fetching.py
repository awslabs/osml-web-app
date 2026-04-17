#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for S3 asset fetching with mocked S3.

Requirements: 6.2, 6.4, 6.5, 6.6
"""

import asyncio
from unittest.mock import MagicMock

import boto3
import pytest
from fetcher import FetchError, STACFetcher
from moto import mock_aws

TEST_BUCKET = "test-stac-bucket"
TEST_KEY = "assets/image.tif"
TEST_S3_URL = f"s3://{TEST_BUCKET}/{TEST_KEY}"
TEST_CONTENT = b"fake-asset-content-bytes"


@mock_aws
def test_fetch_s3_asset_success():
    """Verify successful S3 asset fetch returns correct bytes (6.2)."""
    # Set up real mocked S3 bucket and object
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=TEST_BUCKET)
    s3.put_object(Bucket=TEST_BUCKET, Key=TEST_KEY, Body=TEST_CONTENT)

    async def run():
        async with STACFetcher() as fetcher:
            result = await fetcher._fetch_s3_asset(TEST_S3_URL)
            assert result == TEST_CONTENT

    asyncio.run(run())


@mock_aws
def test_fetch_s3_asset_no_such_bucket():
    """Verify FetchError raised when S3 bucket does not exist (6.5)."""

    async def run():
        async with STACFetcher() as fetcher:
            with pytest.raises(FetchError) as exc_info:
                await fetcher._fetch_s3_asset("s3://nonexistent-bucket/some-key")
            assert "NoSuchBucket" in exc_info.value.message or "S3 error" in exc_info.value.message

    asyncio.run(run())


@mock_aws
def test_fetch_s3_asset_no_such_key():
    """Verify FetchError raised when S3 object does not exist (6.6)."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=TEST_BUCKET)

    async def run():
        async with STACFetcher() as fetcher:
            with pytest.raises(FetchError) as exc_info:
                await fetcher._fetch_s3_asset(f"s3://{TEST_BUCKET}/missing-key.tif")
            assert "NoSuchKey" in exc_info.value.message or "S3 error" in exc_info.value.message

    asyncio.run(run())


@mock_aws
def test_fetch_s3_asset_access_denied():
    """Verify FetchError raised when S3 access is denied (6.4)."""

    async def run():
        async with STACFetcher() as fetcher:
            # Simulate AccessDenied by using a mock that raises ClientError
            mock_s3 = MagicMock()
            error_response = {"Error": {"Code": "AccessDenied", "Message": "Access Denied"}}
            mock_s3.get_object.side_effect = __import__("botocore.exceptions", fromlist=["ClientError"]).ClientError(
                error_response, "GetObject"
            )

            fetcher._s3_client = mock_s3

            with pytest.raises(FetchError) as exc_info:
                await fetcher._fetch_s3_asset(TEST_S3_URL)
            assert "AccessDenied" in exc_info.value.message

    asyncio.run(run())


@mock_aws
def test_fetch_s3_asset_with_assumed_role():
    """Verify S3 fetch works with assumed role credentials (6.2)."""
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket=TEST_BUCKET)
    s3.put_object(Bucket=TEST_BUCKET, Key=TEST_KEY, Body=TEST_CONTENT)

    async def run():
        # Use a fetcher without assume_role_arn (default IAM)
        async with STACFetcher() as fetcher:
            result = await fetcher._fetch_s3_asset(TEST_S3_URL)
            assert result == TEST_CONTENT
            assert fetcher._s3_client is not None

    asyncio.run(run())
