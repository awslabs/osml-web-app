# Web Application Architecture

Detailed architecture of the OSML Web App frontend — a Next.js 16 application with React 19, Redux Toolkit state management, and integrations with multiple backend services.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| UI Library | React 19 |
| Component Library | HeroUI |
| Styling | Tailwind CSS 4 |
| State Management | Redux Toolkit |
| 2D Maps | OpenLayers 10 + ol-ext + ol-stac |
| 3D Globe | CesiumJS 1.136 + Resium |
| Authentication | NextAuth.js (OIDC) |
| AI Chat | Amazon Bedrock (via Utility API) |
| Agent Protocol | Model Context Protocol (MCP) |
| Testing | Jest 30 + Cypress 15 |

## Page / Route Structure

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px' }}}%%
flowchart TB
    subgraph app["Next.js App Router"]
        LAYOUT["layout.tsx<br/>Server: session + metadata"]:::server
        LAYOUT_CLIENT["layout-client.tsx<br/>Client: providers + navbar + sidebar"]:::client
        PROVIDERS["providers.tsx<br/>HeroUI + NextThemes"]:::client

        subgraph pages["Pages"]
            HOME["/ — Dashboard<br/>4 tool cards"]:::page
            IMAGE["/image — Image Viewer<br/>Tile Server integration"]:::page
            MAP["/map — Map Viewer<br/>OpenLayers 2D"]:::page
            GLOBE["/globe — Globe<br/>CesiumJS 3D"]:::page
            GEO["/geo-agent — Geospatial Agent<br/>AI chat + MCP tools"]:::page
        end

        subgraph api_routes["API Routes"]
            AUTH_API["/api/auth/[...nextauth]<br/>OIDC authentication"]:::api
        end
    end

    LAYOUT --> LAYOUT_CLIENT --> PROVIDERS --> pages
    LAYOUT --> api_routes

    classDef server fill:#e3f2fd,stroke:#1565c0,stroke-width:1.5px,color:#0d47a1
    classDef client fill:#e8f5e9,stroke:#2e7d32,stroke-width:1.5px,color:#1b5e20
    classDef page fill:#f1f8e9,stroke:#558b2f,stroke-width:1.5px,color:#33691e
    classDef api fill:#fff8e1,stroke:#f9a825,stroke-width:1.5px,color:#f57f17

    style app fill:#fafafa,stroke:#90a4ae,stroke-width:2px,rx:16
    style pages fill:#f1f8e908,stroke:#558b2f,stroke-width:1.5px,rx:12
    style api_routes fill:#fff8e108,stroke:#f9a825,stroke-width:1.5px,rx:12
```

## Component Hierarchy

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '12px' }}}%%
flowchart TB
    subgraph root["Root Layout"]
        NAVBAR["Navbar"]:::ui
        SIDEBAR["Sidebar<br/>per-route"]:::ui
        CHAT["ChatWidget<br/>floating"]:::chat_node
        INIT["AppInitializer"]:::ui
    end

    subgraph sidebars["Route-Specific Sidebars"]
        SB_IMG["ImageViewerSidebar<br/>S3Selector · ViewpointModal<br/>ImageAdjustments"]:::sidebar
        SB_MAP["MapViewerSidebar<br/>DataCatalog · Overlays<br/>AnalyticsPanel"]:::sidebar
        SB_GLOBE["GlobeViewerSidebar<br/>DataCatalog · Overlays<br/>AnalyticsPanel"]:::sidebar
        SB_GEO["GeoAgentSidebar<br/>McpServerMgmt<br/>ToolExecStatus"]:::sidebar
    end

    subgraph shared_sidebar["Shared Sidebar Components"]
        JL["JobList<br/>SortableItem · ColorControls<br/>StatusArea"]:::component
        LC["LayerControls"]:::component
    end

    subgraph data_catalog["Data Catalog"]
        DC["DataCatalog"]:::component
        DC_COLL["StacCollectionsList"]:::component
        DC_BROWSE["StacItemBrowser"]:::component
        DC_CARD["StacItemCard"]:::component
        DC_DETAIL["StacItemDetailsModal"]:::component
        DC_SEARCH["StacSearchPanel"]:::component
    end

    subgraph analytics["Analytics"]
        AN["AnalyticsPanel"]:::component
        AN_CLASS["ClassificationChart"]:::component
        AN_CONF["ConfidenceHistogram"]:::component
        AN_COMP["ComparisonView"]:::component
        AN_SLIDER["ConfidenceSlider"]:::component
        AN_FILTER["FilterChips"]:::component
    end

    subgraph chat_components["Chat"]
        CW["ChatWidget"]:::chat_node
        CI["ChatInterface"]:::chat_node
        CM["ChatMessage"]:::chat_node
        CIN["ChatInput"]:::chat_node
        MS["ModelSelector"]:::chat_node
        QM["QuotaMeter"]:::chat_node
    end

    subgraph mcp_ui["MCP Management"]
        MCP_MGMT["McpServerManagement"]:::mcp_node
        MCP_ADD["AddServerModal"]:::mcp_node
        MCP_LIST["ServerListItem"]:::mcp_node
        MCP_TOOL["ToolApprovalModal"]:::mcp_node
    end

    root --> sidebars
    SB_MAP --> data_catalog & analytics & shared_sidebar
    SB_GLOBE --> data_catalog & analytics & shared_sidebar
    SB_GEO --> mcp_ui
    CHAT --> chat_components

    DC --> DC_COLL --> DC_BROWSE --> DC_CARD
    DC_CARD --> DC_DETAIL
    DC --> DC_SEARCH

    AN --> AN_CLASS & AN_CONF & AN_COMP & AN_SLIDER & AN_FILTER

    CW --> CI --> CM
    CI --> CIN & MS & QM

    MCP_MGMT --> MCP_ADD & MCP_LIST & MCP_TOOL

    classDef ui fill:#e3f2fd,stroke:#1565c0,stroke-width:1.5px,color:#0d47a1
    classDef sidebar fill:#e8f5e9,stroke:#2e7d32,stroke-width:1.5px,color:#1b5e20
    classDef component fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px,color:#4a148c
    classDef chat_node fill:#fce4ec,stroke:#c62828,stroke-width:1.5px,color:#b71c1c
    classDef mcp_node fill:#e0f2f1,stroke:#00695c,stroke-width:1.5px,color:#004d40

    style root fill:#e3f2fd08,stroke:#1565c0,stroke-width:2px,rx:16
    style sidebars fill:#e8f5e908,stroke:#2e7d32,stroke-width:1.5px,rx:12
    style shared_sidebar fill:#e8f5e908,stroke:#2e7d32,stroke-width:1.5px,rx:12
    style data_catalog fill:#f3e5f508,stroke:#6a1b9a,stroke-width:1.5px,rx:12
    style analytics fill:#f3e5f508,stroke:#6a1b9a,stroke-width:1.5px,rx:12
    style chat_components fill:#fce4ec08,stroke:#c62828,stroke-width:1.5px,rx:12
    style mcp_ui fill:#e0f2f108,stroke:#00695c,stroke-width:1.5px,rx:12
```

## State Management (Redux Toolkit)

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '12px' }}}%%
flowchart TB
    subgraph store["Redux Store — 17 Slices"]
        subgraph ui_state["UI State"]
            S_NAV["navbar<br/>drawer · route · chat toggle"]:::slice
            S_SET["settings<br/>app preferences"]:::slice
            S_VP["viewport<br/>map / globe sync"]:::slice
        end

        subgraph imagery_state["Imagery State"]
            S_IV["imageViewer<br/>viewpoints · bounds<br/>metadata · adjustments"]:::slice
            S_IMG["imagery<br/>layer state"]:::slice
            S_OVR["overlay<br/>GeoJSON overlays"]:::slice
        end

        subgraph data_state["Data State"]
            S_S3["s3<br/>buckets · objects"]:::slice
            S_DC["dataCatalog<br/>STAC collections / items"]:::slice
            S_JOBS["jobs<br/>Model Runner jobs"]:::slice
            S_SM["sagemakerEndpoint<br/>endpoint listing"]:::slice
        end

        subgraph ai_state["AI / Chat State"]
            S_BM["bedrockModel<br/>model selection"]:::slice
            S_BQ["bedrockQuota<br/>quota tracking"]:::slice
            S_BT["bedrockThrottle<br/>throttle state"]:::slice
            S_CW["chatWidget<br/>UI state"]:::slice
            S_CS["chatSession<br/>conversation history"]:::slice
            S_MCP["mcp<br/>server connections"]:::slice
        end

        subgraph analytics_state["Analytics State"]
            S_AN["analytics<br/>detection metrics"]:::slice
        end
    end

    classDef slice fill:#fff3e0,stroke:#ef6c00,stroke-width:1px,color:#e65100

    style store fill:#fafafa,stroke:#90a4ae,stroke-width:2px,rx:16
    style ui_state fill:#e3f2fd08,stroke:#1565c0,stroke-width:1.5px,rx:12
    style imagery_state fill:#e8f5e908,stroke:#2e7d32,stroke-width:1.5px,rx:12
    style data_state fill:#fff3e008,stroke:#e65100,stroke-width:1.5px,rx:12
    style ai_state fill:#fce4ec08,stroke:#c62828,stroke-width:1.5px,rx:12
    style analytics_state fill:#f3e5f508,stroke:#6a1b9a,stroke-width:1.5px,rx:12
```

## Services Layer

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px' }}}%%
flowchart LR
    subgraph frontend["Frontend Services"]
        VS["viewpoint-service"]:::service
        MRS["model-runner-service"]:::service
        S3S["s3-service"]:::service
        BS["bedrock-service"]:::service
        SMS["sagemaker-service"]:::service
        DCS["data-catalog-service"]:::service
        JS["job-submission"]:::service
        JM["job-management"]:::service
        GCS["geojson-cache"]:::service
        LMS["local-mcp-server"]:::service
    end

    subgraph backends["Backend APIs"]
        TS["Tile Server<br/>ECS / ALB"]:::backend
        MR_API["Model Runner API<br/>API Gateway"]:::backend
        WU_API["Utility API<br/>API Gateway"]:::backend
        STAC["STAC Catalog<br/>OpenSearch"]:::backend
        SL_MCP["STAC Loader MCP<br/>ECS / API GW"]:::backend
        GA_MCP["Geo Agents MCP<br/>ECS / ALB"]:::backend
    end

    VS -->|Viewpoint CRUD| TS
    MRS & JS & JM -->|Jobs| MR_API
    S3S & BS & SMS -->|Utility| WU_API
    DCS -->|Catalog| STAC
    LMS -->|MCP| SL_MCP & GA_MCP

    classDef service fill:#e8f5e9,stroke:#2e7d32,stroke-width:1.5px,color:#1b5e20
    classDef backend fill:#e3f2fd,stroke:#1565c0,stroke-width:1.5px,color:#0d47a1

    style frontend fill:#e8f5e908,stroke:#2e7d32,stroke-width:2px,rx:16
    style backends fill:#e3f2fd08,stroke:#1565c0,stroke-width:2px,rx:16
```

## Authentication Flow

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryTextColor': '#1a1a2e', 'lineColor': '#78909c', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '13px', 'actorTextColor': '#1a1a2e', 'signalColor': '#546e7a', 'noteBkgColor': '#fff8e1', 'noteBorderColor': '#f9a825' }}}%%
sequenceDiagram
    participant User as Browser
    participant Next as Next.js Server
    participant NA as NextAuth.js
    participant KC as OIDC Provider
    participant API as Backend APIs

    User->>Next: Visit protected page
    Next->>Next: getServerSession()

    alt No session
        Next->>User: Redirect to login
        User->>KC: Authorization Code flow
        KC->>User: Authorization code
        User->>NA: Callback with code
        NA->>KC: Exchange for tokens
        KC->>NA: access + id + refresh tokens
        NA->>NA: Create session (JWT)
        NA->>User: Set session cookie
    end

    User->>Next: Request with session cookie
    Next->>User: Render page
    User->>API: API call with Bearer token
    API->>API: Lambda Authorizer validates JWT
    API->>User: Response
```

## Key Hooks

| Hook | Purpose |
|------|---------|
| `use-chat-generation` | Orchestrates Bedrock model invocation with tool calling |
| `use-mcp` | Manages MCP server connections and tool discovery |
| `use-local-mcp-server` | Runs the in-browser MCP server |
| `use-tool-chain` | Executes multi-step tool call chains |
| `use-overlay-layer-data` | Loads GeoJSON overlays onto map / globe |
| `use-quota-usage` | Tracks Bedrock quota consumption |
| `use-smart-quota-polling` | Adaptive polling for quota updates |
| `use-stac-item-visibility` | Controls STAC item display on map |
| `use-viewpoint-warming` | Pre-warms tile server viewpoints |
| `use-viewport-sync` | Synchronizes 2D map and 3D globe viewports |
