#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Unit tests for the Detection Bridge Translator Lambda handler.

Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
"""

import json
from unittest.mock import MagicMock, patch


def _make_s3_event(*records):
    """Build an S3 event with one or more record tuples of (bucket, key)."""
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                }
            }
            for bucket, key in records
        ]
    }


def _make_raw_event(records_list):
    """Build an S3 event from raw record dicts."""
    return {"Records": records_list}


class TestSingleValidS3Event:
    """Test single valid S3 event → correct SNSRequest published."""

    def test_valid_event_publishes_correct_sns_request(self):
        """Validates: Requirements 2.1, 2.2, 2.3, 2.4"""
        event = _make_s3_event(("webapp-detection-bridge-123456789012", "abc-123/my-image.geojson"))

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200

        mock_sns.publish.assert_called_once()
        msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])

        assert msg["image_uri"] == "s3://webapp-detection-bridge-123456789012/abc-123/my-image.geojson"
        assert msg["item_id"] == "abc-123-my-image"
        assert msg["collection_id"] == "model-runner-detections"

    def test_response_body_contains_success_count(self):
        """Response body reports correct success/error counts."""
        event = _make_s3_event(("my-bucket", "job1/img.geojson"))

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        body = json.loads(result["body"])
        assert body["success"] == 1
        assert body["errors"] == 0


class TestMissingBucket:
    """Test missing bucket → 400, no publish."""

    def test_missing_bucket_key_returns_400(self):
        """Validates: Requirements 2.5"""
        record = {
            "s3": {
                "object": {"key": "job1/img.geojson"},
            }
        }
        event = _make_raw_event([record])

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0

    def test_empty_bucket_name_returns_400(self):
        """Validates: Requirements 2.5"""
        record = {
            "s3": {
                "bucket": {"name": ""},
                "object": {"key": "job1/img.geojson"},
            }
        }
        event = _make_raw_event([record])

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0


class TestMissingKey:
    """Test missing key → 400, no publish."""

    def test_missing_object_key_returns_400(self):
        """Validates: Requirements 2.5"""
        record = {
            "s3": {
                "bucket": {"name": "my-bucket"},
            }
        }
        event = _make_raw_event([record])

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0

    def test_empty_object_key_returns_400(self):
        """Validates: Requirements 2.5"""
        record = {
            "s3": {
                "bucket": {"name": "my-bucket"},
                "object": {"key": ""},
            }
        }
        event = _make_raw_event([record])

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0


class TestMultiRecordMixedEvent:
    """Test multi-record event with mix of valid/invalid → valid records processed."""

    def test_valid_records_processed_despite_malformed(self):
        """Validates: Requirements 2.6"""
        records = [
            # Valid record
            {
                "s3": {
                    "bucket": {"name": "my-bucket"},
                    "object": {"key": "job1/img1.geojson"},
                }
            },
            # Malformed: missing bucket
            {
                "s3": {
                    "object": {"key": "job2/img2.geojson"},
                }
            },
            # Valid record
            {
                "s3": {
                    "bucket": {"name": "my-bucket"},
                    "object": {"key": "job3/img3.geojson"},
                }
            },
        ]
        event = _make_raw_event(records)

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        # 2 valid records → 200 status
        assert result["statusCode"] == 200
        assert mock_sns.publish.call_count == 2

        body = json.loads(result["body"])
        assert body["success"] == 2
        assert body["errors"] == 1


class TestEnvironmentVariableOverride:
    """Test environment variable override for DETECTION_COLLECTION_ID."""

    def test_custom_collection_id_from_env(self):
        """Validates: Requirements 2.7"""
        event = _make_s3_event(("my-bucket", "job1/img.geojson"))

        mock_sns = MagicMock()

        with patch("handler.sns_client", mock_sns), patch("handler.DETECTION_COLLECTION_ID", "custom-collection"):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200
        msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])
        assert msg["collection_id"] == "custom-collection"


class TestNestedDirectoryKey:
    """Test key with nested directories (e.g., a/b/c.geojson) → correct item_id derivation."""

    def test_nested_key_derives_correct_item_id(self):
        """
        Validates: Requirements 2.2

        Key: a/b/c.geojson
        Per design: job_id = parts[0] = 'a', filename = parts[-1] = 'c.geojson',
        image_name = 'c', item_id = 'a-c'
        """
        event = _make_s3_event(("my-bucket", "a/b/c.geojson"))

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200
        msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])
        assert msg["item_id"] == "a-c"
        assert msg["image_uri"] == "s3://my-bucket/a/b/c.geojson"

    def test_deeply_nested_key(self):
        """Key with multiple directory levels: x/y/z/w/file.geojson → item_id = x-file"""
        event = _make_s3_event(("bucket", "x/y/z/w/file.geojson"))

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200
        msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])
        assert msg["item_id"] == "x-file"


class TestNoRecordsEvent:
    """Test empty Records array returns 400."""

    def test_empty_records_returns_400(self):
        event = {"Records": []}

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0

    def test_missing_records_key_returns_400(self):
        event = {}

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0
