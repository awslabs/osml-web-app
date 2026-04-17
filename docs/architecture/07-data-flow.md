# Data Flow

End-to-end data flows through the OSML Web App, from imagery ingestion to visualization and AI-assisted analysis.

## Image Processing Flow

When a user submits an image for ML processing, the web app sends a job request through the Model Runner API. The API creates a job record in DynamoDB and enqueues an image processing request to SQS. The Model Runner ECS service picks up the message, decomposes the large geospatial image into tiles, sends each tile batch to a SageMaker endpoint for inference, then aggregates the detection results into a geolocated GeoJSON feature collection. Once complete, it writes the results to S3 and publishes a status update to SNS. A Status Monitor Lambda subscribes to that topic and updates the DynamoDB job record. Meanwhile, the web app polls the job status and, once complete, fetches the results and renders them as overlays on the map or globe.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant User as User
    participant UI as Next.js
    participant MR_API as Model Runner API
    participant DDB as DynamoDB
    participant SQS as SQS Queue
    participant MR as Model Runner
    participant SM as SageMaker
    participant S3 as S3 Output
    participant SNS as SNS Status
    participant MON as Status Monitor

    User->>UI: Select image + model + region
    UI->>MR_API: POST /jobs
    MR_API->>DDB: Create job (PENDING)
    MR_API->>SQS: SendMessage
    MR_API->>UI: 201 Created (job_id)

    UI->>UI: Poll GET /jobs/{id}

    SQS->>MR: ReceiveMessage
    MR->>MR: Decompose into tiles
    MR->>SM: InvokeEndpoint
    SM->>MR: Detection results
    MR->>MR: Aggregate + geolocate
    MR->>S3: PutObject (results.geojson)
    MR->>SNS: Publish (COMPLETED)

    SNS->>MON: Lambda invocation
    MON->>DDB: Update → COMPLETED

    UI->>MR_API: GET /jobs/{id}
    MR_API->>DDB: Read job
    MR_API->>UI: Job details + output_uri
    Note over UI: Display results on map / globe
```

## Detection Bridge Flow

After the Model Runner completes a job, its detection results need to be indexed in the STAC catalog so they're discoverable through the Data Catalog UI. The Model Runner writes detection GeoJSON to the Detection Bridge S3 bucket. An S3 event notification triggers the Detection Bridge Translator Lambda, which constructs an SNSRequest message (specifying the collection ID and S3 URI) and publishes it to the `data-catalog-intake` SNS topic. The Data Intake pipeline picks up the message, downloads the GeoJSON from S3, and indexes it as a STAC item in OpenSearch. The web app can then query the catalog and render the detections on the map or globe.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant MR as Model Runner
    participant S3B as Detection Bridge
    participant DBT as Bridge Translator
    participant SNS as data-catalog-intake
    participant DI as Data Intake
    participant OS as OpenSearch
    participant UI as Web App

    MR->>S3B: PutObject (detections.geojson)
    S3B->>DBT: S3 Event
    Note right of DBT: Build SNSRequest<br/>collection: model-runner-detections
    DBT->>SNS: Publish
    SNS->>DI: Invoke
    DI->>S3B: GetObject
    DI->>OS: Index as STAC item
    UI->>OS: Query catalog
    OS->>UI: Detection items
    Note over UI: Render on map / globe
```

## Tile Serving Flow

The Tile Server provides on-demand map tiles from large geospatial imagery stored in S3. The web app first creates a "viewpoint" by sending the S3 bucket, object key, and desired tile size. The Tile Server validates the image exists, registers the viewpoint, and returns an ID. The web app then requests individual tiles using standard z/x/y slippy map coordinates. For each tile request, the Tile Server reads the relevant byte range from S3, decodes the imagery, renders the tile as a PNG, and returns it. OpenLayers (2D map) and CesiumJS (3D globe) consume these tiles as standard map layers.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#e8f5e9', 'noteBorderColor': '#2e7d32' }}}%%
sequenceDiagram
    participant User as Web App
    participant TS as Tile Server
    participant S3 as S3 Imagery

    User->>TS: POST /viewpoints (bucket, key, tile_size)
    TS->>S3: HeadObject (validate)
    TS->>TS: Create viewpoint
    TS->>User: viewpoint_id

    User->>TS: GET /tiles/{z}/{x}/{y}
    TS->>S3: GetObject (byte range)
    TS->>TS: Decode + render tile
    TS->>User: PNG tile

    Note over User: OpenLayers / CesiumJS<br/>renders tiles as map layer
```

## STAC Data Loading Flow

The STAC Loader enables AI-driven data discovery and ingestion through the chat interface. When a user asks the Geospatial Agent to load data for a specific area, the chat sends the request to Amazon Bedrock along with the available MCP tools. Bedrock plans a multi-step action: first calling `search_stac` on the STAC Loader MCP server to find matching items from external STAC catalogs, then calling `load_items` to ingest the selected items into the local STAC catalog backed by OpenSearch. The MCP server stores intermediate results in its S3 workspace bucket. Once loading is complete, the user can browse the newly ingested data through the Data Catalog sidebar.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#f3e5f5', 'noteBorderColor': '#6a1b9a' }}}%%
sequenceDiagram
    participant User as User
    participant Chat as Chat
    participant Bedrock as Bedrock
    participant MCP as STAC Loader MCP
    participant S3W as Workspace
    participant STAC as STAC Catalog

    User->>Chat: "Load Sentinel-2 data for this area"
    Chat->>Bedrock: Message + tools
    Bedrock->>MCP: search_stac(bbox, datetime)
    MCP->>MCP: Fetch from external STAC
    MCP->>S3W: Store items
    MCP->>Bedrock: Search results
    Bedrock->>MCP: load_items(item_ids)
    MCP->>STAC: Ingest items
    MCP->>Bedrock: Confirmation
    Bedrock->>Chat: "Loaded 12 Sentinel-2 scenes"
    Chat->>User: Display response
    User->>STAC: Browse in Data Catalog
```

## AI Chat with Tool Calling

The Geospatial Agent uses Amazon Bedrock with tool calling to interact directly with the web app's UI state. When a user sends a natural language request, the chat interface forwards it to Bedrock along with the definitions of all available tools (26 local tools plus remote MCP server tools). Bedrock plans and executes a sequence of tool calls — each one routed to the in-browser Local MCP Server, which reads from and dispatches actions to the Redux store. React components subscribed to the affected state slices re-render immediately, so the user sees the map update in real time as the AI works through its tool chain. The loop continues until Bedrock has no more tool calls to make, at which point it returns a natural language summary.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fce4ec', 'noteBorderColor': '#c62828' }}}%%
sequenceDiagram
    participant User as User
    participant Chat as Chat
    participant Bedrock as Bedrock
    participant Local as Local MCP
    participant Redux as Redux
    participant Map as Map / Globe

    User->>Chat: "Show detections with confidence > 0.8"
    Chat->>Bedrock: Message + tool definitions

    loop Tool Calling Loop (max 20)
        Bedrock->>Local: filter_features(confidence > 0.8)
        Local->>Redux: getState() → read overlays
        Local->>Local: Filter by confidence
        Local->>Bedrock: Filtered collection

        Bedrock->>Local: update_layer(filtered)
        Local->>Redux: dispatch(overlay update)
        Redux->>Map: Re-render layer
        Local->>Bedrock: Layer updated
    end

    Bedrock->>Chat: "Found 47 detections above 0.8"
    Note over Map: Map already shows results
    Chat->>User: Display response
```

## Quota Management Flow

Bedrock model invocation is subject to AWS Service Quotas rate limits. The quota management system has two phases. At deploy time, a Custom Resource Lambda queries the Bedrock and Service Quotas APIs to build a mapping of model IDs to their quota codes and limits, then writes this as a JSON file to S3. At runtime, when the Utility API receives a Bedrock invocation request, it reads the quota codes from S3, records the request timestamp in a DynamoDB rolling window table, and checks whether the current request count exceeds the quota limit. If under quota, it forwards the request to Bedrock and returns the response. If over quota, it returns a 429 Throttled response with a retry-after interval, and the chat UI displays a throttle countdown to the user.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant Deploy as CDK Deploy
    participant QG as QuotaCodesGen
    participant BR as Bedrock API
    participant SQ as Service Quotas
    participant S3Q as Quota Codes
    participant WU as Utility API
    participant DDB as DynamoDB
    participant User as Web App

    Note over Deploy,S3Q: Deploy-time (Custom Resource)
    Deploy->>QG: Invoke
    QG->>BR: ListFoundationModels
    QG->>SQ: ListServiceQuotas
    QG->>S3Q: Write quota_codes.json

    Note over User,DDB: Runtime
    User->>WU: POST /bedrock/invoke
    WU->>S3Q: Read codes
    WU->>DDB: Record request
    WU->>DDB: Count rolling window

    alt Under quota
        WU->>BR: InvokeModel
        BR->>WU: Response
        WU->>User: AI response
    else Over quota
        WU->>User: 429 Throttled
    end
```
