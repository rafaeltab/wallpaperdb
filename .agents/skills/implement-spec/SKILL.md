---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets sequentially as a GitHub PR stack."
disable-model-invocation: true
---

You have been provided a spec and its implementation tickets. Read them through the repository's [issue tracker](../../../docs/agents/issue-tracker.md).

The goal is the entire spec implemented as one linear GitHub PR stack, with one branch and PR per ticket. The bottom PR targets `main`; each subsequent PR targets the previous ticket's branch. The top branch contains the complete spec.

Tickets form a dependency graph. Implement them one at a time in an order that puts every prerequisite before its dependents. Independent tickets also become successive stack layers. Apply the issue tracker's readiness rule to every prerequisite, including tickets with multiple blockers.

Use rebase to incorporate changes from `main` or an earlier layer. Do not use `git merge` or introduce merge commits.

Communication with subagents should use context pointers to the spec, tickets, research notes, parent branch, and commits. Keep temporary exploration notes outside the repository, accessible to later subagents.

Use one implementer subagent at a time in a single worktree for the stack. Each ticket gets its own branch in that worktree. Review and validate its work before starting the next ticket; its PR can remain open while later tickets are implemented.

## Prerequisites

The `gh stack` commands require the [GitHub CLI extension](https://github.com/github/gh-stack). Follow its setup requirements and check `gh stack --help` before initializing a stack. If the extension is missing, install it with `gh extension install github/gh-stack`, then repeat the check. Use the extension's [command documentation](https://github.com/github/gh-stack/blob/main/skills/gh-stack/SKILL.md) and local command help for supported options.

## Steps

1. Read the spec, full tickets, comments, and blocking relationships. Choose an order that respects the dependency graph. Resolve missing prerequisites or cycles before starting affected tickets.

2. Fetch `main` and bring the local trunk to its current remote tip using a fast-forward update. Initialize the native stack with `gh stack init --base main <first-ticket-branch>`. Consult `gh stack <command> --help` for command options. Branch targets alone do not register a native GitHub stack.

3. Select the next ready ticket. Use the initialized branch for the first ticket. For each later ticket, add a branch on the validated stack tip with `gh stack add <ticket-branch>`. Check out the ticket branch in the stack worktree. Give the implementer pointers to the ticket, spec, worktree, and exact parent commit. The implementer:
   - confirms the ticket branch is based on that parent before starting;
   - uses [tdd](../tdd/SKILL.md) and follows the repository's [development principles](../development-principles/SKILL.md);
   - validates the ticket and reports its commits and results before another implementer starts.

4. Use [code-review](../code-review/SKILL.md) on the ticket's changes against its parent branch. Fix findings in the ticket branch and rerun affected checks. The ticket is implemented for stack readiness only once its acceptance criteria, validation, and review pass.

5. Follow [do-work](../do-work/SKILL.md) for validation and publishing checks. Publish the ticket as a draft PR with `gh stack submit --auto`, which creates or updates the native stack and PR targets. Write a ticket-specific title and body using [pr](../pr/SKILL.md) and [github-markdown-bodies](../github-markdown-bodies/SKILL.md). Include the ticket's closing reference and link to the spec. Record the PR URL and validated commit in the ticket so later implementers can verify prerequisite readiness.

6. Repeat steps 3 through 5 for each remaining ticket. When `main` or an earlier layer changes, restack before continuing or publishing. Follow the rebase rules below, revalidate prerequisites whose file trees changed, and refresh their recorded commit and validation evidence.

7. Once all tickets are implemented, use [code-review](../code-review/SKILL.md) on the top branch against `main` to review the complete spec. Put each fix in the ticket layer that owns it, then rebase descendants and rerun validation for changed file trees. Validate the combined result on the top branch.

8. Mark the PRs ready for review and report the stack's PR URLs, validation results, and native GitHub stack status. Keep tickets and the spec open while their changes are unlanded. Opening PRs or completing implementation does not authorize landing the stack.

9. If a temporary stack worktree was created, clean it up after all commits are published, preserving the stack branches and PRs.

## Rebasing and landing

Use `gh stack rebase` to rebase the stack onto the updated trunk and cascade changes through descendants. Preserve the old parent tips before rewriting history. If rebasing manually, transplant only a layer's own commits with `git rebase --onto <new-parent-tip> <old-parent-tip> <ticket-branch>`, working from the bottom upward. This boundary also prevents replaying landed prerequisite commits after a squash or rebase landing.

Before publishing, apply the ancestry, merge-commit, and validation checks in [do-work](../do-work/SKILL.md#5-open-a-pr). Push rewritten branches with lease protection and update their PR targets and native stack membership. Check GitHub's native stack status after publishing; PR mergeability alone does not establish stack readiness.

When landing is explicitly requested, use GitHub's rebase or squash method, including an explicit `--rebase` or `--squash` when using `gh stack merge`. Land prerequisites before their dependents, or use the native atomic stack operation for a ready prefix. After a partial landing, fetch `main`, rebase the remaining layers onto their new parents, and update the stack. Close each ticket only after its changes reach `main`; close the spec after every ticket has landed and the complete spec is validated.
