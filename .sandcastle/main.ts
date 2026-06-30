// Sequential Sandcastle loop for WallpaperDB.
//
// Workflow per iteration:
//   1. Create a Docker-backed Sandcastle sandbox on a fresh branch.
//   2. Run OpenCode as the implementation agent for one GitHub issue.
//   3. Run OpenCode again as the review/fix agent on the same branch.
//   4. The prompts require the agents to run the full `make ci` suite inside the sandbox.
//   5. Push the completed branch and open a GitHub pull request.
//   6. Clean up Docker resources created by the sandboxed worktree.
//
// Usage:
//   pnpm sandcastle

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const MAX_ITERATIONS = Number(process.env.SANDCASTLE_MAX_ITERATIONS ?? "10");
const MODEL = process.env.SANDCASTLE_OPENCODE_MODEL ?? "openai/gpt-5.5";
const IMAGE_NAME = process.env.SANDCASTLE_IMAGE_NAME ?? "wallpaperdb-sandcastle:opencode";
const PR_BASE_BRANCH = process.env.SANDCASTLE_PR_BASE_BRANCH;
const ENABLE_DOCKER_CLEANUP = process.env.SANDCASTLE_DOCKER_CLEANUP !== "false";
const WALLPAPERDB_CONFIG_DIR = process.env.WALLPAPERDB_CONFIG_DIR ?? `${homedir()}/.config/wallpaperdb`;

loadLocalEnv(".sandcastle/.env");
loadGhTokenFromCli();

const dockerGid = getDockerGroupId();

const sandboxEnv: Record<string, string> = {
  CI: "true",
  DOCKER_HOST: "unix:///var/run/docker.sock",
};

if (process.env.GH_TOKEN) {
  sandboxEnv.GH_TOKEN = process.env.GH_TOKEN;
}

function getDockerGroupId() {
  try {
    const groupEntry = execFileSync("getent", ["group", "docker"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const gid = Number(groupEntry.split(":")[2]);

    if (Number.isInteger(gid)) {
      return gid;
    }
  } catch {
    // Fall through to Docker's common static GID in the local image.
  }

  return 999;
}

function loadLocalEnv(path: string) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadGhTokenFromCli() {
  if (process.env.GH_TOKEN) {
    return;
  }

  try {
    process.env.GH_TOKEN = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Leave GH_TOKEN unset so the failing gh command reports the auth problem.
  }
}

function getDefaultBranch() {
  if (PR_BASE_BRANCH) {
    return PR_BASE_BRANCH;
  }

  try {
    const remoteHead = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return remoteHead.replace(/^origin\//, "");
  } catch {
    // Fall through to GitHub CLI lookup for clones without origin/HEAD configured.
  }

  try {
    return execFileSync("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "main";
  }
}

function createPullRequest(branch: string, implementCommitCount: number, reviewCommitCount: number) {
  const baseBranch = getDefaultBranch();
  const title = `Sandcastle: ${branch}`;
  const body = [
    "Created automatically after a full Sandcastle implement + review cycle.",
    "",
    `Base branch: ${baseBranch}`,
    `Implementation commits: ${implementCommitCount}`,
    `Review commits: ${reviewCommitCount}`,
    "",
    "The Sandcastle prompts require `make ci` to pass inside the Docker sandbox before the issue is closed.",
  ].join("\n");

  execFileSync("git", ["push", "--force-with-lease", "--set-upstream", "origin", branch], { stdio: "inherit" });

  const bodyDir = mkdtempSync(join(tmpdir(), "wallpaperdb-sandcastle-pr-"));
  const bodyFile = join(bodyDir, "body.md");
  writeFileSync(bodyFile, body);

  try {
    const prUrl = execFileSync(
      "gh",
      ["pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body-file", bodyFile],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ).trim();

    console.log(`Pull request created: ${prUrl}`);
  } finally {
    rmSync(bodyDir, { recursive: true, force: true });
  }
}

function branchToSlug(branch: string) {
  const maxTotal = 63;
  const prefix = "wallpaperdb-";
  const maxSlugLength = maxTotal - prefix.length;

  const slug = branch
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return (slug || "worktree").slice(0, maxSlugLength);
}

function getDockerProjectName(branch: string) {
  return `wallpaperdb-${branchToSlug(branch)}`;
}

function runDockerCommand(args: string[]) {
  try {
    execFileSync("docker", args, { stdio: "inherit" });
  } catch {
    console.warn(`Docker cleanup command failed: docker ${args.join(" ")}`);
  }
}

function listDockerResourceIds(args: string[]) {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function cleanupDockerResources(branch: string) {
  if (!ENABLE_DOCKER_CLEANUP) {
    console.log("Docker cleanup disabled by SANDCASTLE_DOCKER_CLEANUP=false.");
    return;
  }

  const projectName = getDockerProjectName(branch);
  console.log(`\nCleaning Docker resources for ${projectName}`);

  for (const composeFile of ["infra/docker-compose.apps.yml", "infra/docker-compose.yml"]) {
    if (!existsSync(composeFile)) {
      continue;
    }

    runDockerCommand(["compose", "-p", projectName, "-f", composeFile, "down", "--volumes", "--remove-orphans"]);
  }

  const containerIds = listDockerResourceIds(["ps", "-aq", "--filter", `name=${projectName}`]);
  if (containerIds.length > 0) {
    runDockerCommand(["rm", "-f", "-v", ...containerIds]);
  }

  const networkIds = listDockerResourceIds(["network", "ls", "-q", "--filter", `name=${projectName}`]);
  if (networkIds.length > 0) {
    runDockerCommand(["network", "rm", ...networkIds]);
  }

  const volumeNames = listDockerResourceIds(["volume", "ls", "-q", "--filter", `name=${projectName}`]);
  if (volumeNames.length > 0) {
    runDockerCommand(["volume", "rm", "-f", ...volumeNames]);
  }
}

const sandboxProvider = docker({
  imageName: IMAGE_NAME,
  network: "host",
  env: sandboxEnv,
  groups: [dockerGid],
  mounts: [
    // Give the sandbox direct access to the host Docker daemon. The sandbox user
    // is added to the host docker socket group above so LXD/TCP proxies are not needed.
    {
      hostPath: "/var/run/docker.sock",
      sandboxPath: "/var/run/docker.sock",
      readonly: false,
    },
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
          "corepack enable && pnpm install --frozen-lockfile && node scripts/setup-worktree.mjs && docker version --format 'Docker server {{.Server.Version}}'",
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

    createPullRequest(branch, implement.commits.length, review.commits.length);
  } finally {
    cleanupDockerResources(branch);
    await sandbox.close();
  }
}

console.log("\nAll done.");
