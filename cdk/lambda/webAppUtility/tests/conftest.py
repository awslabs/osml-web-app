# Copyright Amazon.com, Inc. or its affiliates.
"""
Pytest fixtures for Lambda testing
"""

import os

import pytest
from moto import mock_aws


@pytest.fixture
def aws_credentials():
    """Mock AWS credentials for moto"""
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SECURITY_TOKEN"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["AWS_DEFAULT_REGION"] = "us-west-2"


@pytest.fixture
def dynamodb_table(aws_credentials):
    """Create a mock DynamoDB table for quota tracking"""
    # Start the mock and keep it active for the entire test
    mock = mock_aws()
    mock.start()

    import boto3

    # Set environment variable for table name
    os.environ["QUOTA_TRACKING_TABLE"] = "test-quota-table"

    # Create DynamoDB table
    dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
    table = dynamodb.create_table(
        TableName="test-quota-table",
        KeySchema=[
            {"AttributeName": "model_id", "KeyType": "HASH"},
            {"AttributeName": "request_timestamp", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "model_id", "AttributeType": "S"},
            {"AttributeName": "request_timestamp", "AttributeType": "N"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )

    yield table

    # Stop the mock after the test completes
    mock.stop()


@pytest.fixture
def s3_bucket(aws_credentials):
    """Create a mock S3 bucket"""
    with mock_aws():
        import boto3

        s3 = boto3.client("s3", region_name="us-west-2")
        bucket_name = "test-bucket"
        s3.create_bucket(Bucket=bucket_name, CreateBucketConfiguration={"LocationConstraint": "us-west-2"})

        yield bucket_name


@pytest.fixture
def bedrock_client(aws_credentials):
    """Create a mock Bedrock client"""
    with mock_aws():
        import boto3

        client = boto3.client("bedrock", region_name="us-west-2")
        yield client


@pytest.fixture
def bedrock_runtime_client(aws_credentials):
    """Create a mock Bedrock Runtime client"""
    with mock_aws():
        import boto3

        client = boto3.client("bedrock-runtime", region_name="us-west-2")
        yield client
