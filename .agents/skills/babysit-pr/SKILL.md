---
name: babysit-pr
description: Monitor a pull request until CI passes and Codex approves its current head, fixing review feedback and CI regressions and tracking pre-existing flaky tests. Use when asked to babysit or monitor a PR through CI and Codex review.
---

# Babysit a PR

An invocation authorizes tested fixes and pushes to the selected PR, review replies and reactions, thread resolution, Codex review requests, failed-job reruns, and GitHub issues for proven pre-existing flaky tests. Honor user-specified scope and retry limits. Completion hands the PR back to the user without merging it.

## 1. Establish the target and retain progress

Identify the repository and PR from the request or current branch. Ask when ambiguous. Fetch its actual head branch and preserve unrelated local changes. Register the PR with the current thread using `link_pull_request` when available.

Read the PR diff, current head SHA, all CI checks and workflow runs, and all review feedback. Use [fix-pr-review-comments](../fix-pr-review-comments/SKILL.md) for feedback discovery and handling, including pagination and review summaries outside threads.

Keep a ledger in session state or outside the repository. Retain the PR URL and head SHA, comment IDs and handling outcomes, delivered fix commits, CI failure evidence, reruns per failure and head, Codex requests and results per head, and flaky-test issue URLs. Resume this ledger on every monitoring wake so counts and retries survive across turns.

## 2. Handle review feedback

Invoke [fix-pr-review-comments](../fix-pr-review-comments/SKILL.md) for each batch of unhandled actionable feedback. Its verification, incremental commits, checks, replies, reactions, and resolution rules govern the batch. An outdated comment or an existing reaction alone does not establish completion.

Record each actionable comment whose concern was fixed by a verified change pushed during this babysitting session. Count each comment ID once, including distinct comments reporting the same defect. Track invalid feedback and concerns already fixed before this session separately; neither increases the number of comments fixed. CI-only fixes do not increase this count.

Mixed or uncertain verdicts require the user's answer under that skill. Finish independent work, then return the pending question and incomplete status to the user. A disputed finding that Codex continues to reject also needs the user's decision rather than an endless fix-and-review loop.

## 3. Diagnose and handle CI failures

Inspect failed-job logs and artifacts before retrying. Use [diagnosing-bugs](../diagnosing-bugs/SKILL.md), [development-principles](../development-principles/SKILL.md), and [testing](../testing/SKILL.md) for diagnosis, changes, and focused Make checks. Publish tested fixes to the PR's actual head branch using [do-work](../do-work/SKILL.md)'s publishing and history checks.

Fix failures caused by this PR, including failures in tests that existed before it. Classify a failure as a pre-existing flaky test only with evidence of intermittent behavior and evidence that the PR did not cause it. Compare the diff and use base-branch reproduction or matching historical failures where practical. An unchanged test, a single successful rerun, or inability to reproduce does not establish that classification. Escalate uncertain causes with the evidence gathered.

For a proven pre-existing flaky test, search GitHub issues for the same failure. Reuse a matching issue, or create one with the test name, failure signature, failing run and job links, affected commit, intermittent-failure evidence, and evidence that the PR did not introduce it. Follow [issue-tracker](../../../docs/agents/issue-tracker.md), use `needs-triage` for a new issue, and apply [github-markdown-bodies](../github-markdown-bodies/SKILL.md) when publishing bodies. Retain the issue URL in the ledger.

Rerun only failed jobs after recording the issue. By default, allow at most two reruns for the same failure on the same commit; the user may specify a different limit. Repeated occurrences across jobs or monitoring wakes share that budget. A new CI failure needs diagnosis rather than automatic classification as the same flake. If the budget is exhausted and CI remains red, return a blocker. Filing an issue does not satisfy the CI gate, and passing on retry does not remove the issue from the final report.

Permission failures and infrastructure failures require a concrete blocker report when the agent cannot remedy them within the authorized scope.

## 4. Obtain Codex approval of the current head

In this repository, Codex findings can appear as inline comments and reviews with state `COMMENTED`. Clean outcomes use conversation comments and a thumbs-up reaction on the PR itself from `chatgpt-codex-connector[bot]`. Some GraphQL and `gh pr view` results expose the login as `chatgpt-codex-connector`.

Read conversation comments, reviews, threads, and PR-level reactions. Use GitHub's [list reactions for an issue API](https://docs.github.com/en/rest/reactions/reactions#list-reactions-for-an-issue) for PR-level reactions; follow its pagination and match both the bot identity and `+1` content. Reactions on individual comments are separate from approval of the PR.

Approval requires all of the following:

- The latest code-review result is clean and covers the current head.
- The latest security-review result is clean and covers the current head.
- The Codex bot's thumbs-up reaction on the PR itself.
- Every actionable finding handled according to fix-pr-review-comments, with no pending questions or undelivered fixes.

Use the reviewed commit in results or the corresponding review-summary row to match each result to the full current SHA. Verify abbreviated SHAs identify that commit. A newer review round that is pending or reports findings supersedes an older clean result, even on the same head. A summary marked `Completed` can contain findings; it establishes completion, not a clean result. A PR-level reaction has no commit SHA, so it cannot establish current-head approval by itself. After every push, require fresh results covering the new head.

[PR #322](https://github.com/rafaeltab/wallpaperdb/pull/322) demonstrates clean code and security comments and a PR-level thumbs up after a [manual request](https://github.com/rafaeltab/wallpaperdb/pull/322#issuecomment-5974572590). [PR #335's summary](https://github.com/rafaeltab/wallpaperdb/pull/335#issuecomment-6103790405) demonstrates completed reviews that still reported findings.

Inspect existing requests and review status before posting. New commits can trigger review automatically. After handling feedback, if current-head approval evidence is missing and no corresponding review is running or pending, post `@codex review` with the full current head SHA, using [github-markdown-bodies](../github-markdown-bodies/SKILL.md). Record the request with its head and feedback batch, and avoid duplicate requests for that review round on later wakes. Review fixes may require a manual request for a fresh clean result, including when feedback was handled without changing the head. Escalate an ignored request, stalled review, or unavailable integration with its last known status rather than repeatedly requesting it.

## 5. Monitor until the gates hold

Refresh the PR head and latest applicable check attempts after each fix or wake. Require all applicable CI checks to pass, including checks that are not required by branch protection. Pending, failed, cancelled, or timed-out applicable checks leave the gate incomplete. Historical failed attempts superseded by a passing rerun do not keep the gate red.

Read workflow configuration at the current head to establish which workflows and jobs should run. An intentional exclusion or conditional skip is acceptable only when that check is inapplicable to these changes. This repo's [CI](../../../.github/workflows/ci.yml) and [E2E](../../../.github/workflows/e2e.yml) workflows exclude Markdown-only changes. When no CI applies, report "CI not required for these changes." An empty check list alone is insufficient evidence of an intentional exclusion. Missing expected runs require investigation.

When T3's `watch_pull_request` is available, handle existing feedback and failures first, then call it and end the turn while waiting. T3 wakes the thread for CI and review activity; a wake requires refreshing GitHub state and evaluating both gates again. Use this watcher instead of polling or running a separate watcher. Preserve progress in the ledger before yielding. If it is unavailable, use a resumable monitoring mechanism available in the environment or bounded polling waits of at most 60 seconds with progress updates. Report inability to continue monitoring as a blocker.

There is no fixed deadline while runs are progressing. Investigate evidence of stalled or missing CI and review runs, and return an actionable blocker when progress needs the user. A closed or merged PR ends babysitting. Perform the handoff cleanup below, then report its actual state and which gates were verified.

## 6. Verify and hand back

Before reporting success, re-fetch the PR head, latest CI results, Codex results and reaction, and feedback state. Both gates must hold for the same current head. If the head changed during verification, repeat the check for the new head.

Before every terminal handoff, including success, blockers, pending user questions, and a closed or merged PR, call `unwatch_pull_request` when available so the thread returns to the user's inbox. Perform this cleanup explicitly rather than relying on automatic watcher cleanup. Check `list_thread_pull_requests` and register the selected PR if its link is missing. Report watcher or linking errors accurately.

Return a concise summary containing:

- The PR link and whether babysitting completed or needs the user.
- The number of review comments fixed during this session, with fix commits or comment links supporting the count.
- Whether CI passed, was intentionally unnecessary, or remains blocked.
- Whether Codex approved the current head, identifying that head and linking the code and security results.
- Every flaky-test issue URL created or reused, even if CI later passed.
- Any pending question, exhausted retry budget, or failed operation when incomplete.
