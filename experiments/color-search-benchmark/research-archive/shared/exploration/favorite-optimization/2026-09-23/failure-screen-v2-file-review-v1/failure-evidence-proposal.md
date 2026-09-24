# Minimal failure-evidence follow-up — proposed, not implemented

Finish the transport A/B before changing benchmark evidence handling. Preserve the
original incomplete run, raw 7,491 errors and every old source snapshot.

## Retain request failure detail

Keep the existing `error` string and strict failure counters. Add bounded structured
details to raw request rows: error name/message/code/errno/syscall/address/port,
nested causes, and AggregateError entries. Bound depth, array length and string
size and guard cycles so serializing a failure cannot itself break recording.
Preserve `error.evidence` as `executionEvidence`; both bounded executors already
attach completed stages, cleanup failure and global-bound evidence, but the
benchmark currently discards it. Capture request start/completion wall timestamps
as well as the existing monotonic latency so onset can be located exactly.

Raw rows are the durable detailed record. Compact checkpoint trials should retain
existing error/counter fields, with a failure-detail hash if binding is needed;
do not duplicate large stage objects across every saved checkpoint unnecessarily.

## Retain a finished workload when resource collection fails

After the load scheduler completes, construct and checkpoint its trials/metrics
before depending on the final resource read. If that read fails, persist an
explicit profile with `measurementComplete: true`,
`resourceCollectionComplete: false`, `after: null`, and structured `resourceError`.
Preserve every completed ordinal and existing successful-only latency statistics
alongside all strict request failures. CPU deltas requiring a missing endpoint
must be null. Observed gauges may remain, clearly labeled as incomplete samples.
Then rethrow: the campaign stays interrupted and cannot qualify for arrivals.
A resource failure must not be presented as a successful capacity result.

The independent capacity auditor needs a narrow branch for this explicit profile
shape. It should reconcile the recorded workload with raw request rows, accept its
integrity when correct, and still report incomplete/unqualified campaign evidence.
Do not relax completeness or viability checks on old artifacts.

## Focused regression cases

1. A nested ECONNRESET cause survives raw serialization, including code/syscall.
2. A bounded cleanup failure retains its completed-stage and close-error evidence.
3. Final resource-read failure preserves all completed workload ordinals and the
   exact union of error/one-second failures.
4. Missing resource endpoint leaves CPU deltas null and cannot qualify a candidate.
5. The original complete artifact schema and its independent audits are unchanged.
6. Cyclic/oversized failures are bounded without throwing from the recorder.

No scorer, query body, ranking objective, request retry, service timeout, or host
configuration change belongs in this evidence-only follow-up.
