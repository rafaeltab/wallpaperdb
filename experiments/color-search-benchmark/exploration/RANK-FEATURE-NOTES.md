# Indexed utility profiles with rank features

## Question

Can common named-color and vibe queries use a handful of native scoring clauses while retaining a global ranking across all metadata-eligible wallpapers?

This prototype precomputes positive utility profiles at indexing time, then uses OpenSearch `rank_feature` queries with `linear: {}`. It contains no learned model or image embedding. The full 545-asset corpus is indexed in `color-exploration-rank-feature-real-v1` on the real scratch service at port 19216.

## Confirmed service support

OpenSearch 2.11 supports the `rank_features` mapping and documents its approximately 0.4% relative numeric precision. The field is intended for scoring rather than direct sorting or aggregation. [OpenSearch 2.11 rank field documentation](https://docs.opensearch.org/2.11/field-types/supported-field-types/rank/)

The pinned 2.11.0 query implementation explicitly parses `linear` and delegates it to Lucene's `FeatureField.newLinearQuery`. This matters because some current documentation lists only the other scoring functions. Actual requests against our 2.11.0 service also passed. [OpenSearch 2.11.0 query implementation](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/modules/mapper-extras/src/main/java/org/opensearch/index/query/RankFeatureQueryBuilder.java#L245)

Rank-feature queries can skip noncompetitive hits when total-hit counting is disabled. That is a useful implementation capability, not a guarantee that our dense, heavily tied utility profiles will be fast at a million documents. [Official OpenSearch client documentation](https://opensearch-project.github.io/opensearch-net/api/OpenSearch.Client.html#OpenSearch_Client_IRankFeatureQuery)

## Stored representation

One `utilities` field has mapping type `rank_features`. Every document stores profiles for the existing 23 named color/vibe families.

For each family, round its measured area to the nearest whole percentage point, giving bucket `a`. For every target percentage `t` from 0 through 100, index:

```text
area_utility[a,t] = 100 - abs(a - t)
```

Zero utilities are omitted. Positive values are integers from 1 through 100, which fit exactly in the field's nine significant bits. Thus OpenSearch introduces no additional feature-value approximation for these profiles.

The second variant also stores:

```text
vibe_utility = round(255 × area^0.65 × conditional_color_quality)
```

These integers also fit exactly. The intentional vibe quantization has at most `0.5/255`, or approximately 0.002, absolute utility error. Area quantization has at most 0.5 percentage points error.

### Fractional target percentages

A query for 40.3% green interpolates the 40% and 41% target profiles with weights 0.7 and 0.3. This interpolation is **exact for the quantized document area**: the absolute-error function changes slope only at `a`, and `a` is on the 1% grid. There is no hidden kink between neighboring grid points.

This differs from interpolating 5%-spaced profiles while retaining 1%-spaced document areas, where a kink could lie inside the interpolation interval and introduce error.

## Query and supported behavior

- `rank-features-area` uses target-area utility for proportions and coverage for vibe queries.
- `rank-features-vibe` uses the same proportional objective and the precomputed area/quality utility for vibe queries.
- Each target needs one native clause, or two for a fractional target percentage.
- A constant score of `0.000001` keeps zero-utility documents eligible without changing their relative order.
- Metadata constraints execute inside OpenSearch.
- `track_total_hits` is false; results sort by descending score then stable image ID.
- Target errors are averaged. Unspecified remainder remains free of any additional color penalty.
- Joint unwanted-color penalties, accent products, arbitrary picked colors, and custom RGB/HSV/HSL ranges are not implemented by these profiles. Unsupported controls are rejected explicitly; the missing palette-purity penalty is exposed as a limitation for ordinary composition queries.

This is an exact global search over a quantized additive objective. Its approximate color representation should not be confused with approximate candidate retrieval. All runtime document filtering and scoring happen in OpenSearch.

## Checks and initial indexing evidence

Four tests passed, including real integration:

1. Fractional target interpolation checked across every possible 1% document-area bucket.
2. All indexed values are positive integers no larger than 255; zero utility is omitted and zero-score eligibility retained.
3. Unsupported custom colors/ranges and joint accent queries are rejected.
4. Two variants × five queries returned all 545 documents with scores within `2e-7` of an independent mathematical utility calculation.

The isolated real index contains 545 documents and 1,272,591 positive feature entries, averaging 2,335 per document. Initial indexing took 1.03 seconds; its measured size with `_source` enabled was 12,305,261 bytes. These are small-corpus measurements, not extrapolated production figures.

Index metadata and server version are recorded externally in:

`~/.local/share/wallpaperdb/color-evaluation/exploration/color-exploration-rank-feature-real-v1.json`

## Scale costs and interpretation

The profiles are dense: a million documents would carry roughly 2.3 billion positive entries if their sparsity resembles this corpus. Indexing CPU and storage must be measured. Storage is a lower product priority, but indexing this many postings is still operational work.

Quantized utilities also create score ties. Stable secondary ID sorting and tied block maxima may reduce competitive skipping. Benchmark the actual query shape under load before claiming that the native query mechanism solves scaling.

Both variants have now run through the human-judgment feedback loop and million-document workloads. Their common named queries may be useful even when other methods remain necessary for advanced controls. Missing query support is not an accuracy failure or a free success; compare coverage alongside agreement.

## Resumable scale driver

`make color-exploration-rank-scale` uses the dedicated service on port 19217, builds stages of 1k, 10k, 100k and 1M synthetic documents, and measures concurrent clients at 1, 4 and 16. Coordinate an exclusive benchmark window before running it. It preserves all sixteen workload cases and explicitly records the three unsupported picked-color/range cases.

Useful options through `COLOR_EXP_ARGS`:

```text
--counts 1000000 --rerun --duration-seconds 60
--concurrency 1,4,16 --repeats 4 --batch-size 50
--dry-run --samples 100
```

`--duration-seconds` defaults to zero. A positive value keeps each closed-loop profile active for at least that duration and at least the requested repetitions of every supported query. Started requests are drained and retained. This is sustained concurrent-client load, not an arrival-rate capacity test; the separate arrival-load driver covers scheduled arrivals.

Resume uses a deterministic source/generator/mapping identity, exact utility-key evidence, per-bulk checkpoints, archived invocation sources and explicit document-count verification. Profiles reference their own warmup invocation, including after reruns. Complete request results are appended to `requests.jsonl`; the main checkpoint retains compact metrics to limit memory during sustained measurement. Any warmup or measured error, or latency at or above 1000 ms, fails strict viability. A serial failure skips higher concurrent load for that stage.

Persistent scheduler tests verify minimum duration, minimum workload coverage, bounded concurrency and retention of every started request. Summary tests check parser chunk boundaries, strict warmup failures, stale aggregate counters and rerun association. Driver dry runs generate and serialize descriptors without making service requests; they do not establish search performance.

## Completed million-document measurements

External run: `exploration/rank-feature-scale/2026-09-20T01-58-20.990Z/scale.json`. The index is `color-exploration-rank-feature-scale-v1`, with `_source` disabled. All four stages (1k, 10k, 100k, 1M) passed the initial 52-request profiles at 1, 4 and 16 concurrent clients. Total measured indexing time across the stages was 1,079.98 seconds, including generation, serialization, checkpoint writes, service indexing, refresh and count checks.

The following **60-second sustained** profiles are stronger evidence than the initial short profiles:

| Method | Concurrent clients | Requests | p95 | Maximum | Requests/second |
| --- | ---: | ---: | ---: | ---: | ---: |
| Area | 1 | 4,115 | 42.10 ms | 48.97 ms | 68.57 |
| Area | 4 | 15,644 | 45.60 ms | 67.79 ms | 260.64 |
| Area | 16 | 23,164 | 157.22 ms | 267.86 ms | 385.66 |
| Vibe | 1 | 4,465 | 42.15 ms | 52.14 ms | 74.39 |
| Vibe | 4 | 16,899 | 45.67 ms | 84.17 ms | 281.47 |
| Vibe | 16 | 24,926 | 158.49 ms | 259.53 ms | 414.68 |

All 89,213 sustained requests succeeded below one second. Every recorded warmup also succeeded below one second; the maximum across staged and sustained invocations was 58.14 ms. At sixteen clients, OpenSearch CPU use averaged approximately eight cores, the configured node limit. Sampled heap peaks remained below 2.94 GB in the 4 GiB heap. Client CPU/RSS measurements include the benchmark harness, source descriptors and retained evidence; they are not direct production gateway memory measurements.

These profiles used the original sixteen-case workload, with thirteen supported named-color/proportion/vibe cases and three explicitly unsupported picked-color/range cases. They do not cover the later expanded arrival workload automatically. They are closed-loop concurrency measurements, not arrival-rate capacity guarantees. The service used one shard, one node, eight allocated CPUs, 4 GiB heap and a 12 GiB container limit.

The post-test snapshot `final-storage.json` records **12,433,295,009 bytes** for one million documents, forty-three segments and one active background merge. This storage figure is provisional until merging finishes. A merge remained active throughout the sustained test, so node CPU and latency include that work. The snapshot after 100k documents was approximately 2.22 GB; an immediate 1k snapshot was stale and must not be used for size extrapolation.

The later `idle-storage.json` records **13,105,519,265 bytes**, forty-five segments and zero active merges for the same million documents. This supersedes the provisional size for capacity estimates. See [RANK-FEATURE-SCALE.md](RANK-FEATURE-SCALE.md) for the complete scale evidence and [ARRIVAL-LOAD.md](ARRIVAL-LOAD.md) for scheduled-arrival results.

No 100-million-document claim follows from this experiment. The scale corpus consists of deterministic mixtures of the 545 original descriptors, not one million independently sourced images; ties, feature correlations and image diversity may differ in production. All scoring and filtering nevertheless ran in OpenSearch, with no application-side candidate ranking.
