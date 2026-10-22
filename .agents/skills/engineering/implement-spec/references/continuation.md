# Continue existing work

Recover the coordinator's ticket order, branch/worktree/thread mappings, expected parents, last verified published tips, PR identities, and review/validation evidence before starting more work. Missing evidence needs investigation before adoption or publication.

Read each recorded T3 thread with `t3_thread_read`, inspect its binding, and check active runs or pending work before sending another task. Reuse a valid ticket thread in its owning worktree. If a thread must be replaced, first establish that the original is inactive, preserve its history, and launch a replacement with `workspaceStrategy: {type:"existing_worktree", worktreePath:"<verified-path>", branch:"<ticket-branch>"}`. Record the new thread ID. An uncertain launch is not permission to create a duplicate.

Fetch the actual remote heads and verify recorded published tips, authenticated PR identities, and parent relationships. Compare each owning worktree's branch and full commit with those records. A missing checkout can be recreated through T3 from the verified branch; first verify the branch is not owned by another worktree. Preserve local and remote work on divergence, and integrate it under the [restacking rules](stack-recovery.md#restack-ticket-worktrees). Require the retained remote work to remain represented in the validated result before refreshing publication expectations.

Worktree branches remain checked out in their owning worktrees. Run repairs there through their ticket threads, rather than checking those branches out in the coordinator. A thread completing without a verified published PR and passing evidence does not unblock the next ticket.

Verify native membership separately from local Git state. This workflow needs no shared local `gh-stack` catalog. Preserve any existing catalog without adopting or rewriting it; use [native membership preservation](stack-recovery.md#preserve-native-membership) for the remote stack.

Resume the [ticket workflow](../SKILL.md#steps) only after the relevant thread, worktree, branch, PR, and evidence agree. Refresh `main` and inspect changed parents; restack for changed lower layers, conflicts, or native stack readiness under the shared history policy.
