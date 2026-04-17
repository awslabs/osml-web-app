#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property 16: Configuration Validation

For any configuration with invalid values (negative timeout, zero retention, etc.),
creating the configuration SHALL raise a ValueError with a message describing the
invalid field.

**Validates: Requirements 8.5**
"""

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from config import DataLoaderConfig

# Strategy: non-positive floats for timeout (must be > 0)
invalid_timeout = st.floats(max_value=0.0, allow_nan=False, allow_infinity=False)

# Strategy: negative ints for max_retries (must be >= 0)
invalid_retries = st.integers(max_value=-1)

# Strategy: non-positive ints for max_collection_items (must be > 0)
invalid_collection_items = st.integers(max_value=0)

# Strategy: non-positive ints for concurrency_limit (must be > 0)
invalid_concurrency = st.integers(max_value=0)

# Strategy: non-positive ints for retention_days (must be > 0)
invalid_retention = st.integers(max_value=0)


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(timeout=invalid_timeout)
def test_invalid_timeout_raises_valueerror(timeout):
    """Non-positive request_timeout must raise ValueError."""
    config = DataLoaderConfig(request_timeout=timeout)
    with pytest.raises(ValueError, match="request_timeout"):
        config.validate()


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(retries=invalid_retries)
def test_invalid_retries_raises_valueerror(retries):
    """Negative max_retries must raise ValueError."""
    config = DataLoaderConfig(max_retries=retries)
    with pytest.raises(ValueError, match="max_retries"):
        config.validate()


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(max_items=invalid_collection_items)
def test_invalid_collection_items_raises_valueerror(max_items):
    """Non-positive max_collection_items must raise ValueError."""
    config = DataLoaderConfig(max_collection_items=max_items)
    with pytest.raises(ValueError, match="max_collection_items"):
        config.validate()


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(concurrency=invalid_concurrency)
def test_invalid_concurrency_raises_valueerror(concurrency):
    """Non-positive concurrency_limit must raise ValueError."""
    config = DataLoaderConfig(concurrency_limit=concurrency)
    with pytest.raises(ValueError, match="concurrency_limit"):
        config.validate()


@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow])
@given(days=invalid_retention)
def test_invalid_retention_raises_valueerror(days):
    """Non-positive retention_days must raise ValueError."""
    config = DataLoaderConfig(retention_days=days)
    with pytest.raises(ValueError, match="retention_days"):
        config.validate()
