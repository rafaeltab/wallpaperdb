# Full-million reporting checklist

This is a reporting template, not a result. Populate it only from the completed
or explicitly interrupted campaign's archived evidence. Keep the original failed
screen, transport diagnostics and corrected retry as separate campaigns.

## 1. Bind the evidence before summarizing

- Record campaign directory, start/end or interruption time, exact config/source
  hashes, independent audit path/hash, and whether integrity and completion pass.
  An integrity pass on an interrupted run is not a completed capacity verdict.
- Verify the same index UUID, exact million-record count, source identity,
  mapping/settings and indexing/deletion counters before and after each campaign.
  All four candidates must use the same full 6,138-utility bank and favorite
  preset. Do not substitute projection results or a differently merged index.
- Retain the 950 ms service cap, 1,500 ms client cap and **strict failure at
  1,000 ms or any error**, including warmups. Multi-stage bounds include seed
  searches, final search, result decoding and acknowledged PIT cleanup.
- Bind arrival selection to its completed primary screen, exact query plans and
  builder/executor sources. Show candidates excluded by primary gating and why.
- Reconcile raw timed/warmup rows with saved profiles. Show unfinished rows and
  their failures separately. Never infer zero campaign errors from zero errors
  in completed profiles. A completed measurement with failed final resource
  collection retains its trials but has unavailable resource deltas and cannot
  qualify. Keep audit acceptance separate from performance success.

The comparison candidates are numeric utilities with lean ID fetch, direct sort
with lean ID fetch, pooled global bounds and pooled global-maxima bounds. All
use the same stored numeric objective. Their original duplicate-target behavior
remains; the separate repeated-target correction is not silently included.

## 2. Closed-loop results: one row per actual profile

Use four query shapes (one-color vibe, 40% green, two colors, five colors), each
with unfiltered, synthetic 10% and synthetic 1% metadata eligibility, at C1/C4/C16.
That is up to 144 profiles across four methods; record actual completed, failed,
skipped and unfinished coverage rather than assuming the full matrix ran.

| Method | Query | Eligibility / actual count | Concurrency | Timed requests | p50 / p95 / p99 successful ms | Max all-request ms | Errors | >=1 s | Strict failure union | Warmup failures | Profile status |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |

- Closed-loop percentiles use successful requests; recompute the **maximum over
  every finite raw request**, including errors. Do not relabel a successful-only
  stored maximum as an all-request maximum. Keep invalid/missing latency errors
  explicit. Error and slow counts can overlap; strict failures are their union.
- Show achieved successful requests/second with its measured wall-time window.
  Closed-loop clients self-throttle, so concurrency does not mean user capacity.
- Provide a compact comparison by query/filter and load, then retain the complete
  table. Do not average percentiles or pool selective and unfiltered cases into
  one winner. A small median must not conceal five-color failures.
- Higher-load stages skipped after a failure are **not measured**, not passing.
  Keep valid lower-load observations with their exact workload and duration.

## 3. Scheduled arrivals: rate and queueing are part of the result

Produce separate tables for **fixed**, **varied** and **wide** workloads. Read
rates and durations from each saved configuration; do not fill missing stages
with the default plan. Keep every candidate/rate stage separate.

| Method | Workload | Offered rate / duration | Scheduled / dispatched / successful | Client rejections | End-to-end p50 / p95 / p99 / max ms | Queue delay p95 / max ms | Errors / >=1 s / strict union | Warmup failures | Status |
| --- | --- | --- | --- | ---: | --- | --- | --- | ---: | --- |

- End-to-end latency starts at the **scheduled arrival**, including client
  waiting. Preserve rejected, failed and unfinished requests in accounting.
  Use the arrival harness's all-trial percentiles, not closed-loop successful-only
  percentiles. State the timing boundary for rejected/unfinished observations.
- Report configured offered rate alongside achieved successful throughput and
  its denominator. Short runs, evenly spaced arrivals and a bounded client
  in-flight limit do not establish burst resilience or production user counts.
- Report per-shape failure and latency slices from raw trials where sample sizes
  allow. A mixed-workload p95 is not a guarantee for its five-color component.
- A warmup failure blocks qualification even if timed traffic later looks fast.
  Preserve any resulting omitted rate stages and reasons.

## 4. Prove actual broad color coverage

The wide plan has 8,184 distinct queries spanning 6,138 exact utility keys for one
preset. Its 64 selected warmup queries are separate from timed coverage. A
shorter traversal, or merely compiling every planned query, is not full coverage.

| Method / rate or cumulative window | Scheduled queries / keys | Dispatched queries / keys | Successful queries / keys | Successful keys / 6,138 | Full bank reached? | Target-count / mode mix |
| --- | --- | --- | --- | --- | --- | --- |

- Derive keys from actual compiled scoring fields, not requested color labels.
  Reconcile per-rate `coverage`, `cumulativeTimedCoverage`, final
  `candidateCoverage` and separate `warmupCoverage` with raw request identities.
- Verify advancing query offsets, including rejected arrivals, and no accidental
  restart at offset zero between rates. State how many complete cycles ran.
- Full coverage requires **6,138 successfully queried keys**. Count scheduled,
  dispatched and successful coverage separately; a failed attempt proves no
  successful coverage. Also report the actual target-count/mode distribution.
- A first traversal is not a controlled cold-cache experiment. Request cache is
  disabled, but other caches remain uncontrolled; keep warm repeated queries and
  first/later wide traversals distinct.

## 5. Resources and storage: attach scope and time

| Phase / campaign | Wall window | OpenSearch CPU cores | Client CPU / RSS | JVM heap peak | Container charge / anon / file / swap | I/O by device | Pressure / memory events | Missing/reset evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

- Use raw counter deltas within the same node/container identity and observed
  time window. Missing brackets, collection errors, resets or identity changes
  invalidate affected deltas; do not replace them with zero. Report sampled
  gauges separately from counters and distinguish phase peaks from lifetime peaks.
- Keep service CPU/JVM heap, benchmark client CPU/RSS, and container anonymous,
  file-cache and swap memory separate. Anonymous memory is not JVM heap; file
  cache is not client RSS. Peaks need not occur simultaneously. Do not add
  layered device I/O counters together.
- Retain the 8 CPU / 4 GiB heap / 12 GiB memory limits, one physical node, one
  primary and zero replicas. Background activity and the changed set of open
  indexes limit attribution and cross-campaign comparisons.
- Record exact primary-store bytes, segment count, translog/merge state and
  timestamp before/after queries alongside completed build time. Distinguish
  original final-build storage from later retention/merge observations. Do not
  multiply the 100k footprint to replace the measured million-record footprint.

## 6. Final recommendation and publication checks

- Lead with accuracy and observed fast response, then flexibility and measured
  CPU/memory/storage costs. Link the pooled execution fidelity and unchanged
  human-feedback outcomes; feedback is one observer's development judgments,
  not population relevance accuracy. The scale data are synthetic mixtures of
  523 real images, not one million independent wallpapers.
- Recommend only workload/load combinations supported by complete audited
  evidence with zero strict failures and adequate successful query coverage.
  Say “met the limit in this test,” not “guaranteed under one second.” If no
  candidate qualifies, report that directly and retain the failing cases.
- Keep a potential query-shape dispatch rule separate from a measured universal
  winner. Do not claim multi-node resilience, 100-million capacity, concurrent
  user counts or production readiness from these single-host runs.
- Generate a new immutable summary with all prior feedback inputs plus the new
  pooled run. Verify pending failures and scope separation before publishing.
  `publication.sourceCheckpoint` must be a **basename**; hash the exact source
  checkpoint bytes, then atomically replace only the public snapshot file.
- After publication, verify the file-only dashboard shows failed/incomplete
  campaigns and filters cannot hide unfinished failures. Preserve old snapshots,
  source archives, raw logs and independent audits.

Related: [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity protocol](FAVORITE-OPTIMIZATION-CAPACITY.md),
[wide arrivals](FAVORITE-WIDE-ARRIVALS.md), and
[publication contract](FAVORITE-PERFORMANCE-PAGE.md).
