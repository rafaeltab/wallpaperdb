---
name: publish-pr
description: Publish a validated, independently reviewed issue change as a PR. Use for the publication stage or from do-work.
---

Use the existing checkout and branch. Accept the issue URL, intended PR base or predecessor PR, implementation handoff, retained scope decisions, validation and demonstration, and independent review evidence. Follow [task scope](../../../../docs/agents/task-scope.md); preserve the agreed requirements and exclusions through publication.

1. Verify the handoff against the current change. Required implementation and validation must be complete, and required independent Standards, Spec, and Defects review evidence must apply to this head and comparison under [review evidence](../../../../CONTRIBUTING.md#review-evidence). Unavailable or failed required reviewers, unresolved required findings, pending scope decisions, and missing validation block publication. Return the missing obligations to the caller rather than treating an implementation marker as review approval.
2. Follow the [PR history policy](../../../../CONTRIBUTING.md#pull-request-history). Check linear history and a meaningful diff against the current intended base. Preserve published and external work and use expected-head leases when required. Stack on the supplied predecessor PR; otherwise target the default branch. Reconcile an existing PR before creating another.
3. Use $pr and $github-markdown-bodies to publish automatically. Keep the PR concise with resulting behavior, the owning issue's closing reference, current verification and review results, one appropriate demonstration, and material current limitations. Keep execution history and detailed review evidence in the outside-repository ledger or linked artifacts. For observable UI behavior, record and attach the demonstration with $pr-video-attachment; for nonvisual changes, include representative direct output and explain why a recording is inapplicable.
4. Verify the published head matches the validated commit and the intended base. Read back the body and, for default-branch PRs, verify the intended issue in `closingIssuesReferences`. Verify conflict freedom against the live base under the history policy. Link the PR in T3 and record its URL, tested commit, and review evidence in the issue. Follow the [issue workflow](../../../../docs/agents/issue-tracker.md): verify `In Review` for ready PRs; drafts stay `In Progress`. Honor caller instructions to keep a PR draft. Leave the issue open until landing.

Return the PR URL, full published SHA and tree, base, validation, review evidence, issue comment URL, demonstration, and material limits or pending CI. Emit `<PR>CREATED</PR>` only after these publication obligations are verified. A created PR with incomplete verification leaves this stage incomplete; report what remains without the marker. Publication does not establish CI readiness or default-branch landing.

A factory caller can use a small prompt with its retained context:

```text
Use $publish-pr for <issue URL> against <base branch or predecessor PR>.
Implementation, scope, validation, demonstration and review handoff: <context or ledger path>.
Publication mode: <draft or ready>. Stop after publication and report pending CI.
```
