import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createPullRequest(
  branch: string,
  implementCommitCount: number,
  reviewCommitCount: number,
  configuredBaseBranch?: string,
): void {
  const baseBranch = getDefaultBranch(configuredBaseBranch);
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
      ["pr", "create", "--base", baseBranch, "--head", branch, "--title", `Sandcastle: ${branch}`, "--body-file", bodyFile],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
    console.log(`Pull request created: ${prUrl}`);
  } finally {
    rmSync(bodyDir, { recursive: true, force: true });
  }
}

function getDefaultBranch(configuredBaseBranch?: string): string {
  if (configuredBaseBranch) return configuredBaseBranch;

  try {
    return execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().replace(/^origin\//, "");
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
