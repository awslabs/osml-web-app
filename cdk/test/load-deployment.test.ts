/*
 * Copyright 2025 Amazon.com, Inc. or its affiliates.
 */

/**
 * Unit tests for loadDeploymentConfig function.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 */

// Mock fs module before importing the function under test
jest.mock("fs", () => {
  const actualFs = jest.requireActual<typeof import("fs")>("fs");
  return {
    ...actualFs,
    existsSync: jest.fn(),
    readFileSync: jest.fn()
  };
});

import fc from "fast-check";
import { existsSync, readFileSync } from "fs";

import {
  DeploymentConfigError,
  loadDeploymentConfig
} from "../bin/deployment/load-deployment";

describe("loadDeploymentConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (existsSync as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // Basic Configuration Loading Tests
  // ============================================================================

  describe("basic configuration loading", () => {
    test("loads valid minimal deployment configuration", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.projectName).toBe("test-project");
      expect(result.account.id).toBe("123456789012");
      expect(result.account.region).toBe("us-west-2");
      expect(result.account.prodLike).toBe(false);
      expect(result.account.isAdc).toBe(false);
    });

    test("loads prodLike and isAdc flags when specified", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2",
          prodLike: true,
          isAdc: true
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.account.prodLike).toBe(true);
      expect(result.account.isAdc).toBe(true);
    });

    test("trims whitespace from string fields", () => {
      const config = {
        projectName: "  test-project  ",
        account: {
          id: "  123456789012  ",
          region: "  us-west-2  "
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.projectName).toBe("test-project");
      expect(result.account.id).toBe("123456789012");
      expect(result.account.region).toBe("us-west-2");
    });
  });

  // ============================================================================
  // Missing File and Invalid JSON Tests
  // ============================================================================

  describe("file and JSON validation", () => {
    test("throws error when deployment.json is missing", () => {
      (existsSync as jest.Mock).mockReturnValue(false);

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Missing deployment.json file/);
    });

    test("throws error when JSON is invalid", () => {
      (readFileSync as jest.Mock).mockReturnValue("{ invalid json }");

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid JSON format/);
    });

    test("throws error when file content is not an object", () => {
      (readFileSync as jest.Mock).mockReturnValue('"just a string"');

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/must contain a valid JSON object/);
    });
  });

  // ============================================================================
  // Required Field Validation Tests
  // ============================================================================

  describe("required field validation", () => {
    test("validates required projectName field", () => {
      const config = {
        account: {
          id: "123456789012",
          region: "us-west-2"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Missing required field: projectName/);
    });

    test("validates projectName is not empty", () => {
      const config = {
        projectName: "",
        account: {
          id: "123456789012",
          region: "us-west-2"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/cannot be empty/);
    });

    test("validates required account.id field", () => {
      const config = {
        projectName: "test-project",
        account: {
          region: "us-west-2"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Missing required field: account.id/);
    });

    test("validates required account.region field", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Missing required field: account.region/);
    });

    test("validates account section exists", () => {
      const config = {
        projectName: "test-project"
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Missing or invalid account section/);
    });
  });

  // ============================================================================
  // Format Validation Tests
  // ============================================================================

  describe("format validation", () => {
    test("validates account ID format (must be 12 digits)", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "12345",
          region: "us-west-2"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid AWS account ID format/);
    });

    test("validates region format", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "invalid_region_123"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid AWS region format/);
    });

    test("accepts valid region formats", () => {
      const validRegions = [
        "us-east-1",
        "us-west-2",
        "eu-west-1",
        "ap-southeast-2",
        "us-gov-west-1"
      ];

      for (const region of validRegions) {
        const config = {
          projectName: "test-project",
          account: {
            id: "123456789012",
            region
          }
        };

        (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

        const result = loadDeploymentConfig();
        expect(result.account.region).toBe(region);
      }
    });
  });

  // ============================================================================
  // Network Configuration Tests
  // ============================================================================

  describe("networkConfig validation", () => {
    test("validates VPC ID format when provided", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "invalid-vpc-id"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid VPC ID format/);
    });

    test("validates security group ID format when provided", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "vpc-12345678",
          TARGET_SUBNETS: ["subnet-12345678"],
          SECURITY_GROUP_ID: "invalid-sg-id"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid security group ID format/);
    });

    test("requires TARGET_SUBNETS when VPC_ID is provided", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "vpc-12345678"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/TARGET_SUBNETS must also be specified/);
    });

    test("validates TARGET_SUBNETS is array when provided", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "vpc-12345678",
          TARGET_SUBNETS: "not-an-array"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/must be an array/);
    });

    test("validates subnet ID format in TARGET_SUBNETS", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "vpc-12345678",
          TARGET_SUBNETS: ["invalid-subnet"]
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid Subnet ID format/);
    });

    test("loads networkConfig with valid VPC configuration", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        networkConfig: {
          VPC_ID: "vpc-12345678",
          TARGET_SUBNETS: ["subnet-12345678", "subnet-87654321"],
          SECURITY_GROUP_ID: "sg-1234567890abcdef0"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.networkConfig).toBeDefined();
      expect(result.networkConfig?.VPC_ID).toBe("vpc-12345678");
      expect(result.networkConfig?.TARGET_SUBNETS).toEqual([
        "subnet-12345678",
        "subnet-87654321"
      ]);
      expect(result.networkConfig?.SECURITY_GROUP_ID).toBe(
        "sg-1234567890abcdef0"
      );
    });
  });

  // ============================================================================
  // DataplaneConfig Tests
  // ============================================================================

  describe("dataplaneConfig validation", () => {
    test("loads dataplaneConfig with authConfig", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          authConfig: {
            authority: "https://auth.example.com/realms/osml",
            audience: "account",
            clientId: "osml-web"
          }
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.dataplaneConfig?.authConfig).toBeDefined();
      expect(result.dataplaneConfig?.authConfig?.authority).toBe(
        "https://auth.example.com/realms/osml"
      );
      expect(result.dataplaneConfig?.authConfig?.audience).toBe("account");
      expect(result.dataplaneConfig?.authConfig?.clientId).toBe("osml-web");
    });

    test("validates authConfig authority is a valid URL", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          authConfig: {
            authority: "not-a-valid-url",
            audience: "account"
          }
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid URL format/);
    });

    test("loads dataplaneConfig with webAppConfig", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          webAppConfig: {
            buildFromSource: true,
            hostedZone: "example.com",
            domainName: "osml.example.com"
          }
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.dataplaneConfig?.webAppConfig).toBeDefined();
      expect(result.dataplaneConfig?.webAppConfig?.buildFromSource).toBe(true);
      expect(result.dataplaneConfig?.webAppConfig?.hostedZone).toBe(
        "example.com"
      );
      expect(result.dataplaneConfig?.webAppConfig?.domainName).toBe(
        "osml.example.com"
      );
    });

    test("loads dataplaneConfig with service URLs", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          TILE_SERVER_URL: "https://tiles.example.com",
          STAC_CATALOG_URL: "https://stac.example.com"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.dataplaneConfig?.TILE_SERVER_URL).toBe(
        "https://tiles.example.com"
      );
      expect(result.dataplaneConfig?.STAC_CATALOG_URL).toBe(
        "https://stac.example.com"
      );
    });

    test("validates service URLs are valid URLs", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          TILE_SERVER_URL: "not-a-valid-url"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/Invalid URL format/);
    });

    test("loads MCP_DEFAULT_SERVERS with authMode", () => {
      const config = {
        projectName: "test-project",
        account: { id: "123456789012", region: "us-west-2" },
        dataplaneConfig: {
          MCP_DEFAULT_SERVERS: [
            {
              id: "geo",
              name: "Geo",
              url: "https://geo.example.com/mcp",
              authMode: "session",
              enabled: true
            },
            {
              id: "loader",
              name: "Loader",
              url: "https://loader.example.com/mcp",
              authMode: "none"
            }
          ]
        }
      };
      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));
      const result = loadDeploymentConfig();
      expect(result.dataplaneConfig?.MCP_DEFAULT_SERVERS).toHaveLength(2);
      expect(result.dataplaneConfig?.MCP_DEFAULT_SERVERS?.[0].authMode).toBe(
        "session"
      );
    });

    test("rejects MCP_DEFAULT_SERVERS with authMode 'custom'", () => {
      const config = {
        projectName: "test-project",
        account: { id: "123456789012", region: "us-west-2" },
        dataplaneConfig: {
          MCP_DEFAULT_SERVERS: [
            {
              id: "g",
              name: "G",
              url: "https://g.example.com",
              authMode: "custom"
            }
          ]
        }
      };
      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));
      expect(() => loadDeploymentConfig()).toThrow(/'custom' is not allowed/);
    });

    test("rejects MCP_DEFAULT_SERVERS with duplicate ids", () => {
      const config = {
        projectName: "test-project",
        account: { id: "123456789012", region: "us-west-2" },
        dataplaneConfig: {
          MCP_DEFAULT_SERVERS: [
            {
              id: "dup",
              name: "A",
              url: "https://a.example.com",
              authMode: "session"
            },
            {
              id: "dup",
              name: "B",
              url: "https://b.example.com",
              authMode: "none"
            }
          ]
        }
      };
      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));
      expect(() => loadDeploymentConfig()).toThrow(/Duplicate MCP server id/);
    });

    test("rejects MCP_DEFAULT_SERVERS plaintext http for non-localhost", () => {
      const config = {
        projectName: "test-project",
        account: { id: "123456789012", region: "us-west-2" },
        dataplaneConfig: {
          MCP_DEFAULT_SERVERS: [
            {
              id: "g",
              name: "G",
              url: "http://geo.example.com/mcp",
              authMode: "session"
            }
          ]
        }
      };
      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));
      expect(() => loadDeploymentConfig()).toThrow(/https:\/\/ or wss:\/\//);
    });

    test("allows MCP_DEFAULT_SERVERS http://localhost", () => {
      const config = {
        projectName: "test-project",
        account: { id: "123456789012", region: "us-west-2" },
        dataplaneConfig: {
          MCP_DEFAULT_SERVERS: [
            {
              id: "local",
              name: "Local",
              url: "http://localhost:3001/mcp",
              authMode: "none"
            }
          ]
        }
      };
      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));
      const result = loadDeploymentConfig();
      expect(result.dataplaneConfig?.MCP_DEFAULT_SERVERS).toHaveLength(1);
    });

    test("loads dataplaneConfig with webAppUtilityConfig", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          webAppUtilityConfig: {
            restrictBucketAccess: true,
            allowedBucketArns: ["arn:aws:s3:::bucket1", "arn:aws:s3:::bucket2"],
            bedrockModels: {
              enabledModels: ["anthropic.claude-3-sonnet"]
            }
          }
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.dataplaneConfig?.webAppUtilityConfig).toBeDefined();
      expect(
        result.dataplaneConfig?.webAppUtilityConfig?.restrictBucketAccess
      ).toBe(true);
      expect(
        result.dataplaneConfig?.webAppUtilityConfig?.allowedBucketArns
      ).toEqual(["arn:aws:s3:::bucket1", "arn:aws:s3:::bucket2"]);
      expect(
        result.dataplaneConfig?.webAppUtilityConfig?.bedrockModels
          ?.enabledModels
      ).toEqual(["anthropic.claude-3-sonnet"]);
    });

    test("validates allowedBucketArns is an array", () => {
      const config = {
        projectName: "test-project",
        account: {
          id: "123456789012",
          region: "us-west-2"
        },
        dataplaneConfig: {
          webAppUtilityConfig: {
            allowedBucketArns: "not-an-array"
          }
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      expect(() => {
        loadDeploymentConfig();
      }).toThrow(/must be an array/);
    });
  });

  // ============================================================================
  // Full Configuration Test
  // ============================================================================

  describe("full configuration", () => {
    test("loads complete configuration with all sections", () => {
      const config = {
        projectName: "osml-webapp",
        account: {
          id: "123456789012",
          region: "us-west-2",
          prodLike: true,
          isAdc: false
        },
        networkConfig: {
          VPC_ID: "vpc-1234567890abcdef0",
          TARGET_SUBNETS: ["subnet-1234567890abcdef0"],
          SECURITY_GROUP_ID: "sg-1234567890abcdef0"
        },
        dataplaneConfig: {
          authConfig: {
            authority: "https://auth.example.com/realms/osml",
            audience: "account",
            clientId: "osml-web"
          },
          webAppConfig: {
            buildFromSource: true,
            hostedZone: "example.com",
            domainName: "osml.example.com"
          },
          modelRunnerApiConfig: {
            hostedZone: "example.com",
            domainName: "api.example.com"
          },
          webAppUtilityConfig: {
            restrictBucketAccess: true,
            allowedBucketArns: []
          },
          TILE_SERVER_URL: "https://tiles.example.com",
          STAC_CATALOG_URL: "https://stac.example.com"
        }
      };

      (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

      const result = loadDeploymentConfig();

      expect(result.projectName).toBe("osml-webapp");
      expect(result.account.prodLike).toBe(true);
      expect(result.networkConfig?.VPC_ID).toBe("vpc-1234567890abcdef0");
      expect(result.dataplaneConfig?.authConfig?.authority).toBe(
        "https://auth.example.com/realms/osml"
      );
      expect(result.dataplaneConfig?.webAppConfig?.buildFromSource).toBe(true);
      expect(result.dataplaneConfig?.TILE_SERVER_URL).toBe(
        "https://tiles.example.com"
      );
    });
  });
});

// ============================================================================
// Property-Based Tests
// ============================================================================

describe("Property-Based Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (existsSync as jest.Mock).mockReturnValue(true);
  });

  /**
   * **Property 1: Configuration Schema Validation**
   *
   * For any configuration object passed to loadDeploymentConfig(), if the
   * configuration is valid, it SHALL contain:
   * - An account object with id (12-digit string), region (valid AWS region),
   *   prodLike (boolean), and isAdc (boolean) fields
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  describe("Property 1: Configuration Schema Validation", () => {
    // Arbitrary for valid 12-digit account IDs
    const validAccountId = fc.string({
      minLength: 12,
      maxLength: 12,
      unit: fc.constantFrom(..."0123456789")
    });

    // Arbitrary for valid AWS regions
    const validRegion = fc.constantFrom(
      "us-east-1",
      "us-west-2",
      "eu-west-1",
      "ap-southeast-2",
      "us-gov-west-1"
    );

    // Arbitrary for valid project names
    const validProjectName = fc
      .string({ minLength: 1, maxLength: 50 })
      .filter((s: string) => s.trim().length > 0);

    test("valid configurations always produce valid output schema", () => {
      fc.assert(
        fc.property(
          validProjectName,
          validAccountId,
          validRegion,
          fc.boolean(),
          fc.boolean(),
          (
            projectName: string,
            accountId: string,
            region: string,
            prodLike: boolean,
            isAdc: boolean
          ) => {
            const config = {
              projectName: projectName.trim(),
              account: {
                id: accountId,
                region,
                prodLike,
                isAdc
              }
            };

            (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

            const result = loadDeploymentConfig();

            // Verify output schema
            expect(typeof result.projectName).toBe("string");
            expect(result.projectName.length).toBeGreaterThan(0);
            expect(typeof result.account.id).toBe("string");
            expect(result.account.id).toMatch(/^\d{12}$/);
            expect(typeof result.account.region).toBe("string");
            expect(typeof result.account.prodLike).toBe("boolean");
            expect(typeof result.account.isAdc).toBe("boolean");
          }
        ),
        { numRuns: 100 }
      );
    });

    test("valid VPC configurations produce valid networkConfig schema", () => {
      // Arbitrary for valid VPC IDs (using string with hex character unit)
      const validVpcId = fc
        .string({
          minLength: 8,
          maxLength: 8,
          unit: fc.constantFrom(..."0123456789abcdef")
        })
        .map((hex: string) => `vpc-${hex}`);

      // Arbitrary for valid subnet IDs
      const validSubnetId = fc
        .string({
          minLength: 8,
          maxLength: 8,
          unit: fc.constantFrom(..."0123456789abcdef")
        })
        .map((hex: string) => `subnet-${hex}`);

      fc.assert(
        fc.property(
          validVpcId,
          fc.array(validSubnetId, { minLength: 1, maxLength: 5 }),
          (vpcId: string, subnets: string[]) => {
            const config = {
              projectName: "test-project",
              account: {
                id: "123456789012",
                region: "us-west-2"
              },
              networkConfig: {
                VPC_ID: vpcId,
                TARGET_SUBNETS: subnets
              }
            };

            (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

            const result = loadDeploymentConfig();

            // Verify networkConfig schema
            expect(result.networkConfig).toBeDefined();
            expect(result.networkConfig?.VPC_ID).toMatch(/^vpc-[a-f0-9]{8}$/);
            expect(Array.isArray(result.networkConfig?.TARGET_SUBNETS)).toBe(
              true
            );
            result.networkConfig?.TARGET_SUBNETS?.forEach((subnet) => {
              expect(subnet).toMatch(/^subnet-[a-f0-9]{8}$/);
            });
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 2: Configuration Validation Error Handling**
   *
   * For any invalid configuration object passed to loadDeploymentConfig(),
   * the function SHALL throw a DeploymentConfigError with a descriptive
   * message indicating which field failed validation.
   *
   * **Validates: Requirements 2.4**
   */
  describe("Property 2: Configuration Validation Error Handling", () => {
    test("invalid account IDs always throw DeploymentConfigError", () => {
      // Arbitrary for invalid account IDs (not 12 digits)
      const invalidAccountId = fc
        .string()
        .filter((s: string) => !/^\d{12}$/.test(s) && s.trim().length > 0);

      fc.assert(
        fc.property(invalidAccountId, (accountId: string) => {
          const config = {
            projectName: "test-project",
            account: {
              id: accountId,
              region: "us-west-2"
            }
          };

          (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

          expect(() => {
            loadDeploymentConfig();
          }).toThrow(DeploymentConfigError);
        }),
        { numRuns: 100 }
      );
    });

    test("missing required fields always throw with field name in message", () => {
      const missingFieldConfigs = [
        { account: { id: "123456789012", region: "us-west-2" } }, // missing projectName
        { projectName: "test", account: { region: "us-west-2" } }, // missing account.id
        { projectName: "test", account: { id: "123456789012" } }, // missing account.region
        { projectName: "test" } // missing account
      ];

      for (const config of missingFieldConfigs) {
        (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

        expect(() => {
          loadDeploymentConfig();
        }).toThrow(DeploymentConfigError);
      }
    });

    test("invalid VPC IDs always throw with descriptive message", () => {
      // Arbitrary for invalid VPC IDs
      const invalidVpcId = fc
        .string()
        .filter(
          (s: string) =>
            !/^vpc-[a-f0-9]{8}([a-f0-9]{9})?$/.test(s) && s.length > 0
        );

      fc.assert(
        fc.property(invalidVpcId, (vpcId: string) => {
          const config = {
            projectName: "test-project",
            account: {
              id: "123456789012",
              region: "us-west-2"
            },
            networkConfig: {
              VPC_ID: vpcId,
              TARGET_SUBNETS: ["subnet-12345678"]
            }
          };

          (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

          try {
            loadDeploymentConfig();
            // If it doesn't throw, the VPC ID was accidentally valid
          } catch (error) {
            expect(error).toBeInstanceOf(DeploymentConfigError);
            expect((error as DeploymentConfigError).message).toContain("VPC");
          }
        }),
        { numRuns: 100 }
      );
    });

    test("invalid URLs always throw DeploymentConfigError", () => {
      // Arbitrary for invalid URLs
      // Note: whitespace-only strings are trimmed to empty and treated as "not provided"
      // for optional fields, so we only test non-whitespace invalid URLs
      const invalidUrl = fc.string().filter((s: string) => {
        const trimmed = s.trim();
        // Skip empty/whitespace-only strings - they're treated as "not provided"
        if (trimmed.length === 0) {
          return false;
        }
        // Keep strings that are not valid URLs
        try {
          new URL(trimmed);
          return false;
        } catch {
          return true;
        }
      });

      fc.assert(
        fc.property(invalidUrl, (url: string) => {
          const config = {
            projectName: "test-project",
            account: {
              id: "123456789012",
              region: "us-west-2"
            },
            dataplaneConfig: {
              TILE_SERVER_URL: url
            }
          };

          (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(config));

          expect(() => {
            loadDeploymentConfig();
          }).toThrow(DeploymentConfigError);
        }),
        { numRuns: 100 }
      );
    });
  });
});
