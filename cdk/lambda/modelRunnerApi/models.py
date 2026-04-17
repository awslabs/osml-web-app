# Copyright Amazon.com, Inc. or its affiliates.
"""
Pydantic models for Model Runner API.
"""

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel


class Output(BaseModel):
    type: str
    bucket: Optional[str] = None
    prefix: Optional[str] = None
    stream: Optional[str] = None
    batchSize: Optional[int] = None


class ImageProcessor(BaseModel):
    name: str
    type: str


class NMSAlgorithm(BaseModel):
    algorithm_type: Literal["NMS"]
    iouThreshold: float


class SoftNMSAlgorithm(BaseModel):
    algorithm_type: Literal["SOFT_NMS"]
    iouThreshold: float
    skipBoxThreshold: float
    sigma: float


class PostProcessingStep(BaseModel):
    step: Literal["FEATURE_DISTILLATION"]
    algorithm: Union[NMSAlgorithm, SoftNMSAlgorithm]


class ImageProcessingJobCreate(BaseModel):
    jobName: str
    jobId: str
    imageUrls: List[str]
    outputs: List[Output]
    imageProcessor: ImageProcessor
    imageProcessorTileSize: int
    imageProcessorTileOverlap: int
    imageProcessorTileFormat: str
    imageProcessorTileCompression: str
    imageProcessorParameters: Optional[Dict[str, Any]] = None
    postProcessing: List[PostProcessingStep]
    regionOfInterest: Optional[Dict[str, Any]] = None


class ImageProcessingJobStatus(BaseModel):
    job_id: str
    job_name: str
    status: str
    updated_at: str
    image_status: str
    image_id: str
    processing_duration: str
    output_bucket: str


class ImageProcessingJobList(BaseModel):
    jobs: List[ImageProcessingJobStatus]
