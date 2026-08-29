// Minimal copy of the implementer path for diagnosing terminal streaming.
// It creates the normal Docker sandbox, asks OpenCode to speak/use two tools,
// and then tears the sandbox down without planning, editing, or committing.

import { execFileSync } from "node:child_process";

import * as sandcastle from "@ai-hero/sandcastle";

import { loadConfig } from "./config.js";
import { createSandboxResources } from "./sandbox.js";

const config = loadConfig();
const { sandboxProvider, hooks } = createSandboxResources(config);
const verbose = process.env.SANDCASTLE_STREAM_VERBOSE === "true";
const smokeBranch = `sandcastle/streaming-smoke-${process.pid}`;

console.log(`Starting Sandcastle streaming smoke test (verbose=${verbose})`);

const sandbox = await sandcastle.createSandbox({
  branch: smokeBranch,
  sandbox: sandboxProvider,
  hooks,
  timeouts: { gitSetupMs: 60_000, commitCollectionMs: 120_000 },
});

console.log("Sandbox prepared.");
console.log("Starting smoke implementer.");

try {
  const result = await sandbox.run({
    name: "stream-smoke-implementer",
    maxIterations: 1,
    agent: sandcastle.opencode(config.model, {
      agent: "build",
      variant: config.modelVariant,
    }),
    promptFile: "./.sandcastle/stream-smoke-prompt.md",
    logging: { type: "stdout", verbose },
    idleTimeoutSeconds: 120,
    completionTimeoutSeconds: 30,
  });

  if (!result.stdout.includes("sandcastle-stream-smoke-complete")) {
    throw new Error("Smoke implementer did not return its completion marker");
  }

  console.log("Sandcastle streaming smoke test completed.");
} finally {
  await sandbox.close();
  deleteCommitFreeSmokeBranch();
}

function deleteCommitFreeSmokeBranch(): void {
  try {
    execFileSync("git", ["branch", "--delete", smokeBranch], { stdio: "ignore" });
  } catch {
    console.warn(`Smoke branch ${smokeBranch} was preserved because Git could not delete it safely.`);
  }
}
