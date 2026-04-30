/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

import { RemovalPolicy } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  CfnLoggingConfiguration,
  CfnWebACL,
  CfnWebACLAssociation
} from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

/**
 * Configuration for a per-stack regional WAFv2 WebACL.
 */
export interface WebAppWafProps {
  /**
   * ARN of the resource to associate (ALB ARN or API Gateway stage ARN).
   */
  readonly resourceArn: string;

  /**
   * Name prefix for the WebACL and log group (e.g. `OSML-WebApp-webui`).
   * Must be unique per account/region because CloudWatch log group names
   * (with the mandatory `aws-waf-logs-` prefix) share a namespace with any
   * other WAF WebACL log group in the account/region.
   */
  readonly namePrefix: string;

  /**
   * Whether this is a prod-like environment. Controls log-retention and
   * removal-policy mirroring other log constructs in this package.
   */
  readonly isProd: boolean;

  /**
   * Per-IP rate limit within a 5-minute sliding window. @default 2000
   */
  readonly requestsPer5Min?: number;
}

/**
 * Regional WAFv2 WebACL with AWS managed Known-Bad-Inputs rule and a
 * per-IP rate limit. Associates itself with the provided resource and
 * publishes full logs to a dedicated CloudWatch log group.
 */
export class WebAppWaf extends Construct {
  public readonly webAcl: CfnWebACL;

  constructor(scope: Construct, id: string, props: WebAppWafProps) {
    super(scope, id);

    const rateLimit = props.requestsPer5Min ?? 2000;

    this.webAcl = new CfnWebACL(this, "WebAcl", {
      name: props.namePrefix,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${props.namePrefix}-metric`,
        sampledRequestsEnabled: true
      },
      rules: [
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesKnownBadInputsRuleSet"
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "KnownBadInputs",
            sampledRequestsEnabled: true
          }
        },
        {
          name: "RateLimitPerIp",
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: rateLimit,
              aggregateKeyType: "IP"
            }
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitPerIp",
            sampledRequestsEnabled: true
          }
        }
      ]
    });

    // WAF log group names must be prefixed with "aws-waf-logs-".
    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `aws-waf-logs-${props.namePrefix}`,
      retention: props.isProd
        ? RetentionDays.ONE_YEAR
        : RetentionDays.ONE_MONTH,
      removalPolicy: props.isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY
    });

    new CfnLoggingConfiguration(this, "LoggingConfig", {
      resourceArn: this.webAcl.attrArn,
      logDestinationConfigs: [logGroup.logGroupArn]
    });

    new CfnWebACLAssociation(this, "Association", {
      resourceArn: props.resourceArn,
      webAclArn: this.webAcl.attrArn
    });
  }
}
