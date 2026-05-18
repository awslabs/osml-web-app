// Copyright Amazon.com, Inc. or its affiliates.

/**
 * JSON-serialize `value` with characters that are unsafe inside an inline
 * `<script>` tag escaped: `<`, `>`, `&`, and the line separators U+2028 /
 * U+2029.
 */
export function safeStringifyForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
