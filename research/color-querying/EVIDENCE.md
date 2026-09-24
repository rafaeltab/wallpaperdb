# Evidence and limits

The [accepted direction](README.md) combines a user-preferred matching method
with an indexing approach whose earlier, larger benchmark tested only one
quality setting. Keep four questions separate: does the model feel right, does
retrieval preserve its score globally, does it respond fast enough under load,
and what does the complete representation cost to store?

## Human preference evidence

The reusable corpus contains **523 real wallpapers**: 105 prior sources and
418 images from the supplied archive. The measurement indexes also contain 22
controlled fixtures, totaling 545 assets. The current visual prototype excludes
the fixtures inside OpenSearch. The images themselves remain outside Git.

The feedback dataset has **38 logical records**, including the later red-pagoda
comparison. It contains one observer's preferences, reused images, uncertain
comparisons, and a quickly completed batch. These are development judgments;
they are not independent population samples or a held-out accuracy estimate.
The [evaluation contract](../../experiments/color-search-benchmark/evaluation/loop/README.md)
preserves supplied ties, uncertainty, unsupported cases, and eligibility errors.

The linked-slider run evaluated all eight positions across the three- and
five-option banks and five matching original settings. All 13 candidates shared
the same supported subset: **28 complete cases and 184 assessed preference
pairs**, with zero errors or timing failures. Ten records were unsupported:
four controlled-fixture cases, four accent/relative-contrast requests, and two
conceptual cases without source images. Intermediate 5% amounts are also
unsupported by the linked bank; no additional real-image case in this dataset
was excluded solely for that reason.

| Three-option setting | Query-macro preference agreement | Comparison with the matching original setting |
| --- | ---: | --- |
| Relaxed | 68.33% | Every per-case evaluation record identical |
| Favorite / default | 70.36% | Every per-case evaluation record identical |
| Strictest | 72.26% | Every per-case evaluation record identical |

The metric averages strict preference-pair agreement within each supported
query, then across queries. These percentages do not mean that this fraction of
all retrieved wallpapers is relevant. The strictest position's higher value on
this small development set does not override the user's preferred default.

Sources: [linked prototype record](../../experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md),
[archived run summary](../../experiments/color-search-benchmark/research-archive/run-summaries/2026-09-23T22-53-05.476Z-115e5722/summary.json),
[full report](../../experiments/color-search-benchmark/research-archive/shared/runs/2026-09-23T22-53-05.476Z-115e5722/report.md),
and [per-case parity audit](../../experiments/color-search-benchmark/research-archive/shared/exploration/linked-strictness/2026-09-23/feedback-parity.json).
The preceding run failed adapter setup because the harness normalized absent
parameters to an empty object. Its failed report remains in the archive; a
regression test and fresh run establish the corrected result.

## Representation and global-ranking fidelity

Both compact indexes contain all 545 asset IDs, with all expected fields. The
three-option bank stores 10,044 utility fields; the five-option experiment stores
16,740. Original-encoder checks compared every utility on three sampled documents
per bank: 30,132 and 50,220 values respectively. This is a complete-field sample,
not an all-document value audit.

Across **48 comparisons** covering every offered setting and six single-color,
multi-color, named, and proportion queries, all 523 real wallpapers were
retrieved from each service implementation. Compact results exactly matched
the parent numeric representation's ordered IDs and scores. Compared with the
original cutoff scorer, the maximum per-image score difference was
`1.4000000003733248e-7`; 40 of 48 complete orders were identical. The remaining
differences concern very close float ties and evaluation order. The field
representation preserves the intended arithmetic within this observed floating
precision; it is not bit-identical to every original arithmetic path.

The [full verification evidence](../../experiments/color-search-benchmark/research-archive/shared/exploration/linked-strictness/2026-09-23/verification-v1/verification.json.gz)
records the entire returned rankings and stable index generations. This suite
uses distinct resolved targets. It does not cover the inherited duplicate-field
weighting bug; the separate multiplicity prototype and production follow-up
must remain explicit.

Desktop/mobile browser checks additionally passed for tab state, favorite
parity, live/manual searches, percentage-copy confirmation, all-523 results,
named queries, multiple colors, and image modals. Archive-time checks passed
53 targeted tests. See [archive validation](../../experiments/color-search-benchmark/ARCHIVE-VALIDATION.md).

## Performance: what was actually measured

### Original cutoff execution

The favorite's original query-time scoring was too expensive for unrestricted
combinations at one million records on the test node. Serial single-color p95
was about 249–250 ms; two-color p95 was 659–663 ms; every timed unrestricted
five-color request timed out. Some higher-concurrency proportion/two-color
profiles also failed. More selective metadata filters performed better, but
that did not establish broad-query capacity. A confirmation run retained those
limits and exposed an additional two-color failure.

That million-record benchmark used a **70-measurement-field projection** needed
by its workload, not a fully populated raw bin bank. The full raw banks were
tested at up to 100,000 records. [Original performance report](../../experiments/color-search-benchmark/exploration/FAVORITE-PERFORMANCE.md).

### Precomputed single-favorite execution

The later complete million-record index had **6,138 numeric utilities per
wallpaper**: 279 targets, 22 profiles including 5% increments, and one favorite
setting. It used deterministic synthetic mixtures of measurements from the
523 real wallpapers, one primary shard, no replicas, an eight-CPU quota,
4 GiB Java heap, and 12 GiB container limit on a shared host.

- The audited closed-loop retry passed all 144 profiles, with 1,007,172 timed
  requests and 48 warmups. There were no errors or requests reaching one second;
  the maximum timed latency was 491.544 ms. The earlier interrupted run remains
  failed/incomplete in the evidence.
- In the broad scheduled-arrival workload, numeric execution passed 64 requests
  per second with p95 154.361 ms and maximum 316.415 ms. Ordinary global bounds
  passed the same rate with p95 277.111 ms and maximum 740.410 ms.
- **Both failed at 128 requests per second on that broad workload.** A passing
  lighter workload or low successful-response percentile does not erase those
  failures. Direct sorting also failed the broad 16/s workload despite excellent
  repeated single-query results.
- Selective metadata filters often favored simpler numeric execution; bounds
  could help expensive broad combinations. No combined query dispatcher was
  implemented or validated. CPU, memory, data reads, cache behavior, and cleanup
  transport affected results; score arithmetic alone did not explain all costs.

These observations support the indexing direction. They do not establish a
universal executor, unseen-query/cold-cache latency, production throughput, or
100-million-record capacity. The gateway, production event ingestion, replicas,
and distributed deployment were outside this capacity experiment.

Sources: [final optimization results](../../experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-RESULTS.md),
[resource review](../../experiments/color-search-benchmark/exploration/FAVORITE-FINAL-RESOURCES.md),
and [capacity criteria](../../experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-CAPACITY.md).

### Accepted three-option bank

The new three-option bank has only been loaded and checked on the 545-asset
corpus. Its million-record storage, mixed-setting cache behavior, and concurrent
query capacity are **unmeasured**. Small-corpus feedback timings are diagnostic;
they do not substitute for that missing experiment.

## Storage: correction and comparable scopes

Sizes below are decimal GB of primary index store, excluding replicas and
temporary indexing/merge space. Source retention, field count, record count,
and segment layout differ between rows.

| Representation | Records | Primary bytes | Decimal GB | Evidence status |
| --- | ---: | ---: | ---: | --- |
| Original full 256-bin measurements, source enabled | 100,000 | 4,786,014,183 | 4.786 | Measured after maintenance |
| Original full 1,024-bin measurements, source enabled | 100,000 | 19,139,629,133 | 19.140 | Measured after maintenance |
| Original 70-field workload projection, source disabled | 1,000,000 | 1,249,705,319 | 1.250 | Measured; incomplete bin representation |
| Complete numeric favorite preset, 6,138 utilities | 1,000,000 | 56,048,738,808 | 56.049 | Measured full single preset |
| Nine independent presets, 55,242 utilities | 1,000,000 | 504,438,649,272 | 504.439 | Naive nine-times estimate only; not built |
| Three linked presets, 10,044 utilities | 545 | 161,179,376 | 0.161 | Measured small corpus; one segment |
| Five linked presets, 16,740 utilities | 545 | 269,395,070 | 0.269 | Measured small corpus; one segment |

The earlier “about 20 GB” number was for **100,000**, not one million, records.
The roughly 500 GB nine-preset figure was an estimate, not a populated-index
measurement. That campaign was blocked because the available filesystem had
about 235 GB free and there was no additional storage path. Neither number can
be relabeled as the storage cost of the accepted three-option bank.

Changing to three linked presets and 10% amounts reduces field count by 81.8%
relative to the nine-preset/5% design. That is a schema calculation, not a
measured disk-saving percentage. Per-field overhead, compression, zero density,
and merges prevent reliable extrapolation from 545-record bytes per wallpaper.

Sources: [storage correction and blocked campaign](../../experiments/color-search-benchmark/exploration/FAVORITE-NINE-PRESETS-CURRENT.md)
and [compact-bank measurements](../../experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md).

## Evidence preservation

[Archive manifest](../../experiments/color-search-benchmark/research-archive/manifest.json)
and [verification](../../experiments/color-search-benchmark/research-archive/verification.json)
record 856 preserved source records, including 405 exact-duplicate references,
all external research documents and frozen source bundles, and 39 readable run
summaries. Large text reports are compressed losslessly. Historical links and
bytes remain unchanged, including failed runs and invalidated measurements.
Raw external artifacts and image assets have an inventory; that inventory is
not a backup of their bytes. The consolidated conclusions above must be read
with each linked report's workload and measurement limitations.
