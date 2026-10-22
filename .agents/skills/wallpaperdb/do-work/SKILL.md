---
name: do-work
description: Implement one issue in the supplied checkout, review it, and publish a PR.
---

Use the existing checkout. If given a predecessor PR, stack your PR on it.

1. **Understand.** Read the issue and comments, inspect the relevant code, and clarify missing requirements. Follow the [issue workflow](../../../../docs/agents/issue-tracker.md) for claiming, dependency readiness, and `In Progress` status.
2. **Plan.** Make an implementation checklist.
3. **Implement and commit.** Use $tdd and $development-principles. Work in small increments; check, format, and commit each before starting the next.
4. **Validate.** Run [`make ci`](../../../../CONTRIBUTING.md#check-a-change) and fix failures. Use $testing for focused checks and E2E guidance.
5. **Review and fix.** Run separate read-only subagents in parallel, one using $code-review and one using $review-agent, against the same complete issue change. Compare against the predecessor PR when supplied, otherwise the default base. Verify findings, fix all confirmed issues with new commits, and repeat validation and both reviews until no unresolved findings remain. Unavailable or failed reviewers leave this step incomplete.
6. **Open a PR.** Follow the [PR history policy](../../../../CONTRIBUTING.md#pull-request-history). Use $pr and $github-markdown-bodies to publish automatically, stacking on the predecessor PR when supplied. Include the issue's closing reference, validation, and review results. Record feature demonstrations and attach them with $pr-video-attachment, or explain why a recording is inapplicable. Link the PR in T3 and record its URL and tested commit in the issue. Verify `In Review` for ready PRs; drafts stay `In Progress`. Leave the issue open until landing.
