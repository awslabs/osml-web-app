// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for mcp-server-validation.ts. Covers scheme rules, default allowlist,
 * env-driven allowlist override, malformed-pattern fallback, and the local://
 * pseudo-scheme used by the bundled local viewport server.
 */

// Mock siteConfig before importing the validator. Each test that needs a
// different allowlist value resets modules and re-mocks.
function setHostAllowlist(value: string) {
  jest.resetModules();
  jest.doMock("@/config/site", () => ({
    siteConfig: {
      mcp: {
        hostAllowlist: value
      }
    }
  }));
}

// Helper to load the validator with a fresh allowlist cache
function loadValidator() {
  return require("@/utils/mcp-server-validation") as typeof import("@/utils/mcp-server-validation");
}

describe("validateMcpServerUrl", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe("input validation", () => {
    it("rejects empty input", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/required/i);
    });

    it("rejects malformed URLs", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("not a url");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/valid absolute URL/i);
    });

    it("trims surrounding whitespace before validating", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("  https://geo.amazonaws.com/mcp  ");
      expect(result.ok).toBe(true);
    });
  });

  describe("scheme rules (non-overrideable)", () => {
    it("allows local:// regardless of allowlist", () => {
      setHostAllowlist("none.example.com");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("local://viewport").ok).toBe(true);
    });

    it("rejects unsupported schemes like file://", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("file:///etc/passwd");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/scheme/i);
    });

    it("rejects http:// for non-localhost hosts even when host is allowlisted", () => {
      setHostAllowlist("*.amazonaws.com");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("http://geo.amazonaws.com/mcp");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Plaintext/i);
    });

    it("rejects ws:// for non-localhost hosts", () => {
      setHostAllowlist("*.amazonaws.com");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("ws://geo.amazonaws.com/mcp");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Plaintext/i);
    });

    it("allows http://localhost", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("http://localhost:3001/mcp").ok).toBe(true);
    });

    it("allows http://127.0.0.1", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("http://127.0.0.1:3001/mcp").ok).toBe(true);
    });

    it("allows ws://localhost", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("ws://localhost:3001/mcp").ok).toBe(true);
    });

    it("allows https:// even when host is non-localhost", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://api.amazonaws.com/mcp").ok).toBe(
        true
      );
    });

    it("enforces HTTPS even when allowlist is '*'", () => {
      // '*' is the maximally permissive allowlist value but plaintext rules
      // remain non-overrideable for non-localhost hosts.
      setHostAllowlist("*");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("http://anything.example.com/mcp");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Plaintext/i);
    });
  });

  describe("default allowlist (env unset)", () => {
    it("allows *.amazonaws.com subdomains", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://geo.amazonaws.com/mcp").ok).toBe(
        true
      );
    });

    it("allows *.aws.dev subdomains", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://team.aws.dev/mcp").ok).toBe(true);
    });

    it("allows *.amazon.com subdomains", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://internal.amazon.com/mcp").ok).toBe(
        true
      );
    });

    it("rejects hosts not in the default allowlist", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("https://attacker.example.com/mcp");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/allowlist/i);
    });

    it("returns isExternal=false for localhost", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("http://localhost:3001/mcp").isExternal).toBe(
        false
      );
    });

    it("returns isExternal=true for non-loopback hosts", () => {
      setHostAllowlist("");
      const { validateMcpServerUrl } = loadValidator();
      expect(
        validateMcpServerUrl("https://geo.amazonaws.com/mcp").isExternal
      ).toBe(true);
    });
  });

  describe("subdomain wildcard semantics", () => {
    it("does NOT match the bare apex of a wildcard pattern", () => {
      // *.foo.com matches foo.com subdomains but not foo.com itself.
      setHostAllowlist("*.amazonaws.com");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("https://amazonaws.com/mcp");
      expect(result.ok).toBe(false);
    });

    it("matches multi-level subdomains", () => {
      setHostAllowlist("*.amazonaws.com");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://a.b.c.amazonaws.com/mcp").ok).toBe(
        true
      );
    });

    it("does not match suffix-only collisions", () => {
      // "evilamazonaws.com" must not match "*.amazonaws.com".
      setHostAllowlist("*.amazonaws.com");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("https://evilamazonaws.com/mcp");
      expect(result.ok).toBe(false);
    });
  });

  describe("env-driven override REPLACES default", () => {
    it("rejects default-allowlist hosts when env replaces with custom list", () => {
      setHostAllowlist("only.example.com");
      const { validateMcpServerUrl } = loadValidator();
      const result = validateMcpServerUrl("https://geo.amazonaws.com/mcp");
      expect(result.ok).toBe(false);
    });

    it("accepts custom hosts set via env", () => {
      setHostAllowlist("only.example.com");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://only.example.com/mcp").ok).toBe(
        true
      );
    });

    it("supports comma-separated lists with whitespace", () => {
      setHostAllowlist(" *.foo.com , bar.com ");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://api.foo.com/mcp").ok).toBe(true);
      expect(validateMcpServerUrl("https://bar.com/mcp").ok).toBe(true);
      expect(validateMcpServerUrl("https://other.com/mcp").ok).toBe(false);
    });

    it("'*' allows any host", () => {
      setHostAllowlist("*");
      const { validateMcpServerUrl } = loadValidator();
      expect(validateMcpServerUrl("https://anything.example.com/mcp").ok).toBe(
        true
      );
    });
  });

  describe("malformed override falls back to defaults", () => {
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("falls back when patterns contain interior wildcards", () => {
      setHostAllowlist("*.*");
      const { validateMcpServerUrl } = loadValidator();
      // Default list still applies
      expect(validateMcpServerUrl("https://geo.amazonaws.com/mcp").ok).toBe(
        true
      );
      expect(warnSpy).toHaveBeenCalled();
    });

    it("falls back when one entry is malformed (all-or-nothing)", () => {
      setHostAllowlist("good.example.com,*evil*");
      const { validateMcpServerUrl } = loadValidator();
      // Both entries discarded; default list applies
      expect(validateMcpServerUrl("https://good.example.com/mcp").ok).toBe(
        false
      );
      expect(validateMcpServerUrl("https://geo.amazonaws.com/mcp").ok).toBe(
        true
      );
    });
  });
});
