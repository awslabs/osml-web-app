# Infrastructure Overview

High-level view of the 4 CDK stacks deployed by `osml-web-app` and their relationships to external OSML components.

## AWS Architecture Diagram

![Infrastructure Overview](./drawio/01-infrastructure-overview.png)

> The editable source is at [`drawio/01-infrastructure-overview.xml`](./drawio/01-infrastructure-overview.xml).

## Stack Deployment Order

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#e3f2fd', 'primaryTextColor': '#1a1a2e', 'primaryBorderColor': '#1565c0', 'lineColor': '#546e7a', 'secondaryColor': '#f3e5f5', 'tertiaryColor': '#e8f5e9', 'fontFamily': 'Inter, Segoe UI, sans-serif', 'fontSize': '14px' }}}%%
flowchart LR
    MR["ModelRunnerApi<br/>Stack"]:::api
    WU["WebAppUtility<br/>Stack"]:::utility
    SL["StacLoader<br/>Stack"]:::stac

    MR --> WA["WebApp<br/>Stack"]:::webapp
    WU --> WA
    SL --> WA

    classDef api fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#0d47a1,rx:12
    classDef utility fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#bf360c,rx:12
    classDef stac fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px,color:#4a148c,rx:12
    classDef webapp fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20,rx:12
```

## Stack Summary

| Stack | Key Resources | Purpose |
|-------|--------------|---------|
| **ModelRunnerApi** | API Gateway, 2 Lambdas, DynamoDB | Proxy image processing jobs to Model Runner |
| **WebAppUtilityServices** | API Gateway, 4 Lambdas, DynamoDB, 3 S3 Buckets | S3 browsing, Bedrock AI, quota tracking, data ingest |
| **StacLoader** | API Gateway, ECS Fargate, ALB, NLB, VPC Link, S3 | STAC data loading MCP server |
| **WebApp** | ALB, ASG (2–4 EC2), S3, 2 Lambdas | Next.js frontend hosting |

## Cross-Stack Data Flow

| From | To | Data |
|------|----|------|
| ModelRunnerApi | WebApp | API Gateway URL for job management |
| WebAppUtility | WebApp | API Gateway URL for utility services |
| WebAppUtility | WebApp | Detection Bridge bucket name |
| StacLoader | WebApp | MCP server URL |
| All API stacks | WebApp | URLs injected as Next.js environment variables at build time |
