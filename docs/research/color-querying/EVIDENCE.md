# Evidence and limits

The [accepted direction](README.md) combines preferred matching behavior with
an indexing approach benchmarked at scale for only one setting. Preference,
global-ranking fidelity, load capacity, and storage have different evidence.

## Human preference evidence

The corpus has 523 real wallpapers, comprising 105 prior sources and 418 supplied
images, plus 22 controlled fixtures. Measurement indexes contain all 545 assets;
the visual prototype excludes fixtures in OpenSearch. Image bytes remain outside Git.

The 38 feedback records include the later red-pagoda comparison. These are one
observer's development judgments on reused images, including uncertain comparisons
and a quick batch, not independent samples or held-out accuracy estimates. The
[evaluation contract](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/evaluation/loop/README.md)
preserves supplied ties, uncertainty, unsupported cases, and eligibility errors.

The linked-slider run tested eight positions across the three- and five-option banks
and five matching original settings. All 13 candidates supported the same 28 cases
and 184 preference pairs, without errors or timing failures. Ten records were
unsupported: four fixture cases, four accent/relative-contrast requests, and two
conceptual cases without images. The bank also rejects intermediate 5% amounts;
this excluded no additional real-image case in the dataset.

| Three-option setting | Query-macro preference agreement | Comparison with the matching original setting |
| --- | ---: | --- |
| Relaxed | 68.33% | Every per-case evaluation record identical |
| Favorite / default | 70.36% | Every per-case evaluation record identical |
| Strictest | 72.26% | Every per-case evaluation record identical |

The metric averages strict preference-pair agreement within supported queries,
then across queries. It is not the fraction of relevant results. Strictest's
higher development-set score does not override the preferred default.

Sources: [linked prototype record](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md),
[archived run summary](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/run-summaries/2026-09-23T22-53-05.476Z-115e5722/summary.json),
[full report](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/shared/runs/2026-09-23T22-53-05.476Z-115e5722/report.md),
and [per-case parity audit](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/shared/exploration/linked-strictness/2026-09-23/feedback-parity.json).
The preceding run failed adapter setup because the harness normalized absent
parameters to an empty object. Its failed report remains in the archive; a
regression test and fresh run establish the corrected result.

## Representation and global-ranking fidelity

Both compact indexes contain all 545 IDs and expected fields: 10,044 utilities
for three options and 16,740 for five. Original-encoder checks compared every
utility on three documents per bank, totaling 30,132 and 50,220 values. This is
a complete-field sample, not an all-document value audit.

Across 48 comparisons covering every setting and six single-color, multi-color,
named, and proportion queries, each implementation retrieved all 523 wallpapers.
Compact results exactly matched the parent numeric representation's ordered IDs
and scores. Against the original cutoff scorer, maximum per-image difference was
`1.4000000003733248e-7`; 40 of 48 complete orders were identical. Near ties and
operation order explain the remaining differences. This demonstrates observed
floating precision, not bitwise parity with every original arithmetic path.

The [full verification evidence](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/shared/exploration/linked-strictness/2026-09-23/verification-v1/verification.json.gz)
records the entire returned rankings and stable index generations. This suite
uses distinct resolved targets. It does not cover the inherited duplicate-field
weighting bug; the separate multiplicity prototype and production follow-up
must remain explicit.

Desktop/mobile browser checks additionally passed for tab state, favorite
parity, live/manual searches, percentage-copy confirmation, all-523 results,
named queries, multiple colors, and image modals. Archive-time checks passed
53 targeted tests. See [archive validation](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/ARCHIVE-VALIDATION.md).

## Performance: what was actually measured

### Original cutoff execution

The favorite's original query-time scoring was too expensive for unrestricted
combinations at one million records on the test node. Serial single-color p95
was about 249–250 ms; two-color p95 was 659–663 ms; every timed unrestricted
five-color request timed out. Some higher-concurrency proportion/two-color
profiles also failed. More selective metadata filters performed better, but
that did not establish broad-query capacity. A confirmation run retained those
limits and exposed an additional two-color failure.

That million-record benchmark used a 70-measurement-field projection needed
by its workload, not a fully populated raw bin bank. The full raw banks were
tested at up to 100,000 records. [Original performance report](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-PERFORMANCE.md).

### Precomputed single-favorite execution

The later complete million-record index had 6,138 numeric utilities per
wallpaper: 279 targets, 22 profiles including 5% increments, and one favorite
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
- Both failed at 128 requests per second on that broad workload. A passing
  lighter workload or low successful-response percentile does not erase those
  failures. Direct sorting also failed the broad 16/s workload despite excellent
  repeated single-query results.
- Selective metadata filters often favored simpler numeric execution; bounds
  could help expensive broad combinations. No combined query dispatcher was
  implemented or validated. CPU, memory, data reads, cache behavior, and cleanup
  transport affected results; score arithmetic alone did not explain all costs.

This experiment excludes Gateway, production ingestion, replicas, and distributed
deployment. It establishes neither a universal executor nor unseen/cold-query
latency, production throughput, or 100-million-record capacity.

Sources: [final optimization results](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-RESULTS.md),
[resource review](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-FINAL-RESOURCES.md),
and [capacity criteria](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-CAPACITY.md).

### Accepted three-option bank

The three-option bank was checked only on 545 assets. Million-record storage,
mixed-setting cache behavior, and concurrent capacity remain unmeasured;
small-corpus diagnostic timings do not establish them.

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

The earlier "about 20 GB" covered 100,000 records, not one million. The roughly
500 GB estimate was never measured; the campaign stopped with about 235 GB free
and no additional storage path. Neither describes the accepted three-option bank.

Three linked presets with 10% amounts reduce field count by 81.8% against the
nine-preset/5% design, not measured disk use. Field overhead, compression, zero
density, and merges prevent reliable extrapolation from 545-record bytes per image.

Sources: [storage correction and blocked campaign](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-NINE-PRESETS-CURRENT.md)
and [compact-bank measurements](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md).

## Evidence preservation

[Archive manifest](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/manifest.json)
and [verification](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/research-archive/verification.json)
record 856 preserved source records, including 405 exact-duplicate references,
all external research documents and frozen source bundles, and 39 readable run
summaries. Large text reports are compressed losslessly. Historical links and
bytes remain unchanged, including failed runs and invalidated measurements.
Raw external artifacts and image assets have an inventory; that inventory is
not a backup of their bytes. The consolidated conclusions above must be read
with each linked report's workload and measurement limitations.
