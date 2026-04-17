# OversightML Web Application Infrastructure

AWS CDK project that deploys the OSML Web Application and its supporting infrastructure.

For detailed architecture documentation, diagrams, and data-flow descriptions see [`docs/architecture/`](../docs/architecture/).

## Stacks

| Stack                         | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| **WebApp**                    | Next.js frontend on EC2 behind an Application Load Balancer      |
| **WebAppUtilityServices**     | Lambda API for S3 operations, Bedrock chat, and quota management |
| **ModelRunnerApi**            | Lambda API for ML job submission with DynamoDB status tracking   |
| **StacLoader**                | ECS Fargate MCP server for loading STAC catalog data             |
| **StacLoaderIntegrationTest** | Optional Lambda-based integration tests                          |

All stack names are prefixed with the `projectName` from your deployment config (default: `OSML-WebApp`).

## Prerequisites

- Node.js 24+ and npm
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Quick Start

```bash
# Install dependencies
npm install

# Copy and edit the deployment config
cp bin/deployment/deployment.json.example bin/deployment/deployment.json
# Edit deployment.json with your AWS account, VPC, auth, and service URLs

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy everything
npm run deploy:all
```

## Configuration

Create `bin/deployment/deployment.json` by copying the example file and filling in your values:

```bash
cp bin/deployment/deployment.json.example bin/deployment/deployment.json
```

See [`bin/deployment/deployment.json.example`](./bin/deployment/deployment.json.example) for the full schema with all available options. Key sections:

- **account** — AWS account ID and region
- **networkConfig** — VPC ID and subnet IDs to deploy into
- **dataplaneConfig.authConfig** — OIDC provider settings (Keycloak)
- **dataplaneConfig.webAppConfig** — Domain, build mode, auth client
- **dataplaneConfig.webAppUtilityConfig** — Bucket access, Bedrock models
- **Service URLs** — Tile server, STAC catalog, Geo Agents MCP, Model Runner queue/topic ARNs

> **Note:** `deployment.json` is gitignored. Only the `.example` file is committed.

## Deployment

```bash
# Deploy all stacks
npm run deploy:all

# Deploy individual stacks
cdk deploy OSML-WebApp-WebAppUtilityServices
cdk deploy OSML-WebApp-ModelRunnerApi
cdk deploy OSML-WebApp-StacLoader
cdk deploy OSML-WebApp-WebApp

# Preview changes
npm run diff

# Synthesize CloudFormation templates
npm run synth

# Tear down
npm run destroy
```

The WebApp stack depends on the API stacks, so CDK will deploy them in the correct order when using `--all`.

## Testing

```bash
npm run test              # Unit tests
npm run test:coverage     # With coverage report
```
