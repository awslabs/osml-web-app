#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""Unit tests for protocol detection logic.

Tests HTTP, HTTPS, and S3 URL detection as well as invalid URL formats.

_Requirements: 2.1, 2.2_
"""

from fetcher import detect_protocol


def test_detect_http():
    assert detect_protocol("http://example.com/file.tif") == "http"


def test_detect_https():
    assert detect_protocol("https://example.com/file.tif") == "http"


def test_detect_s3():
    assert detect_protocol("s3://my-bucket/path/to/file.tif") == "s3"


def test_detect_unsupported_ftp():
    assert detect_protocol("ftp://server/file.tif") == "unsupported"


def test_detect_unsupported_empty():
    assert detect_protocol("") == "unsupported"


def test_detect_unsupported_relative_path():
    assert detect_protocol("./relative/path.tif") == "unsupported"


def test_detect_case_insensitive_s3():
    assert detect_protocol("S3://my-bucket/key") == "s3"


def test_detect_case_insensitive_https():
    assert detect_protocol("HTTPS://example.com/file") == "http"
