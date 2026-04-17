#  Copyright 2025 Amazon.com, Inc. or its affiliates.

"""
Property-based tests for the Detection Bridge Translator Lambda handler.

Feature: stac-detection-catalog
Property 1: SNSRequest field derivation from S3 event
Property 2: Valid S3 events produce SNS publish
Property 3: Malformed S3 events are rejected without publishing
Property 4: Independent record processing in batch events

Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
"""

import json
import os
from unittest.mock import MagicMock, patch
from uuid import uuid4

import hypothesis.strategies as st
from hypothesis import given, settings

# --- Strategies ---

# S3 bucket names: 3-63 lowercase alphanumeric chars and hyphens, must start/end with alphanum
_bucket_char = st.sampled_from("abcdefghijklmnopqrstuvwxyz0123456789")
_bucket_middle = st.sampled_from("abcdefghijklmnopqrstuvwxyz0123456789-")

bucket_names = st.builds(
    lambda first, middle, last: first + middle + last,
    first=_bucket_char,
    middle=st.text(alphabet=_bucket_middle, min_size=1, max_size=30),
    last=_bucket_char,
)

# Image names: non-empty alphanumeric + hyphens/underscores (no slashes, no dots)
image_names = st.text(
    alphabet=st.sampled_from("abcdefghijklmnopqrstuvwxyz0123456789-_"),
    min_size=1,
    max_size=40,
)

# Job IDs: UUID-like strings
job_ids = st.from_type(type(uuid4())).map(str)


def _make_s3_event(bucket: str, key: str) -> dict:
    """Build a minimal S3 event notification payload."""
    return {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                }
            }
        ]
    }


class TestSNSRequestFieldDerivation:
    """
    **Validates: Requirements 2.1, 2.2, 2.3**

    Property 1: For any valid S3 event record containing a bucket name B and
    object key of the form {job_id}/{image_name}.geojson, the Translation Lambda
    SHALL produce an SNSRequest where:
      - image_uri equals s3://{B}/{job_id}/{image_name}.geojson
      - item_id equals {job_id}-{image_name}
      - collection_id equals the configured Detection Collection identifier
    """

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_image_uri_is_s3_bucket_key(self, bucket, job_id, image_name):
        """image_uri must be s3://{bucket}/{key}."""
        key = f"{job_id}/{image_name}.geojson"

        from handler import _build_sns_message

        msg = json.loads(_build_sns_message(bucket, key))
        assert msg["image_uri"] == f"s3://{bucket}/{key}"

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_item_id_is_job_id_dash_image_name(self, bucket, job_id, image_name):
        """item_id must be {job_id}-{image_name}."""
        key = f"{job_id}/{image_name}.geojson"

        from handler import _build_sns_message

        msg = json.loads(_build_sns_message(bucket, key))
        assert msg["item_id"] == f"{job_id}-{image_name}"

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_collection_id_matches_env_var(self, bucket, job_id, image_name):
        """collection_id must match the DETECTION_COLLECTION_ID env var."""
        key = f"{job_id}/{image_name}.geojson"

        from handler import DETECTION_COLLECTION_ID, _build_sns_message

        msg = json.loads(_build_sns_message(bucket, key))
        assert msg["collection_id"] == DETECTION_COLLECTION_ID

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_handler_publishes_correct_sns_message(self, bucket, job_id, image_name):
        """Full handler invocation produces correct SNSRequest fields via mocked SNS."""
        key = f"{job_id}/{image_name}.geojson"
        event = _make_s3_event(bucket, key)

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200

        # Verify the published message
        mock_sns.publish.assert_called_once()
        published_msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])

        assert published_msg["image_uri"] == f"s3://{bucket}/{key}"
        assert published_msg["item_id"] == f"{job_id}-{image_name}"
        assert published_msg["collection_id"] == os.environ.get("DETECTION_COLLECTION_ID", "model-runner-detections")


# --- Strategies for malformed records ---

# Malformed records: missing bucket, missing key, wrong types, empty structures
_malformed_records = st.one_of(
    # Missing 's3' key entirely
    st.fixed_dictionaries({"eventSource": st.just("aws:s3")}),
    # Missing 'bucket' inside s3
    st.fixed_dictionaries(
        {"s3": st.fixed_dictionaries({"object": st.fixed_dictionaries({"key": st.just("some/key.geojson")})})}
    ),
    # Missing 'object' inside s3
    st.fixed_dictionaries({"s3": st.fixed_dictionaries({"bucket": st.fixed_dictionaries({"name": st.just("my-bucket")})})}),
    # Empty bucket name
    st.fixed_dictionaries(
        {
            "s3": st.fixed_dictionaries(
                {
                    "bucket": st.fixed_dictionaries({"name": st.just("")}),
                    "object": st.fixed_dictionaries({"key": st.just("some/key.geojson")}),
                }
            )
        }
    ),
    # Empty object key
    st.fixed_dictionaries(
        {
            "s3": st.fixed_dictionaries(
                {
                    "bucket": st.fixed_dictionaries({"name": st.just("my-bucket")}),
                    "object": st.fixed_dictionaries({"key": st.just("")}),
                }
            )
        }
    ),
    # Wrong type for s3 (not a dict)
    st.fixed_dictionaries({"s3": st.just("not-a-dict")}),
    # Wrong type for bucket (not a dict)
    st.fixed_dictionaries(
        {
            "s3": st.fixed_dictionaries(
                {
                    "bucket": st.just(42),
                    "object": st.fixed_dictionaries({"key": st.just("some/key.geojson")}),
                }
            )
        }
    ),
    # None values
    st.fixed_dictionaries(
        {
            "s3": st.fixed_dictionaries(
                {
                    "bucket": st.fixed_dictionaries({"name": st.none()}),
                    "object": st.fixed_dictionaries({"key": st.just("some/key.geojson")}),
                }
            )
        }
    ),
)


def _make_valid_record(bucket: str, job_id: str, image_name: str) -> dict:
    """Build a single valid S3 event record."""
    return {
        "s3": {
            "bucket": {"name": bucket},
            "object": {"key": f"{job_id}/{image_name}.geojson"},
        }
    }


class TestValidS3EventsProduceSNSPublish:
    """
    **Validates: Requirements 2.4**

    Property 2: For any valid S3 event record with a non-empty bucket and a key
    matching {prefix}/{filename}.geojson, the Translation Lambda SHALL publish
    exactly one message to the Intake SNS topic containing a JSON-parseable SNSRequest.
    """

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_single_valid_record_produces_one_publish(self, bucket, job_id, image_name):
        """A single valid S3 event record triggers exactly one sns.publish() call."""
        key = f"{job_id}/{image_name}.geojson"
        event = _make_s3_event(bucket, key)

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 200
        assert mock_sns.publish.call_count == 1

    @given(
        bucket=bucket_names,
        job_id=job_ids,
        image_name=image_names,
    )
    @settings(max_examples=150, deadline=None)
    def test_published_message_is_valid_json(self, bucket, job_id, image_name):
        """The published SNS message must be valid JSON with required fields."""
        key = f"{job_id}/{image_name}.geojson"
        event = _make_s3_event(bucket, key)

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            handler(event, None)

        published_msg = json.loads(mock_sns.publish.call_args.kwargs["Message"])
        assert "image_uri" in published_msg
        assert "item_id" in published_msg
        assert "collection_id" in published_msg


class TestMalformedS3EventsRejected:
    """
    **Validates: Requirements 2.5**

    Property 3: For any S3 event record that is missing the bucket name, missing
    the object key, or has an unparseable structure, the Translation Lambda SHALL
    return a 400 status code and SHALL NOT publish any message to the Intake SNS topic.
    """

    @given(record=_malformed_records)
    @settings(max_examples=150, deadline=None)
    def test_malformed_record_returns_400_no_publish(self, record):
        """Malformed S3 event records produce 400 and zero SNS publishes."""
        event = {"Records": [record]}

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0


class TestIndependentRecordProcessing:
    """
    **Validates: Requirements 2.6**

    Property 4: For any S3 event containing N records where K records are valid
    and (N-K) records are malformed, the Translation Lambda SHALL successfully
    process and publish SNSRequests for all K valid records regardless of the
    malformed records.
    """

    @given(
        valid_records=st.lists(
            st.tuples(bucket_names, job_ids, image_names),
            min_size=1,
            max_size=5,
        ),
        malformed_records=st.lists(_malformed_records, min_size=0, max_size=5),
    )
    @settings(max_examples=150, deadline=None)
    def test_valid_records_published_despite_malformed(self, valid_records, malformed_records):
        """K valid records produce exactly K publishes even when mixed with malformed records."""
        records = []
        for bucket, job_id, image_name in valid_records:
            records.append(_make_valid_record(bucket, job_id, image_name))
        records.extend(malformed_records)

        event = {"Records": records}

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        k = len(valid_records)
        assert result["statusCode"] == 200
        assert mock_sns.publish.call_count == k

    @given(
        malformed_records=st.lists(_malformed_records, min_size=1, max_size=5),
    )
    @settings(max_examples=100, deadline=None)
    def test_all_malformed_returns_400(self, malformed_records):
        """When all records are malformed, handler returns 400 with zero publishes."""
        event = {"Records": malformed_records}

        mock_sns = MagicMock()
        with patch("handler.sns_client", mock_sns):
            from handler import handler

            result = handler(event, None)

        assert result["statusCode"] == 400
        assert mock_sns.publish.call_count == 0
