# WebAppUtility Services Stack

Detailed architecture of the `OSML-WebApp-WebAppUtilityServices` stack. This stack provides utility APIs for S3 browsing, Amazon Bedrock AI model invocation, SageMaker endpoint discovery, quota management, and data catalog ingestion bridges.

See the [Infrastructure Overview](./01-infrastructure-overview.md) for the full AWS architecture diagram showing this stack in context.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/s3/buckets` | List accessible S3 buckets |
| `GET` | `/s3/buckets/{name}/objects` | List objects in a bucket |
| `GET` | `/s3/presigned-url` | Generate presigned URL for object access |
| `DELETE` | `/s3/objects` | Delete an S3 object |
| `POST` | `/bedrock/invoke` | Invoke a Bedrock foundation model |
| `GET` | `/bedrock/models` | List available Bedrock models |
| `GET` | `/sagemaker/endpoints` | List SageMaker endpoints |
| `GET` | `/quotas/usage` | Get current quota usage for a model |
| `GET` | `/quotas/limits` | Get quota limits for Bedrock models |

## Detection Bridge Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant MR as Model Runner<br/>ECS Task
    participant S3B as Detection Bridge<br/>S3 Bucket
    participant DBT as Bridge Translator<br/>Lambda
    participant SNS as data-catalog-intake<br/>SNS Topic
    participant DI as Data Intake<br/>Pipeline

    MR->>S3B: PutObject (detection.geojson)
    S3B->>DBT: S3 Event Notification
    Note right of DBT: Build SNSRequest<br/>collection_id + s3_uri
    DBT->>SNS: Publish
    SNS->>DI: Trigger intake Lambda
    DI->>S3B: GetObject (download GeoJSON)
    DI->>DI: Ingest into STAC catalog
```

## Data Catalog Ingest Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant User as Web App User
    participant API as Utility API
    participant S3I as Ingest Bucket
    participant GIT as GeoJSON Translator
    participant SNS as data-catalog-intake
    participant DI as Data Intake Pipeline

    User->>API: Upload GeoJSON
    API->>S3I: PutObject
    S3I->>GIT: S3 Event (.geojson)
    Note right of GIT: Build SNSRequest
    GIT->>SNS: Publish
    SNS->>DI: Trigger intake
    DI->>S3I: GetObject
    DI->>DI: Ingest into STAC catalog
```

## S3 Bucket Policies

| Bucket | Policy | Principal Condition |
|--------|--------|-------------------|
| **Detection Bridge** | `s3:PutObject` | Role ARN matching `*model-runner*` |
| **Detection Bridge** | `s3:GetObject` | Role ARN matching `*data-catalog-intake*` |
| **Data Catalog Ingest** | `s3:GetObject` | Role ARN matching `*data-catalog-intake*` |

## IAM Permissions

| Lambda | Key Permissions |
|--------|----------------|
| **UtilityApi** | S3 (List/Get/Delete/CORS), Bedrock (Invoke/List), SageMaker (ListEndpoints), Service Quotas, DynamoDB (R/W), CloudWatch, VPC |
| **QuotaCodesGenerator** | Bedrock (ListFoundationModels), Service Quotas (ListServiceQuotas), S3 (Write) |
| **GeojsonIngestTranslator** | SNS (Publish to intake topic) |
| **DetectionBridgeTranslator** | SNS (Publish), S3 (Read bridge bucket) |
