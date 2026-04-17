# Copyright Amazon.com, Inc. or its affiliates.
"""
Quota Codes Loader

Loads pre-generated quota codes mapping and provides fast quota lookups.
"""

import json
import logging
from typing import Dict, Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class QuotaCodesLoader:
    """
    Loads quota codes from pre-generated mapping and provides fast quota lookups.
    """

    def __init__(self, region: str, bucket_name: Optional[str] = None):
        self.region = region
        self.bucket_name = bucket_name
        self.quota_codes_key = "quota-codes.json"
        self.quota_codes: Dict[str, Dict[str, str]] = {}
        self.quota_values_cache: Dict[str, int] = {}

        try:
            self.service_quotas_client = boto3.client("service-quotas", region_name=region)
            self.s3_client = boto3.client("s3", region_name=region)
            logger.info(f"Service Quotas and S3 clients initialized for region: {region}")
        except Exception as e:
            logger.warning(f"Failed to initialize AWS clients: {e}")
            self.service_quotas_client = None
            self.s3_client = None

        # Load quota codes on initialization
        self._load_quota_codes()

    def _load_quota_codes(self):
        """Load quota codes from S3."""
        if not self.bucket_name or not self.s3_client:
            logger.warning("No S3 bucket specified or S3 client unavailable, quota tracking disabled")
            return

        try:
            # Download quota codes from S3
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=self.quota_codes_key)

            quota_data = json.loads(response["Body"].read().decode("utf-8"))

            # Extract models mapping from the S3 data structure
            self.quota_codes = quota_data.get("models", {})

            logger.info(
                f"Loaded quota codes for {len(self.quota_codes)} models from s3://{self.bucket_name}/{self.quota_codes_key}"
            )
            logger.info(f"Generated at: {quota_data.get('generated_at', 'unknown')}")

            # Log a few examples for verification
            for i, (model_id, mapping) in enumerate(self.quota_codes.items()):
                if i < 3:  # Log first 3 for debugging
                    logger.info(
                        f"  {model_id} → tokens:{mapping['tokens_quota_code']}, requests:{mapping['requests_quota_code']}"
                    )
                elif i == 3:
                    logger.info(f"  ... and {len(self.quota_codes) - 3} more models")
                    break

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "Unknown")
            if error_code == "NoSuchKey":
                logger.warning(
                    f"Quota codes file not found in s3://{self.bucket_name}/{self.quota_codes_key}, quota tracking disabled"
                )
            else:
                logger.warning(f"Failed to load quota codes from S3: {e}")
            self.quota_codes = {}
        except Exception as e:
            logger.error(f"Failed to load quota codes from S3: {e}")
            self.quota_codes = {}

    def has_quota_codes(self, model_id: str) -> bool:
        """Check if quota codes are available for a model."""
        return model_id in self.quota_codes

    def get_quota_value(self, model_id: str, quota_type: str) -> Optional[int]:
        """
        Get current quota value for a model using quota codes.

        Args:
            model_id: Bedrock model ID
            quota_type: Either "tokens" or "requests"

        Returns:
            Current quota value or None if not available
        """
        if not self.service_quotas_client:
            logger.warning("Service Quotas client not available")
            return None

        # Check if we have quota codes for this model
        if model_id not in self.quota_codes:
            logger.info(f"No quota codes available for {model_id}")
            return None

        # Get the appropriate quota code
        quota_code_key = f"{quota_type}_quota_code"
        quota_code = self.quota_codes[model_id].get(quota_code_key)

        if not quota_code:
            logger.warning(f"No {quota_type} quota code for {model_id}")
            return None

        # Check cache first
        cache_key = f"{model_id}:{quota_type}"
        if cache_key in self.quota_values_cache:
            return self.quota_values_cache[cache_key]

        try:
            # Fast direct quota lookup using code
            response = self.service_quotas_client.get_service_quota(ServiceCode="bedrock", QuotaCode=quota_code)

            quota_value = int(response["Quota"]["Value"])

            # Cache the result
            self.quota_values_cache[cache_key] = quota_value

            logger.info(f"Retrieved {quota_type} quota for {model_id}: {quota_value}")
            return quota_value

        except ClientError as e:
            logger.warning(f"Failed to get {quota_type} quota for {model_id}: {e}")
            return None
        except Exception as e:
            logger.warning(f"Unexpected error getting {quota_type} quota for {model_id}: {e}")
            return None

    def get_model_quotas(self, model_id: str) -> Optional[Dict[str, int]]:
        """
        Get both tokens and requests quotas for a model.

        Args:
            model_id: Bedrock model ID

        Returns:
            Dictionary with requests_per_minute and tokens_per_minute, or None
        """
        if not self.has_quota_codes(model_id):
            logger.info(f"No quota codes for {model_id}, skipping quota enforcement")
            return None

        # Get both quota values
        tokens_quota = self.get_quota_value(model_id, "tokens")
        requests_quota = self.get_quota_value(model_id, "requests")

        # Both must be available
        if tokens_quota is not None and requests_quota is not None:
            quotas = {"requests_per_minute": requests_quota, "tokens_per_minute": tokens_quota}
            logger.info(f"Retrieved complete quotas for {model_id}: {quotas}")
            return quotas
        else:
            logger.warning(f"Incomplete quotas for {model_id} (tokens: {tokens_quota}, requests: {requests_quota})")
            return None

    def get_available_models_with_quotas(self) -> list:
        """Get list of model IDs that have quota codes available."""
        return list(self.quota_codes.keys())


# Global singleton instance
_quota_codes_loader: Optional[QuotaCodesLoader] = None


def get_quota_codes_loader(region: str, bucket_name: Optional[str] = None) -> QuotaCodesLoader:
    """Get the global quota codes loader instance (singleton)"""
    global _quota_codes_loader
    if _quota_codes_loader is None:
        _quota_codes_loader = QuotaCodesLoader(region=region, bucket_name=bucket_name)
    return _quota_codes_loader
