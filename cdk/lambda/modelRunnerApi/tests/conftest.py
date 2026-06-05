# Copyright Amazon.com, Inc. or its affiliates.
"""Pytest fixtures for Model Runner API Lambda testing."""

import importlib
import os
import sys

import pytest
from moto import mock_aws

# Make the Lambda source modules (app, config, models) importable when pytest
# is invoked directly (tox sets PYTHONPATH; this covers the direct case too).
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

TABLE_NAME = "test-mr-jobs"
REGION = "us-west-2"


@pytest.fixture
def mr_app():
    """Boot the Model Runner API app against a moto-backed DynamoDB table.

    The app binds its DynamoDB table at import time, so the moto mock is
    started and the table created *before* a fresh import of ``app``/``config``
    so their module-level boto3 clients are created under the mock.
    """
    os.environ["AWS_DEFAULT_REGION"] = REGION
    os.environ["AWS_ACCESS_KEY_ID"] = "testing"
    os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
    os.environ["AWS_SESSION_TOKEN"] = "testing"
    os.environ["DDB_TABLE"] = TABLE_NAME
    os.environ["IMAGE_REQUEST_QUEUE_URL"] = f"https://sqs.{REGION}.amazonaws.com/123456789012/test-queue"

    mock = mock_aws()
    mock.start()
    try:
        import boto3

        dynamodb = boto3.resource("dynamodb", region_name=REGION)
        table = dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[{"AttributeName": "job_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "job_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.wait_until_exists()

        # Fresh import so `table = initialize_table()` binds to the moto table.
        for name in ("app", "config"):
            sys.modules.pop(name, None)
        app_module = importlib.import_module("app")

        yield app_module, table
    finally:
        mock.stop()
        for name in ("app", "config"):
            sys.modules.pop(name, None)
