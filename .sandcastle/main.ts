// Sequential Sandcastle loop for WallpaperDB: plan → implement → review → PR.
// Usage: pnpm sandcastle

import * as sandcastle from "@ai-hero/sandcastle";

import { loadConfig } from "./config.js";
import { cleanupDockerResources } from "./docker-resources.js";
import { createPullRequest } from "./github.js";
import { parsePlan } from "./plan.js";
import { createSandboxResources } from "./sandbox.js";

const config = loadConfig();
const { sandboxProvider, hooks } = createSandboxResources(config);
const streamAgentOutputToTerminal = true;
const logging = streamAgentOutputToTerminal ? ({ type: "stdout" } as const) : undefined;

for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
  console.log(`\n=== Sandcastle iteration ${iteration}/${config.maxIterations} ===\n`);

  const planning = await sandcastle.run({
    name: "planner",
    maxIterations: 1,
    sandbox: sandboxProvider,
    hooks,
    agent: sandcastle.opencode(config.model, { agent: "plan", variant: config.modelVariant }),
    promptFile: "./.sandcastle/plan-prompt.md",
    output: sandcastle.Output.string({ tag: "plan" }),
    logging,
    idleTimeoutSeconds: 1_200,
    completionTimeoutSeconds: 120,
  });

  const plannedIssue = parsePlan(planning.output);
  if (!plannedIssue) {
    console.log("Planner found no actionable issues. Stopping.");
    break;
  }

  const { branch } = plannedIssue;
  console.log(`Planning complete for #${plannedIssue.number}: ${plannedIssue.title} → ${branch}`);

  const sandbox = await sandcastle.createSandbox({
    branch,
    sandbox: sandboxProvider,
    hooks,
    timeouts: { gitSetupMs: 60_000, commitCollectionMs: 120_000 },
  });

  console.log(`Sandbox prepared.`);

  try {
    const promptArgs = {
      TASK_ID: plannedIssue.number,
      ISSUE_TITLE: plannedIssue.title,
      BRANCH: branch,
      PLAN: plannedIssue.plan,
    };

    console.log(`Starting implementer`);

    const implement = await sandbox.run({
      name: "implementer",
      maxIterations: 1,
      agent: sandcastle.opencode(config.model, { agent: "build", variant: config.modelVariant }),
      promptFile: "./.sandcastle/implement-prompt.md",
      promptArgs,
      logging,
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
      agent: sandcastle.opencode(config.model, { agent: "build", variant: config.modelVariant }),
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs,
      logging,
      idleTimeoutSeconds: 1_200,
      completionTimeoutSeconds: 120,
    });

    console.log(`Review complete. Review commits: ${review.commits.length}`);
    console.log(
      "The implementer/reviewer prompts require the agent to run `make ci` inside the sandbox before closing the issue.",
    );

    createPullRequest(branch, implement.commits.length, review.commits.length, config.prBaseBranch);
  } finally {
    cleanupDockerResources(branch, config.enableDockerCleanup);
    await sandbox.close();
  }
}

console.log("\nAll done.");
