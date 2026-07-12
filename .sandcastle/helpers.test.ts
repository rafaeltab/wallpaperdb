import { describe, expect, it } from "vitest";

import { getDockerProjectName } from "./docker-resources.js";
import { parsePlan } from "./plan.js";

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
