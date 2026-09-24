# Conditional broad-bank stress follow-up

Prepared only; no runtime edits, tests, service calls or launch.

Root must first review the completed `full-million-pooled-arrival-wide-v1` run and its independent audit. The ordinary bounded pooled candidate must pass rate16 with no strict failures, no client rejection, and all6,138 utility keys observed in successful responses. The Make pipeline below does not implement that decision itself.

`favorite-bounded-pooled-only.json` copies exactly one candidate object from the four-method primary config. Both the arrival runner and its independent auditor accept this subset and still verify candidate identity, allfour unfiltered C1 approvals, recursive builder/executor sources, the original four query bodies, and the index generation. No harness change is needed.

`stress-plan.json` runs wide arrivals at64 then128 requests/second for180seconds each, followed by the existing independent audit. The existing runner skips128 if64 fails. The schedules contain11,520 and23,040 requests, respectively, each longer than the8,184-query cycle. Report actual successful coverage separately for each rate.

Use a fresh persistent pipeline directory `full-million-pooled-bounded-wide-stress-pipeline-v1`, and preserve output directory `full-million-pooled-bounded-wide-stress-v1`. Expected timed work is at most six minutes, plus preflight,64warmups, settling and audit. Source fingerprints and the active campaign remain unchanged.
