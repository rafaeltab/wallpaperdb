# Storage interpretation after bulk indexing

Independent source review, 2026-09-22. No OpenSearch requests made by this reviewer.

The benchmark disables periodic refresh, refreshes after each indexing stage, then waits for search and merge activity to become quiet. This measures a reproducible observed state, but quiet merges alone do not prove that all obsolete segment references have been released.

OpenSearch 2.11's `EngineMergeScheduler.afterMerge` schedules a flush when eligible to release transient disk usage from completed merges. For other large merges it sets a flag so a later operation can flush. This is direct support for treating observed store bytes after merges as potentially transient. [OpenSearch 2.11 implementation](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11/server/src/main/java/org/opensearch/index/engine/InternalEngine.java).

The segments API distinguishes searchable segments from committed segments; a segment can exist on disk before a refresh exposes it to searches. [OpenSearch segments API](https://docs.opensearch.org/latest/api-reference/index-apis/segment/).

Inference for this experiment: old searchable readers and retained commits are plausible contributors to extra storage. They are hypotheses until the captured before/after segment lists and store sizes show what changed.

Keep the completed campaign immutable. Record separate snapshots before maintenance, after a normal refresh and settling, and, if necessary, after a normal flush and settling. Report store bytes, segment count, committed/searchable flags and document count at each step. A force merge changes segment topology further and is unnecessary for this first diagnosis. Preserve the original latency figures as measurements of their actual original segment layout; a new layout needs separately labeled timings.
