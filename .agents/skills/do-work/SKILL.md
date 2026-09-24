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

Make small, focused changes following existing code conventions and patterns. After each increment, run the relevant checks and format the affected code with the applicable Make target, then commit that increment with a descriptive message before starting the next one. Keep unrelated work out of each commit.

### 4. Validate

```sh
make ci
```

This runs build, lint, and all tests. Fix any failures before continuing.

### 5. Open a PR

For each feature touched, exercise the completed feature in a browser and record a short video showing it working. Put the video in the PR description as a playable attachment or link, with enough context to identify the feature. If a browser demonstration is genuinely impossible, explain why in the PR.

Push the completed branch and open a PR automatically. Summarize the changes, link the relevant issue when there is one, and report the validation performed. Use the github-markdown-bodies skill for the PR description. Confirm the PR renders each video and that reviewers can access it.
