# Factory worker

Use the policy and [active ownership lifecycle](SKILL.md#active-ownership-lifecycle) in SKILL.md. Work only in the T3-assigned worktree and keep the coordinator's checkout intact. Verify its branch and admission before proceeding. Both `<admission directory>/worker-thread-id` and `<active directory>/worker-thread-id` must match this conversation's actual T3 ID, and `<active directory>/coordinator-thread-id` must match the launch message. Launch preparation can race the coordinator's ownership writes, so allow up to 60 seconds of read-only rechecks with waits of at most 10 seconds. Stop before external changes if an owner differs or ownership remains unresolved. Keep and recheck active ownership through every babysitting wake and mutation; release it only under the linked terminal handoff rules. A dry run reports the ownership checks it would require without acquiring admission.

## Find one opportunity

Read `AGENTS.md`, the applicable guidelines selected by `CODING_STANDARDS.md`, and relevant domain docs through `GLOSSARY-MAP.md`. Respect recorded ADRs. Load [github-markdown-bodies](../github-markdown-bodies/SKILL.md) before any GitHub body mutation.

Inspect recent upstream changes and relevant tests. Investigate one bounded area that has changed recently, using concrete maintenance friction or test evidence. The existing [codebase-design](../codebase-design/SKILL.md) vocabulary can help assess a local simplification. The interactive `improve-codebase-architecture` skill expects human selection and grilling, so it is not the unattended discovery workflow.

Look for small, behavior-preserving simplifications, duplicated policy that can be consolidated locally, unused internal code whose callers can be fully checked, and missing tests for an established behavior. A smell alone does not justify an issue. Record the observed cost, exact source references at the inspected commit, expected benefit, and a verification method.

The initial automatic scope excludes schema or data migrations, authentication or authorization changes, public contract or event changes, new dependencies, infrastructure and deployment changes, broad renames, and cross-context redesigns. Apply this scope to existing ready issues as well as discoveries. A `ready-for-agent` label supplies readiness, not an exemption from this factory's initial limits.

Search open and closed issues, PRs, and relevant active T3 conversations for each serious candidate, including proposals without the factory marker. Paginate rather than treating a truncated result as complete. Compare the underlying problem and affected code, not just titles. Respect rejected proposals and deferred `future-work`. A recurrence after a landed fix needs evidence and the repository's verified reopen procedure, not a fresh duplicate.

Create at most one discovery issue if a worthwhile, fresh finding exists. If none qualifies, report a skipped discovery and continue to existing issue pickup. Do not create quota-filling work.

The issue body includes:

- The factory marker and this worker's T3 conversation link.
- The problem, source evidence, and why the change is worth maintaining.
- Bounded acceptance criteria and explicit exclusions.
- The proposed change, behavior that must remain intact, and relevant dependencies.
- Tests and validation appropriate to the behavior, including how to detect a regression.
- Why automatic implementation fits the initial scope, or which human decision is missing.

Use `ready-for-agent` only when the evidence, acceptance criteria, dependencies, and verification are sufficient for unattended work. Otherwise use `needs-triage` and leave implementation to a later decision. Read the issue back and verify its body and labels. Search again immediately before creation; reconcile an uncertain creation response with GitHub before retrying.

## Pick up one issue

List open `ready-for-agent` issues excluding `future-work`. Consider existing eligible issues before the issue discovered in this cycle. Prefer the oldest eligible bounded task, using impact and validation confidence to break ties. Read its full body, comments, labels, native dependencies, parent context when relevant, and fallback `Blocked by` references.

Skip issues with open blockers, another assignee, unresolved decisions, another active or uncertain T3 worker, an existing implementation PR, or a prior unresolved factory claim. An assignment to the authenticated account can belong to another agent, so inspect PRs, issue comments, and project conversations even for that account. Check linked closing issues and body references as well as PR titles. Do not revive a factory attempt that already failed without a human recovery decision.

Before claiming, recheck that this issue is still open, still eligible, and still has `ready-for-agent`. Recheck active threads and PRs, including the factory open-PR limit. Follow [issue claiming](../../../docs/agents/issue-tracker.md#claiming-an-issue), including assignment read-back verification. Post one claim comment with the factory marker, date, branch, and this worker's T3 link. Assignment alone is not a lock; project-wide active ownership prevents competing factory launches across dates, while the final eligibility read detects other work already in progress.

If nothing is eligible, report why and finish. A cycle may create an issue without starting implementation.

## Implement and publish

Use [do-work](../do-work/SKILL.md), [development-principles](../development-principles/SKILL.md), and [testing](../testing/SKILL.md) for the selected issue. Follow do-work through Step 4, then pause before Step 5. Complete the factory's independent review below before resuming do-work's PR publication step. The issue body and acceptance criteria determine the work. Apply the initial automatic scope throughout implementation. If new evidence expands the risk or requires a human decision, stop, preserve useful work, and comment with the exact blocker. Move an incomplete specification to `needs-info` or `needs-triage` as appropriate, preserving category labels.

Run the required repository validation and report its real results. Keep infrastructure failures distinct from code failures. Use bounded diagnosis grounded in new evidence; do not disable checks, broaden permissions, or keep retrying unchanged failures. If required validation cannot pass, leave the issue open with the blocker and do not publish a ready PR. A draft may preserve useful completed work and counts toward the open-PR limit.

Before publication, review the diff against both the issue and applicable standards. Fix material findings and rerun affected checks during iteration. After the last review-driven code change, rerun do-work Step 4's required final `make ci` validation before publication and record the tested head. An older commit's full validation does not cover a subsequent code fix. Use the existing [code-review](../code-review/SKILL.md) for its independent Standards and Spec reviews, passing the captured upstream base commit and the selected issue as the spec. Supply both reviewers the initial factory scope. Follow that skill's delegation instructions and preserve evidence of the reviewed head. Resolve material findings before calling the PR ready. If independent review cannot run, preserve the result as a draft and report the gap.

For ready publication, complete do-work Step 5 only after independent review and final validation pass, using the repository's [pr](../pr/SKILL.md) and GitHub body workflows. If publication preparation changes the tree or reviewed diff, refresh the comparison and repeat independent review and required final validation before publishing ready. Include the factory marker, `Closes #<issue>`, the preserved behavior, actual validation and review evidence, and any limitations. Explain when a browser demonstration is inapplicable, such as an internal refactor without a user-visible feature. Check the live schemas for [link_pull_request](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/toolkits/pullRequests/tools.ts#L273-L284) and [list_thread_pull_requests](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/toolkits/pullRequests/tools.ts#L300-L312). Immediately register the PR with the former; before finishing, verify its link with the latter and correct missing links. Report a linking failure accurately.

For failed-work preservation, if required validation is blocked or independent review cannot run and useful work exists, resume do-work Step 5 only to publish a draft with [gh pr create --draft](https://cli.github.com/manual/gh_pr_create). Identify each failing or unavailable gate and incomplete acceptance criterion in its body. Apply the same publication metadata, linking, issue comment, and babysitting steps as for a ready PR. Keep it a draft until independent review and required final validation pass for the current head and comparison. If babysitting cannot resolve the blocker within scope, use its blocker handoff and retain active ownership for human recovery. This path preserves work without claiming the ready-publication gates passed.

Comment on the issue with the PR URL, tested commit, validation result, and remaining gaps. Keep the issue open for landing.

## Babysit the published PR

Once the PR is published and linked, invoke [babysit-pr](../babysit-pr/SKILL.md) for that PR in this worker conversation. Follow its CI failure handling, review fixes, current-head Codex approval, and watcher handoff rules. Preserve its progress ledger across T3 watcher wakes and resume babysitting on each wake. Yielding to the watcher is a monitoring state, not completed factory work.

Keep subsequent fixes within the factory's automatic scope. If a fix requires an excluded change or unresolved human decision, follow the babysitting skill's blocker handoff instead of broadening the assignment. Leave merging to the user.

When babysitting completes or hands back a blocker, report the discovery outcome, selected issue, commit and PR links, checks and review results, and any required recovery alongside its handoff summary. State clearly whether the PR passed the babysitting gates or still needs attention.
