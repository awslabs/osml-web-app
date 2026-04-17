# Copyright Amazon.com, Inc. or its affiliates.
"""
Tests for quota_codes_loader.py

Verifies that the quota codes loader correctly handles Claude 4.x inference profile models.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from quota_codes_loader import QuotaCodesLoader


@pytest.fixture
def mock_s3_client():
    """Mock S3 client for testing."""
    client = MagicMock()
    return client


@pytest.fixture
def mock_service_quotas_client():
    """Mock Service Quotas client for testing."""
    client = MagicMock()
    return client


@pytest.fixture
def sample_quota_codes_data():
    """Sample quota codes data with Claude 4.x models."""
    return {
        "region": "us-west-2",
        "generated_at": "2024-12-12T00:00:00Z",
        "successful_mappings": 5,
        "failed_mappings": 0,
        "models": {
            "us.anthropic.claude-opus-4-5-20251101-v1:0": {
                "model_name": "Anthropic Claude Opus 4.5",
                "is_inference_profile": True,
                "tokens_quota_code": "L-12345678",
                "requests_quota_code": "L-87654321",
            },
            "us.anthropic.claude-haiku-4-5-20251001-v1:0": {
                "model_name": "Anthropic Claude Haiku 4.5",
                "is_inference_profile": True,
                "tokens_quota_code": "L-11111111",
                "requests_quota_code": "L-22222222",
            },
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0": {
                "model_name": "Anthropic Claude Sonnet 4.5",
                "is_inference_profile": True,
                "tokens_quota_code": "L-33333333",
                "requests_quota_code": "L-44444444",
            },
            "us.anthropic.claude-opus-4-1-20250501-v1:0": {
                "model_name": "Anthropic Claude Opus 4.1",
                "is_inference_profile": True,
                "tokens_quota_code": "L-55555555",
                "requests_quota_code": "L-66666666",
            },
            "us.anthropic.claude-sonnet-4-20250514-v1:0": {
                "model_name": "Anthropic Claude Sonnet 4",
                "is_inference_profile": True,
                "tokens_quota_code": "L-77777777",
                "requests_quota_code": "L-88888888",
            },
        },
    }


def test_load_quota_codes_with_claude_4x_models(mock_s3_client, sample_quota_codes_data):
    """Test that quota codes loader correctly loads Claude 4.x model data."""
    # Mock S3 response
    mock_s3_client.get_object.return_value = {
        "Body": MagicMock(read=lambda: json.dumps(sample_quota_codes_data).encode("utf-8"))
    }

    with patch("boto3.client") as mock_boto_client:
        mock_boto_client.return_value = mock_s3_client

        loader = QuotaCodesLoader(region="us-west-2", bucket_name="test-bucket")

        # Verify all 5 Claude 4.x models are loaded
        assert len(loader.quota_codes) == 5

        # Verify specific model is loaded correctly
        opus_model_id = "us.anthropic.claude-opus-4-5-20251101-v1:0"
        assert loader.has_quota_codes(opus_model_id)
        assert loader.quota_codes[opus_model_id]["model_name"] == "Anthropic Claude Opus 4.5"
        assert loader.quota_codes[opus_model_id]["is_inference_profile"] is True
        assert loader.quota_codes[opus_model_id]["tokens_quota_code"] == "L-12345678"
        assert loader.quota_codes[opus_model_id]["requests_quota_code"] == "L-87654321"


def test_has_quota_codes_for_supported_models(mock_s3_client, sample_quota_codes_data):
    """Test that has_quota_codes returns True for all supported Claude 4.x models."""
    mock_s3_client.get_object.return_value = {
        "Body": MagicMock(read=lambda: json.dumps(sample_quota_codes_data).encode("utf-8"))
    }

    with patch("boto3.client") as mock_boto_client:
        mock_boto_client.return_value = mock_s3_client

        loader = QuotaCodesLoader(region="us-west-2", bucket_name="test-bucket")

        # All 5 supported models should have quota codes
        supported_models = [
            "us.anthropic.claude-opus-4-5-20251101-v1:0",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
            "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "us.anthropic.claude-opus-4-1-20250501-v1:0",
            "us.anthropic.claude-sonnet-4-20250514-v1:0",
        ]

        for model_id in supported_models:
            assert loader.has_quota_codes(model_id), f"Model {model_id} should have quota codes"


def test_get_quota_value_with_inference_profile_model(mock_s3_client, mock_service_quotas_client, sample_quota_codes_data):
    """Test that get_quota_value correctly retrieves quota for inference profile models."""
    mock_s3_client.get_object.return_value = {
        "Body": MagicMock(read=lambda: json.dumps(sample_quota_codes_data).encode("utf-8"))
    }

    # Mock Service Quotas response
    mock_service_quotas_client.get_service_quota.return_value = {"Quota": {"Value": 500000}}

    with patch("boto3.client") as mock_boto_client:

        def client_factory(service_name, **kwargs):
            if service_name == "s3":
                return mock_s3_client
            elif service_name == "service-quotas":
                return mock_service_quotas_client
            return MagicMock()

        mock_boto_client.side_effect = client_factory

        loader = QuotaCodesLoader(region="us-west-2", bucket_name="test-bucket")

        # Get quota value for a Claude 4.x model
        model_id = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
        tokens_quota = loader.get_quota_value(model_id, "tokens")

        assert tokens_quota == 500000
        mock_service_quotas_client.get_service_quota.assert_called_once_with(ServiceCode="bedrock", QuotaCode="L-33333333")


def test_get_model_quotas_returns_both_values(mock_s3_client, mock_service_quotas_client, sample_quota_codes_data):
    """Test that get_model_quotas returns both tokens and requests quotas."""
    mock_s3_client.get_object.return_value = {
        "Body": MagicMock(read=lambda: json.dumps(sample_quota_codes_data).encode("utf-8"))
    }

    # Mock Service Quotas responses for both quota types
    def get_quota_side_effect(**kwargs):
        quota_code = kwargs["QuotaCode"]
        if quota_code == "L-33333333":  # tokens
            return {"Quota": {"Value": 500000}}
        elif quota_code == "L-44444444":  # requests
            return {"Quota": {"Value": 200}}
        return {"Quota": {"Value": 0}}

    mock_service_quotas_client.get_service_quota.side_effect = get_quota_side_effect

    with patch("boto3.client") as mock_boto_client:

        def client_factory(service_name, **kwargs):
            if service_name == "s3":
                return mock_s3_client
            elif service_name == "service-quotas":
                return mock_service_quotas_client
            return MagicMock()

        mock_boto_client.side_effect = client_factory

        loader = QuotaCodesLoader(region="us-west-2", bucket_name="test-bucket")

        # Get both quotas for a Claude 4.x model
        model_id = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
        quotas = loader.get_model_quotas(model_id)

        assert quotas is not None
        assert quotas["tokens_per_minute"] == 500000
        assert quotas["requests_per_minute"] == 200


def test_get_available_models_with_quotas(mock_s3_client, sample_quota_codes_data):
    """Test that get_available_models_with_quotas returns all loaded model IDs."""
    mock_s3_client.get_object.return_value = {
        "Body": MagicMock(read=lambda: json.dumps(sample_quota_codes_data).encode("utf-8"))
    }

    with patch("boto3.client") as mock_boto_client:
        mock_boto_client.return_value = mock_s3_client

        loader = QuotaCodesLoader(region="us-west-2", bucket_name="test-bucket")

        available_models = loader.get_available_models_with_quotas()

        assert len(available_models) == 5
        assert "us.anthropic.claude-opus-4-5-20251101-v1:0" in available_models
        assert "us.anthropic.claude-haiku-4-5-20251001-v1:0" in available_models
        assert "us.anthropic.claude-sonnet-4-5-20250929-v1:0" in available_models
        assert "us.anthropic.claude-opus-4-1-20250501-v1:0" in available_models
        assert "us.anthropic.claude-sonnet-4-20250514-v1:0" in available_models
