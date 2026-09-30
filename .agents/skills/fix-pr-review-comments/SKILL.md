---
name: fix-pr-review-comments
description: Verify and handle feedback on a selected GitHub pull request, make incremental fixes, reply with evidence, react to verdicts, and resolve handled review threads. Use when asked to fix or address PR review comments.
---

# Fix PR review comments

An invocation authorizes pushing tested fixes to the selected PR, posting replies and reactions, and resolving handled review threads. Honor any narrower scope or permissions the user supplies.

## 1. Collect the feedback

Identify the repository and PR from the request or current branch. Ask when the target is ambiguous. Fetch the PR head and work on its branch, preserving unrelated local changes. Register the PR with the current thread when a PR-linking tool is available.

For GitHub discovery, replies, reactions, and thread resolution, read [references/github-operations.md](references/github-operations.md). Use available GitHub tools or `gh`; retain the original comment IDs and distinguish them from thread IDs.

Read all pages of review threads, their replies, review summaries, and PR conversation comments. By default, handle all unhandled actionable feedback. Explicit comment IDs or URLs narrow the selection, but still read the surrounding conversation. Skip resolved threads unless explicitly selected or later feedback reopens the concern. An outdated line marker does not establish that a concern is fixed.

Keep a working checklist outside the repository or in session state. For each selected comment, record its URL and ID, thread ID if present, individual claims, verdict and evidence, fix commit, checks, and publication state. A prior reaction alone does not prove the feedback was handled; inspect the replies and current code. Skip acknowledgements and other comments with no requested action.

## 2. Verify each claim

Treat feedback as a claim to investigate, including feedback from bots. Read the relevant code, the full conversation, the PR diff, and authoritative requirements. Follow [CODING_STANDARDS.md](../../../CODING_STANDARDS.md) to select applicable standards. Reproduce behavioral claims or use a focused test where practical. For documentation or policy claims, compare with the authoritative source. Distinguish a real defect or requirement from a reviewer preference, and distinguish the reported problem from the proposed fix.

Classify each comment using evidence:

| Verdict | Required handling | Reaction |
| --- | --- | --- |
| Valid | Fix the verified concern, or verify an existing fix. Explain the outcome and verification. | Thumbs up |
| Invalid | Explain why the claim does not apply, citing concrete code, requirements, or reproduction results. | Thumbs down |
| Mixed | Explain which claims are valid and invalid, then ask the user how to proceed. | None |
| Uncertain | Explain what remains unknown and ask the user for the decision or missing information. | None while uncertain |

Ask about every mixed or uncertain verdict before taking dependent action. Continue independent work while waiting. Do not infer invalidity from inability to reproduce, or treat silence as an answer. A user decision can settle the requested action without proving a factual claim. Keep that distinction in the reply. A mixed comment receives no reaction even after clarification.

The verification step is complete when every selected claim has either an evidence-backed verdict or a specific pending question for the user.

## 3. Fix in incremental commits

Apply the repository's [development-principles](../development-principles/SKILL.md) and [testing](../testing/SKILL.md) skills. For each independent fix, implement the smallest complete change, run the relevant checks and formatting through Make, then commit it before starting the next fix. Group duplicate comments reporting the same defect into that commit and map every duplicate to it. Keep unrelated fixes in separate commits.

Address the verified problem; use the reviewer's suggested implementation only if it is appropriate. If a valid concern is already fixed on the PR branch, verify the existing change and identify its commit or code location. Acknowledge it without an empty commit. Invalid feedback needs an explanation, not a code change.

Run the required checks for the completed changes before publication. Keep fixes whose verification failed pending, and report the failure. Follow the publishing and history checks in [do-work](../do-work/SKILL.md) for the existing PR. Push to the PR's actual head branch and confirm the fix commits are on the remote before reporting them as delivered.

## 4. Reply, react, and resolve

Re-read the selected conversation and PR head before publishing a verdict. Reassess changed claims or code. Reply in the existing review thread when one exists. For review summaries and standalone conversation comments, reply in the PR conversation with a link identifying the original comment. Use [github-markdown-bodies](../github-markdown-bodies/SKILL.md) for bodies and read them back after posting.

For valid feedback, reply with the fix commit or existing fix and the verification performed, then add thumbs up to the original comment. For invalid feedback, post the evidence-backed reason first, then add thumbs down to the original comment. Apply the verdict to each actionable comment, including duplicate reports, rather than reacting only to your reply or the PR itself.

If a valid comment's required fix has not passed its checks or reached the remote PR head, a status reply may explain the blocker, but defer thumbs up until delivery is verified.

Resolve a review thread only when every actionable claim in that conversation has been handled, all required fixes are verified and pushed, and the replies and required reactions succeeded. Mixed comments require the user's decision and completion of the agreed actions; they receive no reaction. Threads with uncertain claims, unanswered questions, failed checks, or failed publication stay open. Review summaries and ordinary PR comments have no thread-resolution operation; acknowledge them without claiming they were resolved.

On an API error or lost response, inspect the current remote state before retrying. Reuse an existing equivalent reply or reaction rather than duplicating it. Preserve other users' reactions. Report permission failures and unsupported operations instead of marking them complete.

## 5. Report the outcome

Re-fetch the selected comments, reactions, thread states, and PR head. Account for every selected actionable comment as handled or pending, and confirm each claimed fix is on the remote. Report the PR link, verdicts with comment links, fix commits, checks, resolved threads, and any pending user questions or failed operations. Newly posted feedback is a separate batch unless the user requested ongoing monitoring.
