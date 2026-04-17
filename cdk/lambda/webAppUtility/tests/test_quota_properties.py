# Copyright Amazon.com, Inc. or its affiliates.
"""
Property-based tests for quota tracker using Hypothesis

Feature: testing-framework-setup, Property 2: Hypothesis Integration Verification
Validates: Requirements 5.1, 5.4
"""

from decimal import Decimal

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from quota_tracker import QuotaTracker, decimal_to_float, decimal_to_int


@given(st.integers(min_value=0, max_value=1000000))
@settings(max_examples=100)
def test_decimal_to_int_property(value):
    """
    Property: decimal_to_int should handle any valid integer or Decimal

    Feature: testing-framework-setup, Property 2: Hypothesis Integration Verification
    Validates: Requirements 5.1, 5.4
    """
    # Test with int
    assert decimal_to_int(value) == value

    # Test with Decimal
    decimal_value = Decimal(str(value))
    assert decimal_to_int(decimal_value) == value


@given(st.floats(min_value=0.0, max_value=1000000.0, allow_nan=False, allow_infinity=False))
@settings(max_examples=100)
def test_decimal_to_float_property(value):
    """
    Property: decimal_to_float should handle any valid float or Decimal

    Feature: testing-framework-setup, Property 2: Hypothesis Integration Verification
    Validates: Requirements 5.1, 5.4
    """
    # Test with float
    result = decimal_to_float(value)
    assert isinstance(result, float)
    assert abs(result - value) < 0.0001  # Allow for floating point precision

    # Test with Decimal
    decimal_value = Decimal(str(value))
    result = decimal_to_float(decimal_value)
    assert isinstance(result, float)


@given(st.integers(min_value=1, max_value=1000), st.integers(min_value=1000, max_value=100000))
@settings(max_examples=100)
def test_quota_limits_storage_property(rpm, tpm):
    """
    Property: Set limits should always be retrievable with same values

    Feature: testing-framework-setup, Property 2: Hypothesis Integration Verification
    Validates: Requirements 5.1, 5.4
    """
    # Note: This test doesn't use DynamoDB, just in-memory cache
    import os

    os.environ["QUOTA_TRACKING_TABLE"] = "test-table"

    tracker = QuotaTracker()
    model_id = f"test-model-{rpm}-{tpm}"

    # Set limits
    tracker.set_model_limits(model_id, rpm, tpm)

    # Get limits
    limits = tracker.get_limits(model_id)

    # Property: Retrieved limits match set limits
    assert limits is not None
    assert limits.requests_per_minute == rpm
    assert limits.tokens_per_minute == tpm
    assert limits.model_id == model_id


@given(st.integers(min_value=0, max_value=10000), st.integers(min_value=10, max_value=1000))
@settings(max_examples=100, deadline=1000, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_check_quota_consistency_property(dynamodb_table, estimated_tokens, rpm):
    """
    Property: check_quota should return consistent results for same inputs

    Feature: testing-framework-setup, Property 2: Hypothesis Integration Verification
    Validates: Requirements 5.1, 5.4

    Note: Fixture parameter must come first, then Hypothesis-generated parameters.
    The function_scoped_fixture health check is suppressed because the shared
    DynamoDB table state doesn't affect test consistency - each test uses unique
    model IDs based on estimated_tokens.
    """
    tracker = QuotaTracker()
    model_id = f"test-model-{estimated_tokens}"

    # Set limits (generous to avoid blocking)
    tracker.set_model_limits(model_id, requests_per_minute=rpm, tokens_per_minute=100000)

    # Check quota twice with same inputs
    result1 = tracker.check_quota(model_id, estimated_tokens)
    result2 = tracker.check_quota(model_id, estimated_tokens)

    # Property: Results should be consistent
    assert result1[0] == result2[0]  # can_proceed
    assert result1[1] == result2[1]  # error_msg
