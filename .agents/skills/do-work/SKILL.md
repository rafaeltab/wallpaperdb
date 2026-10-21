---
name: do-work
description: Structured workflow for implementing tasks. Use when the user asks you to implement, build, or make changes to the codebase, or when a task requires more than a single quick fix.
---

# Do Work

## Steps

### 1. Understand

Gather context. Read relevant files, search the codebase, and clarify ambiguities before proceeding.

For work tied to a GitHub issue, follow [issue claiming](../../../docs/agents/issue-tracker.md#claiming-an-issue) before planning or implementation.

### 2. Plan

Create a todo list of the implementation steps.

### 3. Implement and Commit

When changing code, use TDD for each small behavior change: write one test through the relevant public interface, run it and confirm it fails, write the minimum code to make it pass, then refactor while keeping tests green. Repeat this cycle for the next behavior.

Make small, focused changes following existing code conventions and patterns. After each increment, run the relevant checks and format the affected code with the applicable Make target, then commit that increment with a descriptive message before starting the next one. Keep unrelated work out of each commit.

### 4. Validate

```sh
make ci
```

This runs build, lint, type checks, unit and integration tests, and non-E2E coverage merging. Fix failures before continuing. GitHub Actions enforces the complete E2E suites by default. Use explicit local `make test-e2e` only when requested or needed for diagnosis or deliberate validation; follow [contributor guidance](../../../CONTRIBUTING.md#check-a-change) for prerequisites, owned automatic startup/cleanup, and the shared Docker host lock. Replace manual local E2E stack setup with that supported command.

### 5. Open a PR

For each feature touched, exercise the completed feature in a browser and record a short video showing it working. Put the video in the PR description as a playable attachment or link, with enough context to identify the feature. If a browser demonstration is genuinely impossible, explain why in the PR.

Follow the shared [PR history policy](../../../CONTRIBUTING.md#pull-request-history), including its executable check and GitHub rebaseability requirement. Before publishing a new stack, fetch its trunk and check each layer against the head that will be published immediately below it. `git merge-base --is-ancestor <base-head> <layer-head>` must succeed for those new layers. Updates to published layers preserve their history; an independent trunk advance alone does not require restacking. Restack when conflicts, changed lower layers, or native stack readiness require it, observing the shared authorization requirement for published history. After a restack, rerun Step 4 for every layer whose file tree changed since its last successful validation.

Push the completed branch and open a PR automatically. Summarize the changes, link the relevant issue when there is one, and report the validation performed. Use the github-markdown-bodies skill for the PR description and [pr-video-attachment](../pr-video-attachment/SKILL.md) for each recording. Confirm the PR renders each video and that reviewers can access it.

After publishing or updating a stack, inspect GitHub's native stack status. Report the stack as merge-ready only when each layer is ready there; ordinary PR mergeability alone is insufficient.
