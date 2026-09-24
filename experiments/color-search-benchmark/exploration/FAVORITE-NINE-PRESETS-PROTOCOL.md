# Nine-preset storage and performance comparison

Status: **proposed follow-up experiment; no nine-preset million-record result yet**.
This note defines the comparison and its evidence requirements. The coordinator
owns live services, launch decisions and the [current checkpoint](FAVORITE-OPTIMIZATION-CURRENT.md).

## Question

How much do nine selectable quality/cutoff presets increase storage and query cost
relative to the saved favorite alone? Separate two effects:

1. Storing additional presets while users continue querying the favorite.
2. Users querying different presets, expanding the active field working set.

The score remains the saved shade-aware, strict-hue formula. Presets are the Cartesian
product of quality influence `0`, `0.5`, `1` and cutoff weighting `0`, `1`, `3`.
The favorite is quality influence `0.5`, weighting `1`. This experiment does not add
application reranking, change the score, or establish cache pinning.

## Cohorts and storage prerequisite

Use one million deterministic mixtures of the same 523 real-image measurements,
256 bins, numeric float utilities with points and doc values, source disabled,
one primary and zero replicas. Synthetic records are not independent photographs.
The nine-preset bank has **55,242 utility fields**, versus **6,138** for the favorite.

The existing favorite index used **56,048,738,808 primary-store bytes**. Multiplying
by nine gives **504,438,649,272 bytes**, a planning estimate only. Repetition and
compression can change the measured ratio. The reported roughly 235 GB available
on the current filesystem does not support assuming this full build will fit.
Retain the existing index and evidence; do not delete them to make room.

A **100,000-record, nine-preset pilot** can estimate storage and expose mapping or
ingestion limits once storage is available. The existing full 100k favorite-preset
receipt measured **13,044,690,824 bytes across 30 segments**. Nine times that is
**117,402,217,416 bytes**. Scaling the million-record receipt down first gives a
much lower 50.44 GB estimate, illustrating why the different segment layouts and
merge histories prevent treating either extrapolation as a reliable bound. Use the
larger plausible estimate for launch planning until measurements justify otherwise.
The pilot does not satisfy the requested million-record comparison and cannot
establish its query capacity. Do not compare its timings directly with the
million-record baseline.

Before starting even the pilot, use fresh available-byte measurements from the
actual data filesystem. Preserve the coordinator-selected 100–120 GB free-space
reserve and additional room for transient ingestion/merges. State exact byte units
in the launch receipt. Even a 120 GB reserve plus the larger pilot estimate exceeds
the reported 235 GB free, before any transient headroom. A 100 GB reserve leaves
only about 17.6 GB beyond that estimate. Neither supports a safe launch assumption.
For illustration, a 120 GB reserve plus twice 117.4 GB requires about 354.8 GB free;
two times the estimate is a planning allowance, not an upper bound on merge
amplification. Leave the build unstarted while capacity is unresolved.

The disk guard must check before creation and throughout generation/submission,
stop adding work when the reserve is crossed, drain submitted requests, and retain
partial receipts. Its measurement must include the filesystem actually used by
OpenSearch, including any configured relocation. Errors reading capacity must stop
the build. Do not silently substitute a projection or smaller corpus as the full
result. Reassess the full build from measured pilot size, metadata overhead, available
space and observed transient growth before launching it.

## Controlled query comparison

| Case | Indexed presets | Requested presets | Purpose |
| --- | ---: | --- | --- |
| A | Favorite only | Favorite | Baseline rerun under current conditions |
| B | All nine | Favorite, same query sequence as A | Cost of wider storage/mapping |
| C | All nine | Interleaved preset selections | Cost of a larger active working set |

Use numeric and ordinary bounded scoring. Preserve numeric doc-value ID retrieval,
pooled bounded cleanup, global top-20 semantics and the existing failure limits.
Each method needs identical query order and arrival times for a given case.

Keep the actual service version, CPU quota, JVM heap, memory limit, shards, replicas,
timeouts and driver concurrency limit constant. Open only the index being measured,
plus the same unavoidable background services; keep other scratch indexes closed.
This includes the larger nine-preset mapping's memory cost in case B. Opening both
indexes throughout would make A carry that mapping overhead too and answers a
different question.

Run 16 requests/second first, escalating to 64 only after the candidate passes.
128 is optional capacity discovery, not required to answer the preset comparison.
Repeat A/B in reverse order if feasible to expose order or host drift. Closing and
reopening indexes does not create a cold operating-system cache. Do not clear the
host's global page cache. Describe this as the observed cache state, with explicit
warmups and resource observations, rather than claiming a controlled cold-cache test.

## Workload coverage

The original broad workload contains 8,184 queries: 6,138 coverage queries and
2,046 additional combinations. Zero-percent queries include a positive dummy
target; preserve this behavior and its actual target-count mix in comparisons.
Named-family requests retain their explicit parameter override.

The complete Cartesian nine-preset workload has **73,656 query definitions** and
**55,242 distinct utility fields**. Preset assignments should be interleaved across
the run, not executed as nine isolated preset blocks. A complete cycle needs:

| Rate | Minimum whole-second duration | Scheduled requests at that duration |
| --- | ---: | ---: |
| 16/s | 4,604 s | 73,664 |
| 64/s | 1,151 s | 73,664 |

The existing 600-second duration cap is insufficient for those complete traversals.
A smaller balanced workload is useful, but must be called a sample. Record actual
coverage for every preset; never infer successful coverage from the schedule.
Cases A and B must still use the same favorite-only sequence and shape mix.

Record scheduled, dispatched and successful coverage separately, per preset and
combined. Persist query identity, absolute traversal offset, effective parameters
and compiled fields. Warmups must include every preset and retain every error.
Request cache stays disabled; other cache state remains observed rather than pinned.

The existing driver retains compiled plans and result evidence. Prior broad runs
used approximately 0.63 GiB driver RSS. Expanding all retained structures ninefold
can disturb the shared host. Monitor driver memory, avoid compiling unused matrix
copies, and record any material harness pressure. Evidence overhead is not a
production gateway memory requirement.

## Readiness and timing boundaries

Before timing, independently verify complete bulk acknowledgements, count, mapping,
source/seed identities and sampled values against the original encoder. Audit all
nine presets in the sampled documents, and compare favorite values with the old
index. Confirm numeric/bounded top-20 parity for each preset before load.

Finish refresh and flush, wait for recovery and merges to settle, then capture
segment counts and storage. Require consecutive quiet activity samples rather than
equating the final accepted bulk with readiness. No indexing, browser QA, value
audits, large artifact scans or other benchmarks should overlap timed queries.

Any error, client admission rejection or elapsed time of at least 1,000 ms fails
the tested load; warmups count too. Rejections remain in the scheduled denominator.
Failure categories overlap and must not be added together. Preserve failed trials,
timeouts, resource-read failures and skipped escalation. Successful evidence audit
and successful performance are separate outcomes.

## Resource observer

Reuse `favorite-resources.py` with the **actual JVM host PID**, not the container
entrypoint. This gives JVM process RSS alongside the same cgroup observations.
Use a fresh observer directory after every restart and record PID/cgroup identity,
actual service/JVM version, heap configuration, CPU quota and memory limit.

Capture every two seconds:

- Container CPU time, quota throttling and CPU pressure.
- Anonymous memory, file cache, other charges, swap, memory events and pressure.
- Per-device I/O counters, major faults and file-page refaults.
- JVM process RSS and node-reported heap/GC/search activity.
- Host available memory, swap and CPU/memory/I/O pressure.
- Driver CPU, heap/RSS and scheduler delay from the query runner.

Analyze interval differences after timing. Cgroup lifetime `memory.peak` is not a
profile-specific peak. Do not add stacked block-device counters or independently
peaking memory gauges together. Keep indexing, settling, audits and query intervals
separate. Archive exact observer prefixes and hashes; report gaps or host disturbances
without deleting affected trials.

## Storage interpretation

Compare settled **primary-store bytes** and report the actual ratio. Also record
segment count, translog size and merge/recovery activity. Repeat the size observation
after the campaign to reveal remaining drift. Do not force-merge only one cohort.

Primary-store size excludes replicas, translog, temporary merge/recovery headroom,
old retained indexes, benchmark artifacts and wallpaper files. The full index size
is not the amount of RAM required by its active query working set. Pilot extrapolation
and the measured million-record result must remain separately labelled.

## Independent audit checklist

- Reconcile generated IDs, submitted batches, accepted creates and final count.
- Verify every expected preset/field and sampled original-encoder float32 values.
- Bind exact source/config/plan hashes, index UUIDs, mappings and generations.
- Verify old/new favorite equality and numeric/bounded correctness across presets.
- Reconstruct effective parameters and utility suffixes for recorded requests.
- Check A/B request-sequence identity and mixed-workload shape/preset distribution.
- Recount scheduled/dispatched/successful queries and fields per preset.
- Check rate/duration totals and offset advancement through rejected requests.
- Recompute latency and strict failures from raw rows, including warmups.
- Verify no index/source mutation or overlapping timing/audit phases.
- Recompute resource brackets and preserve observer gaps/shared-host pressure.
- State separately the measured storage cost, favorite-query cost, mixed-preset
  cost, tested capacity and any work still blocked by storage.
