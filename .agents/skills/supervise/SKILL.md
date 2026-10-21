---
name: supervise
description: Start or adopt independent T3 conversations and supervise their work through verified results.
disable-model-invocation: true
---

# Supervise

Supervise independent T3 conversations in WallpaperDB until their assignments are verified or cannot reasonably progress without the user. The supervised workers are ordinary top-level threads. Subagents may help verify their results.

## Establish the work

Use the user's requested task boundaries, such as one thread per issue or bullet. Recover each assignment from the user's request, linked issue, and existing conversation. Judge completion against that assignment using your judgment; explain what was achieved in the final summary rather than requiring a separate acceptance-criteria exercise at startup.

For existing conversations, use IDs supplied by the user or discover matches with `t3_thread_list` using the user's criteria. Paginate as needed and read candidates before adopting them. Resolve ambiguous matches with the user. Include matching completed threads whose results still need verification. Adopting a thread starts with monitoring and verification, without launching a replacement.

Keep a compact record in this conversation of each assignment, dependencies, thread ID, relevant run ID, workspace, monitoring state, verification evidence, and unresolved gaps. For a user-supplied time budget, record the start and deadline once and check it during monitoring and verification. Update the record after launches, follow-ups, and verdicts so supervision can resume after an interruption. Keep temporary investigation notes outside the repository.

Inspect the live T3 tools and their schemas before using them. If required capabilities are unavailable, explain the limitation and retain the work record instead of claiming supervision is running.

## Launch requested conversations

Use `t3_thread_launch` for each new independent conversation. Give it the task, relevant issue/spec links, dependency context, and the user's constraints. Let the worker follow WallpaperDB's applicable repository instructions and skills. Inherit provider, model, and modes unless the user requests otherwise; resolve requested model selections through `orchestrator_capabilities`.

For coding tasks, explicitly bind a separate worktree through `workspaceStrategy`. Choose the base from the assignment and dependency state. For a local base, use `type: "worktree"`, `baseRef`, and `startFromOrigin: false`; use an upstream base when that is intended. Local worktree bases contain committed work, so account for required uncommitted changes before dispatching. Omitting the strategy uses the project root, not this thread's checkout. Repository research also needs the intended branch/workspace context. Preserve adopted threads' existing workspaces.

Launch independent tasks concurrently within the user's limits. Hold dependent tasks until prerequisites are verified and their required artifacts are available in the chosen base or context. Separate worktrees alone do not transfer another task's changes.

Retain the returned thread and run IDs immediately, including launches still preparing. Launch has no idempotency key: after an uncertain response, inspect the thread list and candidate conversations before retrying so you do not create duplicate workers.

## Monitor and verify as results arrive

Keep the supervisor turn active while selected tasks can progress. Independent top-level conversations do not have a documented automatic parent completion notification. Use bounded monitoring cycles; do not add a recurring schedule or promise background continuation after this turn ends. If interrupted, resume from the recorded IDs and reread current state.

1. Read current thread states with `t3_thread_read`. Check all selected threads, including pending questions and newly finished runs, before waiting. Process available results without waiting for the group to finish.
2. When no result is ready, wait on active runs with `t3_thread_wait`, passing explicit thread and run IDs and short timeouts, for example 15–30 seconds. Concurrent bounded waits can cover independent threads; inspect each result and error after every cycle. While a launch is preparing without a run ID, use a short bounded delay between status reads rather than inventing an ID or polling continuously. Keep waits below 60 seconds and share meaningful progress at least once per minute. A timeout leaves the worker running and is not a failure verdict.
3. For each finished run, read its actual output and relevant activity. Follow pagination and recover truncated text using `itemId`, `textOffset`, and `nextTextOffset`. Track read positions for efficiency, but reread the finished run's result because an earlier message may have been updated in place.
4. Check current state again before judging the assignment finished. A terminal run status, an idle thread, or a worker saying "done" is not evidence that the goal succeeded. Account for later runs, pending or queued work, and explicitly unfinished delegated work before accepting the result.
5. Verify the deliverable against the original assignment. For code, inspect the actual workspace/diff and relevant test evidence, running focused checks when needed under the repository's testing workflow. For research or documents, inspect the artifact and check the claims or sources that determine success. Record the artifact version or commit verified. State what remains unverifiable.

Use a verification subagent when its independent review would help. Supply the original assignment, relevant artifacts and version, and enough context to assess the result. For another delegated review round, create a fresh delegated task containing prior findings, responses, and unresolved objections. The supervisor remains responsible for the final verdict. Recheck affected evidence when later changes invalidate a verdict.

Between verifications, revisit other selected threads so questions and failures are handled while unrelated work continues.

## Resolve questions and incomplete work

When a worker asks a question, use `t3_pending_request_list`, `t3_pending_request_read`, and `t3_pending_request_respond` where available. Answer from the assignment, repository evidence, and decisions already made. Surface unresolved user decisions or permission requests with the exact missing input, and continue independent tasks. These question tools cannot approve permission requests.

For incomplete work with a reasonable path forward, send concrete corrective feedback to the same conversation with `t3_thread_send`. Describe the observed gap, supporting evidence, and required result. Retain the returned run ID and use a stable `clientRequestId` when retrying the same send. Resume monitoring and verify the follow-up result rather than accepting a promise to fix it.

Continue when there is a concrete next action and a credible path to success. Use progress, feasibility, and any user-supplied time or retry budget to decide whether another attempt is worthwhile. Repeating encouragement without a changed approach or new evidence is not progress. Slow execution alone does not justify interrupting a worker. Honor explicit user pauses or cancellations.

Keep the supervisor focused on coordination and verification. Prefer feedback to the existing worker before taking over implementation or replacing it; either escalation needs a reason grounded in the failure. Preserve useful existing work and record any replacement thread under the same assignment.

Distinguish work blocked on outside input from work that has no reasonable path to completion. Explain the evidence, useful partial results, and what would be needed to proceed. Report these failures promptly, continue independent tasks, and hold tasks whose prerequisites failed. Missing verification evidence is a gap to resolve or report, not a verified success.

## Finish

Finish when every selected assignment has a verified outcome or an explained failure/blocker, and no selected work can reasonably progress within the user's constraints. If handing back while a worker is still active, identify it and explain why supervision is ending. Never imply that monitoring continues after this turn.

Summarize each task's achieved result, verdict, verification evidence, remaining gaps, and any decision needed from the user. Link its conversation as `[title](t3-thread://v1/<threadId>)` using the exact returned ID, and link relevant deliverables. Summarize substantive findings from verification subagents rather than forwarding their verdicts without assessment.
