import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDockerProjectName } from "./docker-resources.js";
import { parsePlan } from "./plan.js";
import { prepareTurboCacheDirectory } from "./sandbox.js";

describe("parsePlan", () => {
  it("accepts a valid deterministic issue plan", () => {
    expect(
      parsePlan(JSON.stringify({ issue: { number: 42, title: "Fix it", branch: "sandcastle/issue-42", plan: "Do it" } })),
    ).toEqual({ number: 42, title: "Fix it", branch: "sandcastle/issue-42", plan: "Do it" });
  });

  it("returns undefined for an empty backlog and rejects a mismatched branch", () => {
    expect(parsePlan('{"issue":null}')).toBeUndefined();
    expect(() =>
      parsePlan(JSON.stringify({ issue: { number: 42, title: "Fix it", branch: "other", plan: "Do it" } })),
    ).toThrow("Planner returned an invalid issue plan");
  });
});

describe("getDockerProjectName", () => {
  it("sanitizes and bounds a branch for Docker resource names", () => {
    const name = getDockerProjectName("sandcastle/Issue_42!" + "x".repeat(100));
    expect(name).toMatch(/^wallpaperdb-[a-z0-9-]+$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

describe("prepareTurboCacheDirectory", () => {
  it("pre-creates one cache shared by linked worktrees", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wallpaperdb-turbo-cache-"));
    const repository = join(fixtureDir, "repository");
    const worktree = join(fixtureDir, "worktree");

    try {
      execFileSync("git", ["init", "--quiet", repository]);
      execFileSync("git", [
        "-C",
        repository,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "--quiet",
        "-m",
        "initial",
      ]);
      execFileSync("git", [
        "-C",
        repository,
        "worktree",
        "add",
        "--quiet",
        "-b",
        "cache-test",
        worktree,
      ]);

      const repositoryCache = prepareTurboCacheDirectory(repository);
      const worktreeCache = prepareTurboCacheDirectory(worktree);

      expect(worktreeCache).toBe(repositoryCache);
      expect(repositoryCache).toBe(join(repository, ".git", "sandcastle", "turbo-cache"));
      expect(existsSync(repositoryCache)).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
