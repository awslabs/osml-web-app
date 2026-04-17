// Copyright Amazon.com, Inc. or its affiliates.
/**
 * Tests for tool-registry.ts.
 * Covers tool list, lookup by name, and name enumeration.
 */

import {
  findLocalTool,
  getLocalToolNames,
  getLocalToolsList,
  LOCAL_TOOLS
} from "@/mcp/local-server/tool-registry";

describe("tool-registry", () => {
  it("LOCAL_TOOLS should contain all registered tools", () => {
    expect(LOCAL_TOOLS.length).toBeGreaterThan(0);
    // Every tool should have name, description, schema, handler
    for (const tool of LOCAL_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeDefined();
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("getLocalToolsList should return same array as LOCAL_TOOLS", () => {
    expect(getLocalToolsList()).toBe(LOCAL_TOOLS);
  });

  it("findLocalTool should find a known tool", () => {
    const tool = findLocalTool("get_viewport");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("get_viewport");
  });

  it("findLocalTool should return undefined for unknown tool", () => {
    expect(findLocalTool("nonexistent_tool")).toBeUndefined();
  });

  it("getLocalToolNames should return array of tool name strings", () => {
    const names = getLocalToolNames();
    expect(names.length).toBe(LOCAL_TOOLS.length);
    expect(names).toContain("get_viewport");
    expect(names).toContain("draw_feature");
    expect(names).toContain("list_overlay_layers");
  });

  it("should have no duplicate tool names", () => {
    const names = getLocalToolNames();
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});
