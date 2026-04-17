# Copyright Amazon.com, Inc. or its affiliates.
"""
Rolling Window Quota Tracker for Bedrock API

Uses DynamoDB TTL to naturally age out individual requests for more granular quota recovery.
Each API request creates a separate DynamoDB record that expires after 60 seconds.
"""

import logging
import os
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def decimal_to_int(value) -> int:
    """Convert DynamoDB Decimal to int, handling various input types"""
    if isinstance(value, Decimal):
        return int(value)
    return int(value) if value is not None else 0


def decimal_to_float(value) -> float:
    """Convert DynamoDB Decimal to float, handling various input types"""
    if isinstance(value, Decimal):
        return float(value)
    return float(value) if value is not None else 0.0


@dataclass
class QuotaLimits:
    """Quota limits for a model"""

    model_id: str
    requests_per_minute: int
    tokens_per_minute: int


@dataclass
class RequestRecord:
    """Individual request record in rolling window"""

    model_id: str
    request_timestamp: int
    tokens_used: int
    ttl: int


class QuotaTracker:
    """
    Rolling window quota tracker using DynamoDB TTL for natural request aging.

    Each request creates an individual DynamoDB record that expires after 60 seconds.
    TTL handles aging automatically, providing more granular quota recovery.
    """

    def __init__(self, table_name: Optional[str] = None):
        self.table_name = table_name or os.environ.get("QUOTA_TRACKING_TABLE")
        if not self.table_name:
            raise ValueError("QUOTA_TRACKING_TABLE environment variable not set")

        self.dynamodb = boto3.resource("dynamodb")
        self.table = self.dynamodb.Table(self.table_name)
        self._limits_cache: Dict[str, QuotaLimits] = {}

    def set_model_limits(self, model_id: str, requests_per_minute: int, tokens_per_minute: int) -> None:
        """Set quota limits for a model (cached in memory)"""
        self._limits_cache[model_id] = QuotaLimits(
            model_id=model_id, requests_per_minute=requests_per_minute, tokens_per_minute=tokens_per_minute
        )
        logger.info(
            f"Set rolling window limits for {model_id}: {requests_per_minute} req/min, {tokens_per_minute} tokens/min"
        )

    def get_limits(self, model_id: str) -> Optional[QuotaLimits]:
        """Get quota limits for a model"""
        return self._limits_cache.get(model_id)

    def _get_active_requests(self, model_id: str) -> list:
        """Get all active (non-expired) request records for a model"""
        try:
            # Filter expired items at DynamoDB level per AWS best practices
            current_time = int(time.time())

            response = self.table.query(
                KeyConditionExpression=Key("model_id").eq(model_id),
                FilterExpression=Key("ttl").gt(current_time),
            )

            active_records = response.get("Items", [])

            logger.debug(f"Found {len(active_records)} active records for {model_id} (server-side filtered)")
            return active_records

        except ClientError as e:
            logger.error(f"Error querying active requests for {model_id}: {e}")
            return []

    def _check_request_quota(
        self,
        model_id: str,
        current_requests: int,
        requests_threshold: int,
        active_requests: list,
    ) -> Optional[Tuple[bool, str, int]]:
        """Check if request count would exceed quota. Returns failure tuple or None."""
        if (current_requests + 1) <= requests_threshold:
            return None

        if 1 > requests_threshold:
            error_msg = (
                f"Single request would exceed allowed requests for {model_id}. "
                "Quota limits cannot accommodate this request."
            )
            return False, error_msg, 0

        if active_requests:
            oldest_ttl = min(decimal_to_int(item.get("ttl", 0)) for item in active_requests)
            retry_after = max(1, oldest_ttl - int(time.time()))
        else:
            retry_after = 1

        error_msg = f"Request quota would exceed allowed requests for {model_id}. " f"Try again in {retry_after} seconds."
        return False, error_msg, retry_after

    def _check_token_quota(
        self,
        model_id: str,
        current_tokens: int,
        estimated_tokens: int,
        tokens_threshold: int,
        active_requests: list,
    ) -> Optional[Tuple[bool, str, int]]:
        """Check if token usage would exceed quota. Returns failure tuple or None."""
        if (current_tokens + estimated_tokens) <= tokens_threshold:
            return None

        if estimated_tokens > tokens_threshold:
            error_msg = f"Estimated tokens would exceed allowed tokens for {model_id}. Reduce conversation length."
            return False, error_msg, 0

        if active_requests:
            sorted_requests = sorted(active_requests, key=lambda x: x.get("ttl", 0))
            needed_token_space = (current_tokens + estimated_tokens) - tokens_threshold
            freed_tokens = 0
            retry_after = 1

            for request in sorted_requests:
                freed_tokens += decimal_to_int(request.get("tokens_used", 0))
                if freed_tokens >= needed_token_space:
                    retry_after = max(1, decimal_to_int(request.get("ttl", 0)) - int(time.time()))
                    break
        else:
            retry_after = 1

        error_msg = f"Estimated tokens would exceed allowed tokens for {model_id}. " f"Try again in {retry_after} seconds."
        return False, error_msg, retry_after

    def check_quota(self, model_id: str, estimated_tokens: int = 4000) -> Tuple[bool, Optional[str], Optional[int]]:
        """
        Check if request would exceed quota limits in rolling window.

        Returns:
            Tuple of (can_proceed, error_message, retry_after_seconds)
        """
        # Get limits for model
        limits = self.get_limits(model_id)
        if not limits:
            # No limits configured - allow request
            return True, None, None

        try:
            # Get all active requests for this model
            active_requests = self._get_active_requests(model_id)

            # Calculate current usage by summing active requests (convert Decimal to int)
            current_requests = len(active_requests)
            current_tokens = sum(decimal_to_int(item.get("tokens_used", 0)) for item in active_requests)

            requests_threshold = limits.requests_per_minute
            tokens_threshold = int(limits.tokens_per_minute * 0.95)

            # Check request quota
            request_result = self._check_request_quota(model_id, current_requests, requests_threshold, active_requests)
            if request_result is not None:
                logger.warning(f"Rolling quota check failed for {model_id}: {request_result[1]}")
                return request_result

            # Check token quota
            token_result = self._check_token_quota(
                model_id, current_tokens, estimated_tokens, tokens_threshold, active_requests
            )
            if token_result is not None:
                logger.warning(f"Rolling quota check failed for {model_id}: {token_result[1]}")
                return token_result

            return True, None, None

        except ClientError as e:
            logger.error(f"Error checking rolling quota for {model_id}: {e}")
            # On error, allow the request
            return True, None, None

    def record_usage(self, model_id: str, tokens_used: int) -> None:
        """
        Record a request as individual DynamoDB record with TTL-based expiration.
        """
        current_timestamp = int(time.time())
        ttl = current_timestamp + 60  # Expire after 60 seconds

        # Create unique request record
        request_record = {
            "model_id": model_id,
            "request_timestamp": current_timestamp,
            "tokens_used": tokens_used,
            "ttl": ttl,
        }

        try:
            # Insert individual request record
            self.table.put_item(Item=request_record)

            logger.info(f"Recorded rolling window usage for {model_id}: {tokens_used} tokens (expires in 60s)")

        except ClientError as e:
            logger.error(f"Error recording rolling usage for {model_id}: {e}")
            # Continue processing even if tracking fails

    def get_current_usage(self, model_id: str) -> Tuple[int, int]:
        """Get current usage (requests, tokens) for a model from active records"""
        try:
            active_requests = self._get_active_requests(model_id)

            requests_count = len(active_requests)
            tokens_total = sum(decimal_to_int(item.get("tokens_used", 0)) for item in active_requests)

            return requests_count, tokens_total

        except Exception as e:
            logger.error(f"Error getting rolling current usage for {model_id}: {e}")
            return 0, 0

    def get_quota_info(self, model_id: str) -> dict:
        """
        Get comprehensive quota information for a model in rolling window.

        Returns quota limits, current rolling window usage, and remaining capacity.
        """
        limits = self.get_limits(model_id)
        if not limits:
            return {"has_limits": False, "model_id": model_id}

        try:
            requests_used, tokens_used = self.get_current_usage(model_id)

            requests_remaining = max(0, limits.requests_per_minute - requests_used)
            tokens_remaining = max(0, limits.tokens_per_minute - tokens_used)

            # Calculate usage percentages
            requests_usage_pct = (requests_used / limits.requests_per_minute * 100) if limits.requests_per_minute > 0 else 0
            tokens_usage_pct = (tokens_used / limits.tokens_per_minute * 100) if limits.tokens_per_minute > 0 else 0

            # For rolling windows, show average reset time (when oldest request expires)
            active_requests = self._get_active_requests(model_id)
            if active_requests:
                oldest_ttl = min(decimal_to_int(item.get("ttl", 0)) for item in active_requests)
                reset_in_seconds = max(0, oldest_ttl - int(time.time()))
            else:
                reset_in_seconds = 0

            return {
                "has_limits": True,
                "model_id": model_id,
                "window_type": "rolling",  # Indicator for UI
                "limits": {"requests_per_minute": limits.requests_per_minute, "tokens_per_minute": limits.tokens_per_minute},
                "usage": {
                    "requests_used": requests_used,
                    "tokens_used": tokens_used,
                    "window_start": int(time.time()) - 60,  # Rolling window concept
                },
                "remaining": {"requests": requests_remaining, "tokens": tokens_remaining},
                "usage_percent": {"requests": round(requests_usage_pct, 1), "tokens": round(tokens_usage_pct, 1)},
                "reset_in_seconds": reset_in_seconds,
                "active_request_count": len(active_requests),  # Debug info
            }

        except Exception as e:
            logger.error(f"Error getting rolling quota info for {model_id}: {e}")
            # Return safe defaults
            return {
                "has_limits": True,
                "model_id": model_id,
                "window_type": "rolling",
                "limits": {"requests_per_minute": limits.requests_per_minute, "tokens_per_minute": limits.tokens_per_minute},
                "usage": {"requests_used": 0, "tokens_used": 0, "window_start": int(time.time()) - 60},
                "remaining": {"requests": limits.requests_per_minute, "tokens": limits.tokens_per_minute},
                "usage_percent": {"requests": 0.0, "tokens": 0.0},
                "reset_in_seconds": 0,
                "error": "Failed to retrieve rolling quota information",
            }


# Global singleton instance
_quota_tracker: Optional[QuotaTracker] = None


def get_quota_tracker() -> QuotaTracker:
    """Get the global quota tracker instance (singleton)"""
    global _quota_tracker
    if _quota_tracker is None:
        _quota_tracker = QuotaTracker()
    return _quota_tracker
