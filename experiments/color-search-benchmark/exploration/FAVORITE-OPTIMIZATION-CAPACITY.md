# Full-bank capacity campaign

## Current recommendation and status

**The full-million closed-loop retry passed all 144 profiles and its independent audit at 19:20 UTC: 1,007,172 timed requests plus 48 warmups, zero errors or requests at/above one second. Maximum timed latency was 491.544 ms.** The full eight-phase campaign completed and was audited at 20:18:51 UTC. Ordinary pooled bounds alone passed fixed 128 requests/s; all four passed the lighter varied mix at 128/s. Numeric and both bounds passed wide 16/s with all 6,138 keys successfully queried; sorted failed that wide load. The higher-rate follow-up is also complete and audited: both numeric and ordinary bounds passed broad 64/s and failed broad 128/s. [The current handoff](FAVORITE-OPTIMIZATION-CURRENT.md) retains completed job identities and remaining resource-report work.

The four measured candidates are numeric utilities with lean ID fetch, direct numeric sort with lean ID fetch, global bounds with pooled cleanup, and global-maxima bounds with pooled cleanup. All used the same million-record index and favorite preset's 6,138 float utilities, numeric points, doc values and disabled source storage. Each passed 36 profiles: four query shapes × three metadata eligibility levels × concurrency 1/4/16. Original transports and their failed first screen remain preserved; the successful retry does not replace their evidence.

Numeric execution refinements are the current priority. In the completed one-million projection, 18-bit and 27-bit features were slower and provided no human-feedback improvement. Their full-bank builds are deferred. The initial rank18-first recommendation is preserved below as a **superseded proposal**.

The recommendation from this prototype round is the **256-bin precomputed numeric bank**, with
numeric scoring as the broad-query reference and ordinary pooled bounds retained
for workloads where they measured better. Both passed the audited wide64 profiles and both failed wide128;
numeric had lower wide p95, while ordinary bounds alone passed fixed128. A combined
dispatcher has not been benchmarked. Direct sort's broad failure prevents treating
its fast repeated single-target results as a general default. Query/resource audits and v11 browser checks are complete. At passing64, bounds used less OpenSearch CPU (1.774 vs3.087 cores), but had higher latency and more device reads (107.63 vs74.24 GB per180s). Data reads/cache behavior are the next investigation target, alongside execution choice; no further test campaign is planned in this round. The cardinality compiler passed nine offline tests but
remains unintegrated and unmeasured; new-bound experiments are deferred. See the [recommendation and limits](FAVORITE-OPTIMIZATION-RESULTS.md#recommendation-for-this-prototype-round).

The full-million unfiltered C1/C16 p95 values were **2.04/8.28 ms for direct single-color sort**, **12.26/63.34 ms for pooled two-color bounds**, and **77.18/291.66 ms for pooled five-color bounds**. Selective metadata filters often favored simple numeric scoring for combinations: at nominal 1% eligibility, five-color numeric p95 was **4.91/11.26 ms**, versus **17.96/93.88 ms** for bounds. Maxima bounds were not consistently faster than the simpler bound. The [complete C1/C16 matrix](FAVORITE-OPTIMIZATION-RESULTS.md#full-million-closed-loop-retry-complete-and-audited) keeps all methods, shapes and filters separate; C4 also passed. Keep workload mixes explicit and preserve the measured broad64 pass/broad128 fail boundary when choosing a broad-query policy.

Closed-loop evidence is `full-million-four-methods-pooled-v1/audit-independent-pooled-v1.json` plus the small phase log `full-million-pooled-pipeline-v1/full-1m-four-methods-pooled.log`. The audit records complete/accepted evidence, zero incomplete resource profiles and zero pending rows. A 2.32-second file-only proof replay overlapped the start at 18:47:38.419–18:47:40.739 UTC; retain `known-overlap.json`. Independent attribution found 78 numeric one-color-vibe C1 requests in that window, with zero errors or slow requests; all remain in the results without adjustment. No service calls or runtime changes accompanied that overlap. These synthetic records derive from 523 real images, on one shared host with eight CPU quota, 4 GiB heap, 12 GiB memory, one primary and no replicas; they do not establish multi-node or 100-million-image capacity.

## Fixed and varied arrival limits

Each workload completed 16 profiles and 27,840 scheduled timed requests, at
8/32/64/128 requests/s for 30 seconds per rate and method. Both independent audits
accepted the complete evidence. All methods passed fixed rates through 64/s.
At fixed 128/s, ordinary pooled bounds passed (p95 **79.812 ms**, maximum
**176.921 ms**); numeric, direct sort and pooled maxima failed with respectively
**3,723 / 939 / 2,371 strict failures**. Maxima's maximum end-to-end latency reached
**11,141.870 ms**, including scheduler waiting. These failures remain part of the
capacity result even though all 144 earlier closed-loop profiles passed.

All four methods passed varied rates through 128/s. At that rate, p95 was
**77.049 / 69.676 / 13.720 / 65.475 ms** for numeric / direct sort / ordinary bounds /
maxima bounds. **Fixed and varied are different mixtures:** fixed has two single,
one pair and one five-target query per four-query cycle; varied has 65 single,
nine pair and one five-target query per 75-query cycle. The smaller combination
share can explain a large load difference; this is not a controlled cache test.
The [full arrival tables](FAVORITE-OPTIMIZATION-RESULTS.md#fixed-and-varied-scheduled-arrivals-complete-and-audited)
retain all rates and failures. Evidence lives in
`full-million-pooled-arrival-{fixed,varied}-v1/audit-independent-v1.json` and the
corresponding small pipeline logs.

Wide arrivals completed at 16/s for 600 seconds per candidate. Numeric's
9,600 requests had zero strict failures, p95 166.693 ms and maximum 496.421 ms.
Direct sort's 9,600 requests had **107 strict failures**, p95 168.535 ms and maximum
**5,797.602 ms**: this broad-workload rate failed. The cause is not established,
and this does not invalidate its separately measured repeated single-query loads.
Ordinary bounds also completed 9,600 requests with zero strict failures, p95
**210.876 ms** and maximum **463.575 ms**. Maxima passed all 9,600 with p95
**204.753 ms** and maximum **364.696 ms**. Each passing method successfully reached
all **8,184 distinct queries and 6,138 keys**, with 6,889 single-target, 1,515 pair
and 1,196 five-target requests. Sorted's 104 errors left 9,496 successful requests,
8,080 distinct successful queries and **6,088 keys**; planned coverage is not
successful coverage. Its 107 strict failures also include requests missing the
latency limit. The final wide audit accepted complete evidence with one failed
performance profile, no pending rows and no incomplete resource profiles.

The higher-rate follow-up launched at **20:19:30.422 UTC**, finished with an accepted audit at **20:32:03.312 UTC**, and compared numeric
and ordinary bounds at wide 64/128/s. Numeric was chosen for its lowest wide p95;
ordinary bounds for passing fixed 128/s. This does not establish a universal
winner: maxima's wide p95/max were lower than ordinary bounds. The first numeric
64/s stress profile completed 11,520 trials with p95 154.361 ms, maximum 316.415 ms
and zero strict failures. Numeric128 **failed** 23,040 trials with p95 1,500.247 ms,
maximum 1,773.903 ms and **9,465 strict failures**. Preserve the passed 64/s and
failed 128/s scopes separately. Ordinary bounds also passed wide64: 11,520 trials,
p95 **277.111 ms**, maximum **740.410 ms**, zero strict failures. Ordinary-bound128 also **failed**: 23,040 trials, p95 **1,401.420 ms**, maximum
**1,680.592 ms**, **6,368 strict failures** and 254 client rejections. Numeric128
had 1,451 rejections. Both64 profiles covered all6,138 keys; numeric128/ordinary128
covered only6,132/6,116 successfully. Rejections already belong to the failure
union. The complete audit retains both failed128 profiles; the independent resource
review also passed. All rate results are short, evenly
scheduled observations on this synthetic single-host corpus, not production
user counts or burst guarantees. The final query checkpoint is v11 and its
desktop/mobile dashboard check passed; scale19217 and its observer are stopped,
while real19216 and the prototype UIs remain available.

## Completed build and failed first full-million screen

The independent ingestion audit passes all 1,000,000 acknowledgements, 47,620 batches and 29 archived source bindings. The final index has 66 segments and 56.049 GB primary store. The sampled stored-value audit independently replayed 82 raw responses and all 18,414 values from three documents. See `full-million-ingestion-complete-audit-v2.json` and `full-million-bindings-independent-v1.json`.

The first screen's 11 completed profiles contain 85,293 timed requests and zero errors. Its independent raw audit also retains **12,285 timed rows outside completed profiles, including 7,491 errors**. Thus the interrupted campaign has **97,578 timed requests and 7,491 strict failures**, with four error-free warmups. Reporting only finished-profile failures would incorrectly show zero. The raw-evidence audit passes integrity but explicitly fails completion/acceptance; successful-profile p95 values are partial observations. That historical run contains no completed multi-color/filter or arrival coverage; the successful pooled retry is separate evidence.

The completed indexing resource window ends before value auditing and querying. Observed mean container CPU was 2.347 cores; sampled charged-memory peak was 12.000 GiB, separate anonymous/file-cache maxima 4.608/7.334 GiB, final swap 0.916 GiB, and observed OOM/OOM-kill deltas zero. Storage counters report 210.504 GB read / 714.541 GB written at each stacked device layer, which must not be summed. These phase-wide container measurements include indexing, preparation, merging, refresh and background work; they are not JVM heap or per-query costs. The [results report](FAVORITE-OPTIMIZATION-RESULTS.md#resource-cost-of-the-completed-indexing-phase) gives the interval, caveats and independently replayed resource artifacts.

The failed screen is `full-million-four-methods-v2/`; completed build resources are `resources-indexing-completed-v1/`. The independently validated pooled variants now have their own completed closed-loop evidence in `full-million-four-methods-pooled-v1/`.

## Pooled cleanup validation before the retry

Lab options **18, Global bounds · pooled cleanup**, and **19, Global maxima ·
pooled cleanup**, preserve the same parent query, scoring, deadlines, snapshots
and acknowledged cleanup. Only cleanup connection reuse changes. The first 17
options remain available. Native pooled transport was exercised in 2,504 exact
ranking comparisons across the retained one-primary and three-primary real
indexes; all cleanup requests succeeded, with 2,503 connection reuses. The new
feedback run retains all 234 assessed pair outcomes over the same 32 supported
cases. It does not add human labels or fix the separate duplicate-target score.

The focused transport diagnostic's 52,001 requests over 60 seconds had zero
errors or one-second failures and 32 connections, versus 46 errors and 28,227
connections in the interrupted baseline diagnostic. This supports the transport
refinement; it is not a completed four-method, multi-query capacity campaign.
Evidence: `pooled-fidelity-v1/`, `pooled-feedback-independent-audit-v1.json`,
`transport-maxima-pooled-v1/`, and feedback run
`2026-09-23T18-36-10.447Z-84f622c2/`. Desktop/mobile checks for the active 19-method
lab are in `ui-19-complete/`; all ten selected parent/pooled top-20 comparisons
matched and the historical 7,491 failures remain visible in the results page.

## Remaining campaign gates

1. **Index gate complete.** All one million creates across 47,620 batches reconcile with the source/plan/mapping, with no retries or acknowledgement failures. The three-document audit checks all 6,138 float utilities per sampled document against the original encoder. Preserve these completed artifacts; samples are not an audit of every stored value.
2. **Closed-loop retry complete.** All four methods passed every planned shape/filter/load combination on the same index, with 144 completed profiles and no strict failures. Request latency includes service calls, PIT work, fetching and application overhead. Preserve the failed first attempt and successful retry separately. The scale node's changed set of open indexes is a separate cohort from earlier screens; retain the 2.32-second startup-overlap caveat.
3. **Apply the strict rule.** Report every error and every request at or above one second, including warmups. Low successful-request p95 does not erase failures. Independently audit raw requests, coverage, source/index fingerprints and resource evidence before promoting a result.
4. **Arrival campaigns complete.** Fixed/varied/wide and the higher-rate two-method stress are audited, including failed loads. Numeric and both bounds reached all 6,138 keys at wide16; sorted did not. Both stress64 profiles reached every key; both128 profiles failed and had incomplete successful coverage. Preserve scheduled waiting, rejections and failure unions. A first traversal remains distinct from a controlled cold-cache experiment.
5. **Resource review complete; limits retained.** Independent replay passed 2,490 checks over six focused query profiles. The [resource table](FAVORITE-OPTIMIZATION-RESULTS.md#resource-cost-of-broad-query-search) separates OpenSearch CPU/heap, benchmark driver CPU/RSS, container memory and device reads. Passing64 driver CPU was0.100/0.184 cores and peak RSS0.634/0.637 GiB (numeric/bounds); these include preflight/scheduling/evidence retention and are not production gateway costs. Failed128 showed substantial I/O pressure, supporting further data/cache investigation without proving a sole cause. The synthetic single-host corpus does not establish 100-million-image production capacity.

The saved original score remains intact. The separate duplicate-weight correction has correctness evidence but no capacity result and is not silently included in these four preserved numeric paths.

## Why the nine-utility projection is insufficient

The completed 100,000-record projection contains nine utilities across four encodings. Its receipt records **63,403,458 bytes** of primary store, one segment, 6.251 seconds of document indexing, and 7.915 seconds including finalization. The outer pipeline took 11.874 seconds including source preparation. These distinct timings should not be conflated.

The full favorite-preset plan contains **6,138 utilities**: 279 color/vibe targets ×22 profiles (vibe plus 0–100% in 5% steps). That is **682 times** the projection's utility count. Query term counts remain small, but storage, indexing, merge work, and the range of file pages touched by changing queries are different.

| Encoding | Maximum positive feature values/document | Maximum at100k | Maximum at1M |
| --- | ---: | ---: | ---: |
| 16-bit or18-bit, two digits | 12,276 | 1.2276 billion | 12.276 billion |
| 27-bit, three digits | 18,414 | 1.8414 billion | 18.414 billion |
| Both18-bit and27-bit together | 30,690 | 3.069 billion | 30.69 billion |

Zero digits are omitted, but this representation is not very sparse. The real full/all-preset index recorded an average of **11,919.4 positive 16-bit feature values per document per preset**, about97% of the maximum. Many proportion utilities remain positive even for a wallpaper containing none of the requested color.

Numeric utilities require 24,552 bytes/document for6,138 uncompressed float32 values, or24.552GB at1M before compression and all index/metadata overhead. This is a value-payload calculation, not a disk forecast. Feature encodings have posting-list and term-dictionary costs; counting their digit bits does not predict disk size. Neither the projection's634 bytes/document nor the real comparison index's large bytes/document should be extrapolated directly.

The historical real comparison index v2 held all nine presets, all four original encodings, and stored source. Its completion receipt recorded 4,953,881,511 bytes for545 assets across18 segments. That is evidence that keeping every experimental representation together is costly, not a forecast for the proposed single-encoding, source-disabled scale index.

## Historical pilot proposal — superseded

After projection screening and real-corpus fidelity checks, build **one favorite control preset, 256 bins, source disabled, 100,000 full-bank records**. Start with the 18-bit encoding if its measured query performance remains competitive. It has the same two scoring terms per target as the 16-bit encoding with four times finer quantization. Keep the original 16-bit results as a comparison; do not pay for a redundant full-bank copy before there is evidence that its different digit distribution matters.

Build a separate 100,000-record 27-bit index only if its additional precision affects the decision. Promote the best acceptable encoding to a separate one-million-record full-bank index after its 100,000-record capacity measurements establish disk and indexing costs. **Numeric utilities deserve equal consideration:** the completed100k screening is faster than16-bit features on every tested query shape, while preserving greater precision. They avoid digit reconstruction, although they still require scoring all eligible numeric values. Revisit the initial rank18 pilot preference after the1M screening and refinement measurements.

This was the initial proposal before the later numeric-points and precision-projection screens. Its rank18-first sequence is superseded by the current numeric full-million plan above. Retained here to explain the earlier experiment choices; do not use it as the launch plan.

## Historical pilot and promotion gates — superseded sequence

These original gates explain the earlier rank18-first proposal. The completed numeric campaign and final reporting gates are recorded above. The measurement principles remain useful; the encoding/build sequence is no longer the plan.

1. **Freeze the experiment.** Pin scorer source, plan, seed99539473, extraction identity, count, control preset, mapping, and byte-bounded bulk configuration. Synthesize original coverage and quality mass first; calculate nonlinear utilities afterward.
2. **Build100k full rank18 alone.** Use `--scope full --presets favorite --encodings rank18 --source false`, one primary, no replicas, the existing8-CPU/12GiB/4GiB-heap service. Store only searchable utility fields and small ID/metadata fields in this index; keep measured inputs externally reproducible.
3. **Measure ingestion honestly.** Record serialized bytes, generated nonzero feature counts, CPU/time, primary store, translog, segment count, merge activity, heap, cgroup anonymous/file memory, throttling, and memory events. Record store both after indexing and after normal flush/refresh and merge settling. A large page cache is not the same as a heap leak. Do not force-merge merely to make the result favorable.
4. **Measure the existing query workload.** Test four shapes ×unfiltered/10%/1% eligibility, C1/4/16, at least32 requests and10 seconds per profile, including warmups in the strict error/one-second rule. Run profiling separately from timing. Compare selected full-bank results with the matching projected utility encoding to verify identical IDs/scores.
5. **Exercise the actual full bank.** Add a frozen changing-query workload that rotates through many hue/lightness anchors, named vibes, all percentage targets, and multi-color combinations. Repeating the same nine utilities only measures a small warm working set. Report the first pass separately from later warm passes; do not call the first pass an experimentally controlled cold-cache test.
6. **Choose the second pilot using results.** If18-bit fidelity and timing already meet the goal, prioritize its1M full-bank run. If greater fidelity would materially help, compare a separate100k full27-bit index; its extra limb means up to50% more feature values and query clauses. Numeric full-bank utilities are another candidate when precision or index efficiency outweighs their scanning cost. Avoid a combined multi-encoding index for final capacity attribution.
7. **Promote to1M only with a measured resource estimate.** Use observed100k bytes, ingestion rate, segment/merge behavior, and disk headroom, allowing temporary merge output to coexist with input segments. Simple10× extrapolation is a planning estimate, not the final claim. Preserve existing indexes and evidence; stop on actual failed resource conditions and report them.
8. **Re-run latency and arrivals at1M.** Include concurrency and changing queries; quantify throughput while keeping queueing/end-to-end latency. Also test selected scheduled arrival rates and the actual application fetch path. A fast score phase can be hidden by fetching giant stored utility sources, as the initial real-index feedback failures demonstrate. No service-side or client-side shortlist reranking is added.

## Control choices and storage layout

The initial capacity claim should cover the favorite controls only: quality influence0.5, cutoff weighting1, minimum quality0. More presets can be added after measuring this baseline. Nine complete presets multiply the feature volume roughly ninefold; the existing per-preset field separation also avoids putting too many encoded term frequencies in one field. Preset separation is necessary for indexing validity but does not eliminate the storage cost.

User flexibility can later be measured as an explicit cost: one, three, and nine presets, or a smaller set of percentage targets with separately evaluated interpolation. Any interpolated objective must be labeled and evaluated. The favorite snapshot remains intact.

All production-style measurements should request IDs through doc values and omit utility `_source`; images and detailed inspection measurements can be served from their existing external stores. Source-disabled indexes remain rebuildable from the versioned measured inputs and plans. This changes storage/fetch behavior, not scoring.

## Historical first-round screening audit

The repaired sequential pipeline is `first-round-scale-v2`, under the external September23 optimization artifact root. The100k screening completed at13:56UTC and passed its independent file-only audit: **28 profiles,67,911 timed requests,28 warmups,zero errors or requests at/above one second**. These are serial, unfiltered screening profiles. The audit checks raw requests, warmups, summaries, hashes, index fingerprints, complete planned coverage, and resource evidence. Performance failures can exist in an accepted evidence audit; acceptance does not mean the candidate is fast.

| Method | Single-color p95 | Green40% p95 | Two-color p95 | Five-color p95 |
| --- | ---: | ---: | ---: | ---: |
| Original favorite | 38.39ms | 37.82ms | 70.62ms | 210.22ms |
| Generic script | 51.92ms | 47.19ms | 85.21ms | 231.94ms |
| Typed script | 35.34ms | 37.69ms | 72.02ms | 230.84ms |
| Numeric utility | 4.04ms | 4.07ms | 7.31ms | 12.49ms |
| 8-bit feature | 1.57ms | 1.56ms | 5.89ms | 9.45ms |
| 16-bit feature | 5.93ms | 6.08ms | 8.99ms | 16.86ms |
| Native float feature | 1.36ms | 1.36ms | 6.17ms | 9.74ms |

Separate profiling counted100,000 root score calls for numeric single-color queries,97,313 for16-bit features,11,110 for8-bit features, and10,401 for native float features. For the five-color query, **all four utility encodings scored100,000 root documents**. Indexed feature pruning helps the simple query in this test; it does not yet explain the multi-color speedup. Precomputing the expensive layer math still helps even where candidate skipping is absent.

The original/script candidates use the existing full measurement index at100k; utilities use the one-segment nine-utility projection. At1M, the original/scripts also use their earlier measurement projection. These layout differences are another reason to measure complete utility banks before making a production comparison. The1M utility projection holds573,746,617 bytes of primary store; indexing took50.907 seconds, or52.112 seconds including finalization.

100k audit evidence: `screen-100k/audit-capacity-review.json`.

### Completed one-million screening

The1M run completed at14:05:54UTC. Its independent audit accepted all evidence: **28 profiles,27,620 timed requests,28 warmups**. Three profiles failed: five-color baseline, generic script, and typed script. Each had32 timed errors and one warmup error; every errored request also exceeded one second, so the failure union is96 timed requests plus3 warmups. All16 utility profiles passed the strict rule at this tested serial load.

| Method | Single-color p95 | Green40% p95 | Two-color p95 | Five-color p95 |
| --- | ---: | ---: | ---: | ---: |
| Original favorite | 254.18ms | 327.08ms | 666.04ms | All requests failed |
| Generic script | 410.78ms | 425.84ms | 805.01ms | All requests failed |
| Typed script | 290.62ms | 325.36ms | 662.73ms | All requests failed |
| Numeric utility | 25.89ms | 26.91ms | 56.58ms | 109.23ms |
| 8-bit feature | 2.47ms | 2.38ms | 44.61ms | 79.37ms |
| 16-bit feature | 44.42ms | 45.30ms | 68.19ms | 150.33ms |
| Native float feature | 2.19ms | 2.10ms | 44.04ms | 79.06ms |

This supports continuing numeric utility optimization alongside feature encoding refinements. It does not yet demonstrate concurrent-user or full-bank capacity. The bounded-numeric and direct-sort prototypes were not included in this first screen. Their subsequently completed projection and full-100k measurements are in the [results report](FAVORITE-OPTIMIZATION-RESULTS.md).

1M audit evidence: `screen-1m/audit-capacity-review.json`.

External artifact root:

```
/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/
```
