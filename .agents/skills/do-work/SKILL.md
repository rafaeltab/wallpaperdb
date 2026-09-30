---
name: do-work
description: Structured workflow for implementing tasks. Use when the user asks you to implement, build, or make changes to the codebase, or when a task requires more than a single quick fix.
---

# Do Work

## Steps

### 1. Understand

Gather context. Read relevant files, search the codebase, and clarify ambiguities before proceeding.

### 2. Plan

Create a todo list of the implementation steps.

### 3. Implement and Commit

When changing code, use TDD for each small behavior change: write one test through the relevant public interface, run it and confirm it fails, write the minimum code to make it pass, then refactor while keeping tests green. Repeat this cycle for the next behavior.

Make small, focused changes following existing code conventions and patterns. After each increment, run the relevant checks and format the affected code with the applicable Make target, then commit that increment with a descriptive message before starting the next one. Keep unrelated work out of each commit.

### 4. Validate

```sh
make ci
```

This runs build, lint, and all tests. Fix any failures before continuing.

### 5. Open a PR

For each feature touched, exercise the completed feature in a browser and record a short video showing it working. Put the video in the PR description as a playable attachment or link, with enough context to identify the feature. If a browser demonstration is genuinely impossible, explain why in the PR.

Before pushing or updating a stack, fetch its trunk and check each layer against the head that will be published immediately below it. `git merge-base --is-ancestor <base-head> <layer-head>` must succeed, and `git rev-list --count --min-parents=2 <base-head>..<layer-head>` must return `0`. If either check fails, rebase that layer and its descendants, then check every layer again. Repeat after changes to the trunk or a lower layer. After publishing, inspect GitHub's native stack status. Report the stack as merge-ready only when each layer is ready there; ordinary PR mergeability alone is insufficient.

Push the completed branch and open a PR automatically. Summarize the changes, link the relevant issue when there is one, and report the validation performed. Use the github-markdown-bodies skill for the PR description and [pr-video-attachment](../pr-video-attachment/SKILL.md) for each recording. Confirm the PR renders each video and that reviewers can access it.
