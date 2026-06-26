// Sequential Sandcastle loop for WallpaperDB.
//
// Workflow per iteration:
//   1. Create a Docker-backed Sandcastle sandbox on a fresh branch.
//   2. Run OpenCode as the implementation agent for one GitHub issue.
//   3. Run OpenCode again as the review/fix agent on the same branch.
//   4. The prompts require the agents to run the full `make ci` suite inside the sandbox.
//
// Usage:
//   pnpm sandcastle

import { homedir } from "node:os";

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const MAX_ITERATIONS = Number(process.env.SANDCASTLE_MAX_ITERATIONS ?? "10");
const MODEL = process.env.SANDCASTLE_OPENCODE_MODEL ?? "openai/gpt-5.5";
const IMAGE_NAME = process.env.SANDCASTLE_IMAGE_NAME ?? "wallpaperdb-sandcastle:opencode";
const WALLPAPERDB_CONFIG_DIR = process.env.WALLPAPERDB_CONFIG_DIR ?? `${homedir()}/.config/wallpaperdb`;

const sandboxProvider = docker({
  imageName: IMAGE_NAME,
  network: "host",
  env: {
    CI: "true",
    DOCKER_HOST: "tcp://127.0.0.1:2375",
  },
  mounts: [
    // Reuse the host OpenCode OAuth subscription credential inside the sandbox.
    // Mount only auth.json; OpenCode still needs its data dir writable for repo metadata.
    {
      hostPath: "./.sandcastle/.opencode/auth.json",
      sandboxPath: "/home/agent/.local/share/opencode/auth.json",
      readonly: true,
    },
    // Bind the shared WallpaperDB config directory so sandboxes can see the same
    // local runtime configuration as host-based tooling.
    {
      hostPath: WALLPAPERDB_CONFIG_DIR,
      sandboxPath: "/home/agent/.config/wallpaperdb",
      readonly: true,
    },
  ],
});

const hooks = {
  sandbox: {
    onSandboxReady: [
      {
        // This hook runs during sandbox creation, before any OpenCode agent is
        // started, so agents always begin from an installed workspace.
        command:
          "corepack enable && pnpm install --frozen-lockfile && docker version --format 'Docker server {{.Server.Version}}'",
        timeoutMs: 600_000,
      },
    ],
  },
};

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Sandcastle iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  const branch = `sandcastle/opencode-review/${Date.now()}`;
  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: sandboxProvider,
    hooks,
    timeouts: {
      gitSetupMs: 60_000,
      commitCollectionMs: 120_000,
    },
  });

  try {
    const implement = await sandbox.run({
      name: "implementer",
      maxIterations: 1,
      agent: sandcastle.opencode(MODEL, { agent: "build" }),
      promptFile: "./.sandcastle/implement-prompt.md",
      idleTimeoutSeconds: 1_200,
      completionTimeoutSeconds: 120,
    });

    if (!implement.commits.length) {
      console.log("Implementation agent made no commits; backlog is empty or blocked. Stopping.");
      break;
    }

    console.log(`\nImplementation complete on branch: ${branch}`);
    console.log(`Implementation commits: ${implement.commits.length}`);

    const review = await sandbox.run({
      name: "reviewer",
      maxIterations: 1,
      agent: sandcastle.opencode(MODEL, { agent: "build" }),
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs: { BRANCH: branch },
      idleTimeoutSeconds: 1_200,
      completionTimeoutSeconds: 120,
    });

    console.log(`Review complete. Review commits: ${review.commits.length}`);
    console.log(
      "The implementer/reviewer prompts require the agent to run `make ci` inside the sandbox before closing the issue.",
    );
  } finally {
    await sandbox.close();
  }
}

console.log("\nAll done.");
