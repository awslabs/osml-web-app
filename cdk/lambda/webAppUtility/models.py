# Copyright Amazon.com, Inc. or its affiliates.
"""
Pydantic models for S3 API responses.
"""

from typing import List

from pydantic import BaseModel


class S3Bucket(BaseModel):
    name: str
    creationDate: str


class S3Object(BaseModel):
    key: str
    size: int
    lastModified: str


class BucketResponse(BaseModel):
    bucket: str
    objects: List[S3Object]


class BucketsResponse(BaseModel):
    buckets: List[S3Bucket]


class PresignedUrlResponse(BaseModel):
    presignedUrl: str


class BedrockModel(BaseModel):
    modelId: str
    modelName: str
    providerName: str
    inputModalities: List[str]
    outputModalities: List[str]
    supportsStreaming: bool
    supportsToolUse: bool
    modelLifecycle: str
    customizationsSupported: List[str] = []
    inferenceTypesSupported: List[str] = []


class BedrockModelsResponse(BaseModel):
    models: List[BedrockModel]
