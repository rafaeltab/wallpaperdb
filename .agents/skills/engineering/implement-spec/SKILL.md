---
name: implement-spec
description: "Implement all tickets under a spec sequentially in separate T3 threads and worktrees, publish a PR stack, and verify the complete spec."
disable-model-invocation: true
---

Coordinate the spec through the repository's [issue tracker](../../../../docs/agents/issue-tracker.md). Each ticket runs [do-work](../../wallpaperdb/do-work/SKILL.md) in its own ordinary T3 Code thread and separate worktree. Launch one ticket at a time and wait for its reviewed, validated, published PR before starting the next.

The bottom PR targets `main`; every later PR targets the preceding ticket's branch, including independent tickets. A single-ticket spec produces one ordinary PR. Keep ticket PRs as drafts until the complete-spec review passes. Opening PRs does not authorize merging them.

## Steps

1. Read the full spec, comments, accepted decisions, and complete sub-issue hierarchy, using pagination and the issue tracker's fallback relationships where needed. Read every implementation ticket and its blockers. Order unfinished tickets so every prerequisite precedes its dependents. Verify already-completed work on `main` before excluding it from implementation. Resolve missing prerequisites or dependency cycles before starting affected tickets. Keep the full spec as the final acceptance source; the ticket list can omit a requirement.

2. Follow [repository setup](references/setup.md) before launching work. Record the authenticated repository, selected remote, fetched `main` SHA, ticket order, and branch names outside the repository. For multiple tickets, verify native stack capability and the pinned extension; a single ticket skips extension setup and every `gh stack` command. For existing work, apply [continuation checks](references/continuation.md) instead of launching replacement threads.

3. Select the next ready ticket under the issue tracker's [dependency readiness rule](../../../../docs/agents/issue-tracker.md#relationships). For the first ticket, use the fetched `main` commit as parent. For every later ticket, fetch and verify the previous PR's published head, reviewed/validated commit, branch and base, and evidence in its issue. Verify that parent contains all prerequisite layers. Use that exact parent SHA for the next worktree; an open PR or completed thread alone is insufficient.

4. Launch an ordinary T3 conversation with `t3_thread_launch`, inheriting the coordinator's project, model, and modes. Use `workspaceStrategy: {type:"worktree", baseRef:"<verified-parent-sha>", branch:"<ticket-branch>", startFromOrigin:false}`. T3 creates and binds the worktree before its agent starts. Fetch the parent into the shared repository first. Recheck branch availability under the setup rules immediately before launch. Each ticket gets a distinct worktree; use a top-level thread, not `delegate_task`, for ticket implementation.

   Give the thread the following brief:

   - Run [do-work](../../wallpaperdb/do-work/SKILL.md) from Understand through PR publication for this ticket, including both parallel review skills and review fixes.
   - Supply context pointers to the spec, ticket, accepted decisions, prerequisite PRs and evidence, workflow sources, selected repository/remote, parent branch and full SHA, and assigned branch. If the authorized workflow is absent from the parent checkout, supply its exact source path or text so the thread still uses this version.
   - Verify its T3 worktree binding and starting parent before edits. Follow issue claiming and lifecycle rules. Preserve the supplied parent and include only this ticket's changes.
   - Publish a draft targeting the supplied parent branch, using the [stack publication rules](#publishing). Include the ticket closing reference and spec link. Leave the PR unmerged.
   - Finish with the PR URL, branch and worktree path, passing parent/head commits, both review reports, validation and demonstration evidence, and any blockers. Record the PR URL and validated commit in the ticket.

   Retain the returned thread ID immediately. Launch has no idempotency key: after an error or lost response, inspect `t3_thread_list` and the expected branch/worktree before retrying. Reuse a confirmed launch; preserve an uncertain one for investigation.

5. Follow preparation and execution with `t3_thread_read` and bounded `t3_thread_wait` calls, reading the terminal result rather than treating launch acceptance or a completed run as success. Wait for the ticket thread and its review work to finish. Verify the PR's authenticated repository, head SHA, base branch and draft state against the reported reviewed/validated commits, and read the ticket evidence. Register the PR in this coordinator thread with `link_pull_request` as well as in its implementation thread. A failure, incomplete review, failed validation, missing PR, or mismatch blocks the next ticket. Address it in that ticket's existing thread and worktree; do not advance with an incomplete prerequisite.

6. Register the native stack once there are at least two verified PRs, using the publication rules below. Repeat steps 3–5 for each remaining ticket. When `main` or a published layer changes, follow [worktree restacking](references/stack-recovery.md#restack-ticket-worktrees) and the evidence rules below before launching a dependent or publishing another layer.

7. After all tickets have published PRs, fetch current `main`, verify all published layer heads and parents, and restack if needed. On the top ticket's checkout, run [do-work's parallel review step](../../wallpaperdb/do-work/SKILL.md#5-review-and-fix) over the entire stack against that `main` SHA, using the full spec, comments, accepted decisions, and all tickets as the requirements. Validate the combined result under do-work Step 4.

   Require the independent Spec reviewer to account for every spec requirement with implementation and validation evidence, including cross-ticket behavior and requirements absent from the tickets. Missing, partial, incorrect, untested required behavior, or deferred in-scope work prevents a completion verdict. Passing individual tickets does not establish that the spec is complete.

   Put each confirmed fix in its owning ticket's worktree through that ticket's thread, adding focused commits and repeating its do-work review and validation. If a required part of the agreed spec has no owning ticket, record it under the spec and implement it through the same ticket workflow. Restack descendants, refresh affected evidence, and republish. Repeat the complete-spec review after fixes until both review skills pass and the Spec report establishes that no required implementation work remains. Record the reviewed trunk/top commit pair and the requirement evidence outside the repository and summarize it in the spec issue.

8. Before handoff, read the selected remote's actual `main` tip and require it to match step 7's reviewed trunk SHA. Verify every PR's authenticated repository, head SHA, and base branch against its passing layer evidence and expected parent. A mismatch returns to restacking, affected review/validation, and step 7. Mark each PR ready and verify `isDraft:false`, then verify each ticket's `In Review` status under the issue tracker. Report all PR URLs, ticket thread links, validation, the final spec verdict, and native stack status. Check `list_thread_pull_requests` and register missing stack PRs in this coordinator thread. Keep issues open until verified default-branch landing; completion automation owns `Done`.

9. Retain T3-owned ticket worktrees and their bindings for review fixes. Clean up temporary artifacts only after all work is published and verified. For explicitly requested landing, follow [landing rules](references/landing.md).

## Publishing

Apply the ancestry, merge-commit, and validation checks in [do-work](../../wallpaperdb/do-work/SKILL.md#6-open-a-pr). The coordinator retains each layer's branch, worktree, thread ID, expected parent, reviewed/validated commits, and last verified published tip outside the repository. Keep published-tip expectations separate from remote-tracking refs; a new branch expects absence. Pass the current records to each ticket thread before publication or repair.

Before every push, compare all active stack branches' actual remote heads with those expectations. Preserve and inspect external work on any mismatch before restacking, review, validation, or another push. Publish each validated branch using an explicit expected-value lease:

```sh
git push --force-with-lease="refs/heads/<ticket-branch>:<recorded-remote-tip>" "<remote>" "refs/heads/<ticket-branch>:refs/heads/<ticket-branch>"
```

Use an empty expected tip for a new branch. Read back the remote head and update the published-tip record only when it matches the tested commit. On lease rejection, inspect and preserve the changed remote state before retrying. Publish changed layers bottom to top and retain successful tips after a partial failure.

Create each draft PR with `gh pr create`, an explicit repository, base, head, title, and body file. Verify an existing PR's identity before using `gh pr edit` for its target or body. For initial native registration, use `gh stack link --base main "<bottom-pr-url>" ... "<top-pr-url>"` in stack order with verified URLs. This links existing PRs without pushing branches or initializing a shared local stack catalog. For additions or restacks, follow [native membership preservation](references/stack-recovery.md#preserve-native-membership), including merged members. Verify native membership and readiness after linking; PR mergeability alone is insufficient.

## Rebasing and landing

Restack in each ticket's owning worktree under [worktree restacking](references/stack-recovery.md#restack-ticket-worktrees). Preserve old parent boundaries so only that layer's commits move. Incorporate prerequisite changes with rebase and keep history free of merge commits.

Refresh every rewritten layer's recorded commits in its issue. Reuse successful validation only for an identical tree. Compare each layer's new parent-relative diff with the diff between its recorded reviewed commits, and account for changes in requirements or relevant base behavior. Reuse review only when those inputs are unchanged, recording the comparison and refreshed parent/head pair; otherwise repeat do-work's review step. A tree comparison alone cannot establish review equivalence.

After rewrites, publish with the explicit leases above and verify PR targets and native membership. A changed top or trunk requires refreshing the complete-spec review and combined validation before readiness.
