---
name: supervise
description: Start or adopt independent T3 conversations and supervise their work through verified results.
disable-model-invocation: true
---

# Supervise

Supervise independent top-level T3 conversations until assignments are verified or cannot reasonably progress without the user. Subagents may help verify results.

Apply [task scope](../../../../docs/agents/task-scope.md) when assigning work, answering worker questions, and judging results. Include its scope and decision context in the work record and worker and verification briefs, restoring it on resume.

## Establish the work

Use the user's task boundaries, such as one thread per issue or bullet. Recover assignments from the request, linked issues, and existing conversations. Judge completion against those assignments without a separate acceptance-criteria exercise at startup.

Find existing conversations from supplied IDs or `t3_thread_list` using the user's criteria. Paginate and read candidates; ask about ambiguous matches. Include completed threads needing verification. Start adopted threads with monitoring and verification, without a replacement launch.

Prefix each launched or adopted thread's existing title with `SUPERVISED: ` once. Remove the prefix when supervision ends for that thread.

Record assignments, dependencies, thread/run IDs, workspaces, monitoring state, verification evidence, and gaps in this conversation. For a user time budget, record the start and deadline once and check it during monitoring and verification. Update after launches, follow-ups, and verdicts so work can resume. Keep temporary investigation notes outside the repository.

Inspect live T3 tool schemas before use. If required capabilities are unavailable, report the limitation and retain the work record; do not claim supervision is running.

## Launch requested conversations

Use `t3_thread_launch` for each new conversation with the task, issue/spec links, dependencies, and user constraints. Workers follow applicable repository instructions and skills. Inherit provider, model, and modes unless requested otherwise; resolve requested models through `orchestrator_capabilities`.

For coding tasks, bind a separate worktree with `workspaceStrategy`, choosing the base from the assignment and dependencies. For a local base, use `type: "worktree"`, `baseRef`, and `startFromOrigin: false`; otherwise use the intended upstream base. Uncommitted changes do not transfer. Omitting the strategy selects the project root. Give repository research the intended branch/workspace context and preserve adopted threads' workspaces.

Launch independent tasks concurrently within user limits. Hold dependent tasks until prerequisites are verified and required artifacts are available in their base or context.

Retain returned thread/run IDs immediately, including preparing launches. Launch has no idempotency key; after an uncertain response, inspect threads before retrying.

## Monitor and verify as results arrive

Keep the turn active while selected tasks can progress. Top-level conversations have no documented automatic parent completion notification. Use bounded monitoring cycles, without recurring schedules or promises of continuation after the turn. Resume interruptions from recorded IDs and current state.

1. Read all selected threads with `t3_thread_read`, including questions and newly finished runs. Process results before waiting for the group.
2. When no result is ready, call `t3_thread_wait` with explicit thread/run IDs and short timeouts, such as 15–30 seconds. Wait concurrently for independent threads and inspect every result/error. For preparing launches without run IDs, delay briefly between reads; never invent IDs or poll continuously. Cap waits/delays by the remaining budget and below 60 seconds. Share progress at least once per minute. A timeout leaves the worker running.
3. Read finished runs' output and relevant activity. Paginate and recover truncation with `itemId`, `textOffset`, and `nextTextOffset`. Track read positions, but reread final results because messages may update in place.
4. Recheck state before accepting completion, accounting for later runs, pending/queued work, and unfinished delegated work. Terminal or idle status and claims of completion do not establish success.
5. Verify against the original assignment. Inspect code diffs and test evidence, running focused checks under the testing workflow when needed. For research/documents, inspect artifacts and decisive claims/sources. Record the version or commit verified and remaining limits.

Use a verification subagent when its independent review would help. Supply the original assignment, relevant artifacts and version, and enough context to assess the result. For non-Git research and documents, recheck affected evidence whenever the artifact or its relevant assumptions change; record the version checked. For Git-backed work, handle independent base advances with unchanged PR head and base branch under the [PR history policy](../../../../CONTRIBUTING.md#pull-request-history). Assess reviewed-work or base-branch changes under the shared [review evidence policy](../../../../CONTRIBUTING.md#review-evidence) before dispatching another reviewer. Pass the applicable verification evidence to workers on continuation or handoff. For another required delegated review round, create a fresh delegated task containing prior findings, responses, unresolved objections, and retained evidence. The supervisor remains responsible for the final verdict.

Between verifications, check other threads for questions and failures.

## Resolve questions and incomplete work

Handle worker questions through `t3_pending_request_list`, `t3_pending_request_read`, and `t3_pending_request_respond` where available. Answer from the assignment, evidence, and existing decisions. Surface unresolved decisions or permission requests with the exact missing input while independent work continues. Question tools cannot approve permission requests.

For incomplete work with a reasonable path forward, use `t3_thread_send` on the same conversation with the gap, evidence, and required result. Retain its run ID and use a stable `clientRequestId` when retrying that send. Monitor and verify the follow-up result.

Continue while a concrete next action and credible path remain, considering progress, feasibility, and user time/retry budgets. Repeated encouragement without new evidence or approach is not progress. Slowness alone does not justify interruption. Honor user pauses or cancellations.

Prefer feedback to the existing worker before taking over or replacing it. Either escalation needs a reason grounded in the failure. Preserve useful work and record replacements under the same assignment.

Distinguish outside-input blockers from work with no reasonable path to completion. Promptly report evidence, useful partial results, and what is needed. Continue independent tasks and hold failed dependencies. Resolve or report missing verification evidence.

## Finish

Finish when all assignments have verified outcomes or explained failures/blockers and none can reasonably progress, or when the user budget expires. Identify active workers and explain why supervision is ending. Budget expiry alone does not establish failure or justify cancellation. Do not imply monitoring continues after the turn.

Report each task's result, verdict, verification evidence, gaps, and needed decisions. Link conversations as `[title](t3-thread://v1/<threadId>)` with exact IDs, plus relevant deliverables. Assess verification subagents' substantive findings before summarizing them.
