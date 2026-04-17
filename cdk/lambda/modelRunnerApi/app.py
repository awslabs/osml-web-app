# Copyright Amazon.com, Inc. or its affiliates.
"""
FastAPI application for Model Runner API Lambda function.
"""

import json
import logging
import os
from datetime import datetime

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from models import ImageProcessingJobCreate, ImageProcessingJobList, ImageProcessingJobStatus, NMSAlgorithm, SoftNMSAlgorithm

from config import IMAGE_REQUEST_QUEUE_URL, initialize_table, s3, sqs

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize the DynamoDB table
table = initialize_table()

# Create FastAPI app
app = FastAPI()

# Add CORS middleware only if enabled
enable_cors = os.getenv("ENABLE_CORS", "false").lower() == "true"
if enable_cors:
    logger.info("CORS enabled for development")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )
else:
    logger.info("CORS disabled for production")


def validate_post_processing(job_request: ImageProcessingJobCreate) -> None:
    """Validate post-processing configuration."""
    if not job_request.postProcessing:
        return

    for pp in job_request.postProcessing:
        if pp.algorithm.algorithm_type == "NMS":
            if not isinstance(pp.algorithm, NMSAlgorithm):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid NMS configuration")
        elif pp.algorithm.algorithm_type == "SOFT_NMS":
            if not isinstance(pp.algorithm, SoftNMSAlgorithm):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SOFT_NMS configuration")


def extract_output_bucket(job_request: ImageProcessingJobCreate) -> str:
    """Extract S3 output bucket from job request outputs."""
    return next((output.bucket for output in job_request.outputs if output.type == "S3" and output.bucket), "")


def create_initial_job_record(job_request: ImageProcessingJobCreate, timestamp: str, output_bucket: str) -> None:
    """Create initial job record in DynamoDB."""
    initial_job_status = {
        "job_id": job_request.jobId,
        "job_name": job_request.jobName,
        "status": "REQUESTED",
        "updated_at": timestamp,
        "image_status": "REQUESTED",
        "image_id": "",
        "processing_duration": "0",
        "output_bucket": output_bucket,
    }

    try:
        table.put_item(Item=initial_job_status)
    except Exception as e:
        logger.error(f"Failed to create job record: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create job record: {str(e)}"
        )


def submit_job_to_queue(job_request: ImageProcessingJobCreate) -> None:
    """Submit job request to SQS queue."""
    message = job_request.dict()

    try:
        sqs.send_message(QueueUrl=IMAGE_REQUEST_QUEUE_URL, MessageBody=json.dumps(message))
    except Exception as e:
        logger.error(f"Failed to submit job: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to submit job: {str(e)}")


@app.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_image_processing_job(job_request: ImageProcessingJobCreate):
    """Create a new image processing job."""
    timestamp = datetime.utcnow().isoformat()

    # Validate post-processing configuration
    validate_post_processing(job_request)

    # Extract S3 output bucket
    output_bucket = extract_output_bucket(job_request)

    # Create initial DDB entry
    create_initial_job_record(job_request, timestamp, output_bucket)

    # Send to SQS
    submit_job_to_queue(job_request)

    return {"message": "Image request submitted successfully"}


@app.get("/jobs", response_model=ImageProcessingJobList)
async def list_image_processing_jobs():
    """List all image processing jobs."""
    try:
        response = table.scan()
        jobs = response.get("Items", [])

        # Convert DynamoDB items to ImageProcessingJobStatus objects
        parsed_jobs = [ImageProcessingJobStatus(**job) for job in jobs]

        return ImageProcessingJobList(jobs=parsed_jobs)
    except Exception as e:
        logger.error(f"Failed to list jobs: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to list jobs: {str(e)}")


@app.get("/jobs/{job_id}", response_model=ImageProcessingJobStatus)
async def get_image_processing_job(job_id: str):
    """Get details of a specific image processing job."""
    try:
        response = table.get_item(Key={"job_id": str(job_id)})
        job = response.get("Item")

        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

        return ImageProcessingJobStatus(**job)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to get job: {str(e)}")


@app.delete("/jobs/{job_id}", status_code=status.HTTP_200_OK)
async def delete_image_processing_job(job_id: str):
    """Delete an image processing job and its associated S3 output file."""
    try:
        # Check if job exists and get job details
        response = table.get_item(Key={"job_id": str(job_id)})
        job = response.get("Item")

        if not job:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

        # Extract S3 output information from job record
        output_bucket = job.get("output_bucket", "")
        job_name = job.get("job_name", "")

        # Step 1: Delete S3 output file (non-critical, log errors but continue)
        # Output path: <output_bucket>/<job_name>/<job_id>.geojson
        s3_cleanup_error = None
        if output_bucket and job_name:
            try:
                s3_key = f"{job_name}/{job_id}.geojson"
                logger.info(f"Deleting S3 object: s3://{output_bucket}/{s3_key}")

                s3.delete_object(Bucket=output_bucket, Key=s3_key)
                logger.info(f"Successfully deleted S3 object for job {job_id}")

            except Exception as e:
                s3_cleanup_error = str(e)
                logger.error(f"Failed to delete S3 object for job {job_id}: {s3_cleanup_error}")
                # Continue with DDB deletion even if S3 cleanup fails
        else:
            logger.info(f"No S3 output bucket or job name found for job {job_id}, skipping S3 cleanup")

        # Step 2: Delete the job record from DynamoDB (critical operation)
        table.delete_item(Key={"job_id": str(job_id)})
        logger.info(f"Successfully deleted job record from DynamoDB: {job_id}")

        # Return success with optional S3 cleanup warning
        response_data = {"success": True, "message": f"Job {job_id} deleted successfully"}

        if s3_cleanup_error:
            response_data["warning"] = f"S3 cleanup failed: {s3_cleanup_error}"

        return response_data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete job: {str(e)}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to delete job: {str(e)}")
