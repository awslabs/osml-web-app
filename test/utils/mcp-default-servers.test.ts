// Copyright Amazon.com, Inc. or its affiliates.
import { parseMcpDefaultServers } from "@/utils/mcp-default-servers";

describe("parseMcpDefaultServers", () => {
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns [] for empty input", () => {
    expect(parseMcpDefaultServers("")).toEqual([]);
    expect(parseMcpDefaultServers("   ")).toEqual([]);
  });

  it("returns [] and warns on invalid JSON", () => {
    expect(parseMcpDefaultServers("{not json}")).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns [] and warns when parsed value is not an array", () => {
    expect(parseMcpDefaultServers('{"id":"x"}')).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("parses valid entries and applies defaults", () => {
    const raw = JSON.stringify([
      {
        id: "geo",
        name: "Geo",
        url: "https://geo.example.com/mcp",
        authMode: "session"
      }
    ]);
    const result = parseMcpDefaultServers(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "geo",
      name: "Geo",
      url: "https://geo.example.com/mcp",
      authMode: "session",
      enabled: true,
      connectionStatus: "active",
      autoApprovedTools: [],
      disabledTools: []
    });
  });

  it("filters out malformed entries while keeping valid ones", () => {
    const raw = JSON.stringify([
      { id: "ok", name: "OK", url: "https://ok.example.com", authMode: "none" },
      { id: "", name: "bad", url: "https://bad.example.com", authMode: "none" },
      { id: "no-mode", name: "x", url: "https://x.example.com" },
      {
        id: "bad-mode",
        name: "x",
        url: "https://x.example.com",
        authMode: "custom"
      }
    ]);
    const result = parseMcpDefaultServers(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ok");
  });

  it("respects explicit enabled=false", () => {
    const raw = JSON.stringify([
      {
        id: "geo",
        name: "Geo",
        url: "https://geo.example.com",
        authMode: "session",
        enabled: false
      }
    ]);
    const result = parseMcpDefaultServers(raw);
    expect(result[0].enabled).toBe(false);
  });
});
