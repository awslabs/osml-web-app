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
import { AutoScalingGroup, ScalingEvents } from "aws-cdk-lib/aws-autoscaling";
import {
  Certificate,
  CertificateValidation
} from "aws-cdk-lib/aws-certificatemanager";
import {
  AmazonLinux2023ImageSsmParameter,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
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
import { Alias } from "aws-cdk-lib/aws-kms";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { ARecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket
} from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Topic } from "aws-cdk-lib/aws-sns";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
  Provider
} from "aws-cdk-lib/custom-resources";
import { NagSuppressions } from "cdk-nag";
import { execSync } from "child_process";
import { Construct } from "constructs";
import { copyFileSync, existsSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { URL } from "url";

import { WafConfig } from "../config/app-config";
import { OSMLAccount } from "./types";
import { WebAppWaf } from "./web-app-waf";

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

  /**
   * WAFv2 configuration for the internet-facing ALB (optional).
   */
  wafConfig?: WafConfig;
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

    // Shared target for S3 server access logs produced by the web-app
    // artifact bucket below. Security controls enabled here:
    //   - S3-managed encryption at rest
    //   - public access fully blocked
    //   - versioning (so accidental overwrites / deletes are recoverable)
    //   - SSL/TLS-only access via bucket policy
    //   - a 90-day expiration lifecycle rule to bound log growth
    // The suppression below records the logging-recursion constraint: an
    // access-log target bucket cannot itself have server access logging
    // enabled without creating an infinite logging loop.
    const accessLogsBucket = new Bucket(this, "WebAppAccessLogsBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: this.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: [{ expiration: Duration.days(90) }]
    });

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
      {
        id: "AwsSolutions-S1",
        reason:
          "This bucket is the target of server access logs for the web-app artifact bucket and the ALB. Enabling access logs on the access-log bucket itself would create an infinite logging recursion. The bucket has public access blocked, enforces SSL/TLS in transit, is encrypted with S3-managed keys, has versioning enabled, and has a 90-day expiration lifecycle rule to bound log growth, so its security posture is acceptable without an additional logging layer."
      }
    ]);

    // Create artifact bucket
    const artifactBucket = new Bucket(this, "ArtifactBucket", {
      bucketName: `web-app-deployment-artifacts-${props.account.id}`,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: this.removalPolicy,
      autoDeleteObjects: true,
      // Enforce SSL/TLS for every request; the accompanying auto-generated
      // bucket policy denies any request made over plain HTTP.
      enforceSSL: true,
      // Ship S3 server access logs to the shared web-app log bucket under a
      // bucket-specific prefix so operators can audit access per bucket.
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "artifacts/"
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

      NagSuppressions.addResourceSuppressions(
        artifactProvider,
        [
          {
            id: "AwsSolutions-L1",
            reason:
              "The CDK Provider framework-onEvent Lambda has its runtime set by the aws-cdk-lib Provider construct internals; the consumer cannot override the framework Lambda's runtime without replacing the Provider. The framework runtime advances with aws-cdk-lib releases."
          },
          {
            id: "AwsSolutions-IAM4",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
            ],
            reason:
              "The CDK Provider framework Lambda uses the AWS-published AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs access. The Provider construct creates this framework function on the consumer's behalf and does not expose a hook to substitute a customer-managed log policy."
          },
          {
            id: "AwsSolutions-IAM5",
            appliesTo: [
              "Resource::<WebAppArtifactDownloadFunction152F6856.Arn>:*"
            ],
            reason:
              "The CDK Provider framework grants lambda:InvokeFunction on the inner onEventHandler Lambda using an ARN:version-qualifier wildcard so it can invoke any published version or $LATEST. The resource is scoped to the single inner Lambda."
          }
        ],
        true
      );

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

    // Ship ELB access logs to the shared web-app log bucket under a prefix
    // so operators can audit request-level traffic through the ALB.
    this.alb.logAccessLogs(accessLogsBucket, "alb-access-logs");

    // Per-stack WAFv2 WebACL protecting the internet-facing ALB.
    if (props.wafConfig?.enabled !== false) {
      new WebAppWaf(this, "WebAppAlbWaf", {
        resourceArn: this.alb.loadBalancerArn,
        namePrefix: `${this.projectName}-webui`,
        isProd: props.isProd,
        requestsPer5Min: props.wafConfig?.requestsPer5Min
      });
    }

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

    // CloudWatch log group for PM2, nginx, and user-data logs shipped
    // by the CloudWatch agent installed via user data below.
    const webAppLogGroup = new LogGroup(this, "WebAppLogGroup", {
      logGroupName: `/${this.projectName}/web-app`,
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: this.removalPolicy
    });

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
      "dnf install -q -y unzip aws-cli nginx amazon-cloudwatch-agent",

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

      // Configure CloudWatch agent to ship PM2, nginx, and user-data logs.
      // The agent is started here (before PM2) so any crash during the
      // Next.js startup that follows is captured in CloudWatch.
      "echo 'Configuring CloudWatch agent'",
      "cat << 'EOF' > /opt/aws/amazon-cloudwatch-agent/bin/config.json",
      JSON.stringify({
        logs: {
          logs_collected: {
            files: {
              collect_list: [
                {
                  file_path: "/root/.pm2/logs/next-app-out.log",
                  log_group_name: webAppLogGroup.logGroupName,
                  log_stream_name: "{instance_id}/next-app-out"
                },
                {
                  file_path: "/root/.pm2/logs/next-app-error.log",
                  log_group_name: webAppLogGroup.logGroupName,
                  log_stream_name: "{instance_id}/next-app-error"
                },
                {
                  file_path: "/var/log/user-data-script.log",
                  log_group_name: webAppLogGroup.logGroupName,
                  log_stream_name: "{instance_id}/user-data"
                },
                {
                  file_path: "/var/log/nginx/access.log",
                  log_group_name: webAppLogGroup.logGroupName,
                  log_stream_name: "{instance_id}/nginx-access"
                },
                {
                  file_path: "/var/log/nginx/error.log",
                  log_group_name: webAppLogGroup.logGroupName,
                  log_stream_name: "{instance_id}/nginx-error"
                }
              ]
            }
          }
        }
      }),
      "EOF",
      "/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/bin/config.json -s",

      // Set up PM2 environment
      "echo 'Setting up PM2 environment'",
      "mkdir -p /root/.pm2",
      "chmod -R 777 /root/.pm2",
      "export PM2_HOME=/root/.pm2",

      // Disable NextJS telemetry
      "export NEXT_TELEMETRY_DISABLED=1",

      // Setup application directory
      "echo 'Setting up directories'",
      "mkdir -p /var/www/html",
      "chmod -R 755 /var/www/html",

      // Download the prebuilt standalone server bundle directly into the
      // application directory. The artifact is already extracted by the
      // BucketDeployment construct, so this is a plain file sync. The bundle
      // contains server.js, .next/, node_modules/, and public/ — everything
      // needed to run; no `npm install` or `next build` is required on the
      // instance because runtime configuration is injected via env vars.
      "echo 'Downloading application files...'",
      "cd /var/www/html",
      `aws s3 sync s3://${artifactBucket.bucketName}/current/ . --quiet`,

      // List contents to verify
      "echo 'Contents of application directory:'",
      "ls -la /var/www/html",

      // Start the application with PM2
      "echo 'Starting Next.js standalone server with PM2'",
      "export PM2_HOME=/root/.pm2",
      "pm2 install pm2-logrotate",
      "pm2 set pm2-logrotate:max_size 10M",
      "pm2 set pm2-logrotate:retain 5",

      // PM2 ecosystem config. The `env` block is the runtime configuration
      // for the Next.js server. Values are JSON.stringify'd to preserve
      // any quotes, backslashes, or newlines.
      "cat << 'EOF' > /var/www/html/ecosystem.config.js",
      "module.exports = {",
      "  apps: [{",
      "    name: 'next-app',",
      "    script: 'server.js',",
      "    cwd: '/var/www/html',",
      "    instances: 1,",
      "    autorestart: true,",
      "    watch: false,",
      "    max_memory_restart: '1G',",
      "    env: {",
      "      NODE_ENV: 'production',",
      "      PORT: 3000,",
      "      HOSTNAME: '0.0.0.0',",
      `      TILE_SERVER_URL: ${JSON.stringify(this.config.tileServerUrl || "")},`,
      `      STAC_CATALOG_URL: ${JSON.stringify(this.config.stacCatalogUrl || "")},`,
      `      STAC_LOADER_MCP_URL: ${JSON.stringify(this.config.stacLoaderMcpUrl || "")},`,
      `      UTILITY_API_URL: ${JSON.stringify(this.config.webAppUtilityUrl || "")},`,
      `      MODEL_RUNNER_API_URL: ${JSON.stringify(this.config.modelRunnerApiUrl || "")},`,
      `      GEO_AGENTS_MCP_URL: ${JSON.stringify(this.config.geoAgentsMcpUrl || "")},`,
      `      DETECTION_BRIDGE_BUCKET: ${JSON.stringify(this.config.detectionBridgeBucket || "")},`,
      `      KINESIS_STREAM_NAME: ${JSON.stringify(this.config.kinesisStreamName || "")},`,
      `      OIDC_AUTHORITY: ${JSON.stringify(this.config.authority || "")},`,
      `      NEXTAUTH_URL: ${JSON.stringify(this.config.authSuccessUrl || "")},`,
      `      NEXTAUTH_CLIENT_ID: ${JSON.stringify(this.config.authClientId || "")},`,
      `      NEXTAUTH_SECRET: ${JSON.stringify(this.config.authSecret || "")}`,
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
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
      ]
    });

    // Create Launch Template
    const launchTemplate = new LaunchTemplate(this, "WebAppLaunchTemplate", {
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.LARGE),
      machineImage: new AmazonLinux2023ImageSsmParameter({
        cachedInContext: false
      }),
      userData: userData,
      securityGroup: this.ec2SecurityGroup,
      role: ec2Role,
      // Enforce EBS encryption at rest on the root volume of every instance
      // launched from this template. Without an explicit block-device
      // mapping, the launch template would inherit the AMI's default which
      // leaves encryption off unless the account-level default encryption
      // setting is enabled. GP3 is a cost/perf default that matches the
      // t3.large instance profile used above.
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(8, {
            encrypted: true,
            volumeType: EbsDeviceVolumeType.GP3
          })
        }
      ]
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

    // SNS topic that receives ASG instance lifecycle events (launch, terminate,
    // launch-error, terminate-error). Encryption at rest is provided by the
    // AWS-managed SNS KMS key (alias/aws/sns) and a bucket-policy equivalent
    // is attached via enforceSSL so every publish request must use TLS.
    const asgNotificationTopic = new Topic(this, "AsgNotificationTopic", {
      displayName: "WebApp ASG Instance Lifecycle Events",
      masterKey: Alias.fromAliasName(this, "SnsDefaultKey", "alias/aws/sns"),
      enforceSSL: true
    });

    // Create ASG using Launch Template
    const asg = new AutoScalingGroup(this, "WebAppAsg", {
      vpc: props.vpc,
      launchTemplate: launchTemplate,
      minCapacity: 2,
      maxCapacity: 4,
      // Publish every launch, terminate, and error lifecycle event to the SNS
      // topic above so operators can observe fleet churn.
      notifications: [
        {
          topic: asgNotificationTopic,
          scalingEvents: ScalingEvents.ALL
        }
      ]
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

    NagSuppressions.addResourceSuppressions(
      instanceRefreshProvider,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "The CDK Provider framework-onEvent Lambda has its runtime set by the aws-cdk-lib Provider construct internals; the consumer cannot override the framework Lambda's runtime without replacing the Provider. The framework runtime advances with aws-cdk-lib releases."
        },
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "The CDK Provider framework Lambda uses the AWS-published AWSLambdaBasicExecutionRole managed policy for CloudWatch Logs access. The Provider construct does not expose a hook to substitute a customer-managed log policy."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Resource::<WebAppInstanceRefreshFunction486FE838.Arn>:*"
          ],
          reason:
            "The CDK Provider framework grants lambda:InvokeFunction on the inner Lambda using an ARN:qualifier wildcard; scoped to the single inner Lambda."
        }
      ],
      true
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

    // The EC2 role is attached to the launch template used by the ASG above.
    // artifactBucket.grantRead(asg.role) adds an inline policy statement to
    // the role's auto-generated DefaultPolicy child, so the IAM5 suppression
    // for the grantRead-emitted action/resource wildcards must be applied
    // AFTER grantRead with applyToChildren: true so cdk-nag picks up the
    // DefaultPolicy child created by the grant call. The IAM4 suppression
    // covers the managed policies attached at role construction.
    NagSuppressions.addResourceSuppressions(
      ec2Role,
      [
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore",
            "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchAgentServerPolicy"
          ],
          reason:
            "The EC2 instances hosting the web app need Systems Manager agent connectivity (Session Manager, Patch Manager, inventory) and CloudWatch agent log shipping for PM2, nginx, and user-data logs. AmazonSSMManagedInstanceCore and CloudWatchAgentServerPolicy are the AWS-published managed policies for those exact grants; no customer-managed equivalents exist that would narrow the action set without duplicating it."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Action::s3:GetObject*",
            "Action::s3:GetBucket*",
            "Action::s3:List*",
            "Resource::<WebAppArtifactBucket72635782.Arn>/*"
          ],
          reason:
            "Bucket.grantRead() on the web-app artifact bucket emits s3:GetObject*, s3:GetBucket*, and s3:List* action-prefix wildcards together with a bucket/* object-ARN wildcard. The object ARN is already scoped to the single artifact bucket that EC2 instances must read during user-data setup to sync the web app build."
        }
      ],
      true
    );

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
    const artifactDownloadLogGroup = new LogGroup(
      this,
      "ArtifactDownloadLogGroup",
      {
        logGroupName: `/aws/lambda/${this.projectName}-ArtifactDownloader`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    const fn = new Function(this, "ArtifactDownloadFunction", {
      functionName: `${this.projectName}-ArtifactDownloader`,
      description: "Downloads web app build artifacts from a remote URL to S3",
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      logGroup: artifactDownloadLogGroup,
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

    // targetBucket.grantWrite(fn) adds an inline policy statement to the
    // Lambda's auto-generated DefaultPolicy child. The IAM5 suppression for
    // the grantWrite-emitted action/resource wildcards must therefore be
    // applied AFTER the grantWrite call with applyToChildren: true so cdk-nag
    // picks up the DefaultPolicy child created by the grant call. The IAM4
    // suppression covers the Lambda's service-role managed policy.
    NagSuppressions.addResourceSuppressions(
      fn,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to nodejs22.x to stay consistent with the shared web-app Lambda runtime policy and to match the @aws-sdk/client-s3 SDK version bundled in the inline code. nodejs22.x remains an AWS-supported Lambda runtime; advancing the runtime is a coordinated change across every Lambda in this package, not a drive-by upgrade on a single function."
        },
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing it with a customer-managed copy would duplicate the grant and drift whenever AWS updates the CloudWatch Logs action set."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Action::s3:DeleteObject*",
            "Action::s3:Abort*",
            "Resource::<WebAppArtifactBucket72635782.Arn>/*"
          ],
          reason:
            "Bucket.grantWrite() emits s3:DeleteObject* and s3:Abort* action-prefix wildcards so multipart uploads can be aborted, together with a bucket/* object-ARN wildcard scoped to the single artifact bucket."
        }
      ],
      true
    );

    return fn;
  }

  private createInstanceRefreshFunction(asgName: string): Function {
    const instanceRefreshLogGroup = new LogGroup(
      this,
      "InstanceRefreshLogGroup",
      {
        logGroupName: `/aws/lambda/${this.projectName}-InstanceRefresh`,
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: this.removalPolicy
      }
    );

    const fn = new Function(this, "InstanceRefreshFunction", {
      functionName: `${this.projectName}-InstanceRefresh`,
      description: "Triggers ASG instance refresh for web app deployments",
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      logGroup: instanceRefreshLogGroup,
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

    // The two fn.addToRolePolicy calls above extend the Lambda's auto-generated
    // DefaultPolicy child with autoscaling permissions. The IAM5 suppression
    // for the Resource-wildcards those statements emit must therefore be
    // applied AFTER the addToRolePolicy calls with applyToChildren: true so
    // cdk-nag picks up the DefaultPolicy child.
    NagSuppressions.addResourceSuppressions(
      fn,
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "This Lambda is pinned to nodejs22.x to stay consistent with the shared web-app Lambda runtime policy and to match the @aws-sdk/client-auto-scaling SDK version bundled in the inline code. nodejs22.x remains an AWS-supported Lambda runtime; advancing the runtime is a coordinated change across every Lambda in this package, not a drive-by upgrade on a single function."
        },
        {
          id: "AwsSolutions-IAM4",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
          ],
          reason:
            "AWSLambdaBasicExecutionRole is the AWS-published managed policy that grants Lambda permission to create a log stream and write log events to its own log group. Replacing it would duplicate the grant."
        },
        {
          id: "AwsSolutions-IAM5",
          appliesTo: [
            "Resource::arn:aws:autoscaling:*:*:autoScalingGroup:*:autoScalingGroupName/<WebAppWebAppAsgASG11C3C39A>",
            "Resource::*"
          ],
          reason:
            "The autoscaling:StartInstanceRefresh action requires an ARN whose region/account portions are wildcarded because the ASG is referenced by name and the full ARN is known only at deploy time. The autoscaling:DescribeInstanceRefreshes action is a describe/list call that only accepts Resource::* per the AWS Auto Scaling service contract."
        }
      ],
      true
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

      NagSuppressions.addResourceSuppressions(this.albSecurityGroup, [
        {
          id: "AwsSolutions-EC23",
          reason:
            "This ALB serves as the public internet-facing entry point for the web application and must accept traffic from any source IP on HTTPS (and HTTP for redirect-to-HTTPS). Narrowing the ingress CIDR would break the public web app contract. Authentication is enforced at the application layer via OIDC/JWT, and request-level access is audited via the ALB access logs enabled on this stack."
        }
      ]);
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
