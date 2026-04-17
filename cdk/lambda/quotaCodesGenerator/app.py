# Copyright Amazon.com, Inc. or its affiliates.
"""
Custom Resource Lambda for Quota Codes Generation

Runs during CDK deployment to generate quota codes mapping and store in S3.
"""

import json
import logging
from typing import Optional

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class QuotaCodeGenerator:
    """Generates quota code mappings for Bedrock models."""

    def __init__(self, region: str):
        self.region = region
        self.bedrock_client = boto3.client("bedrock", region_name=region)
        self.service_quotas_client = boto3.client("service-quotas", region_name=region)
        self.s3_client = boto3.client("s3", region_name=region)

    def discover_text_models(self) -> list:
        """Discover all Bedrock models that output text."""
        try:
            response = self.bedrock_client.list_foundation_models(byOutputModality="TEXT")
            models = response.get("modelSummaries", [])
            logger.info(f"Discovered {len(models)} text-capable models")
            return models
        except Exception as e:
            logger.error(f"Failed to discover text models: {e}")
            return []

    def find_quota_code_for_model(
        self, model_name: str, quota_type: str, is_inference_profile: bool = False
    ) -> Optional[str]:
        """Find quota code for a model and quota type.

        Args:
            model_name: The model name as it appears in Service Quotas
            quota_type: Either "tokens" or "requests"
            is_inference_profile: If True, search for cross-region inference profile quotas
        """
        if is_inference_profile:
            # For inference profiles, use cross-region quota naming pattern
            quota_name = f"Cross-region inference {quota_type} per minute for {model_name}"
        else:
            # For on-demand models, use on-demand quota naming pattern
            quota_name = f"On-demand model inference {quota_type} per minute for {model_name}"

        try:
            paginator = self.service_quotas_client.get_paginator("list_service_quotas")

            for page in paginator.paginate(ServiceCode="bedrock"):
                for quota in page.get("Quotas", []):
                    if quota.get("QuotaName", "").lower() == quota_name.lower():
                        quota_code = quota.get("QuotaCode")
                        logger.info(f"Found {quota_type} quota for {model_name}: {quota_code}")
                        return quota_code

            logger.warning(f"No {quota_type} quota found for {model_name}")
            return None

        except Exception as e:
            logger.warning(f"Error searching {quota_type} quota for {model_name}: {e}")
            return None

    def extract_model_name_from_id(self, model_id: str) -> Optional[tuple]:
        """Extract Service Quotas model name from Bedrock model ID.

        Returns:
            Tuple of (model_name, is_inference_profile) or None if not found
        """
        MODEL_ID_TO_QUOTA_NAME = {
            # Claude 4.x Inference Profile Models (cross-region inference quotas)
            "us.anthropic.claude-opus-4-5-20251101-v1:0": ("Anthropic Claude Opus 4.5", True),
            "us.anthropic.claude-haiku-4-5-20251001-v1:0": ("Anthropic Claude Haiku 4.5", True),
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0": ("Anthropic Claude Sonnet 4.5", True),
            "us.anthropic.claude-opus-4-1-20250501-v1:0": ("Anthropic Claude Opus 4.1", True),
            "us.anthropic.claude-sonnet-4-20250514-v1:0": ("Anthropic Claude Sonnet 4", True),
        }

        return MODEL_ID_TO_QUOTA_NAME.get(model_id)

    def get_supported_model_ids(self) -> list:
        """Get list of supported model IDs from the hardcoded mapping."""
        # Return the keys from the mapping defined in extract_model_name_from_id
        supported_ids = [
            # Claude 4.x Inference Profile Models
            "us.anthropic.claude-opus-4-5-20251101-v1:0",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "us.anthropic.claude-opus-4-1-20250501-v1:0",
            "us.anthropic.claude-sonnet-4-20250514-v1:0",
        ]
        return supported_ids

    def generate_and_store_quota_codes(self, bucket_name: str, key: str = "quota-codes.json"):
        """Generate quota codes and store in S3."""
        logger.info(f"Starting quota codes generation for region {self.region}")

        # Get supported model IDs instead of discovering all models
        supported_model_ids = self.get_supported_model_ids()
        logger.info(f"Generating quota codes for {len(supported_model_ids)} supported models")

        # Create model objects for processing
        models = [{"modelId": model_id} for model_id in supported_model_ids]

        quota_mappings = {}
        successful_mappings = 0
        failed_mappings = 0

        for model in models:
            model_id = model.get("modelId", "")
            model_info = self.extract_model_name_from_id(model_id)

            if not model_info:
                logger.warning(f"No quota name mapping for {model_id}, skipping")
                failed_mappings += 1
                continue

            quota_model_name, is_inference_profile = model_info

            # Find quota codes with appropriate quota type
            tokens_code = self.find_quota_code_for_model(quota_model_name, "tokens", is_inference_profile)
            requests_code = self.find_quota_code_for_model(quota_model_name, "requests", is_inference_profile)

            # Accept models with at least one quota type (some models only have requests quotas)
            if tokens_code or requests_code:
                quota_mappings[model_id] = {
                    "model_name": quota_model_name,
                    "is_inference_profile": is_inference_profile,
                    "tokens_quota_code": tokens_code,  # May be None for models with only requests quotas
                    "requests_quota_code": requests_code,  # May be None for models with only tokens quotas
                }
                successful_mappings += 1
                logger.info(
                    f"Mapped {model_id} to quota codes "
                    f"(type: {'inference_profile' if is_inference_profile else 'on_demand'}, "
                    f"tokens: {'✓' if tokens_code else '✗'}, requests: {'✓' if requests_code else '✗'})"
                )
            else:
                failed_mappings += 1
                logger.warning(f"No quota codes found for {model_id}")

        # Store in S3
        try:
            quota_data = {
                "region": self.region,
                "generated_at": f"{__import__('datetime').datetime.utcnow().isoformat()}Z",
                "successful_mappings": successful_mappings,
                "failed_mappings": failed_mappings,
                "models": quota_mappings,
            }

            self.s3_client.put_object(
                Bucket=bucket_name, Key=key, Body=json.dumps(quota_data, indent=2), ContentType="application/json"
            )

            logger.info(f"Stored quota codes in s3://{bucket_name}/{key}")
            logger.info(f"Successfully mapped: {successful_mappings} models")
            logger.info(f"Failed mappings: {failed_mappings} models")

            return True

        except Exception as e:
            logger.error(f"Failed to store quota codes in S3: {e}")
            return False


def lambda_handler(event, context):
    """CDK Provider event handler for quota codes generation."""
    try:
        logger.info(f"Provider event: {event}")

        request_type = event["RequestType"]
        properties = event["ResourceProperties"]

        region = properties["Region"]
        bucket_name = properties["BucketName"]

        if request_type in ["Create", "Update"]:
            logger.info(f"Generating quota codes for region: {region}")

            generator = QuotaCodeGenerator(region)
            success = generator.generate_and_store_quota_codes(bucket_name)

            if success:
                # Return success data - CDK Provider handles CloudFormation response
                return {"Status": "SUCCESS", "Region": region, "BucketName": bucket_name}
            else:
                # Raise exception for failure - CDK Provider handles error response
                raise Exception("Failed to generate quota codes")

        elif request_type == "Delete":
            logger.info("Delete event - no action needed")
            return {"Status": "DELETED"}

    except Exception as e:
        logger.error(f"Provider event handler failed: {e}")
        raise e
