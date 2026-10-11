# Stack recovery

## Manual rebases

If rebasing manually, follow Git's [transplanting branches with `--onto` documentation](https://git-scm.com/docs/git-rebase#_transplanting_a_topic_branch_with_onto). Transplant only a layer's own commits with `git rebase --onto "<new-parent-tip>" "<old-parent-tip>" "<ticket-branch>"`, working from the bottom upward. This boundary also prevents replaying landed prerequisite commits after a squash or rebase landing.

After manual rebases, rebuild local tracking below, then apply the main workflow's [review, validation, and publication rules](../SKILL.md#rebasing-and-landing).

## Rebuild local tracking

After any manual history rewrite, rebuild local tracking before another stack `view`, `add`, or `rebase`. External Git commands leave [stored parent boundaries stale](https://github.com/github/gh-stack/issues/193), and `link` only updates GitHub membership. Finish or abort paused operations first. Back up the shared catalog at the Git common directory's `gh-stack` path, obtained with `git rev-parse --git-common-dir`, and record this stack's branch order, tips, and PR identities outside the repository. With a clean worktree on a remaining layer, run [`gh stack unstack --local`](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#unstack), then `gh stack init --base main "<bottom-remaining-branch>" ... "<top-remaining-branch>"` to adopt the existing branches in order. Require every branch to exist at its recorded tip and contain its new parent before adoption. The [init implementation](https://github.com/github/gh-stack/blob/v0.2.1/cmd/init.go) rebuilds parent boundaries and detects existing PRs. Read back the catalog to verify trunk tip, order, each parent boundary, and detected PR identities against the recorded refs and PRs; also verify unrelated stacks and all branch tips stayed intact. Stop on a failed rebuild or mismatch. The local-only removal preserves the native stack, which is verified separately after publication.

## Preserve native membership

For an existing native stack, read its complete ordered remote membership, including merged PRs, before any membership operation. After a restack or partial landing with unchanged membership, skip `link` and verify that membership remains intact. To append new PRs, use the documented [add mode](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#link): `gh stack link "<verified-stack-number>" "<new-pr-url>" ...`. Verify the selected stack identity and every new PR URL first, then read back the complete membership. Never submit only the remaining unmerged PR URLs as a replacement list; membership is additive and [prevalidation rejects omitted members](https://github.com/github/gh-stack/blob/v0.2.1/cmd/link.go#L638). Stop on an unexpected membership or order instead of removing merged members to make linking succeed.
