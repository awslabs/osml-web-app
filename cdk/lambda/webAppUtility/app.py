# Copyright Amazon.com, Inc. or its affiliates.
"""
WebApp Utility API

This FastAPI application provides utility endpoints for the OSML Prototype Web App,
including S3 bucket operations and Bedrock model interactions.
"""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from quota_codes_loader import get_quota_codes_loader

# Import quota tracker and quota codes loader
from quota_tracker import get_quota_tracker

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize FastAPI app
app = FastAPI(title="WebApp Utility API", description="Utility API for OSML Prototype Web App", version="1.0.0")


# Environment variables
RESTRICT_BUCKET_ACCESS = os.getenv("RESTRICT_BUCKET_ACCESS", "false").lower() == "true"
ALLOWED_BUCKET_ARNS = os.getenv("ALLOWED_BUCKET_ARNS", "").split(",") if os.getenv("ALLOWED_BUCKET_ARNS") else []
ENABLE_CORS = os.getenv("ENABLE_CORS", "false").lower() == "true"

# Bedrock quota usage tracking
ENABLE_QUOTA_TRACKING = os.getenv("ENABLE_QUOTA_TRACKING", "true").lower() == "true"

# Default model for chat (inference profile ID)
DEFAULT_MODEL_ID = os.getenv("DEFAULT_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")

# Output token burndown rate for Claude 4.x models (5x consumption)
OUTPUT_BURNDOWN_RATE = 5

# Supported models configuration - inference profile IDs with quotas
# These are the only models the app will expose to users
SUPPORTED_MODELS = {
    "us.anthropic.claude-opus-4-5-20251101-v1:0": {
        "name": "Claude Opus 4.5",
        "provider": "Anthropic",
        "rpm": 250,
        "tpm": 500000,
        "tpd": 720000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": {
        "name": "Claude Haiku 4.5",
        "provider": "Anthropic",
        "rpm": 250,
        "tpm": 1000000,
        "tpd": 1440000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        "name": "Claude Sonnet 4.5",
        "provider": "Anthropic",
        "rpm": 200,
        "tpm": 500000,
        "tpd": 720000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-opus-4-1-20250501-v1:0": {
        "name": "Claude Opus 4.1",
        "provider": "Anthropic",
        "rpm": 250,
        "tpm": 500000,
        "tpd": 720000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-sonnet-4-20250514-v1:0": {
        "name": "Claude Sonnet 4",
        "provider": "Anthropic",
        "rpm": 200,
        "tpm": 500000,
        "tpd": 720000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-sonnet-4-6": {
        "name": "Claude Sonnet 4.6",
        "provider": "Anthropic",
        "rpm": 10000,
        "tpm": 6000000,
        "tpd": 8640000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
    "us.anthropic.claude-opus-4-6-v1": {
        "name": "Claude Opus 4.6",
        "provider": "Anthropic",
        "rpm": 10000,
        "tpm": 3000000,
        "tpd": 4320000000,
        "burndown": 5,
        "streaming": True,
        "tool_use": True,
    },
}

# Allow override of supported models via environment variable (comma-separated inference profile IDs)
ENABLED_MODELS_ENV = os.getenv("ENABLED_MODELS", "")
if ENABLED_MODELS_ENV:
    enabled_ids = [m.strip() for m in ENABLED_MODELS_ENV.split(",") if m.strip()]
    SUPPORTED_MODELS = {k: v for k, v in SUPPORTED_MODELS.items() if k in enabled_ids}

# Configure CORS if enabled
if ENABLE_CORS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
    )
# Cache for buckets that have been CORS-configured (persists for Lambda lifetime)
_cors_configured_buckets: set = set()

# Initialize AWS clients
try:
    # Get region from environment or default to us-west-2
    region = os.getenv("AWS_REGION", "us-west-2")

    # Configure S3 client with Signature Version 4 for KMS encrypted buckets
    s3_config = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})

    s3_client = boto3.client("s3", config=s3_config, region_name=region)
    bedrock_client = boto3.client("bedrock", region_name=region)
    bedrock_runtime = boto3.client("bedrock-runtime", region_name=region)
    sagemaker_client = boto3.client("sagemaker", region_name=region)

    logger.info(f"AWS clients initialized for region: {region}")
    logger.info("S3 client configured with Signature Version 4 for KMS compatibility")

except NoCredentialsError:
    logger.error("AWS credentials not found")
    s3_client = None
    bedrock_client = None
    bedrock_runtime = None
    sagemaker_client = None

# Initialize quota codes loader if quota tracking is enabled
quota_codes_loader = None
if ENABLE_QUOTA_TRACKING:
    try:
        bucket_name = os.getenv("QUOTA_CODES_BUCKET")
        if bucket_name:
            quota_codes_loader = get_quota_codes_loader(region=region, bucket_name=bucket_name)
            logger.info("Quota codes loader initialized")
        else:
            logger.warning("QUOTA_CODES_BUCKET not set, quota codes loader disabled")
    except Exception as e:
        logger.warning(f"Failed to initialize quota codes loader: {e}")

# Log quota tracking status
if ENABLE_QUOTA_TRACKING:
    logger.info(f"Quota tracking enabled with {len(SUPPORTED_MODELS)} supported models")
    logger.info(f"Default model: {DEFAULT_MODEL_ID}")
else:
    logger.info("Quota tracking disabled")


# Pydantic models
class S3Bucket(BaseModel):
    name: str
    creation_date: Optional[str] = None


class S3Object(BaseModel):
    key: str
    size: int
    last_modified: Optional[str] = None
    etag: str


class S3BucketsResponse(BaseModel):
    buckets: List[S3Bucket]


class S3ObjectsResponse(BaseModel):
    objects: List[S3Object]


class PresignedUrlResponse(BaseModel):
    presignedUrl: str


class BedrockModel(BaseModel):
    modelId: str
    modelName: str
    providerName: str
    inputModalities: List[str]
    outputModalities: List[str]
    supportsStreaming: bool
    modelLifecycle: str
    customizationsSupported: List[str]
    inferenceTypesSupported: List[str]


class SageMakerEndpoint(BaseModel):
    name: str
    status: str
    creationTime: Optional[str] = None


class SageMakerEndpointsResponse(BaseModel):
    endpoints: List[SageMakerEndpoint]


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    modelId: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    maxTokens: int = Field(default=4000, ge=1, le=8000)
    temperature: float = Field(default=1.0, ge=0.0, le=1.0)


class ToolCall(BaseModel):
    toolUseId: str
    name: str
    input: Dict[str, Any]


class QuotaInfo(BaseModel):
    """Quota information returned with responses"""

    has_limits: bool
    model_id: str
    limits: Optional[Dict[str, int]] = None
    usage: Optional[Dict[str, int]] = None
    remaining: Optional[Dict[str, int]] = None
    usage_percent: Optional[Dict[str, float]] = None
    reset_in_seconds: Optional[int] = None


class ChatResponse(BaseModel):
    message: str
    usage: Optional[Dict[str, int]] = None
    toolCalls: Optional[List[ToolCall]] = None
    requiresToolExecution: Optional[bool] = None
    quota: Optional[QuotaInfo] = None


class ThrottleErrorResponse(BaseModel):
    """Standardized throttling error response"""

    error: str = "throttled"
    error_type: str  # 'rate_limit' or 'service_unavailable'
    message: str
    retry_after_seconds: int
    model_id: str
    timestamp: str


# MCP-specific models
class McpServerConfig(BaseModel):
    id: str
    name: str
    command: str
    args: Optional[List[str]] = []
    env: Optional[Dict[str, str]] = {}
    transport: Optional[str] = "stdio"
    url: Optional[str] = None


class McpConnectRequest(BaseModel):
    serverId: str
    config: McpServerConfig


class McpToolCallRequest(BaseModel):
    serverId: str
    toolName: str
    arguments: Dict[str, Any]


class EnhancedChatRequest(ChatRequest):
    tools: Optional[List[Dict[str, Any]]] = []
    toolChoice: Optional[str] = "auto"


class ToolResult(BaseModel):
    toolUseId: str
    content: List[Dict[str, Any]]
    status: Optional[str] = "success"


# Helper functions
def is_bucket_allowed(bucket_name: str) -> bool:
    """Check if bucket access is allowed based on configuration."""
    if not RESTRICT_BUCKET_ACCESS:
        return True

    if not ALLOWED_BUCKET_ARNS:
        return False

    # Check if bucket ARN is in allowed list
    bucket_arn = f"arn:aws:s3:::{bucket_name}"
    return bucket_arn in ALLOWED_BUCKET_ARNS


def handle_s3_error(error: ClientError, operation: str) -> HTTPException:
    """Convert S3 client errors to appropriate HTTP exceptions."""
    error_code = error.response.get("Error", {}).get("Code", "Unknown")

    if error_code == "NoSuchBucket":
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bucket not found during {operation}")
    elif error_code == "AccessDenied":
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied during {operation}")
    elif error_code == "NoCredentials":
        return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AWS credentials not configured")
    else:
        logger.error(f"S3 error during {operation}: {error}")
        return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"S3 error during {operation}")


def ensure_bucket_cors(bucket_name: str) -> None:
    """Ensure CORS is configured on a bucket for browser access via presigned URLs.

    This is called automatically when generating presigned URLs. It checks if CORS
    is already configured and sets it up if not. Results are cached for the Lambda
    lifetime to avoid redundant API calls.

    Args:
        bucket_name: The S3 bucket name to configure CORS on
    """
    global _cors_configured_buckets

    # Skip if we've already configured this bucket in this Lambda instance
    if bucket_name in _cors_configured_buckets:
        return

    try:
        # Check if CORS is already configured
        try:
            s3_client.get_bucket_cors(Bucket=bucket_name)
            logger.info(f"Bucket {bucket_name} already has CORS configured")
            _cors_configured_buckets.add(bucket_name)
            return
        except ClientError as e:
            if e.response["Error"]["Code"] != "NoSuchCORSConfiguration":
                raise

        # No CORS config exists, set one up for browser access
        cors_config = {
            "CORSRules": [
                {
                    "AllowedHeaders": ["*"],
                    "AllowedMethods": ["GET", "HEAD"],
                    "AllowedOrigins": ["*"],
                    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        }

        s3_client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration=cors_config)
        logger.info(f"CORS configured for bucket {bucket_name}")
        _cors_configured_buckets.add(bucket_name)

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "AccessDenied":
            logger.warning(f"No permission to configure CORS on bucket {bucket_name} - presigned URL may fail in browser")
        else:
            logger.warning(f"Failed to configure CORS on bucket {bucket_name}: {e}")
        # Don't raise - let the presigned URL generation continue, it might still work


def _extract_property_type(prop_def: Dict[str, Any]) -> str:
    """Extract the type from a property definition."""
    # Try to extract actual type
    if "type" in prop_def:
        prop_type = prop_def["type"]
        if prop_type in ["string", "number", "integer", "boolean", "array", "object"]:
            return prop_type

    # Handle anyOf by taking first non-null type
    if "anyOf" in prop_def and isinstance(prop_def["anyOf"], list):
        for option in prop_def["anyOf"]:
            if isinstance(option, dict) and option.get("type") and option.get("type") != "null":
                return option["type"]

    return "string"  # Default to string


def _build_array_schema(prop_def: Dict[str, Any]) -> Dict[str, Any]:
    """Build schema for array type properties."""
    if "items" in prop_def and isinstance(prop_def["items"], dict):
        items_def = prop_def["items"]
        if "type" in items_def and items_def["type"] != "null":
            return {"type": items_def["type"]}
    # Default array items to string type for Bedrock compatibility
    return {"type": "string"}


def _simplify_property(prop_def: Dict[str, Any]) -> Dict[str, Any]:
    """Simplify a single property definition for Bedrock compatibility."""
    if not isinstance(prop_def, dict):
        return {"type": "string"}

    prop_schema = {"type": _extract_property_type(prop_def)}

    # Add description if present
    if "description" in prop_def and isinstance(prop_def["description"], str):
        prop_schema["description"] = prop_def["description"]

    # Handle array items (simplified)
    if prop_schema["type"] == "array":
        prop_schema["items"] = _build_array_schema(prop_def)

    # Handle object properties (simplified)
    if prop_schema["type"] == "object" and "properties" in prop_def:
        prop_schema["properties"] = {}

    return prop_schema


def simplify_json_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Create a minimal JSON schema for Bedrock compatibility.

    Bedrock is very strict about schema format - create the simplest possible schema.
    """
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}

    # Start with minimal object schema
    simplified = {"type": "object", "properties": {}, "required": []}

    # Handle properties
    if "properties" in schema and isinstance(schema["properties"], dict):
        for prop_name, prop_def in schema["properties"].items():
            simplified["properties"][prop_name] = _simplify_property(prop_def)

    # Handle required fields
    if "required" in schema and isinstance(schema["required"], list):
        # Only include required fields that exist in properties
        simplified["required"] = [
            req_field
            for req_field in schema["required"]
            if isinstance(req_field, str) and req_field in simplified["properties"]
        ]

    return simplified


def convert_openai_tools_to_bedrock(openai_tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert OpenAI function format tools to Bedrock tool format.

    Creates the exact format Bedrock expects per AWS documentation.
    """
    bedrock_tools = []

    for tool in openai_tools:
        if tool.get("type") == "function" and "function" in tool:
            func = tool["function"]

            # Get basic info
            name = func.get("name", "")
            description = func.get("description", "")

            if not name:
                logger.warning(f"Skipping tool with empty name: {func}")
                continue

            # Simplify the parameters schema for Bedrock compatibility
            original_params = func.get("parameters", {})
            simplified_params = simplify_json_schema(original_params)

            # Create Bedrock tool spec in the EXACT format AWS docs specify
            bedrock_tool = {
                "name": name,
                "description": description,
                "input_schema": simplified_params,  # Direct schema, not wrapped
            }

            bedrock_tools.append(bedrock_tool)
            logger.debug(f"Converted tool '{name}' to Bedrock format")

    logger.info(f"Converted {len(bedrock_tools)} OpenAI tools to Bedrock format")
    return bedrock_tools


# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "webapp-utility-api"}


# S3 Endpoints
@app.get("/s3/buckets", response_model=S3BucketsResponse)
async def list_s3_buckets():
    """List all S3 buckets (filtered by allowed buckets if configured)."""
    if not s3_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="S3 client not available")

    try:
        response = s3_client.list_buckets()
        buckets = []

        for bucket in response.get("Buckets", []):
            bucket_name = bucket["Name"]

            # Apply bucket filtering if configured
            if is_bucket_allowed(bucket_name):
                buckets.append(
                    S3Bucket(
                        name=bucket_name,
                        creation_date=bucket.get("CreationDate", "").isoformat() if bucket.get("CreationDate") else None,
                    )
                )

        return {"buckets": buckets}

    except ClientError as e:
        raise handle_s3_error(e, "list buckets")


@app.get("/s3/buckets/{bucket_name}/objects", response_model=S3ObjectsResponse)
async def list_s3_objects(bucket_name: str, prefix: str = "", max_keys: int = 1000):
    """List objects in an S3 bucket."""
    if not s3_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="S3 client not available")

    if not is_bucket_allowed(bucket_name):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to this bucket is not allowed")

    try:
        kwargs = {"Bucket": bucket_name, "MaxKeys": min(max_keys, 1000)}  # Cap at 1000 for performance

        if prefix:
            kwargs["Prefix"] = prefix

        response = s3_client.list_objects_v2(**kwargs)
        objects = []

        for obj in response.get("Contents", []):
            objects.append(
                S3Object(
                    key=obj["Key"],
                    size=obj["Size"],
                    last_modified=obj.get("LastModified", "").isoformat() if obj.get("LastModified") else None,
                    etag=obj["ETag"].strip('"'),
                )
            )

        return {"objects": objects}

    except ClientError as e:
        raise handle_s3_error(e, "list objects")


def _check_bucket_access(bucket: str) -> None:
    """Check if bucket access is allowed, raise HTTPException if not."""
    if RESTRICT_BUCKET_ACCESS and bucket not in [arn.split(":")[-1] for arn in ALLOWED_BUCKET_ARNS]:
        logger.warning(f"Access denied to bucket: {bucket}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access to bucket {bucket} is not allowed")


def _log_bucket_contents(bucket: str, decoded_key: str) -> None:
    """Log bucket contents for debugging (non-critical operation)."""
    try:
        prefix = decoded_key.split("/")[0] if "/" in decoded_key else decoded_key
        list_response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=10)
        if "Contents" in list_response:
            logger.info(f"Found {len(list_response['Contents'])} objects in bucket with prefix:")
            for obj in list_response["Contents"]:
                logger.info(f"  Object key: '{obj['Key']}'")
        else:
            logger.warning(f"No objects found in bucket {bucket} with prefix")
    except Exception as list_error:
        logger.warning(f"Could not list objects: {list_error}")


def _verify_object_exists(bucket: str, decoded_key: str) -> None:
    """Verify the S3 object exists, raise HTTPException if not."""
    try:
        head_response = s3_client.head_object(Bucket=bucket, Key=decoded_key)
        logger.info(f"Head object successful - object exists with size: {head_response.get('ContentLength', 'unknown')}")
    except s3_client.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        logger.error(f"Head object failed with error code: {error_code}")
        if error_code == "NoSuchKey":
            logger.error(f"Object not found: {bucket}/{decoded_key}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Object not found: {decoded_key}")
        elif error_code == "Forbidden":
            logger.error(f"Access forbidden for object: {bucket}/{decoded_key}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access forbidden for object: {decoded_key}")
        else:
            logger.error(f"Head object error: {e}")
            raise


@app.delete("/s3/{bucket}/{prefix:path}")
async def delete_s3_objects_by_prefix(bucket: str, prefix: str):
    """Delete all objects under a prefix in an S3 bucket."""
    if not s3_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="S3 client not available")

    decoded_prefix = unquote(prefix)

    if not is_bucket_allowed(bucket):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to this bucket is not allowed")

    try:
        deleted_count = 0
        paginator = s3_client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=bucket, Prefix=decoded_prefix):
            objects = page.get("Contents", [])
            if not objects:
                continue

            delete_keys = [{"Key": obj["Key"]} for obj in objects]
            s3_client.delete_objects(Bucket=bucket, Delete={"Objects": delete_keys})
            deleted_count += len(delete_keys)

        logger.info(f"Deleted {deleted_count} objects from s3://{bucket}/{decoded_prefix}")
        return {"deleted": deleted_count, "prefix": decoded_prefix}

    except ClientError as e:
        raise handle_s3_error(e, "delete objects")


@app.get("/s3/{bucket}/{key:path}", response_model=PresignedUrlResponse)
async def get_presigned_url(bucket: str, key: str):
    """Generate a presigned URL for an object in S3."""
    try:
        _check_bucket_access(bucket)
        ensure_bucket_cors(bucket)

        # Decode the URL-encoded key
        decoded_key = unquote(key)
        logger.info(f"Raw key received: '{key}'")
        logger.info(f"Decoded key: '{decoded_key}'")
        logger.info(f"Generating presigned URL for bucket: {bucket}, key: {decoded_key}")

        _log_bucket_contents(bucket, decoded_key)
        _verify_object_exists(bucket, decoded_key)

        # Generate presigned URL (expiration: 5 minutes)
        url = s3_client.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": decoded_key}, ExpiresIn=300)

        logger.info(f"Successfully generated presigned URL for {bucket}/{decoded_key}")
        logger.info(f"Presigned URL: {url}")
        return PresignedUrlResponse(presignedUrl=url)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {bucket}/{key}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to generate presigned URL: {str(e)}"
        )


# Bedrock Endpoints
@app.get("/bedrock/models", response_model=Dict[str, List[BedrockModel]])
async def list_bedrock_models():
    """List supported Bedrock models (inference profiles) for the app."""
    if not bedrock_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Bedrock client not available")

    try:
        final_models = []

        for model_id, config in SUPPORTED_MODELS.items():
            final_models.append(
                BedrockModel(
                    modelId=model_id,
                    modelName=config["name"],
                    providerName=config["provider"],
                    inputModalities=["TEXT"],
                    outputModalities=["TEXT"],
                    supportsStreaming=config.get("streaming", True),
                    modelLifecycle="ACTIVE",
                    customizationsSupported=[],
                    inferenceTypesSupported=["INFERENCE_PROFILE"],
                )
            )

        # Sort by model name for consistent ordering
        final_models.sort(key=lambda x: x.modelName)

        logger.info(f"Bedrock models endpoint: Returning {len(final_models)} supported models")

        return {"models": final_models}

    except Exception as e:
        logger.error(f"Error listing models: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list Bedrock models")


@app.post("/bedrock/test-connection")
async def test_bedrock_connection():
    """Test connection to Bedrock service."""
    if not bedrock_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Bedrock client not available")

    try:
        # Simple test - list models to verify connection
        response = bedrock_client.list_foundation_models()
        return {"status": "connected", "models_available": len(response.get("modelSummaries", []))}

    except ClientError as e:
        logger.error(f"Bedrock connection test failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Bedrock connection failed")


def _check_quota_preemptively(request: EnhancedChatRequest) -> None:
    """Check quota before making Bedrock request, raise HTTPException if exceeded."""
    if not ENABLE_QUOTA_TRACKING:
        return

    quota_tracker = get_quota_tracker()
    model_config = SUPPORTED_MODELS.get(request.modelId)

    # Set quota limits from hardcoded config if not already set
    if model_config and not quota_tracker.get_limits(request.modelId):
        quota_tracker.set_model_limits(request.modelId, model_config["rpm"], model_config["tpm"])
        logger.info(f"Set quotas for {request.modelId}: {model_config['rpm']} RPM, {model_config['tpm']} TPM")

    # Estimate tokens for this request with burndown for output tokens
    burndown = model_config.get("burndown", OUTPUT_BURNDOWN_RATE) if model_config else OUTPUT_BURNDOWN_RATE
    estimated_input_tokens = sum(_estimate_tokens_accurate(msg.content) for msg in request.messages)
    estimated_output_tokens = request.maxTokens * burndown
    estimated_total_tokens = estimated_input_tokens + estimated_output_tokens

    can_proceed, error_msg, retry_after = quota_tracker.check_quota(request.modelId, estimated_total_tokens)

    if not can_proceed:
        logger.warning(f"Preemptive throttle triggered for {request.modelId}: {error_msg}")
        throttle_response = {
            "error": "throttled",
            "error_type": "quota_exceeded",
            "message": error_msg,
            "retry_after_seconds": retry_after,
            "model_id": request.modelId,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=throttle_response)


def _estimate_tokens_accurate(text: str) -> int:
    """More accurate token estimation for Claude models.

    Claude uses ~4 chars per token on average, but this varies:
    - Regular text: ~4 chars/token
    - JSON/code: ~3 chars/token (more punctuation)
    - Numbers: ~2-3 chars/token

    We use a conservative 3.5 chars/token average.
    """
    return max(1, len(text) // 3.5)


def _truncate_messages_to_fit_context(
    messages: List[Dict[str, Any]],
    max_context_tokens: int = 180000,  # Leave 20k buffer from 200k limit
    system_overhead: int = 1000,  # Reserve for system prompts and tools
) -> List[Dict[str, Any]]:
    """Truncate message history to fit within context window.

    Strategy:
    1. Always keep the last user message (most recent query)
    2. Keep as many recent messages as possible within token limit
    3. Truncate from the beginning of conversation
    """
    if not messages:
        return messages

    # Calculate tokens for each message
    message_tokens = [_estimate_tokens_accurate(msg["content"]) for msg in messages]
    total_tokens = sum(message_tokens) + system_overhead

    # If within limit, return as-is
    if total_tokens <= max_context_tokens:
        logger.info(f"Message history within limit: ~{total_tokens} tokens")
        return messages

    # Need to truncate - keep messages from the end
    logger.warning(f"Message history too large: ~{total_tokens} tokens, truncating to fit {max_context_tokens}")

    kept_messages = []
    kept_tokens = system_overhead

    # Iterate from end to beginning
    for i in range(len(messages) - 1, -1, -1):
        msg_tokens = message_tokens[i]
        if kept_tokens + msg_tokens <= max_context_tokens:
            kept_messages.insert(0, messages[i])
            kept_tokens += msg_tokens
        else:
            # Can't fit more messages
            break

    # Ensure we have at least the last user message
    if not kept_messages and messages:
        # Last message is too large - truncate its content
        last_msg = messages[-1].copy()
        max_chars = int((max_context_tokens - system_overhead) * 3.5)
        if len(last_msg["content"]) > max_chars:
            last_msg["content"] = last_msg["content"][-max_chars:] + "\n[Earlier content truncated]"
        kept_messages = [last_msg]
        logger.warning("Last message truncated to fit context window")

    logger.info(f"Kept {len(kept_messages)}/{len(messages)} messages (~{kept_tokens} tokens)")
    return kept_messages


def _prepare_bedrock_request_body(request: EnhancedChatRequest) -> Dict[str, Any]:
    """Prepare the request body for Bedrock API."""
    claude_messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

    # Truncate messages to fit within context window
    claude_messages = _truncate_messages_to_fit_context(claude_messages)

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": request.maxTokens,
        "temperature": request.temperature,
        "messages": claude_messages,
    }

    # Convert OpenAI tools to Bedrock format and add to request if present
    if request.tools and len(request.tools) > 0:
        bedrock_tools = convert_openai_tools_to_bedrock(request.tools)
        body["tools"] = bedrock_tools

    return body


def _extract_tool_calls(response_body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract tool calls from Bedrock response."""
    tool_calls = []
    if "content" in response_body:
        for content_block in response_body["content"]:
            if content_block.get("type") == "tool_use":
                tool_calls.append(
                    {
                        "toolUseId": content_block.get("id"),
                        "name": content_block.get("name"),
                        "input": content_block.get("input", {}),
                    }
                )
    return tool_calls


def _extract_message_content(response_body: Dict[str, Any]) -> str:
    """Extract text content from Bedrock response."""
    content = ""
    if "content" in response_body and len(response_body["content"]) > 0:
        for content_block in response_body["content"]:
            if content_block.get("type") == "text":
                content += content_block.get("text", "")
    return content


def _extract_usage(response_body: Dict[str, Any]) -> Optional[Dict[str, int]]:
    """Extract usage information from Bedrock response."""
    if "usage" in response_body:
        return {
            "inputTokens": response_body["usage"].get("input_tokens", 0),
            "outputTokens": response_body["usage"].get("output_tokens", 0),
        }
    return None


def _record_usage(request: EnhancedChatRequest, usage: Optional[Dict[str, int]]) -> None:
    """Record actual usage for quota tracking."""
    if not ENABLE_QUOTA_TRACKING or not usage:
        return

    quota_tracker = get_quota_tracker()
    model_config = SUPPORTED_MODELS.get(request.modelId)
    burndown = model_config.get("burndown", OUTPUT_BURNDOWN_RATE) if model_config else OUTPUT_BURNDOWN_RATE

    input_tokens = usage.get("inputTokens", 0)
    output_tokens = usage.get("outputTokens", 0)
    effective_tokens = input_tokens + (output_tokens * burndown)
    quota_tracker.record_usage(request.modelId, effective_tokens)
    logger.debug(
        f"Recorded usage: {input_tokens} input + {output_tokens} output * {burndown} = {effective_tokens} effective tokens"
    )


def _get_retry_after_seconds(error_code: str) -> int:
    """Determine retry-after seconds based on error code."""
    if error_code == "ThrottlingException":
        return 60  # 1 minute for rate limit throttling
    elif error_code == "TooManyRequestsException":
        return 30  # 30 seconds for burst limit
    elif error_code == "ServiceUnavailableException":
        return 120  # 2 minutes for service issues
    return 60  # Default


def _handle_bedrock_throttling_error(error_code: str, error_message: str, model_id: str) -> None:
    """Handle Bedrock throttling errors."""
    logger.warning(f"Bedrock throttling: {error_code} - {error_message}")

    error_type = "service_unavailable" if error_code == "ServiceUnavailableException" else "rate_limit"
    retry_after = _get_retry_after_seconds(error_code)

    throttle_response = {
        "error": "throttled",
        "error_type": error_type,
        "message": f"Bedrock rate limit exceeded. Please try again in {retry_after} seconds.",
        "retry_after_seconds": retry_after,
        "model_id": model_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }

    logger.info(f"Throttle response: {throttle_response}")
    raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=throttle_response)


def _handle_bedrock_client_error(e: ClientError, model_id: str) -> None:
    """Handle Bedrock ClientError exceptions."""
    error_code = e.response.get("Error", {}).get("Code", "Unknown")
    error_message = e.response.get("Error", {}).get("Message", str(e))

    # Handle throttling and service unavailable errors
    if error_code in ["ServiceUnavailableException", "ThrottlingException", "TooManyRequestsException"]:
        _handle_bedrock_throttling_error(error_code, error_message, model_id)

    # Handle model not found or other errors
    if error_code == "ResourceNotFoundException":
        logger.error(f"Bedrock model not found: {model_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Model '{model_id}' not found or not available."
        )
    elif error_code == "ValidationException":
        logger.error(f"Bedrock validation error: {error_message}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request format or parameters.")
    elif error_code == "AccessDeniedException":
        logger.error(f"Bedrock access denied: {error_message}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to Bedrock model. Please check permissions."
        )
    else:
        logger.error(f"Bedrock chat error: {error_code} - {error_message}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to process chat request")


@app.post("/bedrock/chat", response_model=ChatResponse)
async def chat_with_bedrock(request: EnhancedChatRequest):
    """Send a chat message to Bedrock and get a response."""
    if not bedrock_runtime:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Bedrock runtime client not available")

    try:
        tool_count = len(request.tools) if request.tools else 0
        logger.info(f"Bedrock chat request: model={request.modelId}, messages={len(request.messages)}, tools={tool_count}")
    except Exception as debug_error:
        logger.error(f"Error in debug logging: {debug_error}")

    _check_quota_preemptively(request)

    try:
        body = _prepare_bedrock_request_body(request)

        # Make the request to Bedrock
        response = bedrock_runtime.invoke_model(
            modelId=request.modelId, body=json.dumps(body), contentType="application/json", accept="application/json"
        )

        # Parse the response
        response_body = json.loads(response["body"].read())

        # Extract components from response
        tool_calls = _extract_tool_calls(response_body)
        content = _extract_message_content(response_body)
        usage = _extract_usage(response_body)

        # Record usage for quota tracking
        _record_usage(request, usage)

        # Get current quota info for response
        quota_info = None
        if ENABLE_QUOTA_TRACKING:
            quota_tracker = get_quota_tracker()
            quota_info = quota_tracker.get_quota_info(request.modelId)

        # Build response
        response_data = {"message": content, "usage": usage}
        if tool_calls:
            response_data["toolCalls"] = tool_calls
            response_data["requiresToolExecution"] = True
        if quota_info:
            response_data["quota"] = quota_info

        logger.info(f"Bedrock chat success: response length={len(content)}, tool_calls={len(tool_calls)}")
        return response_data

    except ClientError as e:
        _handle_bedrock_client_error(e, request.modelId)

    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to parse Bedrock response")


@app.get("/bedrock/quota")
async def get_all_quota_status():
    """Get current quota status for all models with configured limits."""
    if not ENABLE_QUOTA_TRACKING:
        return {"quota_tracking_enabled": False, "models": {}, "message": "Quota tracking is disabled"}

    quota_tracker = get_quota_tracker()

    # Get all models that have quota limits configured
    models_with_quotas = {}

    if quota_codes_loader:
        try:
            # Get all available models from quota codes loader
            available_models = quota_codes_loader.get_available_models_with_quotas()

            for model_id in available_models:
                quota_info = quota_tracker.get_quota_info(model_id)
                models_with_quotas[model_id] = quota_info

            logger.info(f"Retrieved quota status for {len(models_with_quotas)} models")

        except Exception as e:
            logger.error(f"Error getting quota status for all models: {e}")
            return {"quota_tracking_enabled": True, "models": {}, "error": f"Failed to retrieve quota information: {str(e)}"}
    else:
        logger.warning("Quota codes loader not available")

    return {"quota_tracking_enabled": True, "models": models_with_quotas}


@app.get("/bedrock/quota/{model_id}")
async def get_quota_status(model_id: str):
    """Get current quota status for a specific model."""
    if not ENABLE_QUOTA_TRACKING:
        return {"quota_tracking_enabled": False, "message": "Quota tracking is disabled"}

    quota_tracker = get_quota_tracker()
    quota_info = quota_tracker.get_quota_info(model_id)

    return {"quota_tracking_enabled": True, **quota_info}


# SageMaker Endpoints
@app.get("/sagemaker/endpoints", response_model=SageMakerEndpointsResponse)
async def list_sagemaker_endpoints():
    """List available SageMaker endpoints that are in service."""
    if not sagemaker_client:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="SageMaker client not available")

    try:
        # List all endpoints
        response = sagemaker_client.list_endpoints(
            StatusEquals="InService", SortBy="Name", SortOrder="Ascending", MaxResults=100
        )

        endpoints = []
        for endpoint in response.get("Endpoints", []):
            endpoints.append(
                SageMakerEndpoint(
                    name=endpoint["EndpointName"],
                    status=endpoint["EndpointStatus"],
                    creationTime=endpoint.get("CreationTime", "").isoformat() if endpoint.get("CreationTime") else None,
                )
            )

        logger.info(f"Found {len(endpoints)} InService SageMaker endpoints")
        return {"endpoints": endpoints}

    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "Unknown")
        logger.error(f"SageMaker error listing endpoints: {error_code} - {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to list SageMaker endpoints: {error_code}"
        )


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "WebApp Utility API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "s3": {"buckets": "/s3/buckets", "objects": "/s3/buckets/{bucket_name}/objects"},
            "bedrock": {
                "models": "/bedrock/models",
                "test": "/bedrock/test-connection",
                "chat": "/bedrock/chat",
                "quota_all": "/bedrock/quota",
                "quota_model": "/bedrock/quota/{model_id}",
            },
            "sagemaker": {
                "endpoints": "/sagemaker/endpoints",
            },
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
