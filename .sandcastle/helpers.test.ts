import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getDockerProjectName } from "./docker-resources.js";
import { buildPullRequestBody, parsePullRequestDetails } from "./github.js";
import { parsePlan } from "./plan.js";
import { prepareTurboCacheDirectory } from "./sandbox.js";

describe("parsePullRequestDetails", () => {
  it("extracts reviewer-authored pull request metadata", () => {
    expect(
      parsePullRequestDetails(`Review complete.
<pull-request>
{
  "title": "feat(web): add wallpaper favorites",
  "summary": [
    "Let signed-in users save wallpapers to their favorites.",
    "Keep favorite state synchronized across gallery views."
  ],
  "testing": ["make ci"]
}
</pull-request>
<promise>COMPLETE</promise>`),
    ).toEqual({
      title: "feat(web): add wallpaper favorites",
      summary: [
        "Let signed-in users save wallpapers to their favorites.",
        "Keep favorite state synchronized across gallery views.",
      ],
      testing: ["make ci"],
    });
  });

  it.each([
    ["missing tags", '{"title":"feat: improve output","summary":["Useful summary"],"testing":["make ci"]}'],
    ["invalid JSON", "<pull-request>not JSON</pull-request>"],
    [
      "missing fields",
      '<pull-request>{"title":"feat: improve output","summary":[],"testing":["make ci"]}</pull-request>',
    ],
  ])("rejects %s", (_case, output) => {
    expect(() => parsePullRequestDetails(output)).toThrow("Reviewer returned invalid pull request details");
  });
});

describe("buildPullRequestBody", () => {
  it("renders a useful summary, test plan, and closing issue reference", () => {
    expect(
      buildPullRequestBody(
        42,
        {
          title: "feat(web): add wallpaper favorites",
          summary: ["Let signed-in users save wallpapers.", "Synchronize favorite state across gallery views."],
          testing: ["make web-test", "make ci"],
        },
      ),
    ).toBe(`## Summary

- Let signed-in users save wallpapers.
- Synchronize favorite state across gallery views.

## Test plan

- \`make web-test\`
- \`make ci\`

Closes #42`);
  });
});

describe("parsePlan", () => {
  it("accepts valid deterministic issue plans", () => {
    expect(
      parsePlan(
        JSON.stringify({
          issues: [
            { number: 42, title: "Fix it", branch: "sandcastle/issue-42" },
            { number: 43, title: "Fix that too", branch: "sandcastle/issue-43" },
          ],
        }),
      ),
    ).toEqual([
      { number: 42, title: "Fix it", branch: "sandcastle/issue-42" },
      { number: 43, title: "Fix that too", branch: "sandcastle/issue-43" },
    ]);
  });

  it("returns an empty list for an empty backlog and rejects a mismatched branch", () => {
    expect(parsePlan('{"issues":[]}')).toEqual([]);
    expect(() =>
      parsePlan(JSON.stringify({ issues: [{ number: 42, title: "Fix it", branch: "other" }] })),
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
  it("pre-creates the shared cache under XDG_CACHE_HOME", () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wallpaperdb-turbo-cache-"));

    try {
      const cacheDir = prepareTurboCacheDirectory({
        env: { XDG_CACHE_HOME: fixtureDir },
        homeDir: join(fixtureDir, "home"),
      });

      expect(cacheDir).toBe(join(fixtureDir, "wallpaperdb", "turbo"));
      expect(existsSync(cacheDir)).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["unset", undefined],
    ["relative", "relative/cache"],
  ])("falls back to the user cache directory for an %s XDG_CACHE_HOME", (_case, xdgCacheHome) => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "wallpaperdb-turbo-cache-"));
    const homeDir = join(fixtureDir, "home");

    try {
      const cacheDir = prepareTurboCacheDirectory({
        env: { XDG_CACHE_HOME: xdgCacheHome },
        homeDir,
      });

      expect(cacheDir).toBe(join(homeDir, ".cache", "wallpaperdb", "turbo"));
      expect(existsSync(cacheDir)).toBe(true);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
