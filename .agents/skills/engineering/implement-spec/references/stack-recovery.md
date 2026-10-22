# Stack publication and recovery

Follow the shared [PR history policy](../../../../../CONTRIBUTING.md#pull-request-history). Preserve published history and external work; obtain authorization before rewriting published commits. A trunk advance alone does not require restacking.

## Publishing

Keep each layer's last verified published tip separate from remote-tracking refs. Before pushing, verify remote heads match those expectations. Push using [explicit expected-value leases](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt), expecting absence for a new branch. Read back each published head; investigate mismatches before retrying. Publish changed layers bottom to top.

Register native membership with [gh stack link](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#link) and verified PR URLs once two PRs exist. PR URLs avoid branch pushes and local catalog initialization. Preserve complete existing membership, including merged PRs; append new PRs rather than replacing the stack with unmerged members alone. Before numeric add mode, reject a same-named local branch because the [pinned CLI](https://github.com/github/gh-stack/blob/v0.2.1/cmd/link.go#L164) otherwise interprets it as a branch argument. Verify native order and readiness afterward.

## Restacking

Record old parent boundaries before changing refs. Wait for active work to finish and require clean owning worktrees. Rebase each layer in its ticket's worktree, bottom to top, using [rebase --onto](https://git-scm.com/docs/git-rebase#_transplanting_a_topic_branch_with_onto) to move only that layer's commits onto its new parent.

Refresh issue evidence after rewrites. Reuse validation only for an identical tree; repeat affected validation and the parallel reviews required by $do-work and the shared history policy. Republish with explicit leases and verify targets and native membership. Repeat final spec review when the reviewed result or relevant base behavior changes.

## Combined validation

When current `main` is not an ancestor of the top commit, validate their combined tree in a disposable worktree using a temporary integration commit. Record both input commits and the tested tree. Preserve the published stack; integration conflicts block readiness until resolved, validated, and reviewed under the history policy.
