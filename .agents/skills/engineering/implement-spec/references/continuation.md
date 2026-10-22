# Continuation

Recover ticket order, thread/worktree/PR mappings, reviewed and validated commits, and last published tips. Verify them against live T3 state and authenticated PR metadata before resuming.

Reuse each ticket's owning thread and worktree. Inspect staged, unstaged, and untracked changes; preserve and reconcile retained work before resuming from a clean checkout. If replacement is necessary, establish that the old thread is inactive and use T3's `existing_worktree` strategy under the [launch contract](setup.md). Investigate uncertain launches before creating another thread.

After cleanup, fetch the published branch and compare its live tip with the local ref. Fast-forward a stale local ref; require the published tip to remain an ancestor of resumed work, or preserve divergence for authorized recovery.

Preserve divergent local or remote work and apply [stack recovery](stack-recovery.md). A completed thread without a verified reviewed, validated, published PR does not unblock the next ticket.
