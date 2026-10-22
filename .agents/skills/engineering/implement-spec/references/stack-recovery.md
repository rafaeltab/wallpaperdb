# Stack recovery

## Restack ticket worktrees

Before rewriting history, record every layer's old parent SHA, local head, reviewed/validated commits, and last verified published remote tip. Inspect `git worktree list --porcelain` and the recorded T3 threads to identify each owning checkout. Wait for active ticket implementation or review work to finish before changing its source. Require that owning worktree to be clean.

Process layers bottom to top through their owning ticket threads, one at a time. Transplant only a layer's own commits using [Git's rebase --onto procedure](https://git-scm.com/docs/git-rebase#_transplanting_a_topic_branch_with_onto):

```sh
git -C "<ticket-worktree>" rebase --onto "<new-parent-sha>" "<old-parent-sha>" "<ticket-branch>"
```

Use the freshly fetched `main` SHA for the bottom parent and the preceding layer's verified new head for each descendant. Keep old parent SHAs even after their branch refs move. This also prevents replaying already-landed prerequisite commits after rebase or squash landing. Resolve conflicts in the owning checkout, preserve external work, and apply the [review, validation, and publication rules](../SKILL.md#rebasing-and-landing) before accepting or publishing the result.

Read every owning worktree's resulting head back and update its ticket evidence. Return to the complete-spec review after fixes or rewrites before ready handoff. Native remote membership is verified separately from local branch history. Avoid shared-catalog commands that switch branches already owned by other worktrees.

## Preserve native membership

For an existing native stack, read its complete ordered remote membership, including merged PRs, before any membership operation. After a restack or partial landing with unchanged membership, skip `link` and verify that membership remains intact. To append new PRs, use the documented [add mode](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#link): `gh stack link "<verified-stack-number>" "<new-pr-url>" ...`. Verify the selected stack identity and every new PR URL first. Immediately before calling `link`, require the verified stack number to be a positive decimal integer and check for a same-named local branch with [git show-ref](https://git-scm.com/docs/git-show-ref): `git show-ref --verify --quiet "refs/heads/<verified-stack-number>"`. Exit code 1 establishes absence; exit code 0 or any other failure blocks the append operation. Preserve an existing branch and report the ambiguity. The pinned [add-mode detection](https://github.com/github/gh-stack/blob/v0.2.1/cmd/link.go#L164) treats an existing numeric branch as a branch argument. After linking, read back the complete membership. Never submit only the remaining unmerged PR URLs as a replacement list; membership is additive and [prevalidation rejects omitted members](https://github.com/github/gh-stack/blob/v0.2.1/cmd/link.go#L638). Stop on an unexpected membership or order instead of removing merged members.
