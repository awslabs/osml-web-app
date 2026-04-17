# Copyright Amazon.com, Inc. or its affiliates.
"""
Main Lambda handler for Model Runner API.
"""

from mangum import Mangum

from app import app

# Create handler for Lambda
handler = Mangum(app)
