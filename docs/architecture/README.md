# OversightML Web Application Architecture Documentation

This directory contains architecture diagrams for the OSML Web App.

## Diagrams

| Document | Description |
|----------|-------------|
| [Infrastructure Overview](./01-infrastructure-overview.md) | High-level view of all 4 CDK stacks and their relationships |
| [ModelRunnerApi Stack](./02-model-runner-api-stack.md) | Detailed resources in the Model Runner API stack |
| [WebAppUtilityServices Stack](./03-web-app-utility-stack.md) | Detailed resources in the WebApp Utility Services stack |
| [StacLoader Stack](./04-stac-loader-stack.md) | Detailed resources in the STAC Loader stack |
| [WebApp Stack](./05-web-app-stack.md) | Detailed resources in the WebApp (frontend hosting) stack |
| [Web Application Architecture](./06-web-application-architecture.md) | Frontend component hierarchy, state management, and service layer |
| [Data Flow](./07-data-flow.md) | End-to-end data flow from imagery ingestion to display |
| [Agentic UI Pattern](./08-agentic-ui-pattern.md) | Novel in-browser MCP server pattern where AI controls UI state via Redux |

## Diagram Formats

**Draw.io** — The infrastructure overview diagram ([`drawio/01-infrastructure-overview.xml`](./drawio/01-infrastructure-overview.xml)) uses official AWS architecture icons and is fully editable.

**Mermaid** — The per-stack detail docs (02–05) and behavioral docs (06–08) use inline Mermaid diagrams that render natively on GitHub. For local viewing, use the [Mermaid Live Editor](https://mermaid.live/) or install the CLI:

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i 06-web-application-architecture.md -o 06-web-application-architecture.png
```
