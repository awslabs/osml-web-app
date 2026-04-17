# Copyright Amazon.com, Inc. or its affiliates.
"""
WebApp Utility API Lambda Handler

This module provides the entry point for the WebApp Utility API Lambda function.
It uses Mangum to adapt the FastAPI application for AWS Lambda execution.
"""

from mangum import Mangum

from app import app

# Create the Lambda handler using Mangum
handler = Mangum(app, lifespan="off")
