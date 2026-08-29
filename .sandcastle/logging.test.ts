import { describe, expect, it } from "vitest";

import { plannerLogging, reusableSandboxLogging } from "./logging.js";

describe("Sandcastle logging policy", () => {
  it("keeps planner output readable while reusable sandboxes stream raw events", () => {
    expect(plannerLogging).toEqual({ type: "stdout" });
    expect(reusableSandboxLogging).toEqual({ type: "stdout", verbose: true });
    expect(plannerLogging).not.toBe(reusableSandboxLogging);
  });
});
