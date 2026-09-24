# Favorite color method: optimization results

Checkpoint: **2026-09-23, after the final query/resource audits and v11 publication/browser checks**. This prototype round is complete; this is not a production capacity claim.

## Current direction

**The full-million closed-loop retry passed all 144 profiles: 1,007,172 timed requests and 48 warmups, with zero errors and zero requests at or above one second. The slowest timed request was 491.544 ms.** This covers four methods, four query shapes, three metadata eligibility levels and concurrency 1/4/16 on the same full 6,138-utility index. The complete eight-phase campaign is now independently audited. Ordinary bounds alone passed fixed 128 requests/s; all four passed the lighter varied mix at 128/s. Numeric and both bounds passed the wide mix at 16/s with all 6,138 keys successfully queried; direct sort failed that wide load with 107 strict failures.

On the full-million bank, unfiltered single-color direct sort reached **2.04 / 8.28 ms p95 at C1 / C16**. Pooled global bounds reached **12.26 / 63.34 ms** for two colors and **77.18 / 291.66 ms** for five colors. With selective metadata filters, the simpler numeric query often won for combinations. The higher-rate wide comparison tested **numeric because it had the lowest wide p95**, and **ordinary bounds because they alone passed fixed 128/s**. Both passed broad 64/s with full successful key coverage and both failed 128/s. This does not establish one universal winner or make maxima a universal loser. The million-record index uses **56.049 GB** of primary storage. The earlier rank18-first proposal is superseded.

The earlier interrupted campaign remains **failed/incomplete**, with **7,491 errors** outside its 11 finished profiles. The successful retry uses new artifacts and pooled cleanup for both bounded methods; it does not erase that failed evidence. See [current work](FAVORITE-OPTIMIZATION-CURRENT.md) and [capacity gates](FAVORITE-OPTIMIZATION-CAPACITY.md).

- Try the [19-method optimization lab](http://zerotwo:8228/) or view the [saved results dashboard](http://zerotwo:8228/performance.html).
- The [original shade-aware, strict-hue inspector](http://zerotwo:8227/) remains available.
- Performance controls: 256 bins, all five cutoffs, cutoff weighting 1, linear quality influence 0.5, minimum quality 0. The full favorite preset stores 6,138 utilities per image.
- Correctness uses 523 real wallpapers plus 22 controlled fixtures. The UI excludes fixtures. Scale records are synthetic mixtures of the 523 real-image measurements; fixtures are excluded from scale generation.

The original methods retain a duplicate-target arithmetic defect. A separate **Repeated target weights** option corrects it and passed service validation. Existing human judgments contain no duplicate-target cases, so this is an arithmetic correction with ordinary-query regression evidence, not demonstrated improvement in perceived relevance.

## Recommendation for this prototype round

**Use the precomputed numeric utility index as the basis for the next implementation.**
It preserves the favorite's scoring formula at the offered presets, with small
float32 differences, and retained every existing human-feedback pair outcome.
Use 256 bins, indexed float utilities/doc values, source disabled and lean ID
fetching. The measured million-record bank stores the single favorite preset
and uses 56.049 GB; the other UI presets do not inherit its capacity result.

For execution, keep **ordinary numeric scoring as the broad-query reference** and
**pooled global bounds as a measured alternative for expensive combinations**.
Numeric had the lowest wide16 p95 and its wide64 profile completed 11,520 requests
with zero strict failures, p95 154.361 ms and maximum 316.415 ms. Ordinary bounds
alone passed fixed128, and also passed wide64 with p95 277.111 ms and maximum
740.410 ms. Selective metadata filters often favor numeric scoring. These results
support exploring a workload-aware dispatch rule; no combined dispatcher was
built or benchmarked in this round.

Keep direct sorting as a **restricted optimization to investigate**, not a broad
default: its repeated single-query results were excellent, but wide16 had 107
strict failures and incomplete successful key coverage. Maxima remains a valid
alternative that passed wide16; the current evidence does not justify its extra
work as a universal improvement over ordinary bounds.

All query campaigns, independent campaign audits, warmup score-parity checks and
the v11 dashboard check are complete. **Both broad128 profiles failed; broad64 is
the highest tested passing rate for these two methods on this workload.** A low
p95 or success on a lighter mix cannot erase that limit. The independent resource
review also passed: ordinary bounds used less OpenSearch CPU at wide64, but had
higher latency, more data reads and greater I/O pressure. **Investigate data reads
and cache behavior next**, alongside query choice; more score arithmetic pruning
alone is not established as the best next improvement. Passing short runs on one shared host with synthetic
records does not guarantee production latency. The new cardinality compiler passed
nine offline tests but remains unintegrated and unmeasured; seed-budget ideas also
remain future experiments. This round requires no further prototype builds. The duplicate-weight correction stays separate
until it is explicitly included in any future production objective and capacity test.

## Full-million closed-loop retry: complete and audited

All four methods used `color-exploration-favorite-points-full-1m-v1`: one million
records, all 6,138 favorite-preset utilities, indexed numeric points, doc values,
and source disabled. All 144 profiles completed, including C4; the compact table
below shows **C1 / C16 p95 in milliseconds**. Filters are synthetic metadata
eligibility (all, nominal 10%, nominal 1%), not color-match percentages.

| Eligibility | Query | Numeric, lean fetch | Direct sort, lean fetch | Pooled global bounds | Pooled global maxima |
| --- | --- | ---: | ---: | ---: | ---: |
| All | One-color vibe | 33.02 / 108.12 | 2.04 / 8.28 | 5.50 / 22.42 | 5.29 / 23.11 |
| All | 40% green | 30.60 / 106.95 | 2.07 / 8.76 | 5.23 / 24.08 | 5.17 / 23.15 |
| All | Two colors | 64.41 / 222.03 | 63.54 / 255.74 | 12.26 / 63.34 | 13.68 / 69.67 |
| All | Five colors | 118.26 / 425.74 | 118.02 / 423.50 | 77.18 / 291.66 | 82.11 / 292.64 |
| 10% | One-color vibe | 7.09 / 54.30 | 2.60 / 10.30 | 6.18 / 26.24 | 6.40 / 26.17 |
| 10% | 40% green | 6.95 / 54.39 | 2.29 / 9.45 | 6.02 / 26.22 | 5.98 / 26.79 |
| 10% | Two colors | 11.00 / 64.09 | 11.71 / 63.56 | 10.73 / 59.97 | 11.30 / 64.48 |
| 10% | Five colors | 18.02 / 76.51 | 17.92 / 76.06 | 27.09 / 128.78 | 30.74 / 124.57 |
| 1% | One-color vibe | 2.11 / 6.46 | 2.06 / 8.02 | 5.78 / 24.27 | 6.18 / 24.90 |
| 1% | 40% green | 2.44 / 6.59 | 2.08 / 8.27 | 5.83 / 26.09 | 5.97 / 25.46 |
| 1% | Two colors | 3.01 / 7.61 | 2.94 / 8.60 | 8.11 / 44.93 | 8.90 / 43.11 |
| 1% | Five colors | 4.91 / 11.26 | 8.71 / 13.33 | 17.96 / 93.88 | 18.95 / 159.17 |

Each profile ran at least ten seconds and completed at least 88 timed requests.
All **1,007,172 timed requests and 48 warmups passed the strict limit**. There are
no unfinished rows or incomplete resource profiles. The maximum timed latency
was **491.543743 ms**, from unfiltered five-color direct-sort C16. For combinations,
the direct-sort method delegates to the same numeric scorer; differences between
those two columns are observed execution variation, not a different combination
algorithm. Pooled maxima did not consistently improve upon the simpler bound.

These are repeated-query, closed-loop observations: clients wait for a result
before issuing their next request. They do not establish scheduled-arrival or
burst capacity. Fixed, varied and wide arrival results and successful key coverage
are separately reported below; higher-rate wide stress is also complete, while final resource
attribution is reported separately below. The data are synthetic mixtures of 523 real-image measurements. The
shared host used one primary, no replicas, an eight-CPU quota, 4 GiB heap and a
12 GiB memory limit. No 100-million or multi-node capacity claim follows.

A file-only proof replay overlapped the beginning of this campaign for **2.32 s**
(18:47:38.419–18:47:40.739 UTC), with no service traffic or runtime changes.
`full-million-pooled-pipeline-v1/known-overlap.json` preserves the caveat; detailed
profile attribution is complete: 78 numeric one-color-vibe C1 requests overlapped,
with zero errors or one-second failures. All remain in the reported results
without any adjustment.

Evidence: `full-million-pooled-pipeline-v1/full-1m-four-methods-pooled.log` and
`full-million-four-methods-pooled-v1/audit-independent-pooled-v1.json`, accepted at
19:20:48.739 UTC. The audit binds benchmark hash
`3d0007b6cdafc7d5ab4a7d323d7f1858383884b0edce56794650b51f955273da` and records
zero integrity errors/warnings. These figures were transcribed from the small
phase log and audit during ongoing arrival timing; large raw artifacts were not
re-read for this documentation update.

## Fixed and varied scheduled arrivals: complete and audited

Both workloads completed all 16 method/rate profiles, with **27,840 timed requests
per workload**. Each rate ran for 30 seconds: 8/32/64/128 requests per second
scheduled 240/960/1,920/3,840 trials per method. The fixed evidence audit passed at
19:29:31 UTC with **three failed performance profiles**; the varied audit passed
at 19:38:07 UTC with none. An accepted audit certifies preserved evidence, not
that every load passed.

All four methods passed fixed rates through 64 requests/s. **Only ordinary pooled
global bounds passed the fixed mix at 128 requests/s.** The other three failed
that load, with 7,033 strict failures in total. All four methods passed every
varied rate through 128 requests/s. The table reports end-to-end latency from the
scheduled arrival, including client waiting, errors and rejected trials; this is
not the successful-only percentile definition used by the closed-loop screen.

| Workload | Method | 8/s p95 ms | 32/s p95 ms | 64/s p95 ms | 128/s p95 ms | 128/s max ms | 128/s strict failures |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed | Numeric, lean fetch | 116.20 | 120.19 | 125.70 | 1,502.01 | 1,510.94 | 3,723 |
| Fixed | Direct sort, lean fetch | 116.01 | 117.52 | 118.66 | 1,501.21 | 1,510.91 | 939 |
| Fixed | Pooled global bounds | 82.65 | 72.23 | 71.06 | 79.81 | 176.92 | 0 |
| Fixed | Pooled global maxima | 86.40 | 99.29 | 82.17 | 6,684.71 | 11,141.87 | 2,371 |
| Varied | Numeric, lean fetch | 63.77 | 63.47 | 66.11 | 77.05 | 431.86 | 0 |
| Varied | Direct sort, lean fetch | 68.29 | 68.76 | 62.37 | 69.68 | 188.58 | 0 |
| Varied | Pooled global bounds | 19.19 | 15.89 | 14.24 | 13.72 | 357.38 | 0 |
| Varied | Pooled global maxima | 20.85 | 17.85 | 16.06 | 65.47 | 391.36 | 0 |

**The workload mixes differ.** The fixed four-query cycle contains two single-target,
one two-target and one five-target query. The varied 75-query cycle contains
**65 single-target, nine two-target and one five-target query**: the fixed four,
60 additional picked-color queries, eight pairs and three named queries. These
are cycle compositions; finite rate windows need not contain an integer number
of cycles. The varied run's lighter combination mix helps explain why numeric
scoring passed 128/s there after failing fixed 128/s. This is not an isolated
comparison of cache behavior or a guarantee for arbitrary query distributions.

Pooled maxima's fixed-128/s maximum was **11,141.870 ms**. Scheduled-arrival waiting
is included even when a dispatched service request has a shorter timeout. Keep
this overload visible; do not substitute the service timeout for observed
end-to-end latency. Error/slow/rejection breakdown and resource attribution will
be reported from raw evidence after all timing ends.

Evidence: `full-million-pooled-pipeline-v1/{fixed,varied}-arrival.log` and
`full-million-pooled-arrival-{fixed,varied}-v1/audit-independent-v1.json`. Both audits
record complete, internally consistent evidence, no pending rows and no incomplete
resource profiles. Existing first-attempt failures remain separately preserved.

### Wide-bank arrivals: complete and audited

The wide stage scheduled **16 requests/s for 600 seconds per candidate** over an
8,184-query plan spanning 6,138 utilities. All four profiles completed, with
9,600 scheduled trials each. The audit accepted complete evidence at 20:18:51 UTC,
including the sorted method's failed performance profile.

| Method | Successful / scheduled | Distinct successful queries | Successful keys / 6,138 | p95 ms | Maximum ms | Errors | Strict failures |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| Numeric, lean fetch | 9,600 / 9,600 | 8,184 | 6,138 / 6,138 | 166.693 | 496.421 | 0 | 0 |
| Direct sort, lean fetch | 9,496 / 9,600 | 8,080 | 6,088 / 6,138 | 168.535 | 5,797.602 | 104 | 107 |
| Pooled global bounds | 9,600 / 9,600 | 8,184 | 6,138 / 6,138 | 210.876 | 463.575 | 0 | 0 |
| Pooled global maxima | 9,600 / 9,600 | 8,184 | 6,138 / 6,138 | 204.753 | 364.696 | 0 | 0 |

Each passing method's 9,600 successful requests comprised **6,889 single-target,
1,515 two-target and 1,196 five-target queries**. All three successfully traversed
the full query/key plan. The sorted method did **not** achieve full successful key
coverage: attempted or planned fields cannot fill its 50 missing successful keys.
Successful responses can still breach the one-second limit; error and strict
failure counts are separate, not additive. Coverage means those scoring fields
were requested in returned rankings, not that every document/posting was visited.

The sorted variant's 16/s broad-workload failure remains distinct from its fast
repeated single-query results. These summaries do not establish a cause. Maxima
passed the wide mix with lower p95 and maximum than ordinary bounds, even though
it failed fixed 128/s. Consequently the follow-up choice is workload-specific:
numeric supplies the lowest wide p95, ordinary bounds the strongest fixed-128/s
result. Neither observation establishes that maxima is always worse.

Evidence: `full-million-pooled-pipeline-v1/wide-arrival.log` and
`full-million-pooled-arrival-wide-v1/audit-independent-v1.json` (complete/integrity/
accepted true, one failed profile, zero pending rows or incomplete resource
profiles). The audit binds result hash
`78b30857b2b4a1c295a2ef9a4ddaf4a7fd9463ec7e96e8be73b6dace5946074b`.
Coverage values are the completed campaign's reported counts. The separate resource
review below complements the accepted query-evidence audit.

### Higher-rate wide comparison: complete and audited

The two-method follow-up ran from 20:19:30.422 UTC through its accepted audit at
**20:32:03.312 UTC**, using the same verified index and unchanged scorer/runtime
sources. Each rate ran for 180 seconds; neither 128/s profile qualified.

| Method | Rate | Scheduled trials | p95 ms | Maximum ms | Strict failures | Client rejections | Successful keys / 6,138 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Numeric, lean fetch | 64/s | 11,520 | 154.361 | 316.415 | 0 | 0 | 6,138 / 6,138 |
| Numeric, lean fetch | 128/s | 23,040 | 1,500.247 | 1,773.903 | 9,465 | 1,451 | 6,132 / 6,138 |
| Pooled global bounds | 64/s | 11,520 | 277.111 | 740.410 | 0 | 0 | 6,138 / 6,138 |
| Pooled global bounds | 128/s | 23,040 | 1,401.420 | 1,680.592 | 6,368 | 254 | 6,116 / 6,138 |

Both 64/s profiles had zero errors, client rejections or one-second requests and
successfully covered every utility key. Both 128/s profiles failed and had
incomplete successful key coverage. Rejections are included in the strict failure
union; do not add the two columns. Keep the passing and failing rates separate.
This establishes an observed workload limit on this host, not a guaranteed service
rate, production user count or burst capacity.

Evidence: `full-million-pooled-wide-two-methods-stress-v1/audit-independent-v1.json`
(complete/integrity/accepted true, four profiles, two failed profiles, zero pending
rows/incomplete resource profiles), and its pipeline's `wide-two-methods-64-128.log`.
The audit binds result hash
`114149a7b8c59b952cd481e7418bc32b5e702d3154fe04f64889f7e903fe2899`.
Plan: `full-million-pooled-wide-two-methods-stress-v1-proposal/stress-plan.json`.
`full-million-final-live-check-v1.json` confirms all 44 runtime pins unchanged.
The scale node and observer were then stopped; the real-corpus service and visual
prototypes remain available. No additional test campaign is planned for this round.

## What the 19 comparison options mean

All filtering and final ordering happen in OpenSearch. “Same stored score” below means the precomputed numeric objective, which has small floating-point differences from the original favorite. “Lean fetch” changes only how result IDs are retrieved. The available controls are shared presets; unsupported values are rejected.

| # | Lab option | What changes | Score relationship |
| ---: | --- | --- | --- |
| 1 | Saved favorite | Original five-cutoff query | Preserved reference, including its duplicate-target defect |
| 2 | Fused score | One script calculates the original components | Exact original scores and orders in all 144 audited query/preset checks |
| 3 | Typed specialized score | More explicit numeric types in the fused script | Same formula; separate parity checks passed, all-preset audit not performed |
| 4 | Precomputed float | Store complete per-target utilities before querying | Same formula at offered presets; float32 grouping can change close ties |
| 5 | Indexed 8-bit | Round utilities to 256 levels | Quantized approximation; visible top-20 changes observed |
| 6 | Indexed split 16-bit | Store two base-256 digits per utility | Quantized approximation; finer than 8-bit |
| 7 | Indexed native precision | Store utilities as native rank features | Reduced significant-bit precision; not full float32 storage |
| 8 | Indexed split 18-bit | Store two base-512 digits | Quantized approximation, finer than 16-bit |
| 9 | Indexed split 27-bit | Store three base-512 digits | Finer quantization; query arithmetic still uses float32 |
| 10 | Native numeric sort | Sort the stored field for one target; numeric query for combinations | Same stored score; single-target score comes from the server sort value |
| 11 | Numeric sort · score tracking | Also calculate the original numeric score during single-target sorting | Same stored score; control for score-tracking cost |
| 12 | Globally bounded float | Seed searches derive a safe global OR range bound | Same stored score and global winners; final ranking uses all eligible bound matches |
| 13 | Precomputed float · lean fetch | Option 4 with ID doc values and stored fields disabled | Same parent score and order |
| 14 | Indexed split 27-bit · lean fetch | Option 9 with ID doc values | Same quantized parent score and order |
| 15 | Native numeric sort · lean fetch | Option 10 with ID doc values | Same parent score and order |
| 16 | Global maxima bounds | Tighten option 12 with necessary per-target ranges | Same stored score and global winners; duplicate fields use the original bound |
| 17 | Repeated target weights | Group identical complete utility fields using their requested multiplicity | Separate arithmetic correction; ordinary distinct-target queries are unchanged |
| 18 | Global bounds · pooled cleanup | Option 12 with reused HTTP connections for acknowledged snapshot cleanup | Same parent scorer, deadline, global ordering and duplicate behavior |
| 19 | Global maxima · pooled cleanup | Option 16 with the same pooled cleanup transport | Same parent scorer, deadline, global ordering and duplicate behavior |

Option 17 does **not** add requested percentages together: red 50% + red 50% retains the red-50% utility at full weight; red 20% + red 40% remains two separate requests. It changes repeated-term weighting, not area allocation. The original 16 methods remain preserved. See [the correction and its evidence](FAVORITE-MULTIPLICITY.md).

Options 18 and 19 are active after service fidelity and feedback validation.
They preserve options 12 and 16 respectively, changing only connection reuse for
the acknowledged snapshot-cleanup request. The first 17 methods remain available.
Across the real one-primary and three-primary indexes, **2,504 executions** matched
reference IDs and scores exactly; 2,504 native cleanup requests succeeded and
2,503 reused a connection. The feedback run supported the same 32 cases and 234
judged pairs, with all four compared methods retaining the same pair outcomes.
This is execution parity and regression evidence, not new human relevance or
full-million capacity evidence.

Evidence: `pooled-fidelity-v1/`, `pooled-feedback-independent-audit-v1.json`, and
feedback run `2026-09-23T18-36-10.447Z-84f622c2/`. Targeted browser QA in
`ui-19-complete/` confirmed all 19 options, 523 real wallpapers, fixture exclusion,
10 pooled/parent top-20 comparisons, mobile details, and the original cutoff-layer
modal. The performance page shows all 7,491 historical errors even when filters
hide every completed profile. Its initial v10 publication metadata error was
corrected; failed and corrected captures are both preserved.

## Historical initial comparison

The following table records the first encoding screen. Later precision, fetch, bounded and full-100k results appear in their own sections below; “unmeasured” in this table describes that initial screen.

Fidelity covers545 assets ×16 queries ×9 supported control combinations. Human feedback uses the existing uncertain judgments; agreement is the mean preference-pair agreement per query, not the percentage of results that are relevant. The initial comparison table below uses one-million **workload projections**, four repeated query shapes, no metadata filter, and concurrency one. C4/C16 were unmeasured in that historical screen; the later, incomplete full-bank campaign is separate evidence.

| Method | Largest score difference from favorite | Lowest top20 overlap | Human agreement | Initial screen: 1M C1 single / five p95 | 1M C4 / C16 |
| --- | ---: | ---: | ---: | ---: | --- |
| Original favorite | Reference | Reference | 69.4792% | 254 / **all failed** | Unmeasured |
| Generic fused script | 0, all144 orders identical | 20/20 | 69.4792% | 411 / **all failed** | Unmeasured |
| Typed fused script | Separate parity checks; all-preset audit not performed | Not measured | 69.4792% | 291 / **all failed** | Unmeasured |
| Numeric utilities | 0.000000140 | 20/20 | 69.4792% | **25.9 /109** | Unmeasured |
| 16-bit feature utilities | 0.000007660 | 20/20 | 69.4792% | 44.4 /150 | Unmeasured |
| 8-bit feature utilities | 0.001960800 | 14/20 | 69.7396%* | 2.47 /79.4 | Unmeasured |
| Native float features | 0.001953040 | 14/20 | 69.7396%* | 2.19 /79.1 | Unmeasured |
| 18-bit feature utilities | 0.000002000 | 20/20 | 69.4792% | Unmeasured | Unmeasured |
| 27-bit feature utilities | 0.000000150 | 20/20 | 69.4792% | Unmeasured | Unmeasured |

Numeric utilities preserved all16 complete orders at the favorite controls, and130/144 across all tested controls. The remaining differences were very small floating-point ties; their maximum reversed baseline score gap was0.000000100. The16-bit representation preserved the top20 but changed many lower positions. It is an explicitly quantized approximation.

The newer27-bit representation also preserved all16 complete orders at the favorite controls and129/144 across all controls. Its maximum reversed baseline gap was0.000000100. The18-bit representation retained every top20 set but only40/144 complete orders, with a maximum reversed gap0.000003620. Both completed independent audits of156,960 combined document scores. They were not timed in that initial screen; the later precision-projection measurements are reported below.

*These feedback values use the completed source-disabled follow-up: all seven candidates assessed32 cases and skipped6 unsupported cases, with no accuracy errors or timed failures. Native float's apparent gain was one incorrect pair becoming a tie;8-bit made three incorrect pairs and two correct pairs ties. Ties receive half credit. Excluding uncertain pairs, the favorite/numeric/16-bit agreement was68.8542%,8-bit68.8021%, and native float69.1146%. This is not evidence of better perception accuracy. These labels reflect one observer and do not establish population-wide accuracy.

The earlier source-enabled8-bit run timed out on8 accuracy cases and evaluated only24; its aggregate remains incomplete evidence. The new run uses both different storage and more heap, so the successful follow-up does not by itself isolate the cause of those errors.

The separate precision feedback run completed all 32 supported cases for the baseline and 16/18/27-bit encodings, with zero accuracy or timed failures. Every assessed pair outcome was unchanged. Its independent audit passed; higher numerical precision preserved the observed preferences without increasing the measured human agreement.

The execution campaign independently verified 1,878 sorted/scored-sort/bounded requests: all IDs, orders and score values exactly matched their numeric OpenSearch reference. Limits 1, 3 and 20 exercised real pruning in 467 bounded requests; full-corpus and zero-score cases exercised fallbacks. PIT and final global range-filter evidence passed. This establishes correctness relative to the numeric service on the tested corpus, not performance at scale.

**Formula defect retained in the snapshot:** repeating a target, or selecting two colors mapped to the same anchor, can halve its intended score. Two 50%-red targets gave a top score of 0.4940832 instead of 0.9881664. Native and optimized services share this behavior. Execution equivalence passed, but the experiment's overall `passed` value is false; a separately tested correction is required before claiming intended arithmetic for duplicate targets.

**Separate correction now verified:** the new scalar multiplicity variant restores repeated field weights. Its 162-case suite contains 135 corrections and 27 unchanged different-percentage controls. All matched the grouped float32 oracle; 144 ordinary query/preset rankings were unchanged. Accuracy-only feedback retained all 234 judged pair outcomes, but the dataset has no duplicate-target cases. It supplies no new performance measurement and leaves the original snapshot's failed duplicate-arithmetic verdict intact.

**Three-shard correctness now verified:** four execution methods completed 1,920 comparisons and 342,940 returned scores with exact global IDs/order and float32 scores against a separate one-shard numeric reference. The 545 assets were split 188/186/171 across three primaries on one node. An independent artifact audit checked PITs, shard success, creation acknowledgements and final bounds. This tests shard reduction, not multi-node reliability or capacity.

Detailed fidelity, pair coverage, and limitations: [accuracy audit](FAVORITE-OPTIMIZATION-ACCURACY.md).

## Fetch refinement: diagnostic result

Fetching IDs through doc values with `stored_fields:"_none_"` preserved every order and raw score across 432 comparisons, independently audited. All three variants also preserved the 234 judged preference pairs, with the same 32 complete/six unsupported feedback cases and zero errors. This change affects result retrieval, not the scoring objective.

The same-index comparison contained four query shapes per method and result limit. These are **diagnostic medians from four pairs**, not latency percentiles or capacity measurements:

| Method | All545 IDs: stored / docvalue median | Top20 IDs: stored / docvalue median |
| --- | ---: | ---: |
| Numeric utilities | 5,925 /3.69ms | 5.96 /3.36ms |
| 27-bit features | 3,741 /6.39ms | 7.10 /6.73ms |
| Numeric direct sort | 1,797 /3.64ms | 9.22 /3.27ms |

All twelve all-document stored-ID requests exceeded one second; all corresponding docvalue-ID requests finished below14ms. For20-hit queries, docvalue fetching was faster in8/12 pairs, with a52ms outlier. This supports avoiding expensive stored-field retrieval, especially for full-corpus diagnostics. It does not establish universal20-hit improvement, concurrent capacity, or the cost of returning production display metadata. See [fetch evidence and source mechanism](FAVORITE-STORED-FIELDS.md).

## Strict performance failures

The pass rule is **zero errors and zero requests at or above1000ms**, including warmups. Low p95 alone does not pass. Closed-loop percentiles contain successful requests only; failed requests remain in the failure counts.

| Completed campaign | Scope and concurrency | Timed requests /warmups | Timed strict failures /warmup strict failures |
| --- | --- | ---: | ---: |
| 100k first screen | Full measurement schema for scripts;9-utility projection for utilities;C1 | 67,911 /28 | 0 /0 |
| 1M first screen | Measurement projection for scripts;9-utility projection for utilities;C1 | 27,620 /28 | 96 /3 |
| 1M numeric execution refinements | Numeric-points projection; C1 | 41,743 /24 | 0 /0 |
| 1M precision feature refinements | Precision projection; C1 | 1,627 /12 | 0 /0 |
| Full100k controls | All6,138 utilities, numeric points; C1 | 21,484 /12 | 0 /0 |
| Full100k execution refinements | Same full bank; C1 | 39,652 /12 | 0 /0 |

All96 timed failures and3 warmup failures in the1M screen came from the baseline, generic script, and typed script five-color profiles. Every one of those profiles'32 timed requests failed. All16 utility profiles passed at the tested serial load. Independent raw-evidence audits accepted both completed screens, including their failures. An accepted audit certifies evidence consistency, not performance viability.

For numeric utilities, the other1M C1 p95 values were26.9ms for40% green and56.6ms for two colors. Profiling still counted one million score calls for numeric queries and for every utility method's five-color query. Precomputation removes expensive per-document layer calculations, but these measurements do not demonstrate sublinear work for combinations. The later globally bounded numeric and direct-sort measurements below address that separate issue.

## Refined execution: one-million projection at C1

The numeric-points projection screen completed at **15:46:12 UTC**. Its independent evidence audit accepted 24 profiles, 41,743 timed requests and 24 warmups, with **zero errors and zero requests at or above one second**. This remains a nine-utility projection, four repeated query shapes and concurrency one.

| Method | Single-color p95 | 40%-green p95 | Two-color p95 | Five-color p95 |
| --- | ---: | ---: | ---: | ---: |
| Numeric | 26.82ms | 29.95ms | 60.78ms | 113.45ms |
| Direct sort | 2.14ms | 2.01ms | 61.58ms | 113.06ms |
| Direct sort retaining scores | 28.47ms | 30.99ms | 60.38ms | 114.37ms |
| Globally bounded numeric | 4.91ms | 4.15ms | 9.26ms | 67.47ms |
| Numeric with docvalue IDs | 29.03ms | 29.86ms | 60.99ms | 115.03ms |
| Direct sort with docvalue IDs | 1.88ms | 1.83ms | 61.10ms | 115.13ms |

Direct sort leads for one target; its multi-target path intentionally uses the unchanged numeric query. Bounded execution improves both tested combinations despite additional service requests. Merely changing numeric ID fetching does not improve these20-hit timings. These comparisons use one unchanged points index, so the older non-point projection screen remains a separate observation. Full-schema storage/cache effects, C4/C16 and changing-query arrivals are still unmeasured here.

Evidence: `fetch-points-projection-c1-v1/benchmark.json` and `audit-independent-v1.json`.

The precision-feature projection screen completed at 15:48:52 UTC with an accepted independent audit: 12 profiles, 1,627 timed requests and 12 warmups, all below one second and without errors.

| Method | Single-color p95 | 40%-green p95 | Two-color p95 | Five-color p95 |
| --- | ---: | ---: | ---: | ---: |
| 18-bit features | 48.70ms | 48.96ms | 71.76ms | 158.20ms |
| 27-bit features | 60.55ms | 60.79ms | 97.85ms | 230.20ms |
| 27-bit with docvalue IDs | 60.11ms | 59.65ms | 98.19ms | 224.51ms |

The extra feature precision preserves the favorite closely but adds cost in these queries. Numeric utilities and their execution refinements remain the stronger candidates for the next full-schema campaign. This is a screening recommendation; the actual full1M result is still required. Evidence: `fetch-precision-projection-c1-v1/`.

## Full100k pilot at C1

Both full-schema screens completed by **15:54:09 UTC**, with accepted independent audits and zero strict failures. They use all6,138 numeric utilities per document, the favorite controls, numeric point indexes and source-disabled storage. The four repeated query shapes still touch a small portion of that bank.

| Method | Single-color p95 | 40%-green p95 | Two-color p95 | Five-color p95 |
| --- | ---: | ---: | ---: | ---: |
| Numeric | 6.73ms | 5.86ms | 10.04ms | 14.91ms |
| Direct sort | 3.87ms | 2.81ms | 9.41ms | 15.24ms |
| Direct sort retaining scores | 6.80ms | 6.72ms | 9.03ms | 15.02ms |
| Numeric with docvalue IDs | 4.93ms | 5.05ms | 8.63ms | 13.56ms |
| Direct sort with docvalue IDs | 1.39ms | 1.53ms | 7.95ms | 13.91ms |
| Globally bounded numeric | 4.30ms | 4.23ms | 7.02ms | 18.79ms |

Direct sort with docvalue IDs again leads for single targets. Bounded execution helps the tested two-target case but loses to the simple numeric query for five targets at100k, while it wins that projection at1M. Keep both paths in the next comparison; these results do not justify one universal dispatch rule yet.

In the refinement screen, mean server CPU ranged0.687–0.935 cores and client CPU0.107–0.628 cores at the achieved serial throughput. Peak sampled shared heap was3,141,222,384 bytes; client RSS reached283,996,160 bytes. These are process samples, not isolated retained memory or cgroup/cache peaks. The bounded path's additional round trips add client work, which remains part of the measured request.

The subsequent full1M campaign shares one numeric-points bank across all four execution methods. Its first screen stopped during single-color maxima C16; the pooled-cleanup retry has now completed the closed-loop and fixed/varied/wide stages, reported above with every failed load retained. The higher-rate two-method wide follow-up is complete and audited. Historical full100k evidence: `fetch-full-100k-controls-c1-v1/` and `fetch-full-100k-leaders-c1-v1/`.

## Transport refinement used in the capacity retry

A targeted same-query diagnostic recorded 28,269 baseline requests over about
39 seconds with 46 errors and 28,227 connections. The pooled cleanup diagnostic
completed 52,001 requests over 60 seconds with zero errors or one-second failures
and 32 connections; result hashes were identical. These focused transport
observations isolate the connection-reuse change. Their differing durations and
single repeated query do not establish full workload capacity. The original
failed screen remains unchanged; the completed closed-loop retry uses new artifacts.
Evidence: `transport-maxima-pooled-v1/` and the transport diagnostic records linked
from [current work](FAVORITE-OPTIMIZATION-CURRENT.md).

## Full-million build completed; first screen failed and incomplete

The build finished on 2026-09-23 at 17:58:12 UTC, followed by the stored-value audit at 17:58:20 UTC. All **1,000,000 creates across 47,620 batches** were acknowledged, with no admission retries or acknowledgement failures. Document indexing took **7,170.076 seconds**; the index receipt's build/finalization interval was **7,336.453 seconds**. Its final observation recorded **56,048,738,808 primary-store bytes (56.049 GB)** and **66 segments**. This is one primary with no replicas; later retention and merging may change its storage.

The independent ingestion audit reconciles every batch, consecutive synthetic ID, body/response hash and all 29 archived sources with the plan/mapping. The independent stored-value check reconstructs ordinals 0, middle and last from original measurements: **18,414 float32 values across 82 service responses** match the original encoder. This audits three documents, not every stored value. The records are synthetic mixtures of the 523 real images, not one million independently collected wallpapers.

The query screen then stopped at 18:01:15 UTC during single-color maxima at C16. **Eleven finished profiles contain 85,293 timed requests with zero errors. The raw log contains another 12,285 timed requests, including 7,491 errors.** Therefore the whole interrupted run contains **97,578 timed requests and 7,491 strict failures**, plus four error-free warmups. None of the timed rows reached one second; fast transport failures still fail the strict rule. The independent evidence audit passes integrity but records `complete:false` and `accepted:false`. It supplies no final p95 or viability for the unfinished profile and no completed multi-color/filter/arrival coverage.

Completed single-color p95 observations, retained as partial-campaign evidence:

| Method | C1 | C4 | C16 |
| --- | ---: | ---: | ---: |
| Numeric, lean fetch | 31.00 ms | 36.18 ms | 106.89 ms |
| Direct sort, lean fetch | 2.20 ms | 2.73 ms | 8.32 ms |
| Original global bounds | 6.09 ms | 8.04 ms | 27.55 ms |
| Global-maxima bounds | 6.94 ms | 9.30 ms | Interrupted; errors recorded, no final p95 |

Evidence: `points-full-1m-v1/index.json`, `points-full-1m-v1-audit/`, `full-million-ingestion-complete-audit-v2.json`, `full-million-bindings-independent-v1.json`, and `full-million-four-methods-v2/{benchmark.json,requests.jsonl,audit-independent-auto-v2.json}`. These original files are preserved; the successful retry is separately recorded in `full-million-four-methods-pooled-v1/`.

### Resource cost of the completed indexing phase

The archived container observer covers 3,669 samples from 15:55:52.628 to 17:58:12.154 UTC, ending before the stored-value audit and query screen. Across this 7,339.527-second observed interval, container CPU averaged **2.347 cores** of the eight-core quota. Sampled charged memory peaked at **12.000 GiB**, with separate anonymous and file-cache maxima of **4.608 GiB** and **7.334 GiB**. Those maxima need not be simultaneous. Final swap was **0.916 GiB**, down from 0.967 GiB at the start. Observed OOM and OOM-kill event deltas were zero; the memory limit was encountered 188,204 times.

Observed storage I/O was **210.504 GB read / 714.541 GB written** on each of the two reported stacked device layers. These are two views of the same I/O; **do not add them together**. CPU, memory and I/O `some` pressure occupied approximately 0.366%, 0.091% and 1.077% of the observed interval. These are container/phase observations including preparation, merging, refresh and background work—not per-query costs, JVM heap measurements or causal attribution to one index operation. Anonymous memory is not synonymous with heap, and file cache is not application RSS.

The original resource report and its independent recomputation are `resources-indexing-completed-v1/resources-summary.json` and `resources-indexing-completed-independent-audit-v1.json`. The container's lifetime memory peak is separate from the sampled peak of this phase.

## Resource cost of broad-query search

The focused independent replay passed **2,490 checks over six profiles**, including
fixed128 maxima, wide16 sorted, and both64/128 stress methods. It bound the original
campaign resource snapshots and archived observer prefix, without importing the
resource helper or calling services. These are observed resource windows around
the requests, including instrumentation and shared-host background work.

At the two **passing 64 requests/s** profiles (180 seconds each):

| Method | OpenSearch mean CPU cores | Peak sampled JVM heap | Load-generator CPU cores | Peak load-generator RSS | Container charge peak | Device reads | I/O `some` pressure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Numeric, lean fetch | 3.087 | 2.924 GiB | 0.100 | 0.634 GiB | 10.349 GiB | 74.24 GB | 4.45% |
| Ordinary pooled bounds | 1.774 | 2.935 GiB | 0.184 | 0.637 GiB | 10.398 GiB | 107.63 GB | 10.33% |

Both had zero sampled search queue and zero OpenSearch search rejections. Bounds
reduced measured OpenSearch CPU, but increased load-generator work, data reads and
latency on this broad workload. The driver CPU/RSS includes query-bank preparation,
scheduling and retained trial evidence; **it is not isolated production gateway
cost**. The production gateway's memory/CPU still needs its own implementation
measurement. JVM heap is separate from container charge: the latter includes
anonymous pages, file cache and kernel memory. Separate anonymous/file-cache peaks
were about 4.412/5.701 GiB for numeric and 4.411/5.755 GiB for bounds; component
maxima need not coincide. No OOM kills were observed in these focused windows.

At failed128, numeric averaged **7.757 OpenSearch cores** against the eight-core
quota, while ordinary bounds averaged **2.035 cores**. I/O `some` pressure occupied
**63.63% / 78.90%** of the respective observed windows, with peak search queues
**83 / 85**. This supports investigating CPU saturation for numeric and data/cache
stalls for both paths; it does not prove a single failure cause. Shared-host
pressure can affect sorted/maxima observations too, so their failed workloads do
not establish an intrinsic failure of their algorithms. The failures still fail
the user-facing latency requirement.

Device reads are one view of the I/O stack: do not add the matching stacked-device
counters. Pressure measures time with tasks stalled, not a percentage of requests
or disk utilization. Sampling windows have small uncovered edges; no controlled
cold-cache state or isolated-machine comparison was established.

Evidence: `resources-full-million-pooled-completed-v1/resources-summary.json` and
`resources-full-million-pooled-independent-audit-v1.json`. The latter preserves
exact source/input hashes, interval boundaries and counter validity. See the
[full resource and overload analysis](FAVORITE-FINAL-RESOURCES.md). The indexing
resource window remains a separate phase.

## Storage and resources: keep index scopes separate

| Saved index observation | Records | Utility values per document | Encodings/presets | Primary store |
| --- | ---: | ---: | --- | ---: |
| 100k utility projection, indexing receipt | 100,000 | 9 | Four encodings/favorite preset, source disabled | 63,403,458 bytes |
| 1M utility projection, indexing receipt | 1,000,000 | 9 | Same projection | 573,746,617 bytes |
| 1M utility projection, screening final fingerprint | 1,000,000 | 9 | Same index; later observation | 633,395,641 bytes |
| Real full comparison,v2 completion | 545 | 55,242 | Four encodings/nine presets, source enabled | 4,953,881,511 bytes |
| Real full comparison,v4 indexing receipt | 545 | 55,242 | Four encodings/nine presets, source disabled | 2,952,257,465 bytes |
| Real precision comparison,v1 indexing receipt | 545 | 55,242 | 18-bit+27-bit/nine presets, source disabled | 2,067,803,804 bytes |
| Real numeric-points,v2 indexing receipt | 545 | 55,242 | Numeric/nine presets, source disabled, numeric points indexed | 1,071,531,998 bytes |
| Full numeric-points pilot, indexing receipt | 100,000 | 6,138 | Numeric/favorite preset, source disabled, numeric points indexed | 13,044,690,824 bytes |
| Full numeric-points million, final build observation | 1,000,000 | 6,138 | Numeric/favorite preset, source disabled, numeric points indexed | 56,048,738,808 bytes |

The full favorite preset needs6,138 utilities,682 times the nine-utility projection. Neither the projection's bytes/document nor the all-encoding real comparison's bytes/document predicts the size of a selected production representation. The two1M storage figures are distinct observations while index segments can change; retain their timestamps and fingerprints instead of selecting the smaller number. The1M projection took50.907s to index documents and52.112s including finalization. The full all-preset realv4 build took350.572s to index545 documents; it is a debugging/comparison schema.

The full 100k numeric-points pilot completed at 15:15:16 UTC with 100,000 acknowledged and counted documents, 613,800,000 utility values, and zero admission retries or acknowledgement failures. Its 4,762 sequential bulk requests took 1,598.548s to index; total build/finalization time was 1,726.499s. The final observation contained 30 segments and 13.045GB of primary storage. This is actual full-bank evidence, but it is a 100k storage/build result. It does not measure 1M query capacity or predict final storage after later retention and merges.

The scale service has8 CPUs,4GiB heap, and12GiB memory limit. At C1, numeric profiles averaged0.960–0.993 server CPU cores and at most0.067 client CPU cores, with peak sampled heap2,810,140,448 bytes and client RSS176,123,904 bytes. This is process-level sampled evidence on a shared JVM, not attributable per-method retained memory or a measured file-cache/cgroup peak. The full schema may touch many more file pages when users change colors. Resource measurements must be repeated with the full schema and concurrent workload.

The separate real-corpus service was moved to preserved storage and raised to4GiB heap/8GiB memory after the source-disabledv3 build hit a circuit breaker after21 acknowledged documents. The original failed receipt remains. The succeedingv4 count is545. This service change does not alter the already completed scale-service measurements.

Before starting the full1M build at approximately15:55 UTC, the campaign closed16 inactive indexes on the scale node, preserving their data and UUIDs. The real-corpus node and UIs were unchanged. The full1M campaign therefore has a different set of open indexes from the earlier projections/pilot; compare its four candidates within the same new index/environment. The inventory and close receipts are external `pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`.

Source-disabled indexes initially retain hidden recovery payloads. Default stored-ID fetching can therefore still decompress large blocks, especially when a diagnostic retrieves all545 documents. Storage and fetch costs depend on segment/retention state. The completed controlled comparison above demonstrates the cost of the fetch-path choice on these indexes; exact decompressor CPU attribution still requires lower-level profiling. See the [official-source investigation](FAVORITE-STORED-FIELDS.md).

Capacity design and all four timing shapes: [capacity report](FAVORITE-OPTIMIZATION-CAPACITY.md).

## Next results to fill in

The four numeric paths completed the full-million closed-loop and fixed/varied/wide comparison. The higher-rate follow-up and focused resource review are complete. Precision-feature capacity work is deferred. Unmeasured entries remain explicitly outside this round's claims.

| Experiment | Formula/fidelity | Feedback | Full100k capacity | Full1M C1/C4/C16 | Changing-query arrivals |
| --- | --- | --- | --- | --- | --- |
| Numeric full bank, lean fetch | Same precomputed objective; 1M sampled values verified | Passed; all pairs unchanged | C1 passed | All 36 profiles passed | Fixed through 64/s; varied through 128/s; wide16/64 passed full coverage; wide128 failed |
| Numeric direct sort, lean fetch | Preserved numeric results; shared duplicate defect | Passed; all pairs unchanged | C1 passed | All 36 profiles passed | Fixed through 64/s; varied through 128/s; wide16 failed (107 strict failures, incomplete successful coverage) |
| Numeric global bounds, pooled cleanup | Parent execution parity plus actual pooled-transport fidelity passed | Passed; all pairs unchanged | Original transport C1 passed | All 36 profiles passed | Fixed/varied through 128/s; wide16/64 passed full coverage; wide128 failed |
| Numeric global-maxima bounds, pooled cleanup | Parent parity/duplicate fallback plus actual pooled-transport fidelity passed | Passed; all pairs unchanged | Unmeasured | All 36 profiles passed | Fixed through 64/s; varied through 128/s; wide16 passed full coverage |
| 18-bit features |144 comparisons passed;all top20 sets preserved | Passed; all pairs unchanged | Deferred | Deferred | Deferred |
| 27-bit features |144 comparisons passed;favorite16 full orders preserved | Passed; all pairs unchanged | Deferred | Deferred | Deferred |

The bounded prototype uses OpenSearch for every score and final global ranking. It uses preliminary service results only to derive a safe lower bound, then queries the entire eligible index under one point-in-time view. No application shortlist is reranked. See [bounded utility proof and limitations](FAVORITE-BOUNDED-UTILITIES.md). Extra round trips, PIT lifecycle, filters, and total deadline remain part of measured request latency.

The separate [seed-maxima bound refinement](FAVORITE-SEED-MAXIMA.md) passed626 real execution comparisons and independent threshold/trace auditing, preserving every result and all4,543 winners/ties at the seed lower bounds. Extra ranges pruned more documents in105 requests, overwhelmingly two-target cases. Feedback pair outcomes remained unchanged. Its original transport failed during the first full-million screen; the pooled-cleanup variant passed all 36 closed-loop profiles. It failed fixed arrivals at 128/s while ordinary bounds passed; both passed varied 128/s and wide 16/s. Maxima's wide p95/max were lower than ordinary bounds, so the benefit depends on the workload.

The changing-query workload should exercise all6,138 utility keys plus combinations, not only repeat the nine warm utilities. Measure the initial pass separately from later passes; do not label an uncontrolled first pass a cold-cache experiment. Full-schema and projected results must remain separate rows in every later report.

### Published final query checkpoint

`results-checkpoint-20260923-v11.json` was published at **20:34:25.598637 UTC**:
14 performance campaigns, eight fidelity runs, eight feedback runs and 13 index
receipts, with zero warnings. Source SHA-256:
`101c9d7733a489db9afc020d3c7c4ade5d373db7da1e358a6bae4b3afc49d12e`.
`publication-v11-receipt.json` records the atomic publication. Targeted browser QA
in `ui-v11-complete/` verified both passed64/failed128 rows, the historical 7,491
unfinished errors even under filters, matching checkpoint metadata, desktop/mobile
layout and 19 available lab methods. The browser is closed. This checkpoint
retains failed campaigns; completed resource analysis is documented separately above.

## Evidence and reproduction

Newly downloaded wallpapers, the supplied ZIP and new campaign artifacts are stored externally. Legacy `corpus/` and `output/` images remain in ignored worktree folders. No image/ZIP files are eligible for Git, and no commits were made. External artifact root:

```
/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/
```

Primary evidence includes `fidelity-v3/`, `precision-fidelity/`, `execution-fidelity/`, `screen-100k/`, `screen-1m/`, both projection index receipts, `real-index-v2-completion/`, `real-index-v4/`, `precision-real/`, `points-real-v2/`, and `points-full-100k-v1/`. Completed feedback runs under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/` include `2026-09-23T13-31-35.757Z-b1e3873d/`, `2026-09-23T14-58-25.115Z-10d80e62/`, and `2026-09-23T15-12-26.942Z-799bcaac/`. Earlier interrupted artifacts remain discoverable and explicitly incomplete.

The real pipeline, fetch follow-up and all four `fetch-screen-v1` screens are complete. Additional evidence is `fetch-fidelity-v1/`, `maxima-fidelity-v1/`, plus feedback runs `2026-09-23T15-32-41.534Z-1d889ffc/`, `2026-09-23T15-36-43.348Z-5fdd65e8/` and `2026-09-23T15-56-35.122Z-2025cd42/`. The full1M build and sampled stored-value audit are complete. The first query screen remains interrupted; `full-million-four-methods-pooled-v1/` separately passed the complete closed-loop matrix. Fixed, varied and wide16 arrivals are complete and audited; the higher-rate two-method wide follow-up is complete and audited.

The file-only summary generator records each artifact's SHA-256, index/scope, each method/query/concurrency, strict failure unions, sampled resources, fidelity and feedback coverage. It discovers future completed or partial full-schema and arrival runs without combining their measurements. It never queries OpenSearch. JSON summaries complement the independent audit; they do not replace it.

The historical v7 summary is `results-checkpoint-20260923-v7.json`, generated at **16:26:35 UTC**: eight performance campaigns (including an incomplete historical run), seven completed fidelity campaigns, seven feedback runs and thirteen index receipts, with no parse warnings. New evidence includes `multiplicity-fidelity-v1/`, `multiplicity-feedback-v1/`, and `multishard-fidelity-v1/`, with independent audits. The execution campaign's failed intended-arithmetic verdict is retained. All performance entries are unchanged from v5; the new feedback run is accuracy-only. Unpublished v6 is retained; v7 clarifies the distinction between three primary shards and their document counts.

The full-million build had **257,922 acknowledged records** at that historical snapshot. Its final count, storage, indexing duration and query capacity were then unmeasured. Later build completion and interrupted query evidence are recorded above; this older checkpoint remains unchanged.

From repository root:

```sh
make color-favorite-optimization-results-test
make color-favorite-optimization-results COLOR_FAVORITE_ARGS='--root /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23 --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T13-31-35.757Z-b1e3873d/run.json --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T14-58-25.115Z-10d80e62/run.json --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T15-12-26.942Z-799bcaac/run.json --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T15-32-41.534Z-1d889ffc/run.json --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T15-36-43.348Z-5fdd65e8/run.json --feedback /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T15-56-35.122Z-2025cd42/run.json --output /tmp/favorite-results-new.json'
make color-favorite-optimization-audit COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/screen-1m --output /tmp/favorite-screen-1m-audit-new.json'
```

Choose fresh output paths; the summary refuses to overwrite an existing file. For actual query/index reproduction, use the saved campaign's `plan.json`, configuration and source snapshot with the documented Make commands in [the main experiment log](FAVORITE-OPTIMIZATION.md). Index identities, source hashes, control preset, data generator seed, fetch settings and resource limits must match. Heavy index and timing jobs are serialized by the campaign driver.
