---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets sequentially as a GitHub PR stack."
disable-model-invocation: true
---

You have been provided a spec and its implementation tickets. Read them through the repository's [issue tracker](../../../docs/agents/issue-tracker.md).

For a spec with multiple tickets, the goal is one linear GitHub PR stack, with one branch and PR per ticket. The bottom PR targets `main`; each subsequent PR targets the previous ticket's branch. The top branch contains the complete spec.

For a single-ticket spec, create an ordinary branch from current `main` and a draft PR targeting `main`. Apply the implementation, review, validation, and issue-closure steps below using [do-work](../do-work/SKILL.md) to publish the PR. Skip extension setup and stack-only initialization, publishing, status, and landing commands. A [native remote stack requires at least two PRs](https://github.com/github/gh-stack/issues/467); the single ticket still implements the complete spec.

Tickets form a dependency graph. Implement them one at a time in an order that puts every prerequisite before its dependents. Independent tickets also become successive stack layers. Apply the issue tracker's readiness rule to every prerequisite, including tickets with multiple blockers.

Use rebase to incorporate changes from `main` or an earlier layer. Do not use `git merge` or introduce merge commits.

Communication with subagents should use context pointers to the spec, tickets, research notes, parent branch, and commits. Keep temporary exploration notes outside the repository, accessible to later subagents.

Use one implementer subagent at a time in a single worktree for the stack. Each ticket gets its own branch in that worktree. Review and validate its work before starting the next ticket; its PR can remain open while later tickets are implemented.

## Prerequisites

The `gh stack` commands require the [GitHub CLI extension](https://github.com/github/gh-stack) at [v0.2.1](https://github.com/github/gh-stack/releases/tag/v0.2.1), the release used to verify this workflow's command behavior. If the extension is missing, use the CLI's [pinned installation](https://cli.github.com/manual/gh_extension_install): `gh extension install github/gh-stack --pin v0.2.1`. Check `gh stack --version` for `0.2.1` before executing workflow commands, then check `gh stack --help`. Stop on a different installed version; review its provenance and behavior before changing the pin. Use the release's [command documentation](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/SKILL.md) and local command help for supported options.

Require generated and adopted ticket branch names to match `^[A-Za-z0-9][A-Za-z0-9/_-]*$` and pass Git's [branch-name validation](https://git-scm.com/docs/git-check-ref-format) with `git check-ref-format --branch "<ticket-branch>"`. Require remote names to match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Reject incompatible names before command construction. Pass dynamic values as separate process arguments; when using a shell, quote them as literal data rather than pasting ticket text into command source or evaluating it.

## Steps

1. Read the spec, full tickets, comments, and blocking relationships. Choose an order that respects the dependency graph. Resolve missing prerequisites or cycles before starting affected tickets.

2. Select and record the remote whose fetch and push URLs resolve to the authenticated target repository. For all CLI operations in this workflow, export [GH_REPO](https://cli.github.com/manual/gh_help_environment) to that repository's `HOST/OWNER/REPO` and verify `gh repo view "<host>/<owner>/<repo>" --json nameWithOwner,url` resolves to it. This also binds stack API calls to the publishing repository, addressing the extension's [multi-remote repository-resolution limitation](https://github.com/github/gh-stack/issues/381). Set the repository-local `remote.pushDefault` to that remote and pass `--remote "<remote>"` to stack commands that support it, following the extension's [non-interactive guidance](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/SKILL.md#non-interactive-use).

   For multiple tickets, check repository capability before initializing branches or starting an implementer. Require write access from `gh repo view "<host>/<owner>/<repo>" --json viewerPermission`. Use `gh api --hostname "<host>" --paginate "repos/<owner>/<repo>/stacks"` with the selected repository and current credential. This is the read-only availability check used by [the extension's submit implementation](https://github.com/github/gh-stack/blob/v0.2.1/cmd/submit.go) and [stack-list API client](https://github.com/github/gh-stack/blob/v0.2.1/internal/github/github.go). A successful empty list is valid. If permissions are insufficient or the API fails, report the error and stop before implementing tickets; native stacks remain the requested output. Investigate authentication or API failures instead of interpreting every error as a disabled feature.

   Choose and record a branch name for every ticket. For a new run, require each name to be absent locally and on the selected remote. Check the remote with [git ls-remote](https://git-scm.com/docs/git-ls-remote): `git ls-remote --exit-code --heads "<remote>" "refs/heads/<ticket-branch>"`. Exit code 2 establishes absence; exit code 0 is a collision, and any other failure blocks creation. Choose a different unused name on collision. Repeat the check immediately before each branch creation, including later `gh stack add` calls. The extension's [init behavior](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#init) decides adoption from local refs, so a remote-only branch is unsafe to initialize as new. If the user requested continuation of existing work, fetch its actual remote heads and verify their recorded tips, PRs, and parent relationships before adopting them; stop if that evidence is missing.

   Fetch `main` from that remote and bring the local trunk to its current remote tip using a fast-forward update. Before initializing a multi-ticket stack, set `git config --local rerere.enabled true` to avoid the extension's [first-run confirmation](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#init). Then initialize with `gh stack init --base main "<first-ticket-branch>"`; for a single ticket, create its ordinary branch instead. Consult `gh stack "<command>" --help` for command options. Branch targets alone do not register a native GitHub stack.

3. Select the next ready ticket. Before the initial branch creation and every later layer, require `git status --porcelain` to be empty, including staged, unstaged, and untracked files. Preserve unrelated work in a separate worktree or an explicitly recorded stash; commit ticket work in its owning layer and repeat validation. The extension's [add behavior](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#add) carries uncommitted changes onto the new branch. Use the branch prepared in step 2 for the first ticket. For each later ticket, add a branch on the validated stack tip with `gh stack add "<ticket-branch>"`. Check out the ticket branch in the stack worktree. Give the implementer pointers to the ticket, spec, worktree, and exact parent commit. The implementer:
   - confirms the ticket branch is based on that parent before starting;
   - uses [tdd](../tdd/SKILL.md) and follows the repository's [development principles](../development-principles/SKILL.md);
   - validates the ticket and reports its commits and results before another implementer starts.

4. Use [code-review](../code-review/SKILL.md) on the ticket's changes against its parent branch. Fix findings in the ticket branch and rerun affected checks. Record the reviewed parent and layer commits with the ticket's evidence. The ticket is implemented for stack readiness only once its acceptance criteria, validation, and review pass.

5. Follow [do-work](../do-work/SKILL.md) for validation and the publishing rules below. Write a ticket-specific title and body using [pr](../pr/SKILL.md) and [github-markdown-bodies](../github-markdown-bodies/SKILL.md), then publish a draft PR. Include the ticket's closing reference and link to the spec. The first publication creates an ordinary PR; register the native stack once the second PR joins it. Record the PR URL and validated commit in the ticket so later implementers can verify prerequisite readiness.

6. Repeat steps 3 through 5 for each remaining ticket. When `main` or an earlier layer changes, restack before continuing or publishing. Follow the rebase rules below for every affected layer's recorded commit and validation evidence.

7. Once all tickets are implemented, use [code-review](../code-review/SKILL.md) on the top branch against `main` to review the complete spec. Put each fix in the ticket layer that owns it, then rebase descendants and rerun validation for changed file trees. Validate the combined result on the top branch.

8. Mark the PRs ready for review and report the stack's PR URLs, validation results, and native GitHub stack status. Apply the issue tracker's [landing and issue-closure policy](../../../docs/agents/issue-tracker.md#relationships). Opening PRs or completing implementation does not authorize landing the stack.

9. If a temporary stack worktree was created, clean it up after all commits are published, preserving the stack branches and PRs.

## Publishing

Apply the ancestry, merge-commit, and validation checks in [do-work](../do-work/SKILL.md#5-open-a-pr). Keep each branch's last verified published tip separate from remote-tracking refs; a new branch expects absence. Before every publication, compare all active stack branches' actual remote heads with those recorded expectations. Stop on any difference, including a newly appeared branch. Fetch and preserve external work, then restack, review, and validate it before recording a new expectation.

Push each validated branch using Git's [explicit expected-value lease](https://git-scm.com/docs/git-push#Documentation/git-push.txt---force-with-leaseltrefnamegtltexpectgt): `git push --force-with-lease="refs/heads/<ticket-branch>:<recorded-remote-tip>" "<remote>" "refs/heads/<ticket-branch>:refs/heads/<ticket-branch>"`. Use an empty expected tip for a new branch. On rejection, reassess and validate the new remote state before retrying. Read back the remote head and update the published-tip record only after it matches the tested commit. Publish changed layers from the bottom upward, retaining verified tips after a partial publication failure.

Create the draft PR using [gh pr create](https://cli.github.com/manual/gh_pr_create) with an explicit repository, parent base, head branch, title, and body file. For an existing PR, use [gh pr edit](https://cli.github.com/manual/gh_pr_edit) to update its parent target and body after verifying the PR identity. With at least two PRs, call `gh stack link --base main "<bottom-pr-url>" ... "<top-pr-url>"` in stack order. Pass only verified PR URLs; the extension's [link implementation](https://github.com/github/gh-stack/blob/v0.2.1/cmd/link.go) skips Git pushes for PR URL arguments. Verify native stack membership and readiness after linking. Use this path for restacks too, because the extension's [fetch-then-lease behavior](https://github.com/github/gh-stack/issues/380) makes `gh stack submit` and `push` unsuitable for preserving recorded remote expectations.

## Rebasing and landing

Use `gh stack rebase --remote "<remote>"` to rebase the stack onto the updated trunk and cascade changes through descendants. Preserve the old parent tips before rewriting history. If rebasing manually, follow Git's [transplanting branches with `--onto` documentation](https://git-scm.com/docs/git-rebase#_transplanting_a_topic_branch_with_onto). Transplant only a layer's own commits with `git rebase --onto "<new-parent-tip>" "<old-parent-tip>" "<ticket-branch>"`, working from the bottom upward. This boundary also prevents replaying landed prerequisite commits after a squash or rebase landing.

Refresh every rewritten layer's recorded commit in its ticket issue, even when its file tree is unchanged. Reuse successful validation for an identical tree and record that comparison; rerun required checks for changed trees. Apply this rule after every history rewrite, including restacks and partial landings.

Compare each layer's diff against its new parent with the diff between its recorded reviewed commits. If that diff changes, invalidate the old layer review and repeat step 4 before treating the ticket as ready or publishing it. If the diff is identical, record the comparison and refresh the reviewed commit pair. A tree comparison alone does not establish that the parent-relative diff is unchanged.

Publish rewritten branches and update their PR targets and native membership using the publishing rules above. PR mergeability alone does not establish native stack readiness.

When landing is explicitly requested, inspect the target branch's effective merge rules first. Without a merge queue, use GitHub's rebase method, or squash when the repository permits it. Invoke stack landing non-interactively with an explicit target and method: `gh stack merge "<stack-or-pr-number>" --yes --rebase`, or substitute `--squash`. Verify that the target resolves to the requested ready prefix before executing it. Immediately before landing or enqueueing, read every selected PR's authenticated head SHA and base branch, compare them with its recorded validated and reviewed commit and expected parent, and recheck native readiness. Stop on any mismatch, preserve external work, and repeat the affected review and validation before another attempt. The extension's [merge command](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#merge) has no equivalent to an atomic expected-head flag, so this preflight cannot guarantee protection against a subsequent concurrent push. If an atomic head match is required, report that limitation before landing. For an ordinary PR without a native stack, use [gh pr merge](https://cli.github.com/manual/gh_pr_merge) with `gh pr merge "<pr-url>" --match-head-commit "<validated-head-sha>" --rebase`, or substitute `--squash`. The matched SHA must be the full recorded validated and reviewed head; on a mismatch, refresh review and validation before another landing attempt. Land prerequisites before their dependents, or use the native atomic stack operation for a ready prefix when no merge queue applies.

If a merge queue applies, follow the extension's [queue behavior](https://github.com/github/gh-stack/blob/v0.2.1/skills/gh-stack/references/commands.md#merge). The queue overrides method flags and may land the requested PRs in separate groups. Verify that its configured method is rebase or an allowed squash before submitting; if it would introduce merge commits or its method cannot be established, report the blocker before enqueueing. Report queued PRs as queued until each reaches `main`. Verify each landing individually and apply the partial-landing rules below whenever only part of the prefix has landed.

After a partial landing, fetch `main` from the selected remote, rebase the remaining layers onto their new parents, and update the stack.
