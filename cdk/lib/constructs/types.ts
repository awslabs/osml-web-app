/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * OSML Account configuration interface.
 */
export interface OSMLAccount {
  /** The AWS account ID. */
  readonly id: string;
  /** The AWS region. */
  readonly region: string;
  /** Whether this is a production-like environment. Defaults to false if not specified. */
  readonly prodLike?: boolean;
  /** Whether this is an ADC (Application Data Center) environment. Defaults to false if not specified. */
  readonly isAdc?: boolean;
}
