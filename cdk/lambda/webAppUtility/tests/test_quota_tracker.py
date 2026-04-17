# Copyright Amazon.com, Inc. or its affiliates.
"""
Unit tests for quota_tracker.py
"""

from decimal import Decimal

from quota_tracker import QuotaTracker, decimal_to_float, decimal_to_int


def test_decimal_to_int_with_decimal():
    """Test decimal_to_int converts Decimal to int"""
    assert decimal_to_int(Decimal("42")) == 42
    assert decimal_to_int(Decimal("0")) == 0
    assert decimal_to_int(Decimal("999")) == 999


def test_decimal_to_int_with_int():
    """Test decimal_to_int handles int input"""
    assert decimal_to_int(42) == 42
    assert decimal_to_int(0) == 0


def test_decimal_to_int_with_none():
    """Test decimal_to_int handles None"""
    assert decimal_to_int(None) == 0


def test_decimal_to_float_with_decimal():
    """Test decimal_to_float converts Decimal to float"""
    assert decimal_to_float(Decimal("42.5")) == 42.5
    assert decimal_to_float(Decimal("0.0")) == 0.0


def test_quota_tracker_set_and_get_limits(dynamodb_table):
    """Test setting and retrieving quota limits"""
    tracker = QuotaTracker()
    model_id = "test-model"

    # Set limits
    tracker.set_model_limits(model_id, requests_per_minute=100, tokens_per_minute=50000)

    # Get limits
    limits = tracker.get_limits(model_id)

    assert limits is not None
    assert limits.model_id == model_id
    assert limits.requests_per_minute == 100
    assert limits.tokens_per_minute == 50000


def test_quota_tracker_get_limits_nonexistent(dynamodb_table):
    """Test getting limits for non-existent model returns None"""
    tracker = QuotaTracker()
    limits = tracker.get_limits("nonexistent-model")

    assert limits is None


def test_quota_tracker_check_quota_no_limits(dynamodb_table):
    """Test check_quota allows request when no limits configured"""
    tracker = QuotaTracker()

    can_proceed, error_msg, retry_after = tracker.check_quota("test-model", 1000)

    assert can_proceed is True
    assert error_msg is None
    assert retry_after is None


def test_quota_tracker_check_quota_under_limit(dynamodb_table):
    """Test check_quota allows request when under limits"""
    tracker = QuotaTracker()
    model_id = "test-model"

    # Set generous limits
    tracker.set_model_limits(model_id, requests_per_minute=100, tokens_per_minute=50000)

    # Check quota with small request
    can_proceed, error_msg, retry_after = tracker.check_quota(model_id, 1000)

    assert can_proceed is True
    assert error_msg is None
    assert retry_after is None


def test_quota_tracker_check_quota_exceeds_tokens(dynamodb_table):
    """Test check_quota blocks request when tokens would exceed limit"""
    tracker = QuotaTracker()
    model_id = "test-model"

    # Set tight token limit
    tracker.set_model_limits(model_id, requests_per_minute=100, tokens_per_minute=1000)

    # Try to use more tokens than allowed (95% threshold = 950)
    can_proceed, error_msg, retry_after = tracker.check_quota(model_id, 1000)

    assert can_proceed is False
    assert error_msg is not None
    assert "tokens" in error_msg.lower()


def test_quota_tracker_record_and_get_usage(dynamodb_table):
    """Test recording usage and retrieving current usage"""
    tracker = QuotaTracker()
    model_id = "test-model"

    # Record some usage with unique timestamps
    # Note: request_timestamp is part of the sort key, so we need different timestamps
    import time

    tracker.record_usage(model_id, 500)
    time.sleep(1.1)  # Sleep > 1 second to ensure different integer timestamp
    tracker.record_usage(model_id, 300)
    time.sleep(0.1)  # Give DynamoDB mock time to process

    # Get current usage
    requests_used, tokens_used = tracker.get_current_usage(model_id)

    # Should have 2 requests totaling 800 tokens
    assert requests_used == 2, f"Expected 2 requests, got {requests_used}"
    assert tokens_used == 800, f"Expected 800 tokens, got {tokens_used}"


def test_quota_tracker_get_quota_info_no_limits(dynamodb_table):
    """Test get_quota_info returns has_limits=False when no limits set"""
    tracker = QuotaTracker()

    info = tracker.get_quota_info("test-model")

    assert info["has_limits"] is False
    assert info["model_id"] == "test-model"


def test_quota_tracker_get_quota_info_with_limits(dynamodb_table):
    """Test get_quota_info returns complete information"""
    tracker = QuotaTracker()
    model_id = "test-model"

    # Set limits
    tracker.set_model_limits(model_id, requests_per_minute=100, tokens_per_minute=50000)

    # Record some usage
    tracker.record_usage(model_id, 1000)

    # Get quota info
    info = tracker.get_quota_info(model_id)

    assert info["has_limits"] is True
    assert info["model_id"] == model_id
    assert info["limits"]["requests_per_minute"] == 100
    assert info["limits"]["tokens_per_minute"] == 50000
    assert info["usage"]["requests_used"] == 1
    assert info["usage"]["tokens_used"] == 1000
    assert info["remaining"]["requests"] == 99
    assert info["remaining"]["tokens"] == 49000
    assert "usage_percent" in info
    assert "reset_in_seconds" in info
