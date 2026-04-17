# Copyright Amazon.com, Inc. or its affiliates.
"""
Status monitor Lambda handler for Model Runner API.
Handles SNS notifications and updates DynamoDB with job status.
"""

import json
import logging
import os
from datetime import datetime

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Get DynamoDB table name from environment
DDB_TABLE = os.environ.get("DDB_TABLE", "")

# Initialize AWS clients
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(DDB_TABLE)


def handler(event, context):
    """Handle SNS notifications and update job status in DynamoDB."""
    logger.info(f"Received event: {json.dumps(event)}")

    for record in event["Records"]:
        try:
            logger.info(f"Processing record: {json.dumps(record)}")

            # Get values from MessageAttributes
            message_attributes = record["Sns"]["MessageAttributes"]

            # Required attributes
            job_id = message_attributes["job_id"]["Value"]
            status = message_attributes["status"]["Value"]

            # Build update expression dynamically
            update_parts = []
            expression_attribute_names = {}
            expression_attribute_values = {}

            # Always update status and updated_at
            update_parts.extend(["#status = :status", "updated_at = :updated_at"])
            expression_attribute_names["#status"] = "status"
            expression_attribute_values.update({":status": status, ":updated_at": datetime.utcnow().isoformat()})

            # Optional attributes - only add if present
            if "image_id" in message_attributes:
                update_parts.append("image_id = :image_id")
                expression_attribute_values[":image_id"] = message_attributes["image_id"]["Value"]

            if "image_status" in message_attributes:
                update_parts.append("image_status = :image_status")
                expression_attribute_values[":image_status"] = message_attributes["image_status"]["Value"]

            if "processing_duration" in message_attributes:
                update_parts.append("processing_duration = :processing_duration")
                expression_attribute_values[":processing_duration"] = message_attributes["processing_duration"]["Value"]

            if "result_url" in message_attributes:
                update_parts.append("result_url = :result_url")
                expression_attribute_values[":result_url"] = message_attributes["result_url"]["Value"]

            # Construct the final update expression
            update_expression = "SET " + ", ".join(update_parts)

            # Update DDB
            update_params = {
                "Key": {"job_id": job_id},
                "UpdateExpression": update_expression,
                "ExpressionAttributeNames": expression_attribute_names,
                "ExpressionAttributeValues": expression_attribute_values,
            }

            logger.info(f"Updating DDB with params: {json.dumps(update_params)}")

            table.update_item(**update_params)

            logger.info(f"Successfully updated item for job_id: {job_id} with status: {status}")

        except KeyError as e:
            logger.error(f"Missing expected key in message attributes: {str(e)}")
            logger.error(f"Available attributes: {json.dumps(record['Sns'].get('MessageAttributes', {}))}")
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            logger.error(f"Record: {json.dumps(record)}")

    return {"statusCode": 200, "body": json.dumps("Processed {} messages".format(len(event["Records"])))}
