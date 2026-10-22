# Review timeout and recovery

Applies separately to code and security reviews. Keep the normal approval requirements intact throughout recovery.

## Deadline

Allow 60 minutes for a review round to complete, including queue time. For a manual round, use the authenticated request timestamp. For an automatic round, use the bot's verified start timestamp. If neither is exposed, record when the pending review was first observed and measure from there, without claiming an earlier start.

The margin comes from a small October 21, 2026 sample of seven completed reviews with matching manual requests: median 9.27 minutes, range 2.93–18.95 minutes. Sixty minutes exceeds three times the longest observation. These are request-to-completion measurements, not worker execution times. Sources include [#437](https://github.com/rafaeltab/wallpaperdb/pull/437#issuecomment-6318378770), [#440](https://github.com/rafaeltab/wallpaperdb/pull/440#issuecomment-6319931317), [#441](https://github.com/rafaeltab/wallpaperdb/pull/441#issuecomment-6321493096), [#446](https://github.com/rafaeltab/wallpaperdb/pull/446#issuecomment-6320441487), and [#447](https://github.com/rafaeltab/wallpaperdb/pull/447#issuecomment-6320821239).

Retain each kind's request URL, start, deadline, last authenticated status and update, comparison identity, and recovery attempts in the existing ledger. Conversation compaction and monitoring wakes preserve these values. Repeated reads and unrelated comment edits do not restart the clock.

Before requesting recovery after a comparison changes, assess retained evidence under the shared [review evidence policy](../../../../../CONTRIBUTING.md#review-evidence). An equivalent history change preserves the associated round's deadlines and retry counts. It neither creates a missing review nor replenishes its recovery budget. A newer pending or adverse round still requires handling under the main skill.

## One recovery request

On a wake at or after the deadline:

1. Refresh the open PR, head/base comparison, bot summary, requests, and results. Handle a completed result normally. If a newer review round has actually started, record its identity and start while preserving the recovery count for that comparison.
2. If a required review has not completed by its deadline, including a recorded manual request with no pending or running review, allow one recovery request for that kind and comparison. Record the attempt before posting the corresponding trigger under section 4 of the main skill. Identify the full head and base, the timed-out round, and that this is its single recovery request. Verify publication and retain its URL; after an uncertain write, inspect for the existing comment before considering another write.
3. Give the recovery round the same completion budget. Track any automatically restarted counterpart review too. If the recovered kind remains incomplete after that budget, or a known failure cannot be recovered within scope, return an actionable blocker with timestamps and links. A further request needs explicit user instruction.

Elapsed time establishes this workflow's timeout, not proof that the provider has stopped working. Recovery is authorized even when internal progress is unavailable. A timeout never waives code review, security review, or the bot's approval reaction. Report task links only when they are usable and belong to the current round.

## Wakes

Keep using the T3 PR watcher. Its current tool contract does not promise a wake when a review deadline expires. Apply the deadline at the next supported wake, and state that limitation in the handoff while reviews are pending. Use a one-off deadline wake only if the host exposes one and the runtime permits it. An interval schedule is recurring work, not a one-off timer. Preserve the deadline when yielding; do not claim an exact timeout wake that the host cannot deliver.
