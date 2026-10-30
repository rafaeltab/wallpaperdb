# Setup

Select and verify the authenticated repository and publishing remote. Set [GH_REPO](https://cli.github.com/manual/gh_help_environment) for coordinator and ticket threads. [Fetch](https://git-scm.com/docs/git-fetch) `main` and verify prerequisite readiness under the [issue tracker](../../../../../docs/agents/issue-tracker.md).

Require [GitHub CLI 2.13 or newer](https://github.com/cli/cli/releases/tag/v2.13.0) and verify merge-command help, including for a single ticket.

For multiple tickets, require native stack access and [github/gh-stack v0.2.1](https://github.com/github/gh-stack/releases/tag/v0.2.1). Check its installation requirements and local help; if missing, use [pinned installation](https://cli.github.com/manual/gh_extension_install). A single ticket uses an ordinary PR and skips stack commands.

Use the [T3 launch contract](https://github.com/pingdotgg/t3code/blob/main/docs/orchestration-v2/orchestrator-mcp-server.md#t3_thread_launch) and live schemas. Launch with a new ticket branch, `workspaceStrategy.type:"worktree"`, the verified parent SHA as `baseRef`, and `startFromOrigin:false`. Inherit project, model, and modes. Verify the resulting binding before implementation.

Ensure [`make install`](../../../../../Makefile) succeeds and generates worktree configuration before $do-work, through verified T3 preparation or as the ticket thread's first action.

Choose unused branch names without local or remote namespace conflicts. Recheck only uncreated names before each launch. Keep existing layers at their recorded refs. After an uncertain launch, inspect threads and worktrees before retrying; preserve existing work.
