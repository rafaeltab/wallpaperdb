import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Issue } from "./plan.js";

export type PullRequestDetails = {
  title: string;
  summary: string[];
  testing: string[];
};

export function parsePullRequestDetails(output: string): PullRequestDetails {
  const matches = [...output.matchAll(/<pull-request>\s*([\s\S]*?)\s*<\/pull-request>/g)];
  const json = matches.at(-1)?.[1];

  try {
    const details = JSON.parse(json ?? "") as Partial<PullRequestDetails>;
    if (
      typeof details.title !== "string" ||
      details.title.trim().length === 0 ||
      details.title.length > 72 ||
      !isNonEmptyStringArray(details.summary) ||
      !isNonEmptyStringArray(details.testing)
    ) {
      throw new Error("Invalid pull request fields");
    }

    return {
      title: details.title.trim(),
      summary: details.summary.map((item) => item.trim()),
      testing: details.testing.map((item) => item.trim()),
    };
  } catch (error) {
    throw new Error("Reviewer returned invalid pull request details", { cause: error });
  }
}

export function buildPullRequestBody(issueNumber: number, details: PullRequestDetails): string {
  const summary = details.summary.map((item) => `- ${item}`).join("\n");
  const testing = details.testing.map((item) => `- ${formatCommand(item)}`).join("\n");

  return [
    "## Summary",
    "",
    summary,
    "",
    "## Test plan",
    "",
    testing,
    "",
    `Closes #${issueNumber}`,
  ].join("\n");
}

export function createPullRequest(
  issue: Issue,
  details: PullRequestDetails,
  baseBranch: string,
): void {
  const body = buildPullRequestBody(issue.number, details);

  execFileSync("git", ["push", "--force-with-lease", "--set-upstream", "origin", issue.branch], {
    stdio: "inherit",
  });

  const bodyDir = mkdtempSync(join(tmpdir(), "wallpaperdb-sandcastle-pr-"));
  const bodyFile = join(bodyDir, "body.md");
  writeFileSync(bodyFile, body);

  try {
    const prUrl = execFileSync(
      "gh",
      [
        "pr",
        "create",
        "--base",
        baseBranch,
        "--head",
        issue.branch,
        "--title",
        details.title,
        "--body-file",
        bodyFile,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
    console.log(`Pull request created: ${prUrl}`);
  } finally {
    rmSync(bodyDir, { recursive: true, force: true });
  }
}

export function getDefaultBranch(configuredBaseBranch?: string): string {
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
    return execFileSync(
      "gh",
      ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "main";
  }
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function formatCommand(command: string): string {
  const withoutBackticks = command.replace(/^`(.*)`$/, "$1");
  return `\`${withoutBackticks}\``;
}
