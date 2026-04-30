# Copyright Amazon.com, Inc. or its affiliates.

"""
Unit tests for the quotaCodesGenerator Lambda.

Covers:
- QuotaCodeGenerator: model ID mapping, supported IDs, quota lookup
  (match/no-match/error), and S3 persistence (success/failure).
- lambda_handler: Create/Update success and failure, Delete, unsupported
  RequestType, outer exception handling.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

# --- QuotaCodeGenerator unit tests ---


class TestQuotaCodeGeneratorInit:
    """Construction initializes boto3 clients for the given region."""

    def test_init_creates_regional_clients(self):
        with patch("app.boto3.client") as mock_client:
            from app import QuotaCodeGenerator

            QuotaCodeGenerator("us-east-1")

            # Should create two clients, all with region_name=us-east-1
            assert mock_client.call_count == 2
            for call in mock_client.call_args_list:
                assert call.kwargs.get("region_name") == "us-east-1"
            services = [call.args[0] for call in mock_client.call_args_list]
            assert set(services) == {"service-quotas", "s3"}


class TestExtractModelNameFromId:
    """extract_model_name_from_id returns the mapping tuple or None."""

    def test_known_inference_profile_model(self):
        with patch("app.boto3.client"):
            from app import QuotaCodeGenerator

            gen = QuotaCodeGenerator("us-west-2")

        result = gen.extract_model_name_from_id("us.anthropic.claude-opus-4-5-20251101-v1:0")
        assert result == ("Anthropic Claude Opus 4.5", True)

    def test_unknown_model_returns_none(self):
        with patch("app.boto3.client"):
            from app import QuotaCodeGenerator

            gen = QuotaCodeGenerator("us-west-2")

        assert gen.extract_model_name_from_id("foo.bar.unknown:1") is None


class TestGetSupportedModelIds:
    def test_returns_expected_model_ids(self):
        with patch("app.boto3.client"):
            from app import QuotaCodeGenerator

            gen = QuotaCodeGenerator("us-west-2")

        ids = gen.get_supported_model_ids()
        assert "us.anthropic.claude-opus-4-5-20251101-v1:0" in ids
        assert len(ids) == 5


class TestFindQuotaCodeForModel:
    """find_quota_code_for_model paginates Service Quotas and matches by name."""

    def _build_gen(self, pages):
        """Helper to build a QuotaCodeGenerator with a mocked paginator."""
        mock_paginator = MagicMock()
        mock_paginator.paginate.return_value = pages

        with patch("app.boto3.client") as mock_client:
            mock_service_quotas = MagicMock()
            mock_service_quotas.get_paginator.return_value = mock_paginator

            # bedrock, service-quotas, s3 — make service-quotas the mocked one
            def client_factory(service, **kwargs):
                if service == "service-quotas":
                    return mock_service_quotas
                return MagicMock()

            mock_client.side_effect = client_factory

            from app import QuotaCodeGenerator

            return QuotaCodeGenerator("us-west-2")

    def test_finds_inference_profile_quota(self):
        pages = [
            {
                "Quotas": [
                    {
                        "QuotaName": "Cross-region inference tokens per minute for Anthropic Claude Sonnet 4",
                        "QuotaCode": "L-ABCD1234",
                    }
                ]
            }
        ]
        gen = self._build_gen(pages)
        code = gen.find_quota_code_for_model("Anthropic Claude Sonnet 4", "tokens", is_inference_profile=True)
        assert code == "L-ABCD1234"

    def test_finds_on_demand_quota(self):
        pages = [
            {
                "Quotas": [
                    {
                        "QuotaName": "On-demand model inference requests per minute for Anthropic Claude Sonnet",
                        "QuotaCode": "L-EFGH5678",
                    }
                ]
            }
        ]
        gen = self._build_gen(pages)
        code = gen.find_quota_code_for_model("Anthropic Claude Sonnet", "requests", is_inference_profile=False)
        assert code == "L-EFGH5678"

    def test_match_is_case_insensitive(self):
        pages = [
            {
                "Quotas": [
                    {
                        "QuotaName": "CROSS-REGION INFERENCE TOKENS PER MINUTE FOR ANTHROPIC CLAUDE SONNET 4",
                        "QuotaCode": "L-CASE1234",
                    }
                ]
            }
        ]
        gen = self._build_gen(pages)
        code = gen.find_quota_code_for_model("Anthropic Claude Sonnet 4", "tokens", is_inference_profile=True)
        assert code == "L-CASE1234"

    def test_no_match_returns_none(self):
        pages = [{"Quotas": [{"QuotaName": "Some other quota", "QuotaCode": "L-OTHER"}]}]
        gen = self._build_gen(pages)
        code = gen.find_quota_code_for_model("Anthropic Claude Sonnet 4", "tokens", is_inference_profile=True)
        assert code is None

    def test_client_error_returns_none(self):
        with patch("app.boto3.client") as mock_client:
            mock_service_quotas = MagicMock()
            mock_service_quotas.get_paginator.side_effect = RuntimeError("boom")

            def client_factory(service, **kwargs):
                if service == "service-quotas":
                    return mock_service_quotas
                return MagicMock()

            mock_client.side_effect = client_factory

            from app import QuotaCodeGenerator

            gen = QuotaCodeGenerator("us-west-2")

        code = gen.find_quota_code_for_model("Anthropic Claude Sonnet 4", "tokens")
        assert code is None


class TestGenerateAndStoreQuotaCodes:
    """generate_and_store_quota_codes aggregates mappings and stores to S3."""

    def _build_gen(self, find_quota_side_effect, s3_put_side_effect=None):
        with patch("app.boto3.client") as mock_client:
            mock_s3 = MagicMock()
            if s3_put_side_effect is not None:
                mock_s3.put_object.side_effect = s3_put_side_effect

            def client_factory(service, **kwargs):
                if service == "s3":
                    return mock_s3
                return MagicMock()

            mock_client.side_effect = client_factory

            from app import QuotaCodeGenerator

            gen = QuotaCodeGenerator("us-west-2")
            gen._mock_s3 = mock_s3  # expose for assertions
            return gen

    def test_success_writes_expected_payload_to_s3(self):
        # Return alternating tokens and requests quota codes
        call_tracker = {"n": 0}

        def find_quota(model_name, quota_type, is_inference_profile=False):
            call_tracker["n"] += 1
            return f"L-{quota_type[:3].upper()}{call_tracker['n']}"

        gen = self._build_gen(find_quota_side_effect=None)

        with patch.object(gen, "find_quota_code_for_model", side_effect=find_quota):
            result = gen.generate_and_store_quota_codes("test-bucket", key="quota-codes.json")

        assert result is True
        gen._mock_s3.put_object.assert_called_once()
        kwargs = gen._mock_s3.put_object.call_args.kwargs
        assert kwargs["Bucket"] == "test-bucket"
        assert kwargs["Key"] == "quota-codes.json"
        assert kwargs["ContentType"] == "application/json"

        body = json.loads(kwargs["Body"])
        assert body["region"] == "us-west-2"
        assert body["successful_mappings"] == 5
        assert body["failed_mappings"] == 0
        assert len(body["models"]) == 5
        # Spot-check one mapping
        sample = body["models"]["us.anthropic.claude-opus-4-5-20251101-v1:0"]
        assert sample["is_inference_profile"] is True
        assert sample["tokens_quota_code"].startswith("L-TOK")
        assert sample["requests_quota_code"].startswith("L-REQ")

    def test_all_quota_lookups_fail_records_failures(self):
        gen = self._build_gen(find_quota_side_effect=None)

        with patch.object(gen, "find_quota_code_for_model", return_value=None):
            result = gen.generate_and_store_quota_codes("test-bucket")

        assert result is True  # S3 put still succeeds
        body = json.loads(gen._mock_s3.put_object.call_args.kwargs["Body"])
        assert body["successful_mappings"] == 0
        assert body["failed_mappings"] == 5
        assert body["models"] == {}

    def test_s3_put_failure_returns_false(self):
        gen = self._build_gen(
            find_quota_side_effect=None,
            s3_put_side_effect=RuntimeError("S3 unavailable"),
        )

        with patch.object(gen, "find_quota_code_for_model", return_value="L-X"):
            result = gen.generate_and_store_quota_codes("test-bucket")

        assert result is False

    def test_partial_quota_only_tokens_is_accepted(self):
        gen = self._build_gen(find_quota_side_effect=None)

        def find_quota(model_name, quota_type, is_inference_profile=False):
            return "L-TOK" if quota_type == "tokens" else None

        with patch.object(gen, "find_quota_code_for_model", side_effect=find_quota):
            result = gen.generate_and_store_quota_codes("test-bucket")

        assert result is True
        body = json.loads(gen._mock_s3.put_object.call_args.kwargs["Body"])
        assert body["successful_mappings"] == 5
        sample = next(iter(body["models"].values()))
        assert sample["tokens_quota_code"] == "L-TOK"
        assert sample["requests_quota_code"] is None


# --- lambda_handler tests ---


def _make_event(request_type, region="us-west-2", bucket="test-bucket"):
    return {
        "RequestType": request_type,
        "ResourceProperties": {"Region": region, "BucketName": bucket},
    }


class TestLambdaHandler:
    def test_create_success_returns_success_status(self):
        with patch("app.QuotaCodeGenerator") as MockGen, patch("app.boto3.client"):
            MockGen.return_value.generate_and_store_quota_codes.return_value = True
            from app import lambda_handler

            result = lambda_handler(_make_event("Create"), None)

        assert result == {"Status": "SUCCESS", "Region": "us-west-2", "BucketName": "test-bucket"}

    def test_update_success_returns_success_status(self):
        with patch("app.QuotaCodeGenerator") as MockGen, patch("app.boto3.client"):
            MockGen.return_value.generate_and_store_quota_codes.return_value = True
            from app import lambda_handler

            result = lambda_handler(_make_event("Update"), None)

        assert result["Status"] == "SUCCESS"

    def test_create_failure_raises_runtime_error(self):
        with patch("app.QuotaCodeGenerator") as MockGen, patch("app.boto3.client"):
            MockGen.return_value.generate_and_store_quota_codes.return_value = False
            from app import lambda_handler

            with pytest.raises(RuntimeError, match="Failed to generate quota codes"):
                lambda_handler(_make_event("Create"), None)

    def test_delete_returns_deleted_without_generating(self):
        with patch("app.QuotaCodeGenerator") as MockGen, patch("app.boto3.client"):
            from app import lambda_handler

            result = lambda_handler(_make_event("Delete"), None)

        assert result == {"Status": "DELETED"}
        MockGen.assert_not_called()

    def test_unsupported_request_type_raises_value_error(self):
        with patch("app.boto3.client"):
            from app import lambda_handler

            with pytest.raises(ValueError, match="Unsupported RequestType: Weird"):
                lambda_handler(_make_event("Weird"), None)

    def test_missing_request_type_raises(self):
        with patch("app.boto3.client"):
            from app import lambda_handler

            # KeyError is caught by outer except and re-raised
            with pytest.raises(KeyError):
                lambda_handler({"ResourceProperties": {"Region": "us-west-2", "BucketName": "x"}}, None)

    def test_missing_properties_raises(self):
        with patch("app.boto3.client"):
            from app import lambda_handler

            with pytest.raises(KeyError):
                lambda_handler({"RequestType": "Create", "ResourceProperties": {}}, None)

    def test_generator_exception_propagates(self):
        """Exceptions from the generator should propagate via the outer re-raise."""
        with patch("app.QuotaCodeGenerator") as MockGen, patch("app.boto3.client"):
            MockGen.return_value.generate_and_store_quota_codes.side_effect = RuntimeError("boto failed")
            from app import lambda_handler

            with pytest.raises(RuntimeError, match="boto failed"):
                lambda_handler(_make_event("Create"), None)
