// Copyright Amazon.com, Inc. or its affiliates.
"use client";

/**
 * Bridges the live MCP `callTool` function from the connection owner
 * (AppInitializer) to its consumers (the chat tool-chain) without a
 * module-level mutable singleton.
 *
 * `callTool` is a closure bound to the active MCP connections, so it is
 * non-serializable and cannot live in Redux. Instead it is held in a ref
 * inside this context: the writer updates the ref in an effect and readers
 * get a stable wrapper that invokes whatever the current `callTool` is. The
 * serializable parts of the MCP runtime (tool catalog, tool→server map) live
 * in the Redux `mcp` slice.
 */
import {
  createContext,
  MutableRefObject,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef
} from "react";

export type McpCallTool = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<unknown>;

const McpRuntimeContext =
  createContext<MutableRefObject<McpCallTool | null> | null>(null);

export function McpRuntimeProvider({ children }: { children: ReactNode }) {
  const callToolRef = useRef<McpCallTool | null>(null);

  return (
    <McpRuntimeContext.Provider value={callToolRef}>
      {children}
    </McpRuntimeContext.Provider>
  );
}

/** Writer: keep the context's live `callTool` in sync with the connections. */
export function useSetMcpCallTool(callTool: McpCallTool | null): void {
  const ref = useContext(McpRuntimeContext);

  useEffect(() => {
    if (!ref) return;
    ref.current = callTool;
    return () => {
      ref.current = null;
    };
  }, [ref, callTool]);
}

/**
 * Reader: a stable function that invokes the current live `callTool`. Throws
 * the same "No MCP tool caller available" error as before when no connection
 * has registered a caller yet.
 */
export function useMcpCallTool(): McpCallTool {
  const ref = useContext(McpRuntimeContext);

  return useCallback(
    (toolName, args) => {
      const fn = ref?.current;
      if (!fn) throw new Error("No MCP tool caller available");
      return fn(toolName, args);
    },
    [ref]
  );
}
