# Launch planned batches from one snapshot

The maintainer explicitly accepts the risk of external requirements changing after planning collection, including the possibility of retrying an affected task. Implementation is tracked in [issue #784](https://github.com/rafaeltab/wallpaperdb/issues/784). This supersedes the full-input freshness checks in [ADR 0005](0005-build-planner-directed-bases-in-one-execution-cycle.md).

The [planner capability](../../src/capabilities/plan/implementation.ts) uses one collected snapshot. The [scheduler](../../src/capabilities/plan/scheduler.ts) accepts the proposal and prepares and launches selected issues without another full collection. It does not invalidate that batch because external titles, bodies, comments, priorities or unrelated job observations changed. Accepted batches retain this behavior across restart and base-preparation retries.

Local pause, capacity, controls, cycle ownership and durable admission checks remain authoritative. Execution-base construction and selected prerequisite verification retain their existing responsibilities. New cycles collect their own snapshot; a retained cycle without an accepted selection may collect on resumption. Collection pacing and provider backoff remain owned by the existing request budget.
