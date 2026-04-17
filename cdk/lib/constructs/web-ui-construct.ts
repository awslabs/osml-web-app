/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import {
  CustomResource,
  DockerImage,
  Duration,
  RemovalPolicy,
  Size
} from "aws-cdk-lib";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import {
  Certificate,
  CertificateValidation
} from "aws-cdk-lib/aws-certificatemanager";
import {
  AmazonLinux2023ImageSsmParameter,
  InstanceClass,
  InstanceSize,
  InstanceType,
  ISecurityGroup,
  IVpc,
  LaunchTemplate,
  Peer,
  Port,
  SecurityGroup,
  SubnetSelection,
  UserData
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  SslPolicy
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal
} from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { Bucket, BucketEncryption, IBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  Provider
} from "aws-cdk-lib/custom-resources";
import { execSync } from "child_process";
import { Construct } from "constructs";
import { copyFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { URL } from "url";

import { OSMLAccount } from "./types";

export interface WebAppConfig {
  buildFromSource?: boolean;
  artifactUrl?: string;
  hostedZone: string;
  domainName: string;
  albSecurityGroupId?: string;
  ec2SecurityGroupId?: string;
  tileServerUrl: string;
  stacCatalogUrl: string;
  stacLoaderMcpUrl: string;
  webAppUtilityUrl: string;
  modelRunnerApiUrl: string;
  geoAgentsMcpUrl: string;
  authSuccessUrl: string;
  authClientId: string;
  authSecret: string;
  authority: string;
  detectionBridgeBucket?: string;
  kinesisStreamName?: string;
}

export interface WebUIProps {
  /**
   * The VPC to deploy the construct into
   */
  vpc: IVpc;

  /**
   * The subnet selection for deployment
   */
  vpcSubnets?: SubnetSelection;

  /**
   * Whether this is a production environment
   */
  isProd: boolean;

  /**
   * The OSML deployment account.
   */
  account: OSMLAccount;

  /**
   * The project name prefix for resource naming
   */
  projectName: string;

  /**
   * Custom configuration for the WebApp Construct (optional).
   * Accepts partial config - construct will apply defaults for missing values.
   */
  config?: Partial<WebAppConfig>;
}

export class WebUIConstruct extends Construct {
  /**
   * The configuration for the WebApp.
   */
  public config!: WebAppConfig;

  /**
   * The removal policy for resources created by this construct.
   */
  public removalPolicy!: RemovalPolicy;

  /**
   * The project name prefix for resource naming.
   */
  private projectName: string;

  /**
   * The security group for the WebApp ALB.
   */
  public albSecurityGroup?: ISecurityGroup;

  /**
   * The security group for the WebApp EC2.
   */
  public ec2SecurityGroup?: ISecurityGroup;

  /**
   * The application load balancer to be used for the FargateService.
   */
  public alb: ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: WebUIProps) {
    super(scope, id);

    // Store project name for resource naming
    this.projectName = props.projectName;

    // Setup class from base properties first
    this.setup(props);

    // Create artifact bucket
    const artifactBucket = new Bucket(this, "ArtifactBucket", {
      bucketName: `web-app-deployment-artifacts-${props.account.id}`,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: true
    });

    // Deployment method depends on buildFromSource flag
    if (this.config.buildFromSource) {
      // Build and deploy from local source using CDK bundling
      const webAppRoot = resolve(__dirname, "../../..");

      const webAppAsset = Source.asset(webAppRoot, {
        bundling: {
          image: DockerImage.fromRegistry("node:24"),
          local: {
            tryBundle(outputDir: string): boolean {
              try {
                // Check if we're in a Node.js environment
                const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

                process.stdout.write(
                  `Building web app from ${webAppRoot}...\n`
                );

                // Remove stale build.zip to ensure a fresh build every time
                const buildZipPath = join(webAppRoot, "build.zip");
                if (existsSync(buildZipPath)) {
                  unlinkSync(buildZipPath);
                  process.stdout.write("Removed stale build.zip\n");
                }

                // Install dependencies and build
                execSync(`${npmCmd} ci`, {
                  cwd: webAppRoot,
                  stdio: "inherit"
                });

                execSync(`${npmCmd} run build:zip`, {
                  cwd: webAppRoot,
                  stdio: "inherit"
                });

                // Copy the built zip to the output directory
                if (!existsSync(buildZipPath)) {
                  process.stderr.write("build.zip not found after build\n");
                  return false;
                }

                copyFileSync(buildZipPath, join(outputDir, "build.zip"));
                process.stdout.write("Web app build completed successfully\n");
                return true;
              } catch (error) {
                process.stderr.write(`Local bundling failed: ${error}\n`);
                throw error; // Fail fast — do not fall back to Docker
              }
            }
          },
          command: [
            "bash",
            "-c",
            ["npm ci", "npm run build:zip", "cp build.zip /asset-output/"].join(
              " && "
            )
          ]
        }
      });

      // Deploy the bundled asset to S3
      new BucketDeployment(this, "DeployLocalArtifact", {
        sources: [webAppAsset],
        destinationBucket: artifactBucket,
        destinationKeyPrefix: "current",
        memoryLimit: 8192,
        ephemeralStorageSize: Size.gibibytes(10),
        extract: true,
        prune: true
      });
    } else {
      if (!this.config.artifactUrl) {
        throw new Error(
          "artifactUrl must be provided when buildFromSource is false"
        );
      }

      // Validate artifact URL exists before creating resources
      this.validateArtifactUrl(this.config.artifactUrl);

      // Create provider for custom resource
      const artifactProvider = new Provider(this, "ArtifactProvider", {
        onEventHandler: this.createArtifactDownloadFunction(artifactBucket)
      });

      // Create custom resource to fetch and deploy from URL
      new CustomResource(this, "ArtifactDeployment", {
        serviceToken: artifactProvider.serviceToken,
        properties: {
          ArtifactUrl: this.config.artifactUrl,
          Timestamp: Date.now()
        }
      });
    }

    // ALB
    this.alb = new ApplicationLoadBalancer(this, "WebAppAlb", {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup
    });

    let listener;

    if (this.config.hostedZone) {
      // Set up SSL and Route 53 if domain name is provided
      const hostedZone = HostedZone.fromLookup(this, "HostedZone", {
        domainName: this.config.hostedZone
      });

      // Use WEB_APP_DOMAIN_NAME if provided, otherwise fall back to hosted zone
      const domainName = this.config.domainName ?? this.config.hostedZone;

      const certificate = new Certificate(this, "Certificate", {
        domainName: domainName,
        validation: CertificateValidation.fromDns(hostedZone)
      });

      listener = this.alb.addListener("HttpsListener", {
        port: 443,
        certificates: [certificate],
        protocol: ApplicationProtocol.HTTPS,
        sslPolicy: SslPolicy.TLS12
      });

      // Route 53 Alias Record
      new ARecord(this, "AliasRecord", {
        zone: hostedZone,
        target: RecordTarget.fromAlias(new LoadBalancerTarget(this.alb)),
        recordName: domainName
      });
    } else {
      // Set up HTTP listener if no domain name is provided
      listener = this.alb.addListener("HttpListener", {
        port: 80,
        protocol: ApplicationProtocol.HTTP
      });
    }

    // User data script
    const userData = UserData.forLinux();

    userData.addCommands(
      "exec > >(tee /var/log/user-data-script.log) 2>&1",
      "echo 'Starting user data script execution'",

      // Update system
      "echo 'Updating system packages'",
      "dnf update -q -y",

      // Install basic utilities
      "echo 'Installing basic utilities'",
      "dnf install -q -y unzip aws-cli nginx",

      // Install Node.js 24 via NVM
      "echo 'Installing Node.js 24 via NVM'",

      // Set up proper shell environment for NVM installation
      "export HOME=/root",
      "cd /root",
      "touch /root/.bashrc",

      // Install NVM
      "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash",

      // Set up NVM environment explicitly
      'export NVM_DIR="/root/.nvm"',
      '[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"',
      '[ -s "$NVM_DIR/bash_completion" ] && source "$NVM_DIR/bash_completion"',

      // Verify NVM is available
      "echo 'Verifying NVM installation:'",
      "nvm --version",

      // Install Node.js 24
      "echo 'Installing Node.js 24'",
      "nvm install 24",
      "nvm use 24",
      "nvm alias default 24",

      // Get the actual installed version and set PATH
      "NODE_VERSION=$(nvm version)",
      'echo "Node.js version installed: $NODE_VERSION"',
      'export PATH="/root/.nvm/versions/node/$NODE_VERSION/bin:$PATH"',

      // Add to bashrc for future sessions
      'echo "export NVM_DIR=\\"/root/.nvm\\"" >> /root/.bashrc',
      'echo "[ -s \\"$NVM_DIR/nvm.sh\\" ] && source \\"$NVM_DIR/nvm.sh\\"" >> /root/.bashrc',
      'echo "[ -s \\"$NVM_DIR/bash_completion\\" ] && source \\"$NVM_DIR/bash_completion\\"" >> /root/.bashrc',

      // Verify installations
      "echo 'Verifying installations:'",
      "nginx -v",
      "node --version",
      "npm --version",
      "which node",
      "which npm",

      // Install PM2 globally
      "echo 'Installing PM2 globally'",
      "npm install -g pm2",

      // Verify PM2
      "echo 'Verifying PM2 installation:'",
      "pm2 --version",
      "which pm2",

      // Configure nginx
      "echo 'Configuring Nginx'",
      this.getNginxConfig(),

      // Set up PM2 environment
      "echo 'Setting up PM2 environment'",
      "mkdir -p /root/.pm2",
      "chmod -R 777 /root/.pm2",
      "export PM2_HOME=/root/.pm2",

      // Install symlink-dir (needed for some build processes)
      "echo 'Installing symlink-dir'",
      "npm install -g symlink-dir",

      // Disable NextJS telemetry
      "export NEXT_TELEMETRY_DISABLED=1",

      // Setup build and application directories
      "echo 'Setting up directories'",
      "mkdir -p /var/www/build",
      "mkdir -p /var/www/html",
      "chmod -R 755 /var/www/build",
      "chmod -R 755 /var/www/html",

      // Download application to build directory
      "echo 'Downloading application files...'",
      "cd /var/www/build",
      `aws s3 sync s3://${artifactBucket.bucketName}/current/ . --quiet`,

      // List contents to verify
      "echo 'Contents of build directory:'",
      "ls -la /var/www/build",

      // Stage 1: Build
      "echo 'Starting build stage'",
      "cd /var/www/build",

      // Install ALL dependencies for build with legacy peer deps
      "echo 'Installing all dependencies for build'",
      "npm install --legacy-peer-deps",

      // Create production environment file
      "rm /var/www/build/.env*",
      "echo 'Creating production environment file'",
      "cat << 'EOF' > /var/www/build/.env.local",
      `NEXT_PUBLIC_TILE_SERVER_URL=${this.config.tileServerUrl || ""}`,
      `NEXT_PUBLIC_STAC_CATALOG_URL=${this.config.stacCatalogUrl || ""}`,
      `NEXT_PUBLIC_STAC_LOADER_MCP_URL=${this.config.stacLoaderMcpUrl || ""}`,
      `NEXT_PUBLIC_UTILITY_API_URL=${this.config.webAppUtilityUrl || ""}`,
      `NEXT_PUBLIC_MODEL_RUNNER_API_URL=${this.config.modelRunnerApiUrl || ""}`,
      `NEXT_PUBLIC_GEO_AGENTS_MCP_URL=${this.config.geoAgentsMcpUrl || ""}`,
      `NEXT_PUBLIC_DETECTION_BRIDGE_BUCKET=${this.config.detectionBridgeBucket || ""}`,
      `NEXT_PUBLIC_KINESIS_STREAM_NAME=${this.config.kinesisStreamName || ""}`,
      `NEXT_PUBLIC_OIDC_AUTHORITY=${this.config.authority || ""}`,
      `NEXTAUTH_URL=${this.config.authSuccessUrl || ""}`,
      `NEXTAUTH_CLIENT_ID=${this.config.authClientId || ""}`,
      `NEXTAUTH_SECRET=${this.config.authSecret || ""}`,
      "EOF",

      // Rebuild the application with the new environment variables
      "echo 'Rebuilding application with environment variables'",
      "npm run build",

      // Stage 2: Production Setup
      "echo 'Starting production stage'",
      "cd /var/www/html",

      // Copy necessary files from build directory
      "echo 'Copying production files'",
      "cp -r /var/www/build/.next .",
      "cp -r /var/www/build/public .",
      "cp /var/www/build/package.json .",
      "cp /var/www/build/package-lock.json .",
      "cp /var/www/build/.env.local .",

      // Install only production dependencies with legacy peer deps
      "echo 'Installing production dependencies'",
      "npm install --omit=dev --legacy-peer-deps",

      // Recreate cesium assets after production npm install
      "echo 'Setting up cesium assets for production'",
      "rm -rf public/cesium",
      "cp -r node_modules/cesium/Build/Cesium public/cesium",
      "echo 'Cesium assets copied successfully'",

      // Clean up build directory
      "echo 'Cleaning up build directory'",
      "rm -rf /var/www/build",

      // Start the application with PM2
      "echo 'Starting Next.js application with PM2'",
      "export PM2_HOME=/root/.pm2",
      "pm2 install pm2-logrotate",
      "pm2 set pm2-logrotate:max_size 10M",
      "pm2 set pm2-logrotate:retain 5",

      // Create PM2 ecosystem config for better process management
      "cat << 'EOF' > /var/www/html/ecosystem.config.js",
      "module.exports = {",
      "  apps: [{",
      "    name: 'next-app',",
      "    script: 'npm',",
      "    args: 'start',",
      "    cwd: '/var/www/html',",
      "    instances: 1,",
      "    autorestart: true,",
      "    watch: false,",
      "    max_memory_restart: '1G',",
      "    env: {",
      "      NODE_ENV: 'production',",
      "      PORT: 3000",
      "    }",
      "  }]",
      "}",
      "EOF",

      // Start the application using ecosystem config
      "cd /var/www/html",
      "pm2 start ecosystem.config.js",
      "pm2 save",
      "pm2 startup systemd -u root --hp /root",

      // Wait for application to start
      "echo 'Waiting for Next.js to start...'",
      "sleep 10",

      // Verify application is running
      "echo 'Verifying application startup...'",
      "for i in {1..30}; do",
      "  if curl -f http://localhost:3000/ >/dev/null 2>&1; then",
      "    echo 'Next.js application is responding on port 3000'",
      "    break",
      "  fi",
      '  echo "Attempt $i: Next.js not ready yet, waiting..."',
      "  sleep 2",
      "done",

      // Start and verify nginx
      "echo 'Starting Nginx'",
      "systemctl start nginx",
      "systemctl enable nginx",
      "sleep 2",

      // Final verification
      "echo 'Final verification...'",
      "if curl -f http://localhost/ >/dev/null 2>&1; then",
      "  echo 'SUCCESS: Nginx is properly proxying to Next.js'",
      "else",
      "  echo 'ERROR: Nginx proxy not working'",
      "fi",

      "echo 'User data script completed'",

      // Print final status
      "echo 'Final service status:'",
      "echo 'Nginx status:'",
      "systemctl status nginx",
      "echo 'PM2 final status:'",
      "pm2 list",
      "echo 'Listening ports:'",
      "netstat -tulpn | grep -E ':(80|3000)'"
    );

    const ec2Role = new Role(this, "EC2InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
      ]
    });

    // Create Launch Template
    const launchTemplate = new LaunchTemplate(this, "WebAppLaunchTemplate", {
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      machineImage: new AmazonLinux2023ImageSsmParameter(),
      userData: userData,
      securityGroup: this.ec2SecurityGroup,
      role: ec2Role
    });

    new AwsCustomResource(this, "SetDefaultWebAppLaunchTemplate", {
      onUpdate: {
        service: "EC2",
        action: "modifyLaunchTemplate",
        parameters: {
          LaunchTemplateId: launchTemplate.launchTemplateId,
          DefaultVersion: "$Latest"
        },
        physicalResourceId: PhysicalResourceId.of(Date.now().toString())
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });

    // Create ASG using Launch Template
    const asg = new AutoScalingGroup(this, "WebAppAsg", {
      vpc: props.vpc,
      launchTemplate: launchTemplate,
      minCapacity: 2,
      maxCapacity: 4
    });

    // Add instance refresh trigger with completion waiting
    const instanceRefreshProvider = new Provider(
      this,
      "InstanceRefreshProvider",
      {
        onEventHandler: this.createInstanceRefreshFunction(
          asg.autoScalingGroupName
        )
      }
    );

    new CustomResource(this, "InstanceRefreshTrigger", {
      serviceToken: instanceRefreshProvider.serviceToken,
      properties: {
        AutoScalingGroupName: asg.autoScalingGroupName,
        Timestamp: Date.now()
      }
    });

    // Grant S3 read access to EC2 instances
    artifactBucket.grantRead(asg.role);

    // Add ASG to ALB target group
    listener.addTargets("WebAppTarget", {
      port: 80,
      targets: [asg],
      stickinessCookieDuration: Duration.days(1),
      healthCheck: {
        path: "/",
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 5,
        interval: Duration.seconds(30)
      }
    });
  }

  private getNginxConfig(): string {
    return `cat << 'EOF' > /etc/nginx/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent" "$http_x_forwarded_for"';

    access_log  /var/log/nginx/access.log  main;

    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    types_hash_max_size 4096;

    include             /etc/nginx/mime.types;
    default_type        application/octet-stream;

    server {
        listen       80;
        server_name  ${this.config.domainName ?? "*"};

        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header RSC $http_rsc;
            proxy_set_header Next-Router-State-Tree $http_next_router_state_tree;
            proxy_set_header Next-Router-Prefetch $http_next_router_prefetch;
            proxy_set_header Next-Router-Segment-Prefetch $http_next_router_segment_prefetch;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
EOF`;
  }

  private validateArtifactUrl(artifactUrl: string): void {
    try {
      const url = new URL(artifactUrl);

      if (!url.hostname || !url.protocol) {
        throw new Error(`Invalid URL format: ${artifactUrl}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      throw new Error(
        `Artifact URL validation failed: ${errorMessage}\n` +
          `   Please verify the URL is accessible: ${artifactUrl}`
      );
    }
  }

  private createArtifactDownloadFunction(targetBucket: IBucket): Function {
    const fn = new Function(this, "ArtifactDownloadFunction", {
      functionName: `${this.projectName}-ArtifactDownloader`,
      description: "Downloads web app build artifacts from a remote URL to S3",
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline(`
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const { URL } = require('url');

const s3Client = new S3Client({ region: process.env.AWS_REGION });

exports.handler = async (event, context) => {
  console.log('EVENT:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;
  const requestType = event.RequestType;

  try {
    if (requestType === 'Delete') {
      console.log('DELETE request - nothing to clean up');
      return { PhysicalResourceId: event.PhysicalResourceId || 'ArtifactDownload' };
    }

    if (requestType === 'Create' || requestType === 'Update') {
      const { ArtifactUrl } = props;

      if (!ArtifactUrl) {
        throw new Error('ArtifactUrl is required');
      }

      console.log('Downloading artifact from:', ArtifactUrl);

      // Parse URL to handle both HTTP and HTTPS
      const url = new URL(ArtifactUrl);
      const client = url.protocol === 'https:' ? https : require('http');

      // Download artifact
      const artifact = await new Promise((resolve, reject) => {
        const options = {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          headers: { 'User-Agent': 'AWS Lambda CDK Deployment' },
          timeout: 30000 // 30 second timeout
        };

        const req = client.get(options, (res) => {
          // Handle redirects
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            console.log('Following redirect to:', res.headers.location);

            // Create new URL for redirect
            const redirectUrl = new URL(res.headers.location);
            const redirectClient = redirectUrl.protocol === 'https:' ? https : require('http');

            const redirectOptions = {
              hostname: redirectUrl.hostname,
              port: redirectUrl.port,
              path: redirectUrl.pathname + redirectUrl.search,
              headers: { 'User-Agent': 'AWS Lambda CDK Deployment' },
              timeout: 30000
            };

            redirectClient.get(redirectOptions, (redirectRes) => {
              if (redirectRes.statusCode !== 200) {
                reject(new Error(\`HTTP \${redirectRes.statusCode}: \${redirectRes.statusMessage}\`));
                return;
              }

              const chunks = [];
              redirectRes.on('data', chunk => chunks.push(chunk));
              redirectRes.on('end', () => resolve(Buffer.concat(chunks)));
            }).on('error', reject);

            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(\`HTTP \${res.statusCode}: \${res.statusMessage}\`));
            return;
          }

          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.end();
      });

      console.log('Downloaded artifact, size:', artifact.length, 'bytes');

      // Upload to S3
      await s3Client.send(new PutObjectCommand({
        Bucket: '${targetBucket.bucketName}',
        Key: 'current/build.zip',
        Body: artifact,
        ContentType: 'application/zip'
      }));

      console.log('Successfully uploaded artifact to S3');

      // Return success data - Provider handles CloudFormation response
      return {
        PhysicalResourceId: \`ArtifactDownload-\${Date.now()}\`,
        Data: {
          BucketName: '${targetBucket.bucketName}',
          ObjectKey: 'current/build.zip',
          ArtifactSize: artifact.length
        }
      };
    }
  } catch (error) {
    console.error('Error in custom resource:', error);
    throw error; // Provider handles the FAILED response
  }
}`),
      timeout: Duration.minutes(5)
    });

    targetBucket.grantWrite(fn);

    return fn;
  }

  private createInstanceRefreshFunction(asgName: string): Function {
    const fn = new Function(this, "InstanceRefreshFunction", {
      functionName: `${this.projectName}-InstanceRefresh`,
      description: "Triggers ASG instance refresh for web app deployments",
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      timeout: Duration.minutes(15), // Maximum timeout for Lambda
      code: Code.fromInline(`
const { AutoScalingClient, StartInstanceRefreshCommand, DescribeInstanceRefreshesCommand } = require('@aws-sdk/client-auto-scaling');

const autoScalingClient = new AutoScalingClient({ region: process.env.AWS_REGION });

exports.handler = async (event, context) => {
  console.log('EVENT:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;
  const requestType = event.RequestType;
  const asgName = props.AutoScalingGroupName;

  try {
    if (requestType === 'Delete') {
      console.log('DELETE request - nothing to clean up for instance refresh');
      return { PhysicalResourceId: event.PhysicalResourceId || 'InstanceRefresh' };
    }

    if (requestType === 'Create' || requestType === 'Update') {
      console.log('Starting instance refresh for ASG:', asgName);

      // Start instance refresh
      const startCommand = new StartInstanceRefreshCommand({
        AutoScalingGroupName: asgName,
        Preferences: {
          MinHealthyPercentage: 50,
          InstanceWarmup: 120, // 2 minutes
          CheckpointPercentages: [20, 50, 100], // Report progress at these percentages
          CheckpointDelay: 60 // Wait 1 minute between checkpoints
        }
      });

      const startResult = await autoScalingClient.send(startCommand);
      const instanceRefreshId = startResult.InstanceRefreshId;

      console.log('Instance refresh started with ID:', instanceRefreshId);

      // Poll for completion (with timeout handling)
      const maxWaitTime = 13 * 60 * 1000; // 13 minutes (allow 2 minutes buffer for Lambda)
      const pollInterval = 30 * 1000; // 30 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const describeCommand = new DescribeInstanceRefreshesCommand({
          AutoScalingGroupName: asgName,
          InstanceRefreshIds: [instanceRefreshId]
        });

        const describeResult = await autoScalingClient.send(describeCommand);
        const refresh = describeResult.InstanceRefreshes[0];

        console.log(\`Instance refresh status: \${refresh.Status}, Progress: \${refresh.PercentageComplete}%\`);

        if (refresh.Status === 'Successful') {
          console.log('Instance refresh completed successfully');
          return {
            PhysicalResourceId: \`InstanceRefresh-\${instanceRefreshId}\`,
            Data: {
              InstanceRefreshId: instanceRefreshId,
              Status: 'Successful',
              PercentageComplete: 100
            }
          };
        }

        if (refresh.Status === 'Failed' || refresh.Status === 'Cancelled') {
          throw new Error(\`Instance refresh failed with status: \${refresh.Status}. Reason: \${refresh.StatusReason}\`);
        }

        // Continue polling if status is 'Pending' or 'InProgress'
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // If we reach here, we've timed out
      console.log('Instance refresh is still in progress, but Lambda is approaching timeout');
      console.log('Note: Instance refresh will continue in background even if Lambda times out');

      return {
        PhysicalResourceId: \`InstanceRefresh-\${instanceRefreshId}\`,
        Data: {
          InstanceRefreshId: instanceRefreshId,
          Status: 'InProgress',
          Note: 'Instance refresh started successfully but may still be in progress'
        }
      };
    }
  } catch (error) {
    console.error('Error in instance refresh custom resource:', error);
    throw error;
  }
}`)
    });

    // Grant permissions to manage Auto Scaling Group instance refreshes
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ["autoscaling:StartInstanceRefresh"],
        resources: [
          `arn:aws:autoscaling:*:*:autoScalingGroup:*:autoScalingGroupName/${asgName}`
        ]
      })
    );

    // DescribeInstanceRefreshes requires * resource (it's a describe/read operation)
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ["autoscaling:DescribeInstanceRefreshes"],
        resources: ["*"]
      })
    );

    return fn;
  }

  private setup(props: WebUIProps): void {
    const inputConfig: Partial<WebAppConfig> = props.config ?? {};

    // Apply defaults for all required fields
    this.config = {
      // Optional fields with defaults
      buildFromSource: inputConfig.buildFromSource ?? false,
      artifactUrl:
        inputConfig.artifactUrl ??
        "https://github.com/awslabs/osml-web-app/releases/latest/download/build.zip",
      albSecurityGroupId: inputConfig.albSecurityGroupId,
      ec2SecurityGroupId: inputConfig.ec2SecurityGroupId,

      // Required fields - must provide defaults or throw errors
      hostedZone: inputConfig.hostedZone ?? "localhost",
      domainName: inputConfig.domainName ?? "localhost",
      tileServerUrl:
        inputConfig.tileServerUrl ?? "https://api.example.com/tiles",
      stacCatalogUrl:
        inputConfig.stacCatalogUrl ?? "https://api.example.com/catalog",
      stacLoaderMcpUrl: inputConfig.stacLoaderMcpUrl ?? "",
      webAppUtilityUrl:
        inputConfig.webAppUtilityUrl ?? "https://api.example.com/webAppUtility",
      modelRunnerApiUrl:
        inputConfig.modelRunnerApiUrl ?? "https://api.example.com/model-runner",
      geoAgentsMcpUrl: inputConfig.geoAgentsMcpUrl ?? "",
      authSuccessUrl: inputConfig.authSuccessUrl ?? "http://localhost:3000",
      authClientId: inputConfig.authClientId ?? "default-client",
      authSecret: inputConfig.authSecret ?? "default-secret",
      authority: inputConfig.authority ?? "https://auth.example.com",
      detectionBridgeBucket: inputConfig.detectionBridgeBucket
    };

    // Validate critical configuration - localhost defaults indicate development environment

    // Setup a removal policy
    this.removalPolicy = props.isProd
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    if (this.config.albSecurityGroupId) {
      this.albSecurityGroup = SecurityGroup.fromSecurityGroupId(
        this,
        "WebAppALBImportSecurityGroup",
        this.config.albSecurityGroupId
      );
    } else {
      this.albSecurityGroup = new SecurityGroup(this, "AlbSecurityGroup", {
        vpc: props.vpc,
        allowAllOutbound: true,
        description: "Security group for WebApp ALB"
      });
      this.albSecurityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.tcp(80),
        "Allow HTTP traffic"
      );
      this.albSecurityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.tcp(443),
        "Allow HTTPS traffic"
      );
    }

    if (this.config.ec2SecurityGroupId) {
      this.ec2SecurityGroup = SecurityGroup.fromSecurityGroupId(
        this,
        "WebAppEC2ImportSecurityGroup",
        this.config.ec2SecurityGroupId
      );
    } else {
      this.ec2SecurityGroup = new SecurityGroup(this, "Ec2SecurityGroup", {
        vpc: props.vpc,
        allowAllOutbound: true,
        description: "Security group for WebApp EC2 instances"
      });

      this.ec2SecurityGroup.addIngressRule(
        this.albSecurityGroup,
        Port.tcp(80),
        "Allow traffic from WebApp ALB"
      );
    }
  }
}
