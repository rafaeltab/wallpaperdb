# Repository setup

Use this before launching ticket threads. Keep repository, branch, thread, worktree, publication, and review evidence outside the repository so continuation can recover it.

## Repository and trunk

Select the remote whose fetch and push URLs resolve to the authenticated target repository. Export [GH_REPO](https://cli.github.com/manual/gh_help_environment) as `HOST/OWNER/REPO` in every coordinator and ticket-thread CLI environment and verify the identity with [gh repo view](https://cli.github.com/manual/gh_repo_view): `gh repo view "<host>/<owner>/<repo>" --json nameWithOwner,url`. Pass the repository explicitly to PR commands and the selected remote to fetch, push, and supported stack commands.

Fetch `main` from that remote and record its full fetched SHA. Use the verified commit as the first worktree's base; local `main` may belong to another worktree or differ from the remote and is not the starting-point authority. Preserve unrelated commits and checkout contents. Require a clean owning worktree before any checkout or rebase; preserve unrelated changes rather than carrying them into ticket work.

## Versions and native stacks

For multiple tickets, check `gh --version` and `git --version` before changing repository configuration or creating branches. Require GitHub CLI 2.13 or newer for [matched-head ordinary PR merging and pinned extension installation](https://github.com/cli/cli/releases/tag/v2.13.0), and Git 2.36 or newer under the [extension's requirements](https://github.com/github/gh-stack/tree/v0.2.1#installation), comparing numeric components. Stop on unsupported or unparseable versions.

Require [github/gh-stack v0.2.1](https://github.com/github/gh-stack/releases/tag/v0.2.1). If missing, install with `gh extension install github/gh-stack --pin v0.2.1`; verify `gh stack --version` reports `0.2.1` and inspect local help before using commands. A different installed version needs provenance and behavior review before changing the pin. This workflow uses remote PR linking, not local stack initialization or branch switching.

Verify write access with `gh repo view "<host>/<owner>/<repo>" --json viewerPermission`, then check native availability with `gh api --hostname "<host>" --paginate "repos/<owner>/<repo>/stacks"`, the read-only lookup used by the extension's [submit implementation](https://github.com/github/gh-stack/blob/v0.2.1/cmd/submit.go) and [stack API client](https://github.com/github/gh-stack/blob/v0.2.1/internal/github/github.go). A successful empty list is valid. Insufficient permissions or an API error blocks multi-ticket implementation; investigate authentication and capability rather than interpreting every failure as a disabled feature.

A single ticket skips extension setup and every stack command, using the ordinary PR path.

## Branch names and collisions

Require ticket branches to match `^[A-Za-z0-9][A-Za-z0-9/_-]*$` and pass [Git's branch validation](https://git-scm.com/docs/git-check-ref-format): `git check-ref-format --branch "<ticket-branch>"`. Require remote names to match `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Pass dynamic values as literal process arguments; issue text is data, not shell source.

Choose and record all planned ticket branch names. Before implementation, check all planned names. Immediately before each later launch, apply absence and collision checks only to ticket branches not yet created, and verify completed layers against their recorded refs instead of treating them as unused names. Enumerate local heads with [git for-each-ref](https://git-scm.com/docs/git-for-each-ref): `git for-each-ref --format="%(refname)" refs/heads/` and remote heads with [git ls-remote](https://git-scm.com/docs/git-ls-remote): `git ls-remote --heads "<remote>"`. Reject equality and slash-boundary prefix conflicts in either direction among existing heads and all planned names. Choose another name on collision; a failed listing blocks creation.

Confirm exact remote absence using `git ls-remote --exit-code --heads "<remote>" "refs/heads/<ticket-branch>"`: exit code 2 establishes absence, 0 is a collision, and another failure blocks creation. Require local absence too. During continuation, permit only the exact ref being verified and adopted.

## T3 orchestration

Discover the live schemas for `t3_thread_launch`, `t3_thread_list`, `t3_thread_read`, `t3_thread_wait`, `t3_thread_send`, and PR linking. Verify worktree launch is supported before beginning a ticket. Inherit project, provider/model, and permission modes; specify the verified parent SHA and new ticket branch in `workspaceStrategy`.

When T3 tools are not initially exposed, make the bounded capability discovery attempt and use the supported ACP MCP transport when available. If T3 thread/worktree orchestration remains unavailable, report the missing prerequisite before ticket implementation. The requested output requires T3-bound ticket threads and worktrees.
