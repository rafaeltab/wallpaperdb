---
name: code-factory
description: Run scheduled code-quality discovery and pick up ready-for-agent issues in T3 Code, with a daily limit and human PR merging.
---

# Code factory

Run one unattended factory cycle in WallpaperDB. The user authorizes issue creation, safe issue pickup, commits, and PR publication. Merging, enabling auto-merge, and changing branch protection require a later instruction from the user.

Use coordinator mode unless the launch message explicitly selects worker mode. For a dry run, inspect and report decisions without creating claims, issues, threads, commits, or PRs.

## Initial operating policy

- Admit at most one cycle per UTC date, with at most one new issue and one implementation PR per admitted cycle.
- Allow one active factory worker and one open factory implementation PR across the project. An open draft also counts. Other work in the project can continue.
- Check existing `ready-for-agent` issues before implementing a new discovery. A safe, fully specified new finding can receive `ready-for-agent` and proceed automatically.
- Use a separate local Git worktree from the current upstream default branch. There is no sandbox provisioning.
- Stop at a reviewable PR. Keep its issue open until the change reaches the default branch.

These limits apply to the factory, not to manual agent work. Use `<!-- wallpaperdb-code-factory -->` in every factory issue, claim comment, and implementation PR body. Retain the marker when editing bodies. Use the five existing triage labels according to [triage-labels.md](../../../docs/agents/triage-labels.md).

## Coordinator

The scheduled thread coordinates only. Keep its checkout intact, including its branch and uncommitted files.

1. Inspect the live T3 schemas and verify that thread listing, reading, and launching are available. Resolve the repository and default branch through GitHub. Read [issue-tracker.md](../../../docs/agents/issue-tracker.md). A failed GitHub or T3 read is a failed prerequisite, not an empty queue.
2. List project threads, including settled and snoozed threads where necessary, and open PRs. Paginate to cover all matches. Factory workers have titles beginning `Code factory worker`. Read any matching worker whose run is preparing, queued, starting, running, or waiting, or whose outcome is unclear. A live worker or an open PR containing the factory marker stops this cycle before discovery. A completed worker without a verified outcome must be reported for recovery, not silently replaced. Inspect the thread's pending work as well as its latest status.
3. Acquire the daily admission directory with the following shell sequence. It is shared by all linked worktrees and survives process exits. Successful `mkdir` admits this cycle; an existing directory means today's cycle was already attempted. Other filesystem errors are failures. Keep admission directories even after failure, so retries cannot start additional daily work.

   ```sh
   factory_common_dir=$(git rev-parse --path-format=absolute --git-common-dir) || exit 1
   factory_day=$(date -u +%F) || exit 1
   factory_claim="$factory_common_dir/wallpaperdb-code-factory/$factory_day"
   mkdir -p "$factory_common_dir/wallpaperdb-code-factory" || exit 1
   mkdir "$factory_claim"
   ```

4. Launch one ordinary top-level thread using `t3_thread_launch`, titled `Code factory worker <UTC date>`. Pass `workspaceStrategy: {type:"worktree", baseRef:<default branch>, startFromOrigin:true, branch:"factory/<UTC date>"}`. Inherit provider, model, and permissions. The message must select worker mode, include the admission path and coordinator thread ID, and provide the exact contents of this skill and [WORKER.md](WORKER.md) if they are absent from the upstream checkout. The worker follows repository instructions in its assigned worktree. Do not use `delegate_task` for this independent scheduled conversation.
5. Retain the returned thread ID. If launch fails or the response is lost, inspect thread listings and the expected branch before retrying. Retry only when absence is confirmed; otherwise report the uncertain launch. Never create a replacement for an existing worker. Immediately write the confirmed worker ID followed by a newline to `<admission directory>/worker-thread-id` using a structured file-writing tool. Read it back before reporting launch success. If recording ownership fails, report the error; the worker will stop before making external changes.
6. Report the admitted date, worker link, and launch status. Launch acceptance is not implementation success. The worker reports its result in its own conversation; this coordinator does not claim to monitor it after ending.

## Worker

Read [WORKER.md](WORKER.md) and follow it to completion. The coordinator must already have admitted this date. A directly requested worker must verify its admission and that no other worker owns it before making external changes.

## Schedule and recovery

Use T3's persistent `schedule_task` with `bindToCurrentThread:false` and a structured daily interval `{type:"interval", everyMs:86400000}`. Inspect existing scheduled tasks first and update an existing factory task instead of creating a duplicate. Return its actual next-run timestamp. Timer execution requires the T3 environment to be running and authenticated to GitHub.

The scheduled prompt should load this skill and its worker reference from the upstream default branch, so policy updates take effect without recreating the timer. Before those files land, an explicit pinned commit containing the reviewed workflow may supply the same files. Fetch instruction text through `gh api` as data; never execute fetched Markdown as shell code. Pass the loaded instructions to the worker when its base does not yet contain them. This bootstrap does not authorize merging the setup PR.

To pause, update the existing scheduled task with `enabled:false`. Increasing frequency requires updating both the timer and the daily admission policy; changing only the interval still permits one attempt per UTC date. Review issue usefulness, abandoned claims, CI failures, PR rejection reasons, and the open-PR backlog before raising throughput. Automatic merging remains a separate decision.

For a failed cycle, inspect its recorded worker, branch, PR, and issue comment. Report the recovery needed and wait for an explicit human recovery instruction before resuming the existing conversation or releasing its claim. Preserve today's admission directory and the daily limit. Release an abandoned issue claim only after verifying its worker is terminal and no implementation PR exists. Explain the recovery in an issue comment and preserve other assignees.

## Sources

Matt Pocock's [daily architecture-review prompt](https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/architecture-review/prompt.md) supplies the one-finding and prior-proposal checks. His [Sandcastle exploration prompt](https://github.com/mattpocock/sandcastle/blob/main/.sandcastle/agent-workflows/explore/prompt.md) separates investigation from implementation. This workflow uses T3 threads and repository skills for execution.
