#  Copyright 2024-2025 Amazon.com, Inc. or its affiliates.

"""
Detection Bridge Translator Lambda Handler

Receives S3 event notifications from the detection bridge bucket and translates
them into SNSRequest format for the data-catalog-intake pipeline. Each S3 event
record is processed independently — malformed records are logged and skipped.
"""

import json
import logging
import os
from typing import Any, Dict

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sns_client = boto3.client("sns")

INTAKE_TOPIC_ARN = os.environ.get("INTAKE_TOPIC_ARN", "")
DETECTION_COLLECTION_ID = os.environ.get("DETECTION_COLLECTION_ID", "model-runner-detections")


def _extract_s3_info(record: Dict[str, Any]) -> tuple:
    """
    Extract bucket name and object key from an S3 event record.

    :param record: A single record from the S3 event notification.
    :returns: Tuple of (bucket_name, object_key).
    :raises ValueError: If the record is missing required S3 fields.
    """
    try:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
    except (KeyError, TypeError) as err:
        raise ValueError(f"Malformed S3 event record — missing required fields: {err}")

    if not bucket:
        raise ValueError("S3 event record has empty bucket name")
    if not key:
        raise ValueError("S3 event record has empty object key")

    return bucket, key


def _derive_item_id(key: str) -> str:
    """
    Derive item_id from the S3 object key.

    The key structure is `{job_id}/{image_name}.geojson`. The item_id is
    `{job_id}-{image_name}` (filename without the .geojson extension).

    :param key: The S3 object key.
    :returns: The derived item_id string.
    """
    parts = key.split("/")
    job_id = parts[0]
    filename = parts[-1]
    image_name = filename.removesuffix(".geojson")
    return f"{job_id}-{image_name}"


def _build_sns_message(bucket: str, key: str) -> str:
    """
    Build the SNSRequest JSON message from bucket and key.

    :param bucket: The S3 bucket name.
    :param key: The S3 object key.
    :returns: JSON string with image_uri, item_id, and collection_id.
    """
    image_uri = f"s3://{bucket}/{key}"
    item_id = _derive_item_id(key)
    message = {
        "image_uri": image_uri,
        "item_id": item_id,
        "collection_id": DETECTION_COLLECTION_ID,
    }
    return json.dumps(message)


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for translating S3 event notifications into SNSRequest messages.

    Processes each record in the event independently. Malformed records are logged
    and skipped. Returns 200 if at least one record was successfully processed,
    or 400 if all records were malformed.

    :param event: The S3 event notification payload.
    :param context: The Lambda execution context (unused).
    :returns: Response dict with statusCode and body.
    """
    records = event.get("Records", [])
    if not records:
        logger.error("No records found in event")
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "No records in event"}),
        }

    success_count = 0
    error_count = 0

    for i, record in enumerate(records):
        try:
            bucket, key = _extract_s3_info(record)
            message = _build_sns_message(bucket, key)

            sns_client.publish(
                TopicArn=INTAKE_TOPIC_ARN,
                Message=message,
                Subject="New Detection GeoJSON",
            )

            logger.info(f"Record {i}: published SNSRequest for s3://{bucket}/{key}")
            success_count += 1

        except ValueError as err:
            logger.error(f"Record {i}: skipping malformed record — {err}")
            error_count += 1
        except Exception as err:
            logger.error(f"Record {i}: failed to publish to SNS — {err}")
            error_count += 1

    if success_count == 0:
        return {
            "statusCode": 400,
            "body": json.dumps(
                {
                    "error": "All records failed",
                    "total": len(records),
                    "errors": error_count,
                }
            ),
        }

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "Processed successfully",
                "total": len(records),
                "success": success_count,
                "errors": error_count,
            }
        ),
    }
