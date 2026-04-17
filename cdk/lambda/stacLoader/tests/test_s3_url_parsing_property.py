#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 16: S3 URL parsing correctness

For any valid S3 URL in the format s3://bucket/key, the STACFetcher should
correctly parse it into bucket name and object key components.

**Validates: Requirements 6.1**
"""

import pytest
from fetcher import STACFetcher
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

# --- Strategies ---

# Valid S3 bucket names: 3-63 chars, lowercase letters, numbers, hyphens
bucket_names = st.from_regex(r"[a-z0-9][a-z0-9\-]{2,20}[a-z0-9]", fullmatch=True)

# Valid S3 object key segments (no empty segments)
key_segments = st.from_regex(r"[a-zA-Z0-9_\-\.]{1,20}", fullmatch=True)

# Build full keys from 1-4 segments joined by /
object_keys = st.lists(key_segments, min_size=1, max_size=4).map(lambda parts: "/".join(parts))


# --- Property 16: S3 URL parsing correctness ---
# Feature: stac-loader-enhancements, Property 16: S3 URL parsing correctness


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(bucket=bucket_names, key=object_keys)
def test_s3_url_roundtrip(bucket, key):
    """Parsing s3://bucket/key must return the original bucket and key."""
    url = f"s3://{bucket}/{key}"
    parsed_bucket, parsed_key = STACFetcher._parse_s3_url(url)
    assert parsed_bucket == bucket
    assert parsed_key == key


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(bucket=bucket_names, key=object_keys)
def test_s3_url_parsing_preserves_key_structure(bucket, key):
    """Parsed key must preserve the full path including slashes."""
    url = f"s3://{bucket}/{key}"
    _, parsed_key = STACFetcher._parse_s3_url(url)
    # The key should contain the same number of path segments
    assert parsed_key.count("/") == key.count("/")


def test_s3_url_missing_bucket_raises():
    """S3 URL with no bucket should raise ValueError."""
    with pytest.raises(ValueError):
        STACFetcher._parse_s3_url("s3://")


def test_s3_url_missing_key_raises():
    """S3 URL with bucket but no key should raise ValueError."""
    with pytest.raises(ValueError):
        STACFetcher._parse_s3_url("s3://my-bucket")


def test_s3_url_missing_key_trailing_slash_raises():
    """S3 URL with bucket and trailing slash but no key should raise ValueError."""
    with pytest.raises(ValueError):
        STACFetcher._parse_s3_url("s3://my-bucket/")


def test_s3_url_not_s3_protocol_raises():
    """Non-S3 URL should raise ValueError."""
    with pytest.raises(ValueError):
        STACFetcher._parse_s3_url("https://example.com/file.tif")
