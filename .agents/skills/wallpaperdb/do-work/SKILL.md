---
name: do-work
description: Implement an issue or requested change through planning, incremental commits, validation, independent reviews, and a published PR. Use when the user asks to implement, build, or change the codebase.
---

# Do Work

## Steps

### 1. Understand

Gather context. Read relevant files, search the codebase, and clarify ambiguities before proceeding.

Read the issue's full requirements and comments. Record the intended PR base branch and its exact commit before implementation. For standalone work, use the fetched default branch. When a caller supplies a ticket branch, parent branch and commit, or draft requirement, preserve those constraints throughout implementation, review, and publication. A stacked ticket starts from its supplied parent, including completed prerequisite layers.

For work tied to a GitHub issue, verify [issue claiming](../../../../docs/agents/issue-tracker.md#claiming-an-issue) and dependency readiness, then follow the [project lifecycle and CLI](../../../../docs/agents/issue-tracker.md#project-lifecycle) to set and verify `In Progress` before code edits.

### 2. Plan

Create a todo list of the implementation steps. Design planning belongs to grilling before this workflow; this checklist keeps the issue `In Progress`.

### 3. Implement and Commit

When changing code, use TDD for each small behavior change: write one test through the relevant public interface, run it and confirm it fails, write the minimum code to make it pass, then refactor while keeping tests green. Repeat this cycle for the next behavior.

Make small, focused changes following existing code conventions and patterns. After each increment, run the relevant checks and format the affected code with the applicable Make target, then commit that increment with a descriptive message before starting the next one. Keep unrelated work out of each commit.

### 4. Validate

```sh
make ci
```

This runs build, lint, type checks, unit and integration tests, and non-E2E coverage merging. Fix failures before continuing. GitHub Actions enforces the complete E2E suites by default. Use explicit local `make test-e2e` only when requested or needed for diagnosis or deliberate validation; follow [contributor guidance](../../../../CONTRIBUTING.md#check-a-change) for prerequisites, owned automatic startup/cleanup, and the shared Docker host lock. Replace manual local E2E stack setup with that supported command.

### 5. Review and fix

Commit the completed implementation and pin its head and intended parent commits. Review the complete parent-relative change, not just the last commit. Supply the issue's accepted requirements, applicable repository instructions, checkout path, and exact diff command to both reviewers.

Start two separate review subagents in parallel:

- One uses [code-review](../../engineering/code-review/SKILL.md) with the parent commit as its fixed point and the issue as its spec. It coordinates that skill's independent Standards and Spec subagents and returns both reports.
- One uses `review-agent` from the current environment's available skills. Read its `SKILL.md` and give that exact path to the reviewer. It inspects the same pinned change for actionable defects, following that skill's read-only and no-delegation rules.

Resolve both skills before starting review. An unavailable skill or failed reviewer leaves review incomplete; report the missing prerequisite instead of substituting a self-review or silently skipping it. Use available orchestration tools to run the reviewers with separate contexts. For T3 delegated rounds, retain each task ID and start a new task for every subsequent round, supplying the original brief, prior findings, fixes, and unresolved objections.

Verify every finding against the code and accepted requirements. Fix all confirmed issues with new, focused commits, using TDD for behavior changes. Record the evidence for findings that do not apply; do not silently discard them or treat a review suggestion as permission to expand the agreed scope. Rerun affected checks and Step 4 after fixes, then repeat both reviews on the resulting complete diff. Continue until both skills pass with no unresolved findings.

Record the passing parent/head commits, validation results, and both review reports. Before publication, reconcile any later rebase or change with this evidence: reuse validation only for an identical tree and reuse reviews only after verifying an identical parent-relative diff and unchanged requirements and relevant behavior from the base. Record the comparison and updated commit pair. Otherwise rerun affected validation and both reviews before publication.

### 6. Open a PR

For each feature touched, exercise the completed feature in a browser and record a short video showing it working. Put the video in the PR description as a playable attachment or link, with enough context to identify the feature. If a browser demonstration is genuinely impossible, explain why in the PR.

Follow the shared [PR history policy](../../../../CONTRIBUTING.md#pull-request-history), including its executable check and GitHub rebaseability requirement. Before publishing a new stack, fetch its trunk and check each layer against the head that will be published immediately below it. `git merge-base --is-ancestor <base-head> <layer-head>` must succeed for those new layers. Updates to published layers preserve their history; an independent trunk advance alone does not require restacking. Restack when conflicts, changed lower layers, or native stack readiness require it, observing the shared authorization requirement for published history. After a restack, rerun Step 4 for every layer whose file tree changed since its last successful validation.

Push the reviewed and validated branch and open a PR automatically against the recorded base. Honor a caller's draft requirement and stack publication rules. Summarize the changes and report the validation and both reviews. For issue work, include a closing reference such as `Closes #<number>` in the PR body. When the PR targets the default branch, read its `closingIssuesReferences` with [gh pr view](https://cli.github.com/manual/gh_pr_view) and verify the selected issue is linked for closure. For stack layers targeting another branch, follow the [retargeting and closure policy](../../../../docs/agents/issue-tracker.md#automation-and-terminal-states). Use the github-markdown-bodies skill for the PR description and [pr-video-attachment](../pr-video-attachment/SKILL.md) for each recording. Confirm the PR renders each video and that reviewers can access it.

Immediately register the PR with T3's `link_pull_request` when available. Read back its repository, head SHA, and base branch; require them to match the reviewed and validated result. Return the PR URL, branch, parent/head commits, review reports, validation, and any remaining blockers. Record the PR URL and validated commit in the issue so a spec coordinator can verify prerequisite readiness. A published PR alone does not establish that the issue is implemented. Before handoff, verify the thread's PR links with `list_thread_pull_requests` and correct missing links.

For issue work, follow the [project lifecycle](../../../../docs/agents/issue-tracker.md#project-lifecycle) to verify `In Review` after the completed PR is ready for review and before handoff. A draft PR keeps its ticket `In Progress`. Keep the issue open until verified default-branch landing; completion automation owns `Done`.

After publishing or updating a stack, inspect GitHub's native stack status. Report the stack as merge-ready only when each layer is ready there; ordinary PR mergeability alone is insufficient.
