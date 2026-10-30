---
name: fix-pr-review-comments
description: Verify and handle feedback on a selected GitHub pull request, make incremental fixes, reply with evidence, react to verdicts, and resolve handled review threads. Use when asked to fix or address PR review comments.
---

# Fix PR review comments

An invocation authorizes tested pushes, replies, reactions, and handled-thread resolution on the selected PR. Honor narrower user scope or permissions.

Apply [task scope](../../../../docs/agents/task-scope.md) when evaluating feedback, assigning fixes, and restoring prior decisions.

## 1. Collect the feedback

Identify the repository and PR from the request or current branch. Ask when the target is ambiguous. Fetch the PR head and work on its branch, preserving unrelated local changes. Register the PR with the current thread when a PR-linking tool is available.

Before substantive fixes or status updates, follow [issue selection for PR fixes](../../../../docs/agents/issue-tracker.md#selecting-issues-for-pr-fixes). Retain the owning issue's full URL for lifecycle transitions; without an associated issue, there is no project status to change.

For GitHub discovery, replies, reactions, and thread resolution, read [references/github-operations.md](references/github-operations.md). Use available GitHub tools or `gh`; retain the original comment IDs and distinguish them from thread IDs.

Read every page of review threads, replies, review summaries, and PR comments. Handle all unhandled actionable feedback unless explicit comment IDs/URLs narrow the selection; still read surrounding conversation. Skip resolved threads unless explicitly selected or reopened by later feedback. Outdated line markers do not establish a fix.

Keep a checklist in session state or outside the repository. Record each selected comment's URL/ID, thread ID, claims, verdict/evidence, fix commit, checks, and publication state. Inspect replies and current code; reactions alone do not prove handling. Skip comments requesting no action.

## 2. Verify each claim

Investigate feedback, including bots', against relevant code, conversation, PR diff, and authoritative requirements. Select standards through [CODING_STANDARDS.md](../../../../CODING_STANDARDS.md) and apply [defect verification](../testing/SKILL.md#verify-defect-fixes). Distinguish defects/requirements from preferences and the reported problem from its suggested fix.

Classify each comment using evidence:

| Verdict | Required handling | Reaction |
| --- | --- | --- |
| Valid | Fix the verified concern within the authorized scope, or verify an existing fix. Apply task scope to proposed expansions and explain their disposition. | Thumbs up after verified delivery |
| Invalid | Explain why the claim does not apply, citing concrete code, requirements, or reproduction results. | Thumbs down |
| Mixed | Explain which claims are valid and invalid, then ask the user how to proceed. | None |
| Uncertain | Explain what remains unknown and ask the user for the decision or missing information. | None while uncertain |

For mixed or uncertain verdicts, apply an existing user decision or ask before dependent action; continue independent work. Failed reproduction does not prove invalidity, and silence is not an answer. Distinguish a user's action decision from proof of a claim. Mixed comments receive no reaction, even after clarification.

The verification step is complete when every selected claim has either an evidence-backed verdict or a specific pending question for the user.

## 3. Fix in incremental commits

Follow the [project lifecycle](../../../../docs/agents/issue-tracker.md#project-lifecycle): substantive rework sets the owning issue to `In Progress`, and tested pushes to `In Review`. Investigation or monitoring alone does not change status. Keep the issue open until verified default-branch landing.

Apply [development-principles](../development-principles/SKILL.md) and [testing](../testing/SKILL.md). For each independent fix, implement the smallest complete change, check and format through Make, and commit before the next fix. Map duplicate reports to that commit; keep unrelated fixes separate.

Fix the verified problem, using the suggested implementation only when appropriate. Verify existing fixes and identify their commit or code location without empty commits. Explain invalid feedback without changing code.

Run required checks before publication; failed verification leaves fixes pending. Apply [do-work](../do-work/SKILL.md)'s validation/push steps and the [PR history policy](../../../../CONTRIBUTING.md#pull-request-history) to the existing head branch. Update the selected PR in place and confirm remote fix commits before claiming delivery.

## 4. Reply, react, and resolve

Before publishing a verdict, reread the conversation/head and reassess changed claims or code. Reply in the existing thread, or in the PR conversation with the original comment's link for summaries and standalone comments. Use [github-markdown-bodies](../github-markdown-bodies/SKILL.md) and read replies back after posting.

For valid feedback, reply with the fix and verification, then add thumbs up to the original comment. For invalid feedback, explain with evidence, then add thumbs down. Apply verdicts to every actionable comment, including duplicates.

Until a required fix passes checks and reaches the remote head, reply only with its status/blocker and defer thumbs up.

Resolve a thread only after every actionable claim is handled, required fixes are verified/pushed, and replies/reactions succeed. Mixed comments require a user decision and completed agreed actions, without a reaction. Leave uncertain claims, unanswered questions, failed checks, and failed publication open. Summaries and ordinary PR comments have no resolution operation.

After an API error or lost response, inspect remote state before retrying and reuse equivalent replies/reactions. Preserve others' reactions. Report permission failures and unsupported operations as incomplete.

## 5. Report the outcome

Re-fetch the selected comments, reactions, thread states, and PR head. Account for every selected actionable comment as handled or pending, and confirm each claimed fix is on the remote. Report the PR link, verdicts with comment links, fix commits, checks, resolved threads, and any pending user questions or failed operations. Newly posted feedback is a separate batch unless the user requested ongoing monitoring.
