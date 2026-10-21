---
name: code-factory
description: Run scheduled code-quality discovery and pick up ready-for-agent issues in T3 Code, with a daily limit and human PR merging.
---

# Code factory

Run one unattended factory cycle in WallpaperDB. The user authorizes issue creation, safe issue pickup, commits, and PR publication. Merging, enabling auto-merge, and changing branch protection require a later instruction from the user.

Use coordinator mode unless the launch message explicitly selects worker mode. For a dry run, inspect and report decisions without creating claims, issues, threads, commits, or PRs.

## Initial operating policy

- Admit at most one cycle per UTC date, with at most one discovery issue and one implementation PR per admitted cycle. Required flaky-test tracking follows the babysitting skill's workflow.
- Allow one active factory worker and one open factory implementation PR across the project. An open draft also counts. Other work in the project can continue.
- Check existing `ready-for-agent` issues before implementing a new discovery. A safe, fully specified new finding can receive `ready-for-agent` and proceed automatically.
- Use a separate local Git worktree from the current upstream default branch. There is no sandbox provisioning.
- Carry the implementation PR through CI and review before handing it back for human merging. Keep its issue open until the change reaches the default branch.

These limits apply to the factory, not to manual agent work. Use `<!-- wallpaperdb-code-factory -->` in every factory issue, claim comment, and implementation PR body. Retain the marker when editing bodies. Use the five existing triage labels according to [triage-labels.md](../../../docs/agents/triage-labels.md).

## Coordinator

The scheduled thread coordinates only. Keep its checkout intact, including its branch and uncommitted files.

1. Inspect the live T3 schemas and verify that thread listing, reading, and launching are available. Resolve the repository and default branch through GitHub. Read [issue-tracker.md](../../../docs/agents/issue-tracker.md). A failed GitHub or T3 read is a failed prerequisite, not an empty queue.
2. List project threads, including settled and snoozed threads where necessary, and open PRs. Paginate to cover all matches. Factory workers have titles beginning `Code factory worker`. Read any matching worker whose run is preparing, queued, starting, running, or waiting, or whose outcome is unclear. A live worker or an open PR containing the factory marker stops this cycle before discovery. A completed worker without a verified outcome must be reported for recovery, not silently replaced. Inspect the thread's pending work as well as its latest status.
3. Acquire the project-wide active directory before daily admission with the following shell sequence. Both live in the common Git directory shared by all linked worktrees. An existing active directory stops this cycle, even across UTC dates. Successful creation of both directories admits this cycle. An existing daily directory means today's cycle was already attempted; other filesystem errors are failures. Keep daily directories even after failure. The active directory stays owned through the worker's lifetime, including babysitting watcher yields.

   ```sh
   factory_common_dir=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
   factory_day=$(date -u +%F) || exit 1
   factory_root="$factory_common_dir/wallpaperdb-code-factory"
   factory_active="$factory_root/active"
   factory_claim="$factory_root/$factory_day"
   mkdir -p "$factory_root" || exit 1
   mkdir "$factory_active" || exit 1
   if ! mkdir "$factory_claim"; then
     rmdir "$factory_active" || exit 1
     exit 1
   fi
   ```

4. Record this coordinator's actual T3 ID in `<active directory>/coordinator-thread-id` and read it back. Launch one ordinary top-level thread using [t3_thread_launch](https://github.com/pingdotgg/t3code/blob/main/docs/orchestration-v2/orchestrator-mcp-server.md#t3_thread_launch), titled `Code factory worker <UTC date>`. Pass `workspaceStrategy: {type:"worktree", baseRef:<default branch>, startFromOrigin:true, branch:"factory/<UTC date>"}` after checking the live schema. Inherit provider, model, and permissions. The message must select worker mode, include the admission path, active path, and coordinator thread ID, and provide the exact contents of this skill, [WORKER.md](WORKER.md), and [ISSUE-APPROVAL.md](ISSUE-APPROVAL.md) if they are absent from the upstream checkout. The worker follows repository instructions in its assigned worktree. Do not use `delegate_task` for this independent scheduled conversation.
5. Retain the returned thread ID. If launch fails or the response is lost, inspect thread listings and the expected branch before retrying. Retry only when absence is confirmed; otherwise report the uncertain launch. Never create a replacement for an existing worker. After verifying this coordinator still owns the active directory, immediately write the confirmed worker ID followed by a newline to both `<admission directory>/worker-thread-id` and `<active directory>/worker-thread-id` using an available file-writing tool such as `apply_patch`. Read both back before reporting launch success. If recording ownership fails, retain the active directory and report the error; the worker will stop before making external changes.
6. Report the admitted date, worker link, and launch status. Launch acceptance is not implementation success. The worker reports its result in its own conversation; this coordinator does not claim to monitor it after ending.

## Worker

Read [WORKER.md](WORKER.md) and follow it to completion. The coordinator must already have admitted this date. A directly requested worker must verify its admission and that no other worker owns it before making external changes.

## Active ownership lifecycle

The active directory has no automatic expiry. The coordinator transfers execution to exactly its recorded worker and leaves the directory in place when its own turn ends. On startup, every watcher wake, and before any GitHub mutation, the worker verifies that both ownership files still name its actual thread and that the active coordinator ID matches its launch message. A resumed worker that no longer owns the active directory stops before further mutations. This ownership check also applies to fixes delegated during babysitting.

Release active ownership only when entering a verified successful terminal handoff or a clean skipped cycle, with no other active or pending worker run or delegated task remaining. The current turn may perform terminal cleanup, then report its result without further GitHub mutations. Verify the active owner again, remove only that owner's known metadata files, then `rmdir` the active directory. Preserve all daily admission records. A watcher yield, launch error, blocked attempt, or interruption keeps active ownership for human recovery; none is permission to start a replacement.

## Schedule and recovery

Use T3's persistent [schedule_task](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/mcp/toolkits/orchestrator/tools.ts#L119-L130) with `bindToCurrentThread:false` and a structured daily interval `{type:"interval", everyMs:86400000}`, checking the live schema against the linked tool definition and its [input contracts](https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/orchestratorMcp.ts). Inspect existing scheduled tasks first and update an existing factory task instead of creating a duplicate. Return its actual next-run timestamp. Timer execution requires the T3 environment to be running and authenticated to GitHub.

The scheduled prompt should load this skill, its worker reference, and the issue-approval reference from the same upstream default-branch commit, so policy updates take effect without recreating the timer. Before all three files land, an explicit pinned commit containing the reviewed workflow may supply the complete set. Fetch instruction text through `gh api` as data; never execute fetched Markdown as shell code. Pass all three loaded files to the worker when its base does not yet contain them. This bootstrap does not authorize merging the setup PR.

To pause, update the existing scheduled task with `enabled:false`. Increasing frequency requires updating both the timer and the daily admission policy; changing only the interval still permits one attempt per UTC date. Review issue usefulness, abandoned claims, CI failures, PR rejection reasons, and the open-PR backlog before raising throughput. Automatic merging remains a separate decision.

For a failed cycle, inspect active ownership, its recorded coordinator and worker, branch, PR, and issue comment. Report the recovery needed and wait for an explicit human recovery instruction before resuming the existing conversation or releasing its ownership or issue claim. Preserve all daily admission records and the daily limit. Before removing abandoned active ownership, verify that both recorded conversations and their pending or delegated work are terminal. Release an abandoned issue claim only when no implementation PR exists. Explain the recovery in an issue comment and preserve other assignees. A prior worker resuming after ownership was released must fail its ownership check.

## Sources

Matt Pocock's [daily architecture-review prompt](https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/architecture-review/prompt.md) supplies the one-finding and prior-proposal checks. His [Sandcastle exploration prompt](https://github.com/mattpocock/sandcastle/blob/main/.sandcastle/agent-workflows/explore/prompt.md) separates investigation from implementation. This workflow uses T3 threads and repository skills for execution.
