#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates.

/**
 * Patches the CDK's CloudAssembly.cleanupTemporaryDirectories to handle
 * EACCES errors gracefully.
 *
 * The @aws-cdk/cloud-assembly-api package registers a process.on("exit")
 * handler that calls rmSync on temporary cloud assembly directories. Docker
 * bundling creates root-owned files in those directories, causing EACCES
 * when the handler tries to delete them.
 *
 * This script patches the specific rmSync calls inside cleanupTemporaryDirectories
 * to wrap them in a try/catch that ignores EACCES.
 */

const fs = require("fs");
const path = require("path");

function patchFile(filePath, label) {
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, "utf8");

  // Already patched?
  if (content.includes("if (e.code !== 'EACCES') throw e;")) {
    console.log(`patch-cdk-cleanup: ${label} already patched`);
    return true;
  }

  // Find the cleanupTemporaryDirectories method and patch the rmSync inside it.
  // We look for the specific pattern: the method name followed by the rmSync call.
  // This is safer than a global regex replacement.
  const methodPattern =
    /static cleanupTemporaryDirectories\(\)\s*\{[^}]*?(\w+)\.rmSync\(dir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\);/g;

  let patched = false;
  content = content.replace(methodPattern, (match, fsVar) => {
    patched = true;
    return match.replace(
      `${fsVar}.rmSync(dir, { recursive: true, force: true });`,
      `try { ${fsVar}.rmSync(dir, { recursive: true, force: true }); } catch(e) { if (e.code !== 'EACCES') throw e; }`
    );
  });

  if (patched) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`patch-cdk-cleanup: ${label} patched`);
    return true;
  }

  console.log(
    `patch-cdk-cleanup: ${label} - cleanupTemporaryDirectories not found`
  );
  return false;
}

const files = [
  [
    path.join(
      __dirname,
      "..",
      "node_modules",
      "aws-cdk-lib",
      "node_modules",
      "@aws-cdk",
      "cloud-assembly-api",
      "lib",
      "cloud-assembly.js"
    ),
    "cloud-assembly-api"
  ],
  [
    path.join(__dirname, "..", "node_modules", "aws-cdk", "lib", "index.js"),
    "aws-cdk CLI"
  ]
];

let count = 0;
for (const [file, label] of files) {
  if (patchFile(file, label)) count++;
}

console.log(`patch-cdk-cleanup: done (${count} file(s))`);
