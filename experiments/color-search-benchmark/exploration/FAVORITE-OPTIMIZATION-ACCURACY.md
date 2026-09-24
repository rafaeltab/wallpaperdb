# Optimization accuracy audit

## Current interpretation

The completed checks support the **numeric utility execution prototypes**, now tested on the completed full-million index. The generic fused script matches the original favorite exactly in the audited cases; precomputed numeric utilities preserve the formula at supported presets with small floating-point differences. Direct sort, lean ID fetch and both global-bound executors preserve their numeric parent objective. The pooled-cleanup variants change transport only and passed separate actual-transport fidelity. Quantized feature encodings remain explicitly approximate. The [19-option method map](FAVORITE-OPTIMIZATION-RESULTS.md#what-the-19-comparison-options-mean) identifies each UI choice.

The separate repeated-target correction passed 135 changed-query executions and 27 unchanged controls, plus 144 ordinary-query comparisons. It restores repeated utility weights without adding percentages together. The original methods retain their documented duplicate arithmetic failure; the new result does not rewrite that historical verdict.

Existing human feedback is unchanged for the numeric, finer-precision, execution and pooled-transport refinements: 32 supported cases, six unsupported and the same 234 judged pair outcomes. This establishes regression evidence against one observer's uncertain judgments, not improved relevance for all users. No human case labels duplicate targets. Correctness covers 523 real wallpapers plus 22 fixtures, including a three-primary test on one physical node. **The full-million closed-loop and fixed/varied/wide16 campaign is complete and audited; the two-method higher-rate follow-up is also complete and audited.** Fixed 128/s has three failed methods and wide16 has one despite accepted evidence; do not convert an audit pass into a performance pass. See [current work](FAVORITE-OPTIMIZATION-CURRENT.md) and [measured results](FAVORITE-OPTIMIZATION-RESULTS.md).

## Completed formula and ranking checks

The completed `fidelity-v3` run compared the original 256-bin favorite with four precomputed utility encodings and the generic fused script. It used all 545 indexed assets, including the 22 controlled fixtures, 16 queries, and nine control combinations: quality influence 0/0.5/1 × cutoff weighting 0/1/3. The run finished at **2026-09-23 13:31:35 UTC**.

An independent, read-only audit recomputed results from `rankings.jsonl`: 144 query/settings combinations, 576 utility comparisons, and 313,920 document score comparisons. It verified complete document IDs, score errors and bounds, exact ordering flags, top-20 overlap, maximum rank displacement, inversion counts, largest inverted score gaps, and the archived source hash. All checks passed. The generic fused script matched every original score and position in all 144 combinations. The separately developed typed script is not included in this particular all-preset artifact.

| Utility encoding | Largest score error | Identical complete orders /144 | Lowest top-20 overlap | Largest original score gap reversed |
| --- | ---: | ---: | ---: | ---: |
| Numeric float fields | 0.000000140 | 130 | 20/20 | 0.000000100 |
| Two 8-bit limbs, 16-bit utility | 0.000007660 | 14 | 20/20 | 0.000014700 |
| 8-bit utility | 0.001960800 | 0 | 14/20 | 0.003911023 |
| Native float feature | 0.001953040 | 0 | 14/20 | 0.001921300 |

Scores are on the original approximately 0–1 scale. These are measured errors against the native baseline, not percentages of human relevance. The indexed-encoding oracle agreed with OpenSearch within 0.000000030 for every encoding. All observed deviations stayed inside the declared numerical bounds.

At the user's favorite controls, quality influence **0.5** and cutoff weighting **1**:

- Numeric utilities preserved the complete ordering for all 16 queries, with maximum score difference 0.000000120.
- The 16-bit encoding retained the original top 20 for all 16 queries. Maximum rank movement was 15 positions; the largest inverted baseline score gap was 0.000014447.
- The 8-bit encoding averaged 19.375/20 retained results; native float features averaged 19.5/20. Both retained only 14/20 for the grayscale query. These encodings introduce observable ordering changes even though their numerical errors are small.

Across all presets, the 16-bit encoding moved some closely scored documents by as many as 97 positions. A large rank movement can occur in a densely scored tail; the accompanying score gap and visible top results are necessary context. We do not classify a numerical threshold as a perceptual tolerance.

## Completed18-bit and27-bit refinement checks

The precision run completed at **2026-09-23 14:58:24 UTC**. It tested both new feature encodings against the original native favorite over the same545 assets,16 queries and9 presets. An independent Python audit reconstructed every ranking comparison from saved responses:144 query/settings combinations,288 comparisons and156,960 document scores. It also checked complete ID sets, archived source identity, unchanged before/after index generations, saved native and encoded oracles, and the declared quantization bounds. All checks passed.

| Refinement | Largest score error | Identical complete orders /144 | Lowest top20 overlap | Largest original score gap reversed | Maximum rank displacement |
| --- | ---: | ---: | ---: | ---: | ---: |
| 18-bit, two base512 digits | 0.000002000 | 40 | 20/20 | 0.000003620 | 89 |
| 27-bit, three base512 digits | 0.000000150 | 129 | 20/20 | 0.000000100 | 13 |

At the favorite controls,27-bit preserved all16 complete orders, with maximum score delta0.000000100. The18-bit encoding preserved all16 top20 sets but only2 complete orders; its largest reversed gap was0.000003300 and maximum rank displacement15. This supports27-bit as a higher-fidelity feature encoding, conditional on its additional posting and query costs. It does not establish that its performance is better than numeric utilities. Both service/oracle discrepancies stayed below0.000000030.

Evidence: `precision-fidelity/fidelity.json`, `rankings.jsonl`, `oracles.jsonl`, and `audit-independent-v1.json`. The audit implementation is external `independent-refinement-audit-v2.py`; it uses independent rank/inversion calculations and does not import the service/scoring implementation. It verifies saved oracle consistency, not a new independent pixel extraction. Archived source SHA-256: `01f871f5e02bc3cd4966cc9db16b2c1711e48f249dca21084cb28d91c122b016`.

## Global execution checks and duplicate-target defect

Execution fidelity completed at **2026-09-23 15:32:41 UTC**. Its execution-equivalence checks passed, but its overall formula verdict is **failed** because of the duplicate-target defect below. The independent file-only audit accepted the evidence and preserved that failed verdict.

The campaign tested 160 query/settings cases: the 144 original query/preset combinations, two duplicate-target diagnostics and 14 eligibility/filter cases. Each of direct sort, scored direct sort and globally bounded execution completed 626 requests, covering limits 1, 3, 20 and full-corpus retrieval where applicable. All **1,878 requests and 250,158 returned document scores** exactly matched the corresponding numeric service result in IDs, order and returned score values. Nonduplicate numeric results differed from the original favorite by at most 0.000000140 and from the saved arithmetic oracle by less than 0.000000030.

The audit also checked the archived source, unchanged index generations, actual final global range queries, preservation of score clauses and metadata filters, and PIT use/closure including rotated PIT IDs. Positive bounds were applied in 473 executions; 467 pruned documents while preserving the global result. This included 158 pruned limit-1 cases, 158 limit-3 cases and 151 limit-20 cases. The largest observed reduction was 544 of 545 eligible documents. Full-corpus requests correctly fell back to the full query. These counts establish exercised pruning on this corpus, not expected production selectivity or speed.

**Duplicate-target defect:** two targets resolving to the same utility field are effectively counted once while retaining their per-clause half weight. For example, the top result for two identical 50%-red targets scores 0.4940832, while the equivalent single-target utility is 0.9881664. The intended mean of two equal utilities should equal that single utility. Both identical red and nearby red colors mapping to one anchor reproduce the defect; maximum error against intended arithmetic is 0.49408319185. The preserved native favorite has the same defect, and all three execution refinements reproduce its numeric-service behavior exactly. This is not a harmless float rounding difference. This historical campaign does not claim a correction. The separately validated scalar correction is documented below and preserves this failed verdict for the original methods.

Evidence: `execution-fidelity/fidelity.json`, `references.jsonl`, `executions.jsonl`, `service-traces.jsonl`, `duplicate-diagnostics.jsonl`, and `audit-independent-v1.json`. Independent audit implementation: external `independent-refinement-audit-v3.py`. Archived source SHA-256: `cf2961278dccab660a53dce5882493e70ad9e5f7d777316dafa3c7745ad7accb`.

## Fetch-only refinement

The docvalue-ID fetch campaign completed at **2026-09-23 15:36:43 UTC**. Numeric, 27-bit and direct-sort variants each preserved all 144 archived orders and raw score values: **432 comparisons and 235,440 document scores**. The independent audit verified complete unique IDs, archived reference/source hashes, unchanged index generations, and request bodies. Only ID-fetch settings changed; the parent score/filter/sort body stayed intact. All 24 additional same-index stored-ID/docvalue-ID pairs also preserved IDs and scores.

The archived numeric reference came from the older equivalent utility index; current measurement/source hashes matched, and the same-index A/B pairs supplement that historical comparison. This validates transport parity, not intended duplicate-target arithmetic or human perception. The duplicate defect remains unchanged.

Evidence: `fetch-fidelity-v1/` and its `audit-independent-v1.json`; independent implementation `independent-fetch-audit-v1.py`. Archived source SHA-256: `fc4f4fd201bfeecf6f37ef4ba6fe892ff09d2b6acad93a2a863e951269cdd956`.

## Stronger bounds from global maxima

The separate maxima executor passed its real-service run at **2026-09-23 15:56:34 UTC**. An independent file-only audit verified all **626 executions and 83,386 returned scores** against the numeric service across 160 cases. IDs, order and raw scores matched exactly.

The audit reconstructed 189 complete utility fields from archived full-corpus seed sorts, independently checked each maximum against the eligible documents, verified the float32 predecessor of each added threshold cannot win even when all other utilities reach their maxima, and retained all 4,543 saved scores tied with or above the seed lower bounds. It checked PIT rotation/closure, unchanged scoring and metadata filters, and reproduced every candidate-count result from the reconstructed values.

Of 473 positive-bound executions, 458 added necessary per-field ranges and 105 eliminated extra documents: 102 two-target cases and three five-target cases. The largest additional reduction was 525 documents. Six positive-bound duplicate cases correctly retained only the original OR bound; the shared duplicate-target arithmetic defect remains. This is execution correctness evidence, not a measured speed improvement.

Evidence: `maxima-fidelity-v1/audit-independent-v1.json` and the accompanying raw references, service traces and candidate counts. Independent implementation: external `independent-maxima-audit-v1.py`. Archived source SHA-256: `addb62a4adf3e2b502a0d7aa3ed0ba76762ac99680fc88d06e3bdca7e97a207e`.

## Pooled cleanup transport fidelity

The two additional bounded variants preserve their original parent scorers,
filters, deadlines and acknowledged PIT cleanup, while reusing HTTP connections
for the cleanup request. Their real-service suite completed **2,504 executions
and 333,544 returned scores** over the retained one-primary and three-primary
indexes. IDs, order and float32 scores matched their numeric reference exactly.
The independent audit checked 34 source bindings, unchanged index generations,
13,256 HTTP stages, 2,504 actual native cleanup acknowledgements and 2,503 socket
reuses. This verifies the new transport was exercised, not bypassed by a mock API.

The audit retained 1,892 positive-bound executions, 916 maxima-range executions
and 12 duplicate fallbacks. The duplicate-target arithmetic defect remains;
these methods do not incorporate the separate multiplicity correction. Every
created/rotated PIT had an acknowledged cleanup. One idle pool socket captured
before final pool shutdown is distinct from a leaked PIT.

Evidence: `pooled-fidelity-v1/fidelity.json` and
`pooled-fidelity-v1/audit-independent-v2.json`. The v2 file-only replay passed with
the same preserved results. This is correctness on 545 assets and shard reduction
on one physical node, not million-record performance or multi-node resilience.

## Three-shard global ranking

The separate shard-reduction campaign completed at **2026-09-23 16:15:53 UTC**. A fresh numeric-points projection stored all 545 assets and 189 utility fields across three primary shards, with **188 /186 /171 documents** and zero replicas. The shards shared one physical OpenSearch node.

Numeric docvalue-ID, direct-sort docvalue-ID, original bounded and maxima-bounded execution each completed 480 requests: **1,920 comparisons and 342,940 returned scores** in total. They covered the 16 original queries across nine presets, duplicate diagnostics, selective metadata/ID eligibility, empty eligibility and zero-score ties, with limits 3, 20 and 545. Every global ID/order and float32 score matched the separate single-primary numeric reference; unchanged score-query paths also preserved raw score values. Direct sorting can serialize the same float32 value differently.

The independent file-only audit verified all 545 bulk-create acknowledgements, encoded-document and source hashes, complete disjoint shard inventories, unchanged index generations, every global search's successful shard count, and PIT rotation/closure. Its separate stored-utility arithmetic oracle checked 82,078 reference scores using the preserved duplicate-clause behavior. Positive bounds appeared in 760 executions; maxima added ranges in 329; six positive duplicate cases used their conservative fallback. Every one of 167,610 saved winner/tie observations at or above a seed lower bound survived the final global filters.

This validates distributed shard reduction on one node. It does **not** establish multi-node reliability, network/failover behavior, or performance. Other correctness work and million-record indexing were allowed to overlap. The shared duplicate-target arithmetic defect remains in these four methods.

Evidence: `multishard-fidelity-v1/`, especially `audit-independent-v2.json`; independent implementation `independent-multishard-audit-v2.py`. The retained v1 audit covered actual top-K winners; v2 additionally reads the correct `kthSeedScore` evidence field to check every lower-bound tie. Archived source SHA-256: `a340c2a55c2766da2bb56cee219749634ce28925c8620977ac9f0fcdeb33a049`.

Reproduce with a new external directory and a new scratch index:

```sh
make color-favorite-multishard-fidelity-test
make color-favorite-multishard-fidelity COLOR_FAVORITE_ARGS='--directory /external/new-multishard-run --index color-exploration-favorite-multishard-real-v2'
```

The runner pins real OpenSearch port 19216. It retains source, requests, encoded documents, acknowledgements, per-shard inventories, reference rankings and executor traces. It never overwrites an existing index or output directory.

## Separate duplicate-target correction

A new scalar utility variant corrects repeated resolved fields by grouping them with factor **multiplicity / original target count**. Percentages remain separate utility targets; the correction does not merge two 50% requests into a 100% request. The original favorite and earlier optimized variants remain unchanged.

Service fidelity completed at **16:08:20 UTC**. Its 162-case suite contains **135 actual duplicate-weight corrections and 27 unchanged different-percentage controls**, not 162 corrections. All matched an independently reconstructed grouped float32 oracle. It additionally preserved 144 ordinary query/preset rankings and passed three filtered/empty eligibility comparisons. Maximum difference from the ideal unrounded repeated-term mean was 0.000000079473. An independent audit verified 30,564 suite scores and 78,480 ordinary-parent scores, plus 36 full single-equivalent/control comparisons.

Accuracy-only feedback completed at **16:10:26 UTC**. Both parent and corrected scalar methods completed 32 cases, skipped six unsupported cases, and had no errors. All 234 assessed pair outcomes remained unchanged: 69.4792% agreement, or 68.8542% excluding uncertain pairs. **The feedback dataset contains zero duplicate-target cases**, so this is an ordinary-query regression check, not human validation of duplicate-query semantics. No timed phase or capacity result was collected.

Evidence: `multiplicity-fidelity-v1/`, `multiplicity-feedback-v1/`, and `multiplicity-independent-audit-v1.json`. This correction does not retroactively clear the preserved execution campaign's failed intended-arithmetic verdict.

## Human-feedback evaluation

### Initial source-enabled run

The existing feedback loop finished at **2026-09-23 13:46:08 UTC**. The audit independently recomputed pair outcomes from the frozen judgments and raw hit scores for all 216 successful candidate/case records, recomputed their aggregate metrics, and verified the archived source hash. Each supported case contributes equally to the reported agreement; this is not a claim that approximately 69% of search results are good.

| Method | Complete / unsupported / error cases | Agreement | Excluding uncertain pairs |
| --- | --- | ---: | ---: |
| Original favorite | 32 / 6 / 0 | 69.4792% | 68.8542% |
| Generic fused script | 32 / 6 / 0 | 69.4792% | 68.8542% |
| Typed fused script | 32 / 6 / 0 | 69.4792% | 68.8542% |
| Numeric utilities | 32 / 6 / 0 | 69.4792% | 68.8542% |
| 16-bit utilities | 32 / 6 / 0 | 69.4792% | 68.8542% |
| Native float features | 32 / 6 / 0 | 69.7396% | 69.1146% |
| 8-bit utilities | 24 / 6 / 8 | **Incomplete; not comparable** | **Incomplete; not comparable** |

The six complete candidates assessed 234 of the dataset's 265 preference pairs, or 229 of 260 after excluding uncertain pairs. No eligibility violations were reported. Native float's small aggregate gain is entirely one discordant pair becoming a tied score in `proportion-green-real-batch-002`; the metric awards a tie half credit. It did not become a correctly ordered pair. This is not evidence of improved perception accuracy.

The 8-bit candidate encountered eight **10-second accuracy-stage timeouts**: near-neutral, monochromatic, grayscale/red (two cases), blue/orange (two cases), warm-red precision, and muted-green precision. Its reported 69.7222% aggregate used only the remaining 24 cases, so it must not be compared with the others' 32-case aggregates. The feedback process returned an error and the sequential pipeline correctly stopped. The saved results remain useful evidence of both accuracy and integration failures. Zero failures among the later timed trials does not erase the failed accuracy-stage requests, which were excluded from timing.

The feedback configuration is `configs/favorite-optimization-feedback.json`. It retains the existing judgments and includes the perceived-red pagoda case. The three-document encoding-reference spot check in the fidelity driver is an additional consistency check: the separate baseline comparison and encoded-oracle checks still cover every one of the 545 documents.

### Source-disabled integration follow-up

The follow-up completed at **2026-09-23 15:12:26 UTC**, using the source-disabledv4 utility index and the larger real-service heap. All seven candidates completed32 cases, skipped the same6 unsupported cases, and reported zero accuracy-stage errors and zero timed failures. An independent audit reconstructed pair judgments from the frozen order groups and recomputed all224 successful candidate/case records, category and aggregate metrics, coverage, and dataset/corpus hashes. Its integrity check passed. The archived source hash was separately verified.

| Method | Agreement over32 complete cases | Excluding uncertain pairs | Pair outcomes changed from baseline |
| --- | ---: | ---: | ---: |
| Baseline, generic/typed scripts, numeric,16-bit | 69.4792% | 68.8542% | 0 |
| 8-bit | 69.7396% | 68.8021% | 5 |
| Native float feature | 69.7396% | 69.1146% | 1 |

The8-bit changes are three discordant pairs becoming ties (pink and two green-proportion cases), and two concordant pairs becoming ties (darkness and muted-green precision). Its small all-pairs gain reverses direction after removing uncertain pairs. Native float again changes only the one green-proportion pair from discordant to tied. Neither result demonstrates improved perception accuracy.

This run fixes the earlier coverage gap for comparison purposes; it does not erase the earlier eight timeouts or isolate their cause, because both index storage and service memory changed. Its small-corpus timed results are not a full-schema million-document capacity result.

Run: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T14-58-25.115Z-10d80e62/`. Independent audit: external `lean-feedback-independent-audit-v1.json`. Archived source SHA-256: `7bf8f0062743feb4a70651a0643450e5e8e4edaa0c55205fd1a823dd36fc6e6d`.

### Precision-encoding follow-up

The precision feedback run completed at **2026-09-23 15:20:49 UTC**. Baseline, 16-bit, 18-bit and 27-bit methods each completed 32 cases, skipped the same six unsupported cases, and had no accuracy errors or timed failures. All 234 assessed pair outcomes were identical to the baseline: agreement was **69.4792%**, or **68.8542%** excluding uncertain pairs. The independent audit reconstructed all 128 successful candidate/case records and verified the frozen dataset and corpus hashes. The archived source hash was separately verified.

This establishes that the higher-precision encodings preserve the measured human-feedback outcomes. It does not establish improved perception, new query coverage, or capacity at scale.

Run: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T15-12-26.942Z-799bcaac/`. Independent audit: external `precision-feedback-independent-audit-v1.json`. Archived source SHA-256: `27f6a6f4eb887c7ad9449225ca26049053d71e70cc3b45b731030b8623b0a495`.

### Execution and fetch follow-ups

The execution follow-up (`2026-09-23T15-32-41.534Z-1d889ffc`) compared the original, numeric, direct-sort, scored-sort and bounded methods. The fetch follow-up (`2026-09-23T15-36-43.348Z-5fdd65e8`) compared the original with numeric, 27-bit and direct-sort docvalue-ID variants. Every candidate completed 32 cases with six unsupported and zero errors or timed failures. All 234 judged pair outcomes remained identical: **69.4792% agreement**, **68.8542% excluding uncertain pairs**.

Independent audits reconstructed raw-score pair judgments and checked dataset/corpus and source hashes. A separate path audit confirmed that all 32 bounded accuracy requests used the actual PIT executor. Timed feedback records do not retain each stage trace; their archived adapter dispatches through the same executor. These development cases contain no explicit duplicate-anchor arithmetic expectation, so their passing feedback does not clear the separate defect.

Evidence: external `{execution,fetch}-feedback-independent-audit-v1.json`, `execution-feedback-bounded-path-audit-v1.json`, and `fetch-feedback-execution-path-audit-v1.json`; both run directories are under the same external `runs/` root.

The maxima feedback follow-up (`2026-09-23T15-56-35.122Z-2025cd42`) also passed: baseline, numeric docvalue-ID, original bounded and maxima-bounded methods each completed 32 cases with six unsupported and no accuracy or timed failures. All 234 pair outcomes were unchanged. The independent path audit confirmed the actual maxima PIT executor in all 32 accuracy calls; their limit1000 appropriately uses the full-corpus fallback. Meaningful top-K pruning is established by the separate limit1/3/20 fidelity cases above. Reports: `maxima-feedback-independent-audit-v1.json` and `maxima-feedback-execution-path-audit-v1.json`.

### Pooled-cleanup feedback and execution path

Run `2026-09-23T18-36-10.447Z-84f622c2` compared the original favorite, numeric lean
fetch, pooled global bounds and pooled maxima. All four supported 32 cases,
skipped the same six, and retained every one of the 234 judged pair outcomes:
**69.4792% agreement**, or **68.8542% excluding uncertain pairs**, with no accuracy
errors or timed failures. The independent judgment audit is
`pooled-feedback-independent-audit-v1.json`.

`pooled-feedback-execution-path-audit-v2.json` checked the frozen adapter/runner
sources and all 32 saved accuracy executions for each pooled method. Each carries
an actual native cleanup witness. Those limit-1000 queries intentionally use the
full-query fallback on 545 assets; top-K pruning is covered by separate fidelity.
Each candidate's 96 timed feedback requests matched its saved full-query prefix.
Timed rows omit stage traces, so native cleanup witnesses cannot be reconstructed
for those rows; source binding establishes the same execution path. These timings
are integration diagnostics, not scale capacity evidence.

The earlier incorrect generic-runner invocation
`2026-09-23T18-35-44.336Z-e30f5f5b` remains preserved as 148 setup errors with zero
service calls. It is not a scoring result or a comparable same-dataset feedback
run. The successful run used the exploration wrapper.

## Full-million warmup ranking consistency

After all timing ended, a separate file-only audit compared the pooled campaign's
48 saved warmups: four methods × four query shapes × three metadata filters. All
36 comparisons against numeric docvalues preserved IDs/order and all720 raw
scores exactly, with maximum score difference0. Every warmup returned the full
expected20 hits; none failed or reached one second.

The audit bound31 archived source files to the approved44-pin launch manifest,
checked the exact config, accepted raw-capacity evidence and completed full-bank
receipt, and verified unchanged index generations. The index contains1,000,000
synthetic measurement mixtures and6,138 numeric utilities, UUID
`LHjoEvSiR8KNe5WZv_a7iA`. Pooled warmups also carried their actual single-attempt
native cleanup witnesses. Evidence:
`full-million-four-methods-pooled-v1/audit-warmup-pooled-parity-v1.json`.

This supplements the complete545-asset execution traces with consistency at the
actual million-record schema. It covers saved top20 warmups, not every timed
query or all million document scores, and creates no new human relevance labels.

### Recorded host overlap

The same raw-file pass associated the previously recorded file-audit overlap
(18:47:38.419–18:47:40.739 UTC) with78 timed requests in the unfiltered
`numeric-docvalues / picked-one-vibe / C1` profile. None errored or took at least
one second; no warmup fell in that interval. All samples remain in the original
profile. Timestamp association does not estimate the audit's performance effect
or establish that it had none. The report retains this limitation and the
profile's broader resource envelope.

The helper passed four isolated tests. Separately, nine pure cardinality-bound
tests passed after timing; that new compiler remains unintegrated and has no
service-fidelity or capacity result. Commands, source hashes and logs are recorded
in `post-timing-completion-checks-v1.json` and `post-timing-tests-receipt-v1.json`.

## Performance evidence

The initial repaired scale pipeline completed `screen-100k/benchmark.json` and `screen-1m/benchmark.json`; both passed independent evidence audits. The1M screen contains96 timed strict failures plus3 failed warmups in the original/script five-color profiles. All16 utility profiles passed at concurrency one. These are workload-projection measurements, not full-schema or concurrent-user capacity. Later numeric-points/precision projection screens and full-100k numeric screens also completed with independent audits.

The full-million numeric build and sampled value audit are complete. The preserved
first full-bank query attempt contains 7,491 errors; the pooled retry separately
passed all 144 closed-loop profiles. Fixed and varied scheduled arrivals are also
complete and audited: ordinary bounds passed fixed 128/s, while the other three
methods failed that rate; all four passed the lighter varied mix at 128/s. Their
different query compositions prevent a cache-only interpretation. Wide16 is
complete: numeric and both bounds passed and successfully queried all 6,138 keys;
sorted failed with 107 strict failures and 6,088 successful keys. The higher-rate numeric-versus-ordinary-bound follow-up also completed: both passed
wide64 with all6,138 keys, and both failed wide128 with incomplete successful key
coverage. The separate resource report and focused independent replay are complete. See [results](FAVORITE-OPTIMIZATION-RESULTS.md) for all
measured scopes and limits; none of this creates new human relevance labels.

Formula-validation timing is excluded from performance conclusions: validation requests retrieve all545 IDs and can use a different fetch configuration. The completed same-index fetch comparison changed all-document medians from roughly1.8–5.9 seconds to3.6–6.4ms while preserving results. Its20-hit pairs were less consistent. The mechanism and controlled diagnostic are documented in [stored-field findings](FAVORITE-STORED-FIELDS.md). Do not relabel all-document diagnostic times as20-hit user-query latency or1M capacity.

## Limits

- Fidelity means agreement with the preserved favorite; it does not establish that the favorite matches every user's perception.
- Human judgments come from one observer and include acknowledged uncertainty. They are development evidence, not a held-out population study. New or unjudged wallpapers do not become relevance labels by appearing in search results.
- The measured utility controls are discrete. Percentage targets use the prototype's 5% grid; unsupported controls or targets are rejected rather than silently rounded. Interpolation, if added, needs its own fidelity and feedback evidence.
- These results cover 16 query shapes and nine supported control combinations, not every possible query.
- Scale records are synthetic mixtures of real measurements. Workload-projection timing cannot establish the storage or memory cost of a full production index.
- This report evaluates the current utility scorer derived from the endorsed shade-aware, strict-hue method. It does not substitute the earlier named-color/vibe utility formula.

## Evidence locations

External artifact root (wallpapers remain outside Git):

```
/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/
```

- `fidelity-v3/fidelity.json`: all numerical comparison summaries.
- `fidelity-v3/rankings.jsonl`: complete baseline and candidate rankings for independent audit.
- `fidelity-v3/source-snapshot.json`: executed source, SHA-256 `6d89186c1685506b9f19016e76a8dc826125a3455bac240084e6245db4b44942`.
- `real-index-v2-completion/completion.json`: complete real-index mapping, source, count and sample validation.
- `first-round-continuation-v3/status.json` and `plan.json`: sequential run status and output paths.

The completed feedback evidence is in `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-23T13-31-35.757Z-b1e3873d/`, including `run.json`, `dataset.json`, `report.md`, and `report.html`.
