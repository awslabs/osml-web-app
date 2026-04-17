# Copyright Amazon.com, Inc. or its affiliates.
"""
Configuration settings for Model Runner API Lambda function.
"""

import os

import boto3

# Get environment variables
DDB_TABLE = os.environ.get("DDB_TABLE", "")
IMAGE_REQUEST_QUEUE_URL = os.environ.get("IMAGE_REQUEST_QUEUE_URL", "")

# Initialize AWS clients
sqs = boto3.client("sqs")
s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")

# Initialize table reference (will be set by the app)
table = None


def initialize_table():
    """Initialize the DynamoDB table reference."""
    global table
    if DDB_TABLE:
        table = dynamodb.Table(DDB_TABLE)
    return table
