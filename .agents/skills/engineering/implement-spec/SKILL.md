---
name: implement-spec
description: "Implement a spec's tickets sequentially in T3 worktrees, stack their PRs, and verify the complete spec."
disable-model-invocation: true
---

1. Read the full spec, tickets, comments, and dependencies through the [issue tracker](../../../../docs/agents/issue-tracker.md). Order unfinished tickets by dependency. Verify already-landed requirements before excluding them.
2. Follow [setup](references/setup.md). For each ticket, launch one ordinary T3 thread with `t3_thread_launch` in a separate worktree. Base the first on fetched `main`, and each later ticket on the preceding PR's verified published head. The coordinator owns branch and worktree setup.
3. Give the thread the issue, full spec, predecessor PR, current workflow instructions, and [publication constraints](references/stack-recovery.md#publishing), including its expected remote tip or absence. Tell it to use $do-work through publication, keeping its PR draft. Wait for completion and verify the published PR, passing reviews, validation, and issue evidence before starting the next ticket.
4. Keep one PR per ticket: the first targets `main`, each later PR targets the preceding PR. Follow [stack publication and recovery](references/stack-recovery.md). Record ticket threads, worktrees, PRs, and passing commits outside the repository. Reuse existing threads for repairs and [continuation](references/continuation.md).
5. After every ticket is published, run separate $code-review and $review-agent subagents in parallel on the complete stack against current `main`. Give them the full spec and all tickets. Require the Spec review to account for every requirement with implementation and validation evidence, including cross-ticket behavior and requirements missing from tickets. Record the reviewed `main` and top commits.
6. Fix every confirmed gap in its owning ticket thread with new commits. Add a ticket for required work without an owner. Refresh affected layers, validation, and reviews, then repeat the complete-spec review until no required work remains.
7. Validate the combined result with $testing and verify published heads and PR targets match the reviewed work. Recheck live `main` against the reviewed commit before readiness; refresh affected reviews and validation if it changed. Mark PRs ready, verify tickets are `In Review`, and report PRs, thread links, validation, and the final spec verdict. Keep worktrees for repairs. Leave issues open until landing; merge only when explicitly requested, following [landing rules](references/landing.md).
