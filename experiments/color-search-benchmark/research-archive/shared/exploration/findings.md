# Color-query findings

Generated 2026-09-21T23:50:37.819Z. 54/54 registered methods have valid default feedback results on 545 assets.

- Development preference evidence from one observer, including a quickly completed 24-case batch. These are not population relevance scores or independent samples.
- Unsupported cases and unjudged wallpapers are not scored as wrong. Pairwise agreement is reported only for assessed judgments, with coverage retained.
- The full 545-asset corpus contains 523 real wallpapers and 22 controlled fixtures. Newly imported ZIP wallpapers remain unjudged.
- Agreement uses a larger diagnostic result window; small-corpus latency uses 20 results. Sparse judged-pair coverage in those 20 results limits conclusions about their user-visible quality.
- Million-document tests use synthetic descriptor mixtures, not one million independently sourced wallpapers. They measure execution, not new human accuracy.
- Strict scale PASS requires no errors or observations at or above one second in warmups and timed requests. It applies only to the recorded workload, hardware and concurrency.
- OpenSearch CPU counters can stay unchanged during short blocks because statistics are cached. A zero delta does not establish zero CPU usage.
- There is no combined accuracy/speed leaderboard or declared overall winner.

## Development accuracy and small-corpus speed

The same-case column uses all 20 cases supported by HSV cosine. A partial intersection is not substituted. Agreement is query-macro pairwise agreement, not a relevance grade.

| Method / engine / family | Retrieval | Supported | Agreement | Without uncertain pairs | Same cases vs HSV | Judged pair coverage in top20 | Small p95 | Report |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| HSV64 cosine ANN control / OpenSearch / vector | approximate | 20/37 | 54.0% | 51.5% | 54.0% vs 54.0% (+0.0 pp) | 1.1% | 3.19 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| HSV64 raw L2 ANN control / OpenSearch / vector | approximate | 20/37 | 54.0% | 53.8% | 54.0% vs 54.0% (+0.0 pp) | 1.1% | 2.98 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| HSV64 unit-sum L2 ANN / OpenSearch / vector | approximate | 20/37 | 51.5% | 49.2% | 51.5% vs 54.0% (-2.5 pp) | 1.1% | 3.85 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| HSV64 Hellinger ANN / OpenSearch / vector | approximate | 20/37 | 46.5% | 43.7% | 46.5% vs 54.0% (-7.5 pp) | 1.1% | 3.32 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| RGB512 perceptual query + Hellinger ANN / OpenSearch / vector | approximate | 20/37 | 48.7% | 46.3% | 48.7% vs 54.0% (-5.3 pp) | 1.1% | 3.97 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| RGB512 perceptual query + cosine ANN / OpenSearch / vector | approximate | 20/37 | 56.0% | 56.2% | 56.0% vs 54.0% (+2.0 pp) | 1.5% | 3.29 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| HSV64 exhaustive cosine reference / OpenSearch / vector-reference | exact-stored-objective | 20/37 | 54.0% | 51.5% | 54.0% vs 54.0% (+0.0 pp) | 1.1% | 3.14 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Fine RGB histogram perceptual kernel / OpenSearch / kernel | exact-stored-objective | 33/37 | 65.4% | 65.9% | 62.3% vs 54.0% (+8.3 pp) | 13.3% | 471.3 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Palette32 target area / OpenSearch / area | exact-stored-objective | 33/37 | 71.3% | 71.3% | 73.4% vs 54.0% (+19.4 pp) | 11.0% | 9.83 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Fine histogram target area / OpenSearch / area | exact-stored-objective | 33/37 | 72.0% | 71.9% | 74.2% vs 54.0% (+20.2 pp) | 11.7% | 465.3 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Fine histogram area + quality + palette purity / OpenSearch / composition | exact-stored-objective | 33/37 | 67.1% | 67.1% | 66.8% vs 54.0% (+12.8 pp) | 10.2% | 457.8 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Indexed family areas, linear target error / OpenSearch / native | exact-stored-objective | 32/37 | 70.6% | 70.5% | 17/20 cases; unavailable | 12.1% | 2.85 ms | [2026-09-20T01-55-38.776Z-219058ec](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html) |
| Indexed family areas, Gaussian target error / OpenSearch / native | exact-stored-objective | 32/37 | 70.6% | 70.5% | 17/20 cases; unavailable | 12.1% | 2.66 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Indexed coverage bucket postings / OpenSearch / postings | exact-stored-objective | 32/37 | 70.4% | 70.3% | 17/20 cases; unavailable | 12.1% | 2.85 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Named feature area + quality + palette purity / OpenSearch / composition | exact-stored-objective | 32/37 | 67.9% | 67.8% | 17/20 cases; unavailable | 12.5% | 2.33 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| RGB marginal distribution Wasserstein / OpenSearch / distribution | exact-stored-objective | 33/37 | 49.3% | 48.1% | 48.5% vs 54.0% (-5.5 pp) | 6.1% | 11.4 ms | [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html) |
| Named composition with exact indexed bounds / OpenSearch / composition-bounded | exact-stored-objective | 32/37 | 67.9% | 67.8% | 17/20 cases; unavailable | 12.5% | 9.46 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Fine histogram target area, typed Painless / OpenSearch / area | exact-stored-objective | 33/37 | 72.0% | 71.9% | 74.2% vs 54.0% (+20.2 pp) | 11.7% | 5.76 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Fine histogram composition, typed Painless / OpenSearch / composition | exact-stored-objective | 33/37 | 67.1% | 67.1% | 66.8% vs 54.0% (+12.8 pp) | 10.2% | 5.15 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Fine histogram perceptual kernel, typed Painless / OpenSearch / kernel | exact-stored-objective | 33/37 | 65.4% | 65.9% | 62.3% vs 54.0% (+8.3 pp) | 13.3% | 4.90 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Palette32 target area, typed Painless / OpenSearch / area | exact-stored-objective | 33/37 | 71.3% | 71.3% | 73.4% vs 54.0% (+19.4 pp) | 11.0% | 3.57 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Palette32 exclusive portion transport / OpenSearch / transport | exact-stored-objective | 12/37 | 52.8% | 51.7% | 10/20 cases; unavailable | 5.7% | 80.3 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Named features: free remainder + graded quality / OpenSearch / intent-refinement | exact-stored-objective | 32/37 | 72.0% | 72.0% | 17/20 cases; unavailable | 10.6% | 1.85 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Fine histogram: free remainder + graded quality / OpenSearch / intent-refinement | exact-stored-objective | 33/37 | 73.0% | 73.2% | 75.8% vs 54.0% (+21.8 pp) | 11.0% | 5.00 ms | [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html) |
| Named features: refined objective + exact bounds / OpenSearch / intent-refinement | exact-stored-objective | 32/37 | 72.0% | 72.0% | 17/20 cases; unavailable | 10.6% | 8.58 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Named indexed bounds + precise histogram queries / OpenSearch / intent-refinement | exact-stored-objective | 35/37 | 72.7% | 72.7% | 75.0% vs 54.0% (+21.0 pp) | 12.5% | 8.57 ms | [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html) |
| Direct Palette32 balanced area and color / OpenSearch / direct-palette | exact-stored-objective | 33/37 | 72.8% | 73.0% | 73.8% vs 54.0% (+19.8 pp) | 11.7% | 10.5 ms | [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html) |
| Direct Palette32 with shade-first picked colors / OpenSearch / direct-palette | exact-stored-objective | 33/37 | 73.0% | 73.6% | 74.1% vs 54.0% (+20.1 pp) | 11.7% | 10.2 ms | [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html) |
| Rank features: indexed target area / OpenSearch / rank-features | exact-stored-objective | 28/37 | 73.3% | 73.2% | 17/20 cases; unavailable | 12.1% | 3.11 ms | [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html) |
| Rank features: target area and perceptual vibe / OpenSearch / rank-features | exact-stored-objective | 28/37 | 74.1% | 74.1% | 17/20 cases; unavailable | 12.5% | 4.15 ms | [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html) |
| Relative bright accents + named/precise color routing / OpenSearch / relative-contrast | exact-stored-objective | 35/37 | 75.5% | 75.9% | 74.9% vs 54.0% (+20.9 pp) | 12.5% | 11.9 ms | [2026-09-20T01-11-36.841Z-66d53e54](http://zerotwo:8224/2026-09-20T01-11-36.841Z-66d53e54/report.html) |
| HSV64 cosine ANN control (k=500) / OpenSearch / vector | approximate | 20/37 | 54.0% | 51.5% | 54.0% vs 54.0% (+0.0 pp) | 1.1% | 3.57 ms | [2026-09-20T01-12-38.947Z-86945d5c](http://zerotwo:8224/2026-09-20T01-12-38.947Z-86945d5c/report.html) |
| RGB512 perceptual query + cosine ANN (k=500) / OpenSearch / vector | approximate | 20/37 | 56.0% | 56.2% | 56.0% vs 54.0% (+2.0 pp) | 2.7% | 3.47 ms | [2026-09-20T01-12-38.947Z-86945d5c](http://zerotwo:8224/2026-09-20T01-12-38.947Z-86945d5c/report.html) |
| Direct precision with exact indexed palette-cell bounds / OpenSearch / palette-bounded | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 19.5 ms | [2026-09-20T01-18-35.608Z-adff6e8d](http://zerotwo:8224/2026-09-20T01-18-35.608Z-adff6e8d/report.html) |
| Relative accents + exact indexed named/precise color search / OpenSearch / relative-contrast | exact-stored-objective | 35/37 | 75.5% | 75.9% | 74.9% vs 54.0% (+20.9 pp) | 12.5% | 14.1 ms | [2026-09-20T01-18-35.608Z-adff6e8d](http://zerotwo:8224/2026-09-20T01-18-35.608Z-adff6e8d/report.html) |
| Direct picked-color precision, typed Painless / OpenSearch / direct-palette | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 7.11 ms | [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html) |
| Typed precision with exact indexed palette bounds / OpenSearch / palette-bounded | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 18.9 ms | [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html) |
| Relative accents + typed exact indexed precision / OpenSearch / relative-contrast | exact-stored-objective | 35/37 | 75.5% | 75.9% | 74.9% vs 54.0% (+20.9 pp) | 12.5% | 14.1 ms | [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html) |
| Picked precision with indexed OKLab centroids / OpenSearch / direct-palette | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 3.65 ms | [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html) |
| Indexed OKLab precision with conservative palette bounds / OpenSearch / palette-bounded | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 15.2 ms | [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html) |
| Relative accents + indexed OKLab precision / OpenSearch / relative-contrast | exact-stored-objective | 35/37 | 75.5% | 75.9% | 74.9% vs 54.0% (+20.9 pp) | 12.5% | 11.4 ms | [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html) |
| Native target areas + graded color quality / OpenSearch / native-refined | exact-stored-objective | 28/37 | 73.6% | 73.6% | 17/20 cases; unavailable | 17.8% | 2.59 ms | [2026-09-20T01-55-38.776Z-219058ec](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html) |
| Native graded quality + stronger excess-area penalty / OpenSearch / native-refined | exact-stored-objective | 28/37 | 74.5% | 74.5% | 17/20 cases; unavailable | 14.8% | 3.10 ms | [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html) |
| ClickHouse exact picked-color palette precision / ClickHouse / columnar-palette | exact-stored-objective | 3/37 | 79.4% | 83.9% | 3/20 cases; unavailable | 1.9% | 11.9 ms | [2026-09-20T02-52-07.682Z-6faa9adb](http://zerotwo:8224/2026-09-20T02-52-07.682Z-6faa9adb/report.html) |
| Native indexed picked-color grid / OpenSearch / native-precision-grid | Interpolated color score · global indexed ranking | 3/37 | 87.8% | 93.3% | 3/20 cases; unavailable | 1.9% | 2.30 ms | [2026-09-20T03-13-00.884Z-c2f20177](http://zerotwo:8224/2026-09-20T03-13-00.884Z-c2f20177/report.html) |
| Overlapping 1,024 regions: coverage + quality / OpenSearch / overlap-quality | Interpolated color score · global indexed ranking | 31/37 | 66.4% | 66.5% | 61.9% vs 54.0% (+7.9 pp) | 12.9% | 3.51 ms | [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html) |
| Overlapping regions + named color families / OpenSearch / overlap-quality | Interpolated color score · global indexed ranking | 31/37 | 74.4% | 74.4% | 74.3% vs 54.0% (+20.3 pp) | 16.7% | 3.81 ms | [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html) |
| Pixel cutoff: Hard cutoff / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 66.4% | 66.5% | 61.9% vs 54.0% (+7.9 pp) | 12.9% | 4.14 ms | [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html) |
| Pixel cutoff: Feathered cutoff / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 67.7% | 67.8% | 62.2% vs 54.0% (+8.2 pp) | 13.6% | 4.18 ms | [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html) |
| Pixel cutoff: Full core, soft halo / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 67.3% | 67.5% | 61.6% vs 54.0% (+7.6 pp) | 14.0% | 4.18 ms | [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html) |
| Pixel cutoff: Multiple cutoffs / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 68.7% | 68.4% | 65.4% vs 54.0% (+11.4 pp) | 12.1% | 4.37 ms | [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html) |
| Pixel cutoff: All cutoffs / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 62.7% | 62.7% | 56.2% vs 54.0% (+2.2 pp) | 10.2% | 4.49 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| All cutoffs: shade-aware / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 70.1% | 69.2% | 66.0% vs 54.0% (+12.0 pp) | 10.6% | 4.83 ms | [2026-09-21T23-14-33.424Z-046c06d3](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html) |
| All cutoffs: shade-aware + strict hue / OpenSearch / cutoff-quality | Interpolated color score · global indexed ranking | 31/37 | 71.3% | 70.6% | 67.8% vs 54.0% (+13.8 pp) | 17.8% | 4.89 ms | [2026-09-21T23-14-33.424Z-046c06d3](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html) |

## Precision grid versus continuous palette

3 identical complete development cases: interpolated grid 87.8% versus continuous palette 79.4% query-macro agreement. This small, single-observer set does not establish general superiority.

17 color queries: mean top20 overlap with the continuous palette order 81.5%; mean top20 utility loss 0.00403; maximum individual score difference 0.4220. These compare scoring formulas, not human relevance. Range boundaries can produce substantial score changes.

| Case | Interpolated grid | Continuous palette |
| --- | ---: | ---: |
| precision-shade-001 | 80.0% | 80.0% |
| precision-warm-red-batch-001 | 100.0% | 91.7% |
| precision-muted-green-batch-001 | 83.3% | 66.7% |

Grid run: `2026-09-20T03-13-00.884Z-c2f20177`; continuous reference: `2026-09-20T01-39-31.955Z-22f2b24e`.

## Million-document status

No result is inferred from a different method, smaller corpus, or concurrency.

| Method | Million-document evidence | Largest tested corpus |
| --- | --- | ---: |
| HSV64 cosine ANN control | C1: 14.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 17.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 21.9 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| HSV64 raw L2 ANN control | C1: 8.98 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 8.08 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 20.3 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| HSV64 unit-sum L2 ANN | C1: 12.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 11.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 19.0 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| HSV64 Hellinger ANN | C1: 14.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 13.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 16.3 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| RGB512 perceptual query + Hellinger ANN | C1: 19.3 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 19.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 27.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| RGB512 perceptual query + cosine ANN | C1: 21.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 21.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 25.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| HSV64 exhaustive cosine reference | C1: 119.6 ms p95; FAIL: observed error or ≥1 second; 1 errors, 1 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Fine RGB histogram perceptual kernel | C1: — p95; FAIL: observed error or ≥1 second; 48 errors, 48 timed ≥1s, 16 warmup errors, 16 warmup ≥1s | 1000000 |
| Palette32 target area | C1: 977.2 ms p95; FAIL: observed error or ≥1 second; 42 errors, 41 timed ≥1s, 14 warmup errors, 14 warmup ≥1s | 1000000 |
| Fine histogram target area | C1: — p95; FAIL: observed error or ≥1 second; 48 errors, 48 timed ≥1s, 16 warmup errors, 16 warmup ≥1s | 1000000 |
| Fine histogram area + quality + palette purity | C1: — p95; FAIL: observed error or ≥1 second; 48 errors, 48 timed ≥1s, 16 warmup errors, 16 warmup ≥1s | 1000000 |
| Indexed family areas, linear target error | C1: 49.0 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 49.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 71.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Indexed family areas, Gaussian target error | C1: 58.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 62.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 97.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Indexed coverage bucket postings | C1: 137.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 128.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 369.9 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Named feature area + quality + palette purity | C1: 239.2 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 246.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 939.3 ms p95; FAIL: observed error or ≥1 second; 2 errors, 2 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| RGB marginal distribution Wasserstein | C1: 169.2 ms p95; FAIL: observed error or ≥1 second; 45 errors, 45 timed ≥1s, 15 warmup errors, 15 warmup ≥1s | 1000000 |
| Named composition with exact indexed bounds | C1: 556.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 563.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C15 (requested 16): 573.9 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Fine histogram target area, typed Painless | C1: 883.5 ms p95; FAIL: observed error or ≥1 second; 21 errors, 21 timed ≥1s, 22 warmup errors, 21 warmup ≥1s | 1000000 |
| Fine histogram composition, typed Painless | C1: 360.9 ms p95; FAIL: observed error or ≥1 second; 21 errors, 21 timed ≥1s, 21 warmup errors, 21 warmup ≥1s | 1000000 |
| Fine histogram perceptual kernel, typed Painless | C1: 358.2 ms p95; FAIL: observed error or ≥1 second; 21 errors, 21 timed ≥1s, 21 warmup errors, 21 warmup ≥1s | 1000000 |
| Palette32 target area, typed Painless | C1: 593.7 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 1 warmup errors, 0 warmup ≥1s / C4: 594.0 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 1 warmup errors, 0 warmup ≥1s / C16: 1004.4 ms p95; FAIL: observed error or ≥1 second; 9 errors, 10 timed ≥1s, 1 warmup errors, 0 warmup ≥1s | 1000000 |
| Palette32 exclusive portion transport | C1: — p95; FAIL: observed error or ≥1 second; 8 errors, 8 timed ≥1s, 8 warmup errors, 8 warmup ≥1s | 1000000 |
| Named features: free remainder + graded quality | C1: 434.0 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 447.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C15 (requested 16): 635.9 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Fine histogram: free remainder + graded quality | C1: 360.5 ms p95; FAIL: observed error or ≥1 second; 21 errors, 20 timed ≥1s, 21 warmup errors, 21 warmup ≥1s | 1000000 |
| Named features: refined objective + exact bounds | C1: 414.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 414.8 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C15 (requested 16): 464.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Named indexed bounds + precise histogram queries | C1: 414.9 ms p95; FAIL: observed error or ≥1 second; 8 errors, 8 timed ≥1s, 8 warmup errors, 8 warmup ≥1s | 1000000 |
| Direct Palette32 balanced area and color | C1: 151.7 ms p95; FAIL: observed error or ≥1 second; 22 errors, 22 timed ≥1s, 22 warmup errors, 21 warmup ≥1s | 1000000 |
| Direct Palette32 with shade-first picked colors | C1: 134.0 ms p95; FAIL: observed error or ≥1 second; 22 errors, 21 timed ≥1s, 22 warmup errors, 21 warmup ≥1s | 1000000 |
| Rank features: indexed target area | C1: 42.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 45.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 157.2 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Rank features: target area and perceptual vibe | C1: 42.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 45.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 158.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Relative bright accents + named/precise color routing | C1: 414.7 ms p95; FAIL: observed error or ≥1 second; 8 errors, 8 timed ≥1s, 8 warmup errors, 8 warmup ≥1s | 1000000 |
| HSV64 cosine ANN control (k=500) | C1: 29.8 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 32.9 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 31.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| RGB512 perceptual query + cosine ANN (k=500) | C1: 59.5 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 0 warmup errors, 1 warmup ≥1s / C4: 66.4 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 0 warmup errors, 1 warmup ≥1s / C16: 74.0 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 0 warmup errors, 1 warmup ≥1s | 1000000 |
| Direct precision with exact indexed palette-cell bounds | C1: 710.0 ms p95; FAIL: observed error or ≥1 second; 6 errors, 5 timed ≥1s, 6 warmup errors, 6 warmup ≥1s | 1000000 |
| Relative accents + exact indexed named/precise color search | C1: 699.0 ms p95; FAIL: observed error or ≥1 second; 7 errors, 7 timed ≥1s, 7 warmup errors, 7 warmup ≥1s | 1000000 |
| Direct picked-color precision, typed Painless | C1: — p95; FAIL: observed error or ≥1 second; 7 errors, 7 timed ≥1s, 7 warmup errors, 7 warmup ≥1s | 1000000 |
| Typed precision with exact indexed palette bounds | C1: 1048.1 ms p95; FAIL: observed error or ≥1 second; 5 errors, 6 timed ≥1s, 5 warmup errors, 6 warmup ≥1s | 1000000 |
| Relative accents + typed exact indexed precision | C1: 1011.7 ms p95; FAIL: observed error or ≥1 second; 6 errors, 7 timed ≥1s, 6 warmup errors, 7 warmup ≥1s | 1000000 |
| Picked precision with indexed OKLab centroids | C1: 664.4 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 1 warmup errors, 1 warmup ≥1s / C4: 669.0 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 1 warmup errors, 1 warmup ≥1s / C16: 683.4 ms p95; FAIL: observed error or ≥1 second; 16 errors, 0 timed ≥1s, 1 warmup errors, 1 warmup ≥1s | 1000000 |
| Indexed OKLab precision with conservative palette bounds | C1: 691.6 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 0 warmup errors, 3 warmup ≥1s / C4: 673.6 ms p95; FAIL: observed error or ≥1 second; 0 errors, 0 timed ≥1s, 0 warmup errors, 3 warmup ≥1s / C16: 909.1 ms p95; FAIL: observed error or ≥1 second; 8 errors, 8 timed ≥1s, 0 warmup errors, 3 warmup ≥1s | 1000000 |
| Relative accents + indexed OKLab precision | C1: 594.5 ms p95; FAIL: observed error or ≥1 second; 3 errors, 3 timed ≥1s, 1 warmup errors, 1 warmup ≥1s | 1000000 |
| Native target areas + graded color quality | C1: 250.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 252.6 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 324.8 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Native graded quality + stronger excess-area penalty | C1: 293.4 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 304.0 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 374.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| ClickHouse exact picked-color palette precision | C1 · 8 threads/query: 331.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C1 · 1 threads/query: 403.2 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4 · 8 threads/query: 996.1 ms p95; FAIL: observed error or ≥1 second; 70 errors, 12 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16 · 8 threads/query: 1012.9 ms p95; FAIL: observed error or ≥1 second; 148 errors, 51 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16 · 1 threads/query: 1016.0 ms p95; FAIL: observed error or ≥1 second; 141 errors, 51 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Native indexed picked-color grid | C1: 151.8 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 160.5 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 502.3 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Overlapping 1,024 regions: coverage + quality | C1: 341.7 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 346.8 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 831.6 ms p95; FAIL: observed error or ≥1 second; 7 errors, 6 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Overlapping regions + named color families | C1: 337.1 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C4: 344.3 ms p95; PASS at this tested load; 0 errors, 0 timed ≥1s, 0 warmup errors, 0 warmup ≥1s / C16: 826.6 ms p95; FAIL: observed error or ≥1 second; 9 errors, 6 timed ≥1s, 0 warmup errors, 0 warmup ≥1s | 1000000 |
| Pixel cutoff: Hard cutoff | NOT YET TESTED | Not yet tested |
| Pixel cutoff: Feathered cutoff | NOT YET TESTED | Not yet tested |
| Pixel cutoff: Full core, soft halo | NOT YET TESTED | Not yet tested |
| Pixel cutoff: Multiple cutoffs | NOT YET TESTED | Not yet tested |
| Pixel cutoff: All cutoffs | NOT YET TESTED | Not yet tested |
| All cutoffs: shade-aware | NOT YET TESTED | Not yet tested |
| All cutoffs: shade-aware + strict hue | NOT YET TESTED | Not yet tested |

## Scale profiles

| Method | Documents | Concurrency | p95 | Maximum | Errors | Timed ≥1s | Warmup maximum | Warmup errors / ≥1s | Strict result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| HSV64 cosine ANN control | 1000 | C1 | 4.59 ms | 4.83 ms | 0 | 0 | 27.9 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 1000 | C4 | 7.14 ms | 8.48 ms | 0 | 0 | 27.9 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 1000 | C16 | 15.3 ms | 16.5 ms | 0 | 0 | 27.9 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 10000 | C1 | 3.17 ms | 5.03 ms | 0 | 0 | 3.86 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 10000 | C4 | 4.50 ms | 5.22 ms | 0 | 0 | 3.86 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 10000 | C16 | 7.94 ms | 8.38 ms | 0 | 0 | 3.86 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 100000 | C1 | 4.04 ms | 4.34 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 100000 | C4 | 3.91 ms | 4.68 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 100000 | C16 | 7.35 ms | 7.54 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 1000000 | C1 | 14.7 ms | 16.1 ms | 0 | 0 | 229.6 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 1000000 | C4 | 17.5 ms | 18.1 ms | 0 | 0 | 229.6 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control | 1000000 | C16 | 21.9 ms | 22.0 ms | 0 | 0 | 229.6 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000 | C1 | 4.33 ms | 4.57 ms | 0 | 0 | 3.70 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000 | C4 | 4.27 ms | 4.45 ms | 0 | 0 | 3.70 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000 | C16 | 12.5 ms | 13.1 ms | 0 | 0 | 3.70 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 10000 | C1 | 2.87 ms | 3.61 ms | 0 | 0 | 3.13 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 10000 | C4 | 3.32 ms | 3.32 ms | 0 | 0 | 3.13 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 10000 | C16 | 10.6 ms | 11.2 ms | 0 | 0 | 3.13 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 100000 | C1 | 3.14 ms | 3.18 ms | 0 | 0 | 5.71 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 100000 | C4 | 3.44 ms | 3.83 ms | 0 | 0 | 5.71 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 100000 | C16 | 8.90 ms | 8.92 ms | 0 | 0 | 5.71 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000000 | C1 | 8.98 ms | 10.6 ms | 0 | 0 | 175.2 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000000 | C4 | 8.08 ms | 10.7 ms | 0 | 0 | 175.2 ms | 0 / 0 | PASS |
| HSV64 raw L2 ANN control | 1000000 | C16 | 20.3 ms | 20.5 ms | 0 | 0 | 175.2 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000 | C1 | 3.34 ms | 3.42 ms | 0 | 0 | 4.05 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000 | C4 | 3.41 ms | 4.19 ms | 0 | 0 | 4.05 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000 | C16 | 13.6 ms | 13.8 ms | 0 | 0 | 4.05 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 10000 | C1 | 2.32 ms | 2.59 ms | 0 | 0 | 2.45 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 10000 | C4 | 3.23 ms | 3.48 ms | 0 | 0 | 2.45 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 10000 | C16 | 7.45 ms | 7.78 ms | 0 | 0 | 2.45 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 100000 | C1 | 3.88 ms | 5.67 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 100000 | C4 | 2.55 ms | 3.34 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 100000 | C16 | 9.34 ms | 9.34 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000000 | C1 | 12.4 ms | 13.8 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000000 | C4 | 11.5 ms | 14.6 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 unit-sum L2 ANN | 1000000 | C16 | 19.0 ms | 19.0 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000 | C1 | 3.39 ms | 3.55 ms | 0 | 0 | 3.48 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000 | C4 | 4.07 ms | 4.64 ms | 0 | 0 | 3.48 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000 | C16 | 15.2 ms | 15.7 ms | 0 | 0 | 3.48 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 10000 | C1 | 3.30 ms | 3.81 ms | 0 | 0 | 3.81 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 10000 | C4 | 3.97 ms | 4.90 ms | 0 | 0 | 3.81 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 10000 | C16 | 9.13 ms | 9.89 ms | 0 | 0 | 3.81 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 100000 | C1 | 3.79 ms | 5.26 ms | 0 | 0 | 6.83 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 100000 | C4 | 4.20 ms | 5.18 ms | 0 | 0 | 6.83 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 100000 | C16 | 8.48 ms | 8.72 ms | 0 | 0 | 6.83 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000000 | C1 | 14.5 ms | 15.1 ms | 0 | 0 | 208.8 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000000 | C4 | 13.6 ms | 15.8 ms | 0 | 0 | 208.8 ms | 0 / 0 | PASS |
| HSV64 Hellinger ANN | 1000000 | C16 | 16.3 ms | 16.5 ms | 0 | 0 | 208.8 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000 | C1 | 3.62 ms | 4.51 ms | 0 | 0 | 3.76 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000 | C4 | 4.43 ms | 4.63 ms | 0 | 0 | 3.76 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000 | C16 | 12.6 ms | 13.4 ms | 0 | 0 | 3.76 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 10000 | C1 | 3.68 ms | 3.97 ms | 0 | 0 | 4.45 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 10000 | C4 | 3.38 ms | 5.89 ms | 0 | 0 | 4.45 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 10000 | C16 | 17.1 ms | 17.4 ms | 0 | 0 | 4.45 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 100000 | C1 | 4.97 ms | 5.56 ms | 0 | 0 | 12.1 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 100000 | C4 | 4.61 ms | 5.74 ms | 0 | 0 | 12.1 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 100000 | C16 | 15.4 ms | 15.8 ms | 0 | 0 | 12.1 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000000 | C1 | 19.3 ms | 19.5 ms | 0 | 0 | 490.4 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000000 | C4 | 19.6 ms | 20.8 ms | 0 | 0 | 490.4 ms | 0 / 0 | PASS |
| RGB512 perceptual query + Hellinger ANN | 1000000 | C16 | 27.6 ms | 30.4 ms | 0 | 0 | 490.4 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000 | C1 | 2.80 ms | 2.92 ms | 0 | 0 | 2.97 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000 | C4 | 3.57 ms | 3.64 ms | 0 | 0 | 2.97 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000 | C16 | 12.5 ms | 13.6 ms | 0 | 0 | 2.97 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 10000 | C1 | 4.16 ms | 4.36 ms | 0 | 0 | 4.48 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 10000 | C4 | 3.56 ms | 4.01 ms | 0 | 0 | 4.48 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 10000 | C16 | 10.1 ms | 11.0 ms | 0 | 0 | 4.48 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 100000 | C1 | 5.88 ms | 6.10 ms | 0 | 0 | 12.2 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 100000 | C4 | 5.74 ms | 6.52 ms | 0 | 0 | 12.2 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 100000 | C16 | 14.1 ms | 14.5 ms | 0 | 0 | 12.2 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000000 | C1 | 21.1 ms | 21.6 ms | 0 | 0 | 647.9 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000000 | C4 | 21.6 ms | 22.5 ms | 0 | 0 | 647.9 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN | 1000000 | C16 | 25.5 ms | 26.6 ms | 0 | 0 | 647.9 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 1000 | C1 | 3.01 ms | 3.32 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 1000 | C4 | 3.04 ms | 3.30 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 1000 | C16 | 10.3 ms | 10.8 ms | 0 | 0 | 14.0 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 10000 | C1 | 3.87 ms | 3.97 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 10000 | C4 | 4.27 ms | 4.41 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 10000 | C16 | 14.9 ms | 15.1 ms | 0 | 0 | 7.35 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 100000 | C1 | 18.8 ms | 21.0 ms | 0 | 0 | 43.7 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 100000 | C4 | 32.1 ms | 32.2 ms | 0 | 0 | 43.7 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 100000 | C16 | 150.1 ms | 159.0 ms | 0 | 0 | 43.7 ms | 0 / 0 | PASS |
| HSV64 exhaustive cosine reference | 1000000 | C1 | 119.6 ms | 352.2 ms | 1 | 1 | 227.7 ms | 0 / 0 | FAIL |
| Fine RGB histogram perceptual kernel | 1000 | C1 | 134.8 ms | 134.8 ms | 42 | 42 | 1649.6 ms | 14 / 14 | FAIL |
| Fine RGB histogram perceptual kernel | 10000 | C1 | 187.2 ms | 187.2 ms | 45 | 45 | 1767.7 ms | 15 / 15 | FAIL |
| Fine RGB histogram perceptual kernel | 100000 | C1 | — | — | 48 | 48 | 1754.9 ms | 16 / 16 | FAIL |
| Fine RGB histogram perceptual kernel | 1000000 | C1 | — | — | 48 | 48 | 1536.0 ms | 16 / 16 | FAIL |
| Palette32 target area | 1000 | C1 | 18.2 ms | 19.1 ms | 0 | 0 | 59.2 ms | 0 / 0 | PASS |
| Palette32 target area | 1000 | C4 | 19.1 ms | 20.0 ms | 0 | 0 | 59.2 ms | 0 / 0 | PASS |
| Palette32 target area | 1000 | C16 | 32.3 ms | 34.1 ms | 0 | 0 | 59.2 ms | 0 / 0 | PASS |
| Palette32 target area | 10000 | C1 | 111.3 ms | 111.7 ms | 0 | 0 | 110.8 ms | 0 / 0 | PASS |
| Palette32 target area | 10000 | C4 | 118.8 ms | 126.7 ms | 0 | 0 | 110.8 ms | 0 / 0 | PASS |
| Palette32 target area | 10000 | C16 | 373.2 ms | 380.9 ms | 0 | 0 | 110.8 ms | 0 / 0 | PASS |
| Palette32 target area | 100000 | C1 | 1049.6 ms | 1076.6 ms | 9 | 7 | 1114.7 ms | 4 / 2 | FAIL |
| Palette32 target area | 1000000 | C1 | 977.2 ms | 977.2 ms | 42 | 41 | 1414.4 ms | 14 / 14 | FAIL |
| Fine histogram target area | 1000 | C1 | 185.8 ms | 185.8 ms | 42 | 42 | 1525.7 ms | 14 / 14 | FAIL |
| Fine histogram target area | 10000 | C1 | 176.1 ms | 176.1 ms | 45 | 45 | 1542.9 ms | 15 / 15 | FAIL |
| Fine histogram target area | 100000 | C1 | — | — | 48 | 48 | 1538.4 ms | 16 / 16 | FAIL |
| Fine histogram target area | 1000000 | C1 | — | — | 48 | 48 | 1564.8 ms | 16 / 16 | FAIL |
| Fine histogram area + quality + palette purity | 1000 | C1 | 158.7 ms | 158.7 ms | 42 | 42 | 1605.9 ms | 14 / 14 | FAIL |
| Fine histogram area + quality + palette purity | 10000 | C1 | 171.5 ms | 171.5 ms | 45 | 45 | 1546.0 ms | 15 / 15 | FAIL |
| Fine histogram area + quality + palette purity | 100000 | C1 | — | — | 48 | 48 | 1536.0 ms | 16 / 16 | FAIL |
| Fine histogram area + quality + palette purity | 1000000 | C1 | — | — | 48 | 48 | 1562.4 ms | 16 / 16 | FAIL |
| Indexed family areas, linear target error | 1000 | C1 | 2.89 ms | 3.23 ms | 0 | 0 | 9.42 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 1000 | C4 | 2.90 ms | 3.12 ms | 0 | 0 | 9.42 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 1000 | C16 | 11.3 ms | 13.3 ms | 0 | 0 | 9.42 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 10000 | C1 | 2.88 ms | 3.09 ms | 0 | 0 | 6.57 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 10000 | C4 | 3.75 ms | 4.12 ms | 0 | 0 | 6.57 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 10000 | C16 | 10.6 ms | 10.9 ms | 0 | 0 | 6.57 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 100000 | C1 | 6.72 ms | 8.29 ms | 0 | 0 | 11.4 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 100000 | C4 | 8.35 ms | 9.16 ms | 0 | 0 | 11.4 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 100000 | C16 | 10.1 ms | 10.5 ms | 0 | 0 | 11.4 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 1000000 | C1 | 49.0 ms | 51.1 ms | 0 | 0 | 58.9 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 1000000 | C4 | 49.5 ms | 51.2 ms | 0 | 0 | 58.9 ms | 0 / 0 | PASS |
| Indexed family areas, linear target error | 1000000 | C16 | 71.4 ms | 83.0 ms | 0 | 0 | 58.9 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000 | C1 | 2.36 ms | 2.65 ms | 0 | 0 | 2.56 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000 | C4 | 3.71 ms | 4.87 ms | 0 | 0 | 2.56 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000 | C16 | 8.32 ms | 8.63 ms | 0 | 0 | 2.56 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 10000 | C1 | 2.74 ms | 3.48 ms | 0 | 0 | 5.76 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 10000 | C4 | 4.25 ms | 4.41 ms | 0 | 0 | 5.76 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 10000 | C16 | 7.39 ms | 8.36 ms | 0 | 0 | 5.76 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 100000 | C1 | 9.25 ms | 9.90 ms | 0 | 0 | 8.98 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 100000 | C4 | 8.30 ms | 8.58 ms | 0 | 0 | 8.98 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 100000 | C16 | 11.8 ms | 15.2 ms | 0 | 0 | 8.98 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000000 | C1 | 58.7 ms | 59.5 ms | 0 | 0 | 62.0 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000000 | C4 | 62.5 ms | 63.1 ms | 0 | 0 | 62.0 ms | 0 / 0 | PASS |
| Indexed family areas, Gaussian target error | 1000000 | C16 | 97.5 ms | 101.5 ms | 0 | 0 | 62.0 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000 | C1 | 5.23 ms | 20.5 ms | 0 | 0 | 19.8 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000 | C4 | 17.4 ms | 17.9 ms | 0 | 0 | 19.8 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000 | C16 | 12.2 ms | 12.5 ms | 0 | 0 | 19.8 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 10000 | C1 | 4.97 ms | 5.09 ms | 0 | 0 | 5.87 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 10000 | C4 | 6.50 ms | 6.50 ms | 0 | 0 | 5.87 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 10000 | C16 | 27.1 ms | 27.4 ms | 0 | 0 | 5.87 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 100000 | C1 | 17.2 ms | 17.5 ms | 0 | 0 | 17.6 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 100000 | C4 | 20.4 ms | 22.9 ms | 0 | 0 | 17.6 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 100000 | C16 | 23.5 ms | 26.0 ms | 0 | 0 | 17.6 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000000 | C1 | 137.1 ms | 146.5 ms | 0 | 0 | 129.7 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000000 | C4 | 128.7 ms | 131.3 ms | 0 | 0 | 129.7 ms | 0 / 0 | PASS |
| Indexed coverage bucket postings | 1000000 | C16 | 369.9 ms | 378.9 ms | 0 | 0 | 129.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000 | C1 | 5.48 ms | 5.64 ms | 0 | 0 | 22.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000 | C4 | 3.25 ms | 3.29 ms | 0 | 0 | 22.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000 | C16 | 8.09 ms | 8.22 ms | 0 | 0 | 22.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 10000 | C1 | 5.72 ms | 5.79 ms | 0 | 0 | 6.25 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 10000 | C4 | 8.30 ms | 8.34 ms | 0 | 0 | 6.25 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 10000 | C16 | 9.95 ms | 11.7 ms | 0 | 0 | 6.25 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 100000 | C1 | 28.4 ms | 29.1 ms | 0 | 0 | 29.0 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 100000 | C4 | 27.5 ms | 28.8 ms | 0 | 0 | 29.0 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 100000 | C16 | 63.9 ms | 76.2 ms | 0 | 0 | 29.0 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000000 | C1 | 239.2 ms | 241.4 ms | 0 | 0 | 225.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000000 | C4 | 246.5 ms | 263.2 ms | 0 | 0 | 225.7 ms | 0 / 0 | PASS |
| Named feature area + quality + palette purity | 1000000 | C16 | 939.3 ms | 959.2 ms | 2 | 2 | 225.7 ms | 0 / 0 | FAIL |
| RGB marginal distribution Wasserstein | 1000 | C1 | 20.6 ms | 20.9 ms | 0 | 0 | 56.2 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 1000 | C4 | 24.0 ms | 26.4 ms | 0 | 0 | 56.2 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 1000 | C16 | 80.0 ms | 80.9 ms | 0 | 0 | 56.2 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 10000 | C1 | 174.8 ms | 177.3 ms | 0 | 0 | 173.5 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 10000 | C4 | 179.2 ms | 185.7 ms | 0 | 0 | 173.5 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 10000 | C16 | 580.4 ms | 587.5 ms | 0 | 0 | 173.5 ms | 0 / 0 | PASS |
| RGB marginal distribution Wasserstein | 100000 | C1 | 168.1 ms | 168.1 ms | 42 | 37 | 1237.9 ms | 14 / 13 | FAIL |
| RGB marginal distribution Wasserstein | 1000000 | C1 | 169.2 ms | 169.2 ms | 45 | 45 | 1421.0 ms | 15 / 15 | FAIL |
| Named composition with exact indexed bounds | 1000000 | C1 | 556.1 ms | 556.1 ms | 0 | 0 | 582.6 ms | 0 / 0 | PASS |
| Named composition with exact indexed bounds | 1000000 | C4 | 563.4 ms | 563.4 ms | 0 | 0 | 582.6 ms | 0 / 0 | PASS |
| Named composition with exact indexed bounds | 1000000 | C15 (requested 16) | 573.9 ms | 573.9 ms | 0 | 0 | 582.6 ms | 0 / 0 | PASS |
| Fine histogram target area, typed Painless | 1000000 | C1 | 883.5 ms | 883.5 ms | 21 | 21 | 1779.9 ms | 22 / 21 | FAIL |
| Fine histogram composition, typed Painless | 1000000 | C1 | 360.9 ms | 360.9 ms | 21 | 21 | 1535.1 ms | 21 / 21 | FAIL |
| Fine histogram perceptual kernel, typed Painless | 1000000 | C1 | 358.2 ms | 358.2 ms | 21 | 21 | 1738.1 ms | 21 / 21 | FAIL |
| Palette32 target area, typed Painless | 1000000 | C1 | 593.7 ms | 921.8 ms | 0 | 0 | 978.4 ms | 1 / 0 | FAIL |
| Palette32 target area, typed Painless | 1000000 | C4 | 594.0 ms | 901.7 ms | 0 | 0 | 978.4 ms | 1 / 0 | FAIL |
| Palette32 target area, typed Painless | 1000000 | C16 | 1004.4 ms | 1004.4 ms | 9 | 10 | 978.4 ms | 1 / 0 | FAIL |
| Palette32 exclusive portion transport | 1000000 | C1 | — | — | 8 | 8 | 2443.4 ms | 8 / 8 | FAIL |
| Named features: free remainder + graded quality | 1000000 | C1 | 434.0 ms | 434.0 ms | 0 | 0 | 459.8 ms | 0 / 0 | PASS |
| Named features: free remainder + graded quality | 1000000 | C4 | 447.4 ms | 447.4 ms | 0 | 0 | 459.8 ms | 0 / 0 | PASS |
| Named features: free remainder + graded quality | 1000000 | C15 (requested 16) | 635.9 ms | 635.9 ms | 0 | 0 | 459.8 ms | 0 / 0 | PASS |
| Fine histogram: free remainder + graded quality | 1000000 | C1 | 360.5 ms | 360.5 ms | 21 | 20 | 1751.1 ms | 21 / 21 | FAIL |
| Named features: refined objective + exact bounds | 1000000 | C1 | 414.7 ms | 414.7 ms | 0 | 0 | 449.7 ms | 0 / 0 | PASS |
| Named features: refined objective + exact bounds | 1000000 | C4 | 414.8 ms | 414.8 ms | 0 | 0 | 449.7 ms | 0 / 0 | PASS |
| Named features: refined objective + exact bounds | 1000000 | C15 (requested 16) | 464.6 ms | 464.6 ms | 0 | 0 | 449.7 ms | 0 / 0 | PASS |
| Named indexed bounds + precise histogram queries | 1000000 | C1 | 414.9 ms | 414.9 ms | 8 | 8 | 1790.4 ms | 8 / 8 | FAIL |
| Direct Palette32 balanced area and color | 1000000 | C1 | 151.7 ms | 151.7 ms | 22 | 22 | 1659.5 ms | 22 / 21 | FAIL |
| Direct Palette32 with shade-first picked colors | 1000000 | C1 | 134.0 ms | 134.0 ms | 22 | 21 | 1399.6 ms | 22 / 21 | FAIL |
| Rank features: indexed target area | 1000 | C1 | 2.71 ms | 3.27 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 1000 | C4 | 6.21 ms | 6.65 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 1000 | C16 | 15.4 ms | 16.5 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 10000 | C1 | 3.76 ms | 4.17 ms | 0 | 0 | 4.80 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 10000 | C4 | 6.26 ms | 7.03 ms | 0 | 0 | 4.80 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 10000 | C16 | 12.8 ms | 13.2 ms | 0 | 0 | 4.80 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 100000 | C1 | 6.98 ms | 7.79 ms | 0 | 0 | 17.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 100000 | C4 | 7.71 ms | 9.19 ms | 0 | 0 | 17.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 100000 | C16 | 12.7 ms | 13.9 ms | 0 | 0 | 17.9 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 1000000 | C1 | 42.1 ms | 49.0 ms | 0 | 0 | 49.0 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 1000000 | C4 | 45.6 ms | 67.8 ms | 0 | 0 | 49.0 ms | 0 / 0 | PASS |
| Rank features: indexed target area | 1000000 | C16 | 157.2 ms | 267.9 ms | 0 | 0 | 49.0 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000 | C1 | 3.37 ms | 3.50 ms | 0 | 0 | 3.26 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000 | C4 | 4.43 ms | 4.83 ms | 0 | 0 | 3.26 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000 | C16 | 12.1 ms | 12.6 ms | 0 | 0 | 3.26 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 10000 | C1 | 3.87 ms | 4.17 ms | 0 | 0 | 3.63 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 10000 | C4 | 3.69 ms | 3.79 ms | 0 | 0 | 3.63 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 10000 | C16 | 10.4 ms | 11.0 ms | 0 | 0 | 3.63 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 100000 | C1 | 8.33 ms | 10.3 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 100000 | C4 | 7.56 ms | 8.66 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 100000 | C16 | 13.4 ms | 14.3 ms | 0 | 0 | 11.9 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000000 | C1 | 42.1 ms | 52.1 ms | 0 | 0 | 43.4 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000000 | C4 | 45.7 ms | 84.2 ms | 0 | 0 | 43.4 ms | 0 / 0 | PASS |
| Rank features: target area and perceptual vibe | 1000000 | C16 | 158.5 ms | 259.5 ms | 0 | 0 | 43.4 ms | 0 / 0 | PASS |
| Relative bright accents + named/precise color routing | 1000000 | C1 | 414.7 ms | 414.7 ms | 8 | 8 | 1686.4 ms | 8 / 8 | FAIL |
| HSV64 cosine ANN control (k=500) | 1000000 | C1 | 29.8 ms | 29.8 ms | 0 | 0 | 566.7 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control (k=500) | 1000000 | C4 | 32.9 ms | 32.9 ms | 0 | 0 | 566.7 ms | 0 / 0 | PASS |
| HSV64 cosine ANN control (k=500) | 1000000 | C16 | 31.4 ms | 31.4 ms | 0 | 0 | 566.7 ms | 0 / 0 | PASS |
| RGB512 perceptual query + cosine ANN (k=500) | 1000000 | C1 | 59.5 ms | 59.5 ms | 0 | 0 | 1970.5 ms | 0 / 1 | FAIL |
| RGB512 perceptual query + cosine ANN (k=500) | 1000000 | C4 | 66.4 ms | 66.4 ms | 0 | 0 | 1970.5 ms | 0 / 1 | FAIL |
| RGB512 perceptual query + cosine ANN (k=500) | 1000000 | C16 | 74.0 ms | 74.0 ms | 0 | 0 | 1970.5 ms | 0 / 1 | FAIL |
| Direct precision with exact indexed palette-cell bounds | 1000000 | C1 | 710.0 ms | 710.0 ms | 6 | 5 | 1565.5 ms | 6 / 6 | FAIL |
| Relative accents + exact indexed named/precise color search | 1000000 | C1 | 699.0 ms | 699.0 ms | 7 | 7 | 1651.3 ms | 7 / 7 | FAIL |
| Direct picked-color precision, typed Painless | 1000000 | C1 | — | — | 7 | 7 | 1561.9 ms | 7 / 7 | FAIL |
| Typed precision with exact indexed palette bounds | 1000000 | C1 | 1048.1 ms | 1048.1 ms | 5 | 6 | 1265.9 ms | 5 / 6 | FAIL |
| Relative accents + typed exact indexed precision | 1000000 | C1 | 1011.7 ms | 1011.7 ms | 6 | 7 | 1683.0 ms | 6 / 7 | FAIL |
| Picked precision with indexed OKLab centroids | 1000000 | C1 | 664.4 ms | 668.7 ms | 0 | 0 | 1128.7 ms | 1 / 1 | FAIL |
| Picked precision with indexed OKLab centroids | 1000000 | C4 | 669.0 ms | 687.6 ms | 0 | 0 | 1128.7 ms | 1 / 1 | FAIL |
| Picked precision with indexed OKLab centroids | 1000000 | C16 | 683.4 ms | 683.4 ms | 16 | 0 | 1128.7 ms | 1 / 1 | FAIL |
| Indexed OKLab precision with conservative palette bounds | 1000000 | C1 | 691.6 ms | 727.2 ms | 0 | 0 | 1317.8 ms | 0 / 3 | FAIL |
| Indexed OKLab precision with conservative palette bounds | 1000000 | C4 | 673.6 ms | 707.4 ms | 0 | 0 | 1317.8 ms | 0 / 3 | FAIL |
| Indexed OKLab precision with conservative palette bounds | 1000000 | C16 | 909.1 ms | 909.1 ms | 8 | 8 | 1317.8 ms | 0 / 3 | FAIL |
| Relative accents + indexed OKLab precision | 1000000 | C1 | 594.5 ms | 674.2 ms | 3 | 3 | 1706.4 ms | 1 / 1 | FAIL |
| Native target areas + graded color quality | 1000000 | C1 | 250.5 ms | 254.9 ms | 0 | 0 | 261.5 ms | 0 / 0 | PASS |
| Native target areas + graded color quality | 1000000 | C4 | 252.6 ms | 266.0 ms | 0 | 0 | 261.5 ms | 0 / 0 | PASS |
| Native target areas + graded color quality | 1000000 | C16 | 324.8 ms | 471.0 ms | 0 | 0 | 261.5 ms | 0 / 0 | PASS |
| Native graded quality + stronger excess-area penalty | 1000000 | C1 | 293.4 ms | 297.6 ms | 0 | 0 | 307.6 ms | 0 / 0 | PASS |
| Native graded quality + stronger excess-area penalty | 1000000 | C4 | 304.0 ms | 323.5 ms | 0 | 0 | 307.6 ms | 0 / 0 | PASS |
| Native graded quality + stronger excess-area penalty | 1000000 | C16 | 374.7 ms | 525.4 ms | 0 | 0 | 307.6 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 1000 | C1 · 8 threads/query | 9.43 ms | 12.8 ms | 0 | 0 | 11.1 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 1000 | C4 · 8 threads/query | 10.1 ms | 15.5 ms | 0 | 0 | 11.1 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 1000 | C16 · 8 threads/query | 68.5 ms | 94.1 ms | 0 | 0 | 11.1 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 10000 | C1 · 8 threads/query | 14.1 ms | 18.7 ms | 0 | 0 | 16.5 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 10000 | C4 · 8 threads/query | 21.4 ms | 30.1 ms | 0 | 0 | 16.5 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 10000 | C16 · 8 threads/query | 103.8 ms | 200.5 ms | 0 | 0 | 16.5 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 100000 | C1 · 8 threads/query | 39.2 ms | 46.3 ms | 0 | 0 | 45.5 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 100000 | C4 · 8 threads/query | 116.5 ms | 179.9 ms | 0 | 0 | 45.5 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 100000 | C16 · 8 threads/query | 988.2 ms | 1069.8 ms | 33 | 9 | 45.5 ms | 0 / 0 | FAIL |
| ClickHouse exact picked-color palette precision | 1000000 | C1 · 8 threads/query | 331.7 ms | 340.5 ms | 0 | 0 | 327.2 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 1000000 | C1 · 1 threads/query | 403.2 ms | 454.8 ms | 0 | 0 | 424.3 ms | 0 / 0 | PASS |
| ClickHouse exact picked-color palette precision | 1000000 | C4 · 8 threads/query | 996.1 ms | 1021.9 ms | 70 | 12 | 327.2 ms | 0 / 0 | FAIL |
| ClickHouse exact picked-color palette precision | 1000000 | C16 · 8 threads/query | 1012.9 ms | 1087.6 ms | 148 | 51 | 327.2 ms | 0 / 0 | FAIL |
| ClickHouse exact picked-color palette precision | 1000000 | C16 · 1 threads/query | 1016.0 ms | 1088.1 ms | 141 | 51 | 424.3 ms | 0 / 0 | FAIL |
| Native indexed picked-color grid | 1000 | C1 | 2.42 ms | 2.74 ms | 0 | 0 | 4.73 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 1000 | C4 | 4.79 ms | 4.95 ms | 0 | 0 | 4.73 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 1000 | C16 | 10.0 ms | 10.3 ms | 0 | 0 | 4.73 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 10000 | C1 | 3.89 ms | 4.05 ms | 0 | 0 | 3.33 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 10000 | C4 | 4.33 ms | 4.40 ms | 0 | 0 | 3.33 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 10000 | C16 | 8.86 ms | 9.43 ms | 0 | 0 | 3.33 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 100000 | C1 | 18.6 ms | 19.1 ms | 0 | 0 | 19.6 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 100000 | C4 | 18.9 ms | 19.6 ms | 0 | 0 | 19.6 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 100000 | C16 | 30.7 ms | 30.9 ms | 0 | 0 | 19.6 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 1000000 | C1 | 151.8 ms | 158.4 ms | 0 | 0 | 151.0 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 1000000 | C4 | 160.5 ms | 186.4 ms | 0 | 0 | 151.0 ms | 0 / 0 | PASS |
| Native indexed picked-color grid | 1000000 | C16 | 502.3 ms | 621.8 ms | 0 | 0 | 151.0 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000 | C1 | 5.26 ms | 16.7 ms | 0 | 0 | 20.6 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000 | C4 | 4.34 ms | 11.3 ms | 0 | 0 | 20.6 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000 | C16 | 19.9 ms | 40.2 ms | 0 | 0 | 20.6 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 10000 | C1 | 6.30 ms | 27.5 ms | 0 | 0 | 7.15 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 10000 | C4 | 6.36 ms | 27.3 ms | 0 | 0 | 7.15 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 10000 | C16 | 32.3 ms | 48.6 ms | 0 | 0 | 7.15 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 100000 | C1 | 39.6 ms | 53.8 ms | 0 | 0 | 50.1 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 100000 | C4 | 40.0 ms | 59.1 ms | 0 | 0 | 50.1 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 100000 | C16 | 100.0 ms | 189.2 ms | 0 | 0 | 50.1 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000000 | C1 | 341.7 ms | 358.5 ms | 0 | 0 | 386.1 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000000 | C4 | 346.8 ms | 369.0 ms | 0 | 0 | 386.1 ms | 0 / 0 | PASS |
| Overlapping 1,024 regions: coverage + quality | 1000000 | C16 | 831.6 ms | 1083.6 ms | 7 | 6 | 386.1 ms | 0 / 0 | FAIL |
| Overlapping regions + named color families | 1000 | C1 | 3.89 ms | 5.43 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 1000 | C4 | 4.08 ms | 11.9 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 1000 | C16 | 24.0 ms | 47.6 ms | 0 | 0 | 4.21 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 10000 | C1 | 6.19 ms | 8.23 ms | 0 | 0 | 7.70 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 10000 | C4 | 6.34 ms | 13.5 ms | 0 | 0 | 7.70 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 10000 | C16 | 35.2 ms | 54.4 ms | 0 | 0 | 7.70 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 100000 | C1 | 37.7 ms | 42.0 ms | 0 | 0 | 60.1 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 100000 | C4 | 39.0 ms | 59.8 ms | 0 | 0 | 60.1 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 100000 | C16 | 99.9 ms | 192.7 ms | 0 | 0 | 60.1 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 1000000 | C1 | 337.1 ms | 347.2 ms | 0 | 0 | 363.0 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 1000000 | C4 | 344.3 ms | 377.5 ms | 0 | 0 | 363.0 ms | 0 / 0 | PASS |
| Overlapping regions + named color families | 1000000 | C16 | 826.6 ms | 1013.4 ms | 9 | 6 | 363.0 ms | 0 / 0 | FAIL |

## Scheduled arrival load

Arrival-to-result latency includes dispatch delay. All outcomes, including failures and rejections, contribute to percentiles; original closed-loop baseline percentiles include successful requests only. Rejections are failures. These rate profiles remain separate from closed-loop concurrency measurements; query subsets and duration are retained.

| Method | Documents | Requests/sec | Seconds | Requests | p95 | Maximum | Errors / rejected | Timed ≥1s | Warmup errors / ≥1s | Strict result | Query subset |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | --- |
| rank-features-vibe | 1000000 | 100 | 60 | 6000 | 76.7 ms | 108.3 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, five-color-portions |
| rank-features-vibe | 1000000 | 300 | 60 | 18000 | 81.8 ms | 140.6 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, five-color-portions |
| rank-features-vibe | 1000000 | 500 | 60 | 30000 | 1101.7 ms | 1781.7 ms | 18210 / 17500 | 1866 | 0 / 0 | FAIL: observed error or ≥1 second | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, five-color-portions |
| native-area-linear | 1000000 | 50 | 60 | 3000 | 127.3 ms | 145.4 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, dark-bright-spots, five-color-portions |
| native-area-linear | 1000000 | 200 | 60 | 12000 | 1647.9 ms | 2008.2 ms | 5636 / 4945 | 3091 | 0 / 0 | FAIL: observed error or ≥1 second | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, dark-bright-spots, five-color-portions |
| native-quality-asymmetric | 1000000 | 50 | 60 | 3000 | 311.2 ms | 343.5 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, five-color-portions |
| native-quality-asymmetric | 1000000 | 200 | 60 | 12000 | 2000.9 ms | 2008.0 ms | 8652 / 7122 | 4596 | 0 / 0 | FAIL: observed error or ≥1 second | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, five-color-portions |
| feature-intent-bounded | 1000000 | 20 | 60 | 1200 | 420.7 ms | 443.6 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, dark-bright-spots, five-color-portions |
| feature-intent-bounded | 1000000 | 50 | 60 | 3000 | 429.9 ms | 471.5 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, dark-bright-spots, five-color-portions |
| feature-intent-bounded | 1000000 | 100 | 60 | 6000 | 1969.1 ms | 3628.5 ms | 1515 / 871 | 4148 | 0 / 0 | FAIL: observed error or ≥1 second | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, dark-bright-spots, five-color-portions |
| hsv-cosine-k500-ann | 1000000 | 100 | 60 | 6000 | 30.5 ms | 40.9 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| hsv-cosine-k500-ann | 1000000 | 300 | 60 | 18000 | 28.8 ms | 50.9 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| rank-features-precision-grid | 1000000 | 50 | 60 | 3000 | 181.9 ms | 236.9 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | precise-warm-red, precise-muted-green, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| rank-features-precision-grid | 1000000 | 100 | 60 | 6000 | 2001.9 ms | 2008.6 ms | 5939 / 2126 | 3848 | 0 / 0 | FAIL: observed error or ≥1 second | precise-warm-red, precise-muted-green, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| overlap-quality-dense | 1000000 | 20 | 30 | 600 | 150.5 ms | 352.1 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| overlap-quality-dense | 1000000 | 50 | 30 | 1500 | 161.9 ms | 369.7 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| overlap-quality-hybrid | 1000000 | 20 | 30 | 600 | 151.6 ms | 353.2 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |
| overlap-quality-hybrid | 1000000 | 50 | 30 | 1500 | 171.0 ms | 377.6 ms | 0 / 0 | 0 | 0 / 0 | PASS at this tested load | red-vibe, green-vibe, blue-vibe, orange-vibe-filter10, pink-vibe-filter1, green40, green70, red20, redgreen50, blueorange40, gray80red20, dark, grayscale, precise-warm-red, precise-muted-green, five-color-portions, precise-101010, precise-808080, precise-dd6600, precise-8030b0, precise-20b8d0 |

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-38-31.904Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-38-31.904Z/source-snapshot.json`; finished 2026-09-20T02:41:40.381Z.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-41-54.257Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-41-54.257Z/source-snapshot.json`; finished 2026-09-20T02:46:08.645Z.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-46-44.724Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-46-44.724Z/source-snapshot.json`; finished 2026-09-20T02:49:55.499Z.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-50-45.866Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T02-50-45.866Z/source-snapshot.json`; finished 2026-09-20T02:52:52.171Z.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T03-25-57.457Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-20T03-25-57.457Z/source-snapshot.json`; finished 2026-09-20T03:28:05.383Z.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-21T14-48-34.482Z/load.json`. Source snapshot: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/arrival-load/2026-09-21T14-48-34.482Z/source-snapshot.json`; finished 2026-09-21T14:50:47.906Z.

## Parameter sensitivity

These configurations reuse the development judgments. They are kept separate from default methods and do not provide held-out validation.

| Candidate | Parameters | Supported | Agreement | Without uncertain pairs | p95 | Report |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| feature-intent-sweep-3f83d9f8bd53 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.5,"excessPenalty":1} | 32/37 | 71.3% | 71.3% | 2.33 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-2fbf62ec71cc | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.5,"excessPenalty":1.25} | 32/37 | 70.6% | 70.6% | 2.23 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-d9b4709739f8 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.5,"excessPenalty":1.5} | 32/37 | 70.2% | 70.2% | 2.33 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-a55dc1ba089e | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.65,"excessPenalty":1} | 32/37 | 71.5% | 71.5% | 2.45 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-280f94466be3 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.65,"excessPenalty":1.25} | 32/37 | 70.8% | 70.8% | 2.62 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-e50afdc96ed0 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.65,"excessPenalty":1.5} | 32/37 | 70.4% | 70.4% | 2.65 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-4f721a67ee16 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.85,"excessPenalty":1} | 32/37 | 71.5% | 71.5% | 2.06 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-cc10f3fd00a2 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.85,"excessPenalty":1.25} | 32/37 | 70.8% | 70.8% | 2.67 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-ceb4b1d6e574 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":0.85,"excessPenalty":1.5} | 32/37 | 70.4% | 70.4% | 2.13 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-e7a745d8dc52 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":1,"excessPenalty":1} | 32/37 | 70.9% | 70.8% | 2.38 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-2fea08242cdb | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":1,"excessPenalty":1.25} | 32/37 | 70.3% | 70.2% | 2.12 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-ee8c3c2f4ad5 | {"outsidePenalty":6,"qualityPenalty":0,"areaPower":1,"excessPenalty":1.5} | 32/37 | 69.9% | 69.8% | 2.23 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-9d203b99fd1f | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.5,"excessPenalty":1} | 32/37 | 72.4% | 72.4% | 2.26 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-bf43cdb6d9fe | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.5,"excessPenalty":1.25} | 32/37 | 71.8% | 71.8% | 2.18 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-c9d220380e69 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.5,"excessPenalty":1.5} | 32/37 | 71.8% | 71.8% | 2.49 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-a0ad130105d9 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.65,"excessPenalty":1} | 32/37 | 72.6% | 72.6% | 1.93 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-f7954939a505 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.65,"excessPenalty":1.25} | 32/37 | 72.0% | 72.0% | 2.14 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-9f6d8cd14b54 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.65,"excessPenalty":1.5} | 32/37 | 72.0% | 72.0% | 2.05 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-dcd9663d11a2 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.85,"excessPenalty":1} | 32/37 | 72.6% | 72.6% | 1.93 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-78340d076a70 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.85,"excessPenalty":1.25} | 32/37 | 72.0% | 72.0% | 1.82 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-1064e6de32c5 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":0.85,"excessPenalty":1.5} | 32/37 | 72.0% | 72.0% | 1.92 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-156988055bfc | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":1,"excessPenalty":1} | 32/37 | 72.1% | 72.0% | 1.87 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-397b54856204 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":1,"excessPenalty":1.25} | 32/37 | 71.5% | 71.4% | 1.78 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-8c602a7404b1 | {"outsidePenalty":6,"qualityPenalty":0.1,"areaPower":1,"excessPenalty":1.5} | 32/37 | 71.5% | 71.4% | 1.95 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-14899c1dba2e | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.5,"excessPenalty":1} | 32/37 | 71.7% | 71.7% | 1.93 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-e86119e73434 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.5,"excessPenalty":1.25} | 32/37 | 72.8% | 72.8% | 1.82 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-3bb7d6bafb8e | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.5,"excessPenalty":1.5} | 32/37 | 72.8% | 72.8% | 1.59 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-c35b3c36d8b2 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.65,"excessPenalty":1} | 32/37 | 71.9% | 71.9% | 1.83 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-b296a7f65ce6 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.65,"excessPenalty":1.25} | 32/37 | 73.0% | 73.0% | 1.80 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-391ecad23c1d | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.65,"excessPenalty":1.5} | 32/37 | 73.0% | 73.0% | 1.46 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-f2f037eb0849 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.85,"excessPenalty":1} | 32/37 | 71.9% | 71.9% | 1.39 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-570c6083d695 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.85,"excessPenalty":1.25} | 32/37 | 73.0% | 73.0% | 1.92 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-b81fc2ee5aeb | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":0.85,"excessPenalty":1.5} | 32/37 | 73.0% | 73.0% | 1.41 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-09ed7aa36ce9 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":1,"excessPenalty":1} | 32/37 | 71.4% | 71.3% | 1.94 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-f0e288b88e91 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":1,"excessPenalty":1.25} | 32/37 | 72.5% | 72.4% | 2.18 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| feature-intent-sweep-b726077122e3 | {"outsidePenalty":6,"qualityPenalty":0.25,"areaPower":1,"excessPenalty":1.5} | 32/37 | 72.5% | 72.4% | 1.84 ms | [2026-09-20T01-03-08.336Z-08292a68](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html) |
| overlap-dense-buckets-16 | {"bucketCount":16,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.5% | 72.4% | 1.82 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-dense-buckets-64 | {"bucketCount":64,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.6% | 65.6% | 1.92 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-dense-buckets-256 | {"bucketCount":256,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.0% | 67.1% | 2.14 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-dense-buckets-1024 | {"bucketCount":1024,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.4% | 66.5% | 4.24 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-hybrid-buckets-16 | {"bucketCount":16,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.78 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-hybrid-buckets-64 | {"bucketCount":64,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 1.65 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-hybrid-buckets-256 | {"bucketCount":256,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 2.14 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| overlap-hybrid-buckets-1024 | {"bucketCount":1024,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 3.55 ms | [2026-09-21T16-35-36.773Z-ddf75f70](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html) |
| baseline-concrete-swatches-16 | {"bucketCount":16,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.5% | 72.4% | 1.73 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q00-concrete-swatches | {"bucketCount":16,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.9% | 65.9% | 2.52 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q25-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.0% | 67.1% | 2.81 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q50-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.5% | 72.4% | 2.25 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q75-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.7% | 64.7% | 2.07 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q90-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.2% | 61.1% | 2.02 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q00-concrete-swatches | {"bucketCount":16,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.9% | 68.0% | 2.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q25-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.8% | 67.5% | 2.65 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q50-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 70.4% | 70.2% | 2.53 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q75-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 63.0% | 63.1% | 2.10 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q90-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.2% | 61.1% | 2.16 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q00-concrete-swatches | {"bucketCount":16,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.3% | 67.3% | 1.78 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q25-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 69.6% | 69.0% | 1.94 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q50-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.5% | 72.3% | 1.88 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q75-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.1% | 61.1% | 2.02 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q90-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.4% | 61.3% | 1.82 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q00-concrete-swatches | {"bucketCount":16,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.3% | 67.7% | 2.23 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q25-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.0% | 71.1% | 1.79 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q50-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.7% | 74.1% | 1.88 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q75-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.0% | 65.1% | 1.88 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q90-concrete-swatches | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.2% | 61.1% | 1.87 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-concrete-swatches-64 | {"bucketCount":64,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.6% | 65.6% | 1.61 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q00-concrete-swatches | {"bucketCount":64,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.3% | 64.5% | 3.34 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q25-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.8% | 66.2% | 2.97 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q50-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.6% | 65.6% | 3.43 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q75-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 63.3% | 62.8% | 3.15 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q90-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 60.1% | 58.9% | 3.53 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q00-concrete-swatches | {"bucketCount":64,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.0% | 68.0% | 3.35 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q25-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.5% | 67.5% | 3.95 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q50-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 63.6% | 63.6% | 3.38 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q75-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.8% | 61.1% | 3.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q90-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 59.0% | 57.6% | 3.34 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q00-concrete-swatches | {"bucketCount":64,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.6% | 64.1% | 3.41 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q25-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.4% | 67.4% | 2.98 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q50-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.5% | 64.5% | 3.33 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q75-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.1% | 60.5% | 2.98 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q90-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 59.2% | 57.8% | 3.01 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q00-concrete-swatches | {"bucketCount":64,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 62.3% | 61.5% | 3.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q25-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.2% | 64.2% | 3.20 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q50-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.1% | 63.3% | 3.88 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q75-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 63.4% | 63.0% | 3.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q90-concrete-swatches | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 60.1% | 58.9% | 3.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-concrete-swatches-256 | {"bucketCount":256,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.0% | 67.1% | 1.39 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q00-concrete-swatches | {"bucketCount":256,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 64.2% | 63.8% | 4.19 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q25-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.7% | 66.7% | 3.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q50-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.0% | 67.1% | 3.56 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q75-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 69.8% | 69.0% | 3.86 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q90-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 58.8% | 58.2% | 3.89 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q00-concrete-swatches | {"bucketCount":256,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.1% | 67.3% | 3.66 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q25-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.3% | 66.3% | 3.43 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q50-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.1% | 67.6% | 4.71 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q75-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.9% | 68.3% | 4.59 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q90-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 58.5% | 58.0% | 4.69 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q00-concrete-swatches | {"bucketCount":256,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.2% | 66.5% | 3.54 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q25-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.3% | 66.3% | 4.02 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q50-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.6% | 67.1% | 3.94 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q75-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.4% | 67.9% | 3.65 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q90-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 59.0% | 58.4% | 4.10 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q00-concrete-swatches | {"bucketCount":256,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.6% | 65.5% | 4.03 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q25-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 70.1% | 70.2% | 4.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q50-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.7% | 71.2% | 3.56 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q75-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.3% | 66.3% | 4.03 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q90-concrete-swatches | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 58.8% | 58.2% | 3.96 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-concrete-swatches-1024 | {"bucketCount":1024,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.4% | 66.5% | 3.04 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q00-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.2% | 65.8% | 4.05 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q25-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 61.6% | 61.6% | 4.29 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q50-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.4% | 66.5% | 4.18 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q75-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.0% | 67.5% | 3.59 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q90-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.0% | 65.2% | 3.74 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q00-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.6% | 68.8% | 3.98 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q25-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 66.6% | 66.8% | 4.17 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q50-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.7% | 67.8% | 4.44 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q75-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.2% | 68.1% | 3.82 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q90-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.0% | 65.2% | 4.18 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q00-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.4% | 65.6% | 3.99 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q25-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 69.6% | 69.8% | 3.86 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q50-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.3% | 67.5% | 3.95 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q75-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 67.5% | 67.5% | 4.33 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q90-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.0% | 65.2% | 3.97 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q00-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 62.3% | 62.3% | 3.96 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q25-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.8% | 65.9% | 6.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q50-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.7% | 68.4% | 4.00 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q75-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 68.1% | 68.5% | 4.19 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q90-concrete-swatches | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"concrete-swatches","qualityInfluence":1,"minimumQuality":0} | 31/37 | 65.0% | 65.2% | 4.57 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-named-families-16 | {"bucketCount":16,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.01 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q00-named-families | {"bucketCount":16,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.28 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q25-named-families | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.75 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q50-named-families | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.59 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q75-named-families | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 70.9% | 71.0% | 1.35 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-16-q90-named-families | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 1.11 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q00-named-families | {"bucketCount":16,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.28 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q25-named-families | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.28 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q50-named-families | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 74.4% | 1.07 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q75-named-families | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 72.0% | 1.36 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-16-q90-named-families | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 1.35 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q00-named-families | {"bucketCount":16,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.46 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q25-named-families | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.26 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q50-named-families | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 74.4% | 1.23 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q75-named-families | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 70.4% | 70.4% | 1.14 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-16-q90-named-families | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 1.05 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q00-named-families | {"bucketCount":16,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 1.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q25-named-families | {"bucketCount":16,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 74.4% | 1.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q50-named-families | {"bucketCount":16,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.5% | 75.1% | 1.51 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q75-named-families | {"bucketCount":16,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.6% | 71.7% | 1.07 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-16-q90-named-families | {"bucketCount":16,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 1.23 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-named-families-64 | {"bucketCount":64,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 1.56 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q00-named-families | {"bucketCount":64,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 2.87 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q25-named-families | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 2.98 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q50-named-families | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.06 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q75-named-families | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.3% | 72.3% | 3.25 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-64-q90-named-families | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.1% | 72.2% | 2.95 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q00-named-families | {"bucketCount":64,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.22 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q25-named-families | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.08 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q50-named-families | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.57 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q75-named-families | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.9% | 73.0% | 3.03 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-64-q90-named-families | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 3.47 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q00-named-families | {"bucketCount":64,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.56 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q25-named-families | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.24 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q50-named-families | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.07 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q75-named-families | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.3% | 72.3% | 2.92 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-64-q90-named-families | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.8% | 71.8% | 2.84 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q00-named-families | {"bucketCount":64,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.08 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q25-named-families | {"bucketCount":64,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.3% | 73.1% | 3.05 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q50-named-families | {"bucketCount":64,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.0% | 73.8% | 2.81 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q75-named-families | {"bucketCount":64,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.9% | 73.0% | 3.51 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-64-q90-named-families | {"bucketCount":64,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 72.1% | 72.2% | 3.13 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-named-families-256 | {"bucketCount":256,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 2.02 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q00-named-families | {"bucketCount":256,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.73 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q25-named-families | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.87 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q50-named-families | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 4.00 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q75-named-families | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.6% | 73.6% | 3.59 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-256-q90-named-families | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.0% | 70.5% | 3.29 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q00-named-families | {"bucketCount":256,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 4.74 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q25-named-families | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.62 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q50-named-families | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 4.57 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q75-named-families | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.2% | 74.2% | 4.64 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-256-q90-named-families | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.0% | 70.5% | 3.69 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q00-named-families | {"bucketCount":256,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.93 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q25-named-families | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 4.10 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q50-named-families | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.93 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q75-named-families | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.6% | 73.6% | 3.75 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-256-q90-named-families | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.0% | 70.5% | 3.79 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q00-named-families | {"bucketCount":256,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.78 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q25-named-families | {"bucketCount":256,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.9% | 73.8% | 3.77 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q50-named-families | {"bucketCount":256,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.5% | 74.4% | 3.48 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q75-named-families | {"bucketCount":256,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.2% | 73.0% | 3.33 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-256-q90-named-families | {"bucketCount":256,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 71.0% | 70.5% | 3.71 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| baseline-named-families-1024 | {"bucketCount":1024,"qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 2.91 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q00-named-families | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.35 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q25-named-families | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.55 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q50-named-families | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.35 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q75-named-families | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.1% | 73.6% | 3.69 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-hard-1024-q90-named-families | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.2% | 73.4% | 3.99 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q00-named-families | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.00 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q25-named-families | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 3.65 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q50-named-families | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.04 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q75-named-families | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.7% | 74.2% | 3.84 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-feather-1024-q90-named-families | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.2% | 73.4% | 3.64 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q00-named-families | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.21 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q25-named-families | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.49 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q50-named-families | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.25 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q75-named-families | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.1% | 73.6% | 3.76 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-core-halo-1024-q90-named-families | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.2% | 73.4% | 3.86 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q00-named-families | {"bucketCount":1024,"pixelCutoff":0,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 3.77 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q25-named-families | {"bucketCount":1024,"pixelCutoff":0.25,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 74.4% | 74.4% | 4.30 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q50-named-families | {"bucketCount":1024,"pixelCutoff":0.5,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 75.1% | 75.1% | 3.92 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q75-named-families | {"bucketCount":1024,"pixelCutoff":0.75,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.7% | 74.2% | 4.10 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| cutoff-consensus-1024-q90-named-families | {"bucketCount":1024,"pixelCutoff":0.9,"namedMode":"named-families","qualityInfluence":1,"minimumQuality":0} | 31/37 | 73.2% | 73.4% | 3.74 ms | [2026-09-21T18-52-54.244Z-1101fa3a](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html) |
| overlap-quality-dense-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 67.7% | 67.4% | 1.72 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 74.2% | 74.0% | 1.66 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 61.0% | 60.8% | 1.99 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 65.6% | 65.7% | 1.88 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 64.2% | 64.3% | 2.14 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 69.6% | 69.1% | 2.04 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 63.9% | 64.4% | 3.41 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-dense-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 67.3% | 67.4% | 3.17 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 66.0% | 65.9% | 1.51 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 72.7% | 73.2% | 1.27 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 66.8% | 66.5% | 1.88 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 72.7% | 72.6% | 1.70 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 68.4% | 68.1% | 2.07 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 72.7% | 72.6% | 1.94 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0} | 31/37 | 68.1% | 68.1% | 2.91 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| overlap-quality-hybrid-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0} | 31/37 | 73.2% | 73.2% | 3.90 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 58.5% | 58.4% | 2.01 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 66.7% | 66.1% | 1.69 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 57.0% | 56.3% | 3.33 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 63.4% | 62.6% | 4.29 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 55.4% | 55.4% | 5.01 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 64.3% | 63.9% | 4.27 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 50.4% | 49.7% | 20.6 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-hard-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 61.2% | 60.8% | 4.23 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 57.4% | 57.3% | 1.73 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 69.1% | 68.6% | 1.69 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 58.1% | 58.1% | 3.85 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 67.1% | 67.0% | 3.06 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 57.9% | 58.1% | 4.98 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 68.0% | 68.2% | 3.49 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 58.7% | 58.9% | 4.49 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-feather-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 66.9% | 67.0% | 4.47 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 58.0% | 57.8% | 1.75 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 70.3% | 69.9% | 1.80 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 53.2% | 53.0% | 3.24 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 63.3% | 63.1% | 3.33 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 57.9% | 58.1% | 4.71 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 67.8% | 68.1% | 4.85 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 55.9% | 55.9% | 20.4 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-core-halo-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 66.1% | 66.2% | 3.96 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-16-linear-i3 | {"bucketCount":16,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 66.1% | 66.3% | 2.58 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-16-power-i3 | {"bucketCount":16,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 74.0% | 73.5% | 2.66 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-64-linear-i3 | {"bucketCount":64,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 58.5% | 58.1% | 3.07 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-64-power-i3 | {"bucketCount":64,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 63.7% | 63.3% | 3.32 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-256-linear-i3 | {"bucketCount":256,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 62.7% | 62.8% | 4.66 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-256-power-i3 | {"bucketCount":256,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 69.8% | 69.9% | 3.84 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-1024-linear-i3 | {"bucketCount":1024,"qualityCurve":"linear","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 60.9% | 61.2% | 4.57 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-consensus-1024-power-i3 | {"bucketCount":1024,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"pixelCutoff":0,"namedMode":"concrete-swatches"} | 31/37 | 64.6% | 64.5% | 4.52 ms | [2026-09-21T19-57-25.162Z-4756a400](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html) |
| cutoff-all-levels-16-blend0-i1 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.5% | 67.0% | 2.57 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend2-i1 | {"bucketCount":16,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.6% | 71.1% | 2.26 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend4-i1 | {"bucketCount":16,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.8% | 70.8% | 1.86 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend6-i1 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.8% | 70.5% | 1.87 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-16-q00-i1 | {"bucketCount":16,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.3% | 67.7% | 2.08 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-16-q50-i1 | {"bucketCount":16,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.7% | 74.1% | 2.56 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend0-i3 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.3% | 71.4% | 2.19 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend2-i3 | {"bucketCount":16,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.3% | 72.4% | 2.25 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend4-i3 | {"bucketCount":16,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.2% | 73.0% | 2.00 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend6-i3 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.3% | 72.0% | 2.19 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-16-q00-i3 | {"bucketCount":16,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 74.0% | 73.5% | 2.05 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-16-q50-i3 | {"bucketCount":16,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.2% | 71.8% | 1.86 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend0-i1 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 61.2% | 60.3% | 3.83 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend2-i1 | {"bucketCount":64,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.0% | 61.8% | 4.42 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend4-i1 | {"bucketCount":64,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 63.4% | 62.7% | 3.38 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend6-i1 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 63.5% | 62.8% | 3.06 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-64-q00-i1 | {"bucketCount":64,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.3% | 61.5% | 3.56 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-64-q50-i1 | {"bucketCount":64,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.1% | 63.3% | 3.42 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend0-i3 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.9% | 64.2% | 3.92 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend2-i3 | {"bucketCount":64,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 65.4% | 64.7% | 3.32 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend4-i3 | {"bucketCount":64,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.0% | 66.3% | 4.09 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-64-blend6-i3 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.5% | 66.3% | 3.66 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-64-q00-i3 | {"bucketCount":64,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 63.7% | 63.3% | 3.20 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-64-q50-i3 | {"bucketCount":64,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 66.0% | 65.4% | 3.77 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend0-i1 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 66.3% | 66.2% | 3.60 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend2-i1 | {"bucketCount":256,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.4% | 69.4% | 4.36 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend4-i1 | {"bucketCount":256,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.5% | 70.6% | 4.00 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend6-i1 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.6% | 71.2% | 4.62 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-256-q00-i1 | {"bucketCount":256,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 65.6% | 65.5% | 3.79 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-256-q50-i1 | {"bucketCount":256,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.7% | 71.2% | 4.19 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend0-i3 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.2% | 71.2% | 3.87 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend2-i3 | {"bucketCount":256,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.0% | 72.6% | 4.05 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend4-i3 | {"bucketCount":256,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.7% | 73.2% | 3.99 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-256-blend6-i3 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.6% | 72.0% | 4.53 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-256-q00-i3 | {"bucketCount":256,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.8% | 69.9% | 3.97 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-256-q50-i3 | {"bucketCount":256,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.9% | 71.4% | 3.96 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend0-i1 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.7% | 62.7% | 4.30 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend2-i1 | {"bucketCount":1024,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 65.8% | 65.9% | 4.95 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend4-i1 | {"bucketCount":1024,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.8% | 68.5% | 4.20 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend6-i1 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.6% | 68.3% | 4.68 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-1024-q00-i1 | {"bucketCount":1024,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.3% | 62.3% | 5.19 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-1024-q50-i1 | {"bucketCount":1024,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.7% | 68.4% | 4.45 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend0-i3 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.5% | 64.6% | 5.20 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend2-i3 | {"bucketCount":1024,"cutoffBlendExponent":2,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.6% | 68.3% | 4.69 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend4-i3 | {"bucketCount":1024,"cutoffBlendExponent":4,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.7% | 69.4% | 4.79 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-1024-blend6-i3 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.2% | 69.9% | 5.48 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-1024-q00-i3 | {"bucketCount":1024,"pixelCutoff":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.6% | 64.5% | 4.29 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-consensus-1024-q50-i3 | {"bucketCount":1024,"pixelCutoff":0.5,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.9% | 68.5% | 5.19 ms | [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) |
| cutoff-all-levels-16-blend0-i1 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.5% | 67.0% | 2.01 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend0-i1 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.7% | 66.9% | 2.21 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-16-blend3-i1 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.1% | 71.2% | 1.73 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend3-i1 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.8% | 69.9% | 2.14 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-16-blend6-i1 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.8% | 70.5% | 2.19 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend6-i1 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.1% | 68.9% | 1.90 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-16-blend0-i3 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.3% | 71.4% | 2.13 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend0-i3 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.0% | 69.7% | 2.30 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-16-blend3-i3 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.1% | 71.9% | 2.42 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend3-i3 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.0% | 71.0% | 2.32 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-16-blend6-i3 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.3% | 72.0% | 2.07 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend6-i3 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.6% | 72.5% | 2.00 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend0-i1 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 61.2% | 60.3% | 3.09 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend0-i1 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.7% | 68.1% | 2.50 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend3-i1 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.7% | 62.5% | 3.26 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend3-i1 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.5% | 66.2% | 2.41 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend6-i1 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 63.5% | 62.8% | 3.21 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend6-i1 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 66.8% | 66.0% | 2.67 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend0-i3 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.9% | 64.2% | 3.55 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend0-i3 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.3% | 69.2% | 2.88 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend3-i3 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 65.9% | 65.3% | 3.50 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend3-i3 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.2% | 66.9% | 2.78 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-64-blend6-i3 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 67.5% | 66.3% | 3.58 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-64-blend6-i3 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.7% | 68.0% | 2.66 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend0-i1 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 66.3% | 66.2% | 4.92 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend0-i1 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.8% | 69.5% | 4.07 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend3-i1 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.3% | 71.4% | 4.11 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend3-i1 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.2% | 71.2% | 4.89 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend6-i1 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.6% | 71.2% | 4.44 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend6-i1 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.8% | 71.3% | 3.67 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend0-i3 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 71.2% | 71.2% | 4.36 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend0-i3 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.0% | 69.0% | 4.61 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend3-i3 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.8% | 72.4% | 5.21 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend3-i3 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.9% | 72.9% | 4.74 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-256-blend6-i3 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 72.6% | 72.0% | 4.03 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-256-blend6-i3 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 73.7% | 73.1% | 4.36 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend0-i1 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 62.7% | 62.7% | 3.75 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend0-i1 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.1% | 69.2% | 5.07 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend3-i1 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.1% | 67.7% | 4.73 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend3-i1 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.0% | 69.1% | 4.54 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend6-i1 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 68.6% | 68.3% | 4.39 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend6-i1 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.6% | 69.8% | 6.57 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend0-i3 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 64.5% | 64.6% | 4.86 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend0-i3 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.0% | 69.0% | 4.84 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend3-i3 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 69.1% | 68.8% | 4.71 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend3-i3 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.8% | 69.9% | 5.07 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-all-levels-1024-blend6-i3 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.2% | 69.9% | 4.85 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-1024-blend6-i3 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 31/37 | 70.4% | 69.6% | 4.77 ms | [2026-09-21T22-29-58.206Z-ceda9d2e](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html) |
| cutoff-shade-all-levels-16-blend0-i1 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 65.6% | 64.8% | 2.18 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend0-i1 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.6% | 67.3% | 2.01 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-16-blend3-i1 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.6% | 67.7% | 2.11 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend3-i1 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.3% | 69.3% | 2.21 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-16-blend6-i1 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.0% | 66.8% | 2.02 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend6-i1 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.2% | 70.1% | 2.15 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-16-blend0-i3 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.8% | 67.5% | 2.01 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend0-i3 | {"bucketCount":16,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.0% | 69.0% | 2.14 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-16-blend3-i3 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.8% | 68.8% | 2.28 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend3-i3 | {"bucketCount":16,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.1% | 70.0% | 2.58 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-16-blend6-i3 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 73.4% | 73.3% | 2.15 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-16-blend6-i3 | {"bucketCount":16,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.9% | 71.7% | 2.49 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend0-i1 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 66.6% | 65.9% | 3.05 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend0-i1 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.4% | 68.4% | 2.61 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend3-i1 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 65.4% | 64.2% | 2.24 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend3-i1 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.9% | 68.3% | 2.34 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend6-i1 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 64.7% | 64.0% | 2.72 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend6-i1 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.1% | 67.6% | 2.29 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend0-i3 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.1% | 67.1% | 2.58 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend0-i3 | {"bucketCount":64,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.8% | 68.8% | 2.62 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend3-i3 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 66.0% | 64.8% | 2.81 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend3-i3 | {"bucketCount":64,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.5% | 69.0% | 2.56 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-64-blend6-i3 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.7% | 69.0% | 3.26 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-64-blend6-i3 | {"bucketCount":64,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.3% | 69.8% | 2.59 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend0-i1 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.6% | 67.3% | 4.03 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend0-i1 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.1% | 69.0% | 4.24 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend3-i1 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.9% | 69.0% | 5.18 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend3-i1 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.6% | 70.9% | 4.06 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend6-i1 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.6% | 69.1% | 5.89 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend6-i1 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.3% | 70.6% | 4.04 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend0-i3 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.8% | 66.9% | 6.23 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend0-i3 | {"bucketCount":256,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.3% | 70.7% | 4.34 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend3-i3 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.6% | 70.6% | 5.96 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend3-i3 | {"bucketCount":256,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 72.2% | 71.6% | 4.22 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-256-blend6-i3 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 74.5% | 74.0% | 6.22 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-256-blend6-i3 | {"bucketCount":256,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 72.9% | 72.3% | 4.67 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend0-i1 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.9% | 67.1% | 4.43 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend0-i1 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 72.2% | 71.6% | 4.95 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend3-i1 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.8% | 67.0% | 7.11 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend3-i1 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.0% | 69.7% | 6.38 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend6-i1 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.4% | 67.6% | 4.39 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend6-i1 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":1,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 69.3% | 68.9% | 4.07 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend0-i3 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 67.8% | 66.9% | 6.33 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend0-i3 | {"bucketCount":1024,"cutoffBlendExponent":0,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.2% | 71.1% | 6.12 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend3-i3 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 68.5% | 67.7% | 4.85 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend3-i3 | {"bucketCount":1024,"cutoffBlendExponent":3,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.1% | 69.7% | 4.82 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-all-levels-1024-blend6-i3 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 71.4% | 70.5% | 6.42 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| cutoff-shade-hue-all-levels-1024-blend6-i3 | {"bucketCount":1024,"cutoffBlendExponent":6,"qualityCurve":"power","qualityInfluence":3,"minimumQuality":0,"namedMode":"concrete-swatches"} | 32/38 | 70.1% | 69.7% | 6.51 ms | [2026-09-21T23-11-56.676Z-ea2526a6](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html) |
| strict-hue-favorite-001-256 | {"bucketCount":256,"cutoffBlendExponent":1,"qualityCurve":"linear","qualityInfluence":0.5,"minimumQuality":0,"namedMode":"concrete-swatches","areaPower":0.5,"qualityPenalty":0.35,"excessPenalty":1.5,"pixelCutoff":0} | 32/38 | 69.5% | 68.9% | 6.17 ms | [2026-09-21T23-49-12.493Z-97753239](http://zerotwo:8224/2026-09-21T23-49-12.493Z-97753239/report.html) |
| strict-hue-favorite-001-1024 | {"bucketCount":1024,"cutoffBlendExponent":1,"qualityCurve":"linear","qualityInfluence":0.5,"minimumQuality":0,"namedMode":"concrete-swatches","areaPower":0.5,"qualityPenalty":0.35,"excessPenalty":1.5,"pixelCutoff":0} | 32/38 | 71.3% | 70.5% | 6.23 ms | [2026-09-21T23-49-12.493Z-97753239](http://zerotwo:8224/2026-09-21T23-49-12.493Z-97753239/report.html) |

## Provenance

### HSV64 cosine ANN control

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: hsv-cosine-ann.

```json
{
  "configuration": {
    "id": "hsv-cosine-ann",
    "method": "hsv-cosine-ann",
    "label": "HSV64 cosine ANN control",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### HSV64 raw L2 ANN control

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: hsv-l2-raw-ann.

```json
{
  "configuration": {
    "id": "hsv-l2-raw-ann",
    "method": "hsv-l2-raw-ann",
    "label": "HSV64 raw L2 ANN control",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### HSV64 unit-sum L2 ANN

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: hsv-l2-unit-ann.

```json
{
  "configuration": {
    "id": "hsv-l2-unit-ann",
    "method": "hsv-l2-unit-ann",
    "label": "HSV64 unit-sum L2 ANN",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### HSV64 Hellinger ANN

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: hsv-hellinger-ann.

```json
{
  "configuration": {
    "id": "hsv-hellinger-ann",
    "method": "hsv-hellinger-ann",
    "label": "HSV64 Hellinger ANN",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### RGB512 perceptual query + Hellinger ANN

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: rgb-hellinger-ann.

```json
{
  "configuration": {
    "id": "rgb-hellinger-ann",
    "method": "rgb-hellinger-ann",
    "label": "RGB512 perceptual query + Hellinger ANN",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### RGB512 perceptual query + cosine ANN

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: rgb-cosine-ann.

```json
{
  "configuration": {
    "id": "rgb-cosine-ann",
    "method": "rgb-cosine-ann",
    "label": "RGB512 perceptual query + cosine ANN",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### HSV64 exhaustive cosine reference

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: hsv-cosine-exact.

```json
{
  "configuration": {
    "id": "hsv-cosine-exact",
    "method": "hsv-cosine-exact",
    "label": "HSV64 exhaustive cosine reference",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine RGB histogram perceptual kernel

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: rgb-kernel-exact.

```json
{
  "configuration": {
    "id": "rgb-kernel-exact",
    "method": "rgb-kernel-exact",
    "label": "Fine RGB histogram perceptual kernel",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Palette32 target area

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: palette-area-exact.

```json
{
  "configuration": {
    "id": "palette-area-exact",
    "method": "palette-area-exact",
    "label": "Palette32 target area",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram target area

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: histogram-area-exact.

```json
{
  "configuration": {
    "id": "histogram-area-exact",
    "method": "histogram-area-exact",
    "label": "Fine histogram target area",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram area + quality + palette purity

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: histogram-composition-exact.

```json
{
  "configuration": {
    "id": "histogram-composition-exact",
    "method": "histogram-composition-exact",
    "label": "Fine histogram area + quality + palette purity",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Indexed family areas, linear target error

Run: [2026-09-20T01-55-38.776Z-219058ec](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html). Candidate: native-area-linear.

```json
{
  "configuration": {
    "id": "native-area-linear",
    "method": "native-area-linear",
    "label": "Indexed family areas, linear target error",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 10,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "18a7b1c44bda5a1514d46bb093bd097eff69f5b497e49be3afdf1fe3f50ef563",
    "exploration/registry.mjs": "1165f2b25c369dcc3e4b03474c00cfc695a731d8c0cfd543d19fbfe8ee7fe537",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "3ec1a846b840f77938b9a95e46c476c6d8b8852d37d02877c4b00429a3dd8223",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Indexed family areas, Gaussian target error

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: native-area-gauss.

```json
{
  "configuration": {
    "id": "native-area-gauss",
    "method": "native-area-gauss",
    "label": "Indexed family areas, Gaussian target error",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Indexed coverage bucket postings

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: native-area-postings.

```json
{
  "configuration": {
    "id": "native-area-postings",
    "method": "native-area-postings",
    "label": "Indexed coverage bucket postings",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Named feature area + quality + palette purity

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: feature-composition-exact.

```json
{
  "configuration": {
    "id": "feature-composition-exact",
    "method": "feature-composition-exact",
    "label": "Named feature area + quality + palette purity",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### RGB marginal distribution Wasserstein

Run: [2026-09-20T00-50-38.374Z-32d2dbb7](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html). Candidate: rgb-cdf-wasserstein.

```json
{
  "configuration": {
    "id": "rgb-cdf-wasserstein",
    "method": "rgb-cdf-wasserstein",
    "label": "RGB marginal distribution Wasserstein",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "49310d9983e401ea6578578a120c1ce7ddfc09c81894b235f7c07da91192255f",
    "exploration/methods.mjs": "d532d960611da838e1f89c07a63b9bda66c4fc9785474cf61de7804daf6b4cb3",
    "exploration/query.mjs": "4c78c8dfc447227ec930113cd4611e3bb84f2630c71f5334f41075e976bfdf70",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Named composition with exact indexed bounds

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: feature-composition-bounded.

```json
{
  "configuration": {
    "id": "feature-composition-bounded",
    "method": "feature-composition-bounded",
    "label": "Named composition with exact indexed bounds",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram target area, typed Painless

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: histogram-area-typed.

```json
{
  "configuration": {
    "id": "histogram-area-typed",
    "method": "histogram-area-typed",
    "label": "Fine histogram target area, typed Painless",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram composition, typed Painless

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: histogram-composition-typed.

```json
{
  "configuration": {
    "id": "histogram-composition-typed",
    "method": "histogram-composition-typed",
    "label": "Fine histogram composition, typed Painless",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram perceptual kernel, typed Painless

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: rgb-kernel-typed.

```json
{
  "configuration": {
    "id": "rgb-kernel-typed",
    "method": "rgb-kernel-typed",
    "label": "Fine histogram perceptual kernel, typed Painless",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Palette32 target area, typed Painless

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: palette-area-typed.

```json
{
  "configuration": {
    "id": "palette-area-typed",
    "method": "palette-area-typed",
    "label": "Palette32 target area, typed Painless",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Palette32 exclusive portion transport

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: palette-transport-exact.

```json
{
  "configuration": {
    "id": "palette-transport-exact",
    "method": "palette-transport-exact",
    "label": "Palette32 exclusive portion transport",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Named features: free remainder + graded quality

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: feature-intent-balanced.

```json
{
  "configuration": {
    "id": "feature-intent-balanced",
    "method": "feature-intent-balanced",
    "label": "Named features: free remainder + graded quality",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Fine histogram: free remainder + graded quality

Run: [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html). Candidate: histogram-intent-balanced.

```json
{
  "configuration": {
    "id": "histogram-intent-balanced",
    "method": "histogram-intent-balanced",
    "label": "Fine histogram: free remainder + graded quality",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "bb3cfb6ac789785fc13ff6eeca3f8ea44d8edd1fdb1d3a8d63e1b7bcd270fd34",
    "exploration/registry.mjs": "693d0342d7b190c6e37f79de84c4fc97e978c3dd9a1d40e790e8fe0e61441ccd",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a459ad4db9ab88f4283b8884f7b722e833d2b03a8733a9561d0c8a6459466efa",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Named features: refined objective + exact bounds

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: feature-intent-bounded.

```json
{
  "configuration": {
    "id": "feature-intent-bounded",
    "method": "feature-intent-bounded",
    "label": "Named features: refined objective + exact bounds",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Named indexed bounds + precise histogram queries

Run: [2026-09-20T01-00-54.214Z-9ee49dbd](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html). Candidate: hybrid-intent-bounded.

```json
{
  "configuration": {
    "id": "hybrid-intent-bounded",
    "method": "hybrid-intent-bounded",
    "label": "Named indexed bounds + precise histogram queries",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "d7ebf1222e400c5e7ab40f75026343a9859e42ea7adc24bf4fde98e6bc355320",
    "exploration/registry.mjs": "2d79c914a7ffc6875907843f5bd688bf6bf24a9762e557c5fddfc000710eea80",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Direct Palette32 balanced area and color

Run: [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html). Candidate: palette-direct-balanced.

```json
{
  "configuration": {
    "id": "palette-direct-balanced",
    "method": "palette-direct-balanced",
    "label": "Direct Palette32 balanced area and color",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "e7d1e266810287785a6431af246c2ffcb66aecf728cc3dcbafbf4b726147657b",
    "exploration/registry.mjs": "cb9369cdcd971f1c2e3b8ed51fa14423543bec484c16416026f35ea425b4937c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Direct Palette32 with shade-first picked colors

Run: [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html). Candidate: palette-direct-precision.

```json
{
  "configuration": {
    "id": "palette-direct-precision",
    "method": "palette-direct-precision",
    "label": "Direct Palette32 with shade-first picked colors",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "e7d1e266810287785a6431af246c2ffcb66aecf728cc3dcbafbf4b726147657b",
    "exploration/registry.mjs": "cb9369cdcd971f1c2e3b8ed51fa14423543bec484c16416026f35ea425b4937c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Rank features: indexed target area

Run: [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html). Candidate: rank-features-area.

```json
{
  "configuration": {
    "id": "rank-features-area",
    "method": "rank-features-area",
    "label": "Rank features: indexed target area",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "e7d1e266810287785a6431af246c2ffcb66aecf728cc3dcbafbf4b726147657b",
    "exploration/registry.mjs": "cb9369cdcd971f1c2e3b8ed51fa14423543bec484c16416026f35ea425b4937c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Rank features: target area and perceptual vibe

Run: [2026-09-20T01-07-33.778Z-ba9d2951](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html). Candidate: rank-features-vibe.

```json
{
  "configuration": {
    "id": "rank-features-vibe",
    "method": "rank-features-vibe",
    "label": "Rank features: target area and perceptual vibe",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "e7d1e266810287785a6431af246c2ffcb66aecf728cc3dcbafbf4b726147657b",
    "exploration/registry.mjs": "cb9369cdcd971f1c2e3b8ed51fa14423543bec484c16416026f35ea425b4937c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "2c12897cd0e698d4599094a34878707f7aa3b877aeb8d8034ff31b0765959eb8",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### Relative bright accents + named/precise color routing

Run: [2026-09-20T01-11-36.841Z-66d53e54](http://zerotwo:8224/2026-09-20T01-11-36.841Z-66d53e54/report.html). Candidate: hybrid-relative-accents.

```json
{
  "configuration": {
    "id": "hybrid-relative-accents",
    "method": "hybrid-relative-accents",
    "label": "Relative bright accents + named/precise color routing",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "ffc23dbbf33bbc819469d7f7a6ac96231819da2318640a386a86d08605e9b5fb",
    "exploration/registry.mjs": "dfdf6436fe392f5d2c2ec4f61e397e1798978644c40280a7e30f6ad52f14eb69",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  }
}
```

### HSV64 cosine ANN control (k=500)

Run: [2026-09-20T01-12-38.947Z-86945d5c](http://zerotwo:8224/2026-09-20T01-12-38.947Z-86945d5c/report.html). Candidate: hsv-cosine-k500-ann.

```json
{
  "configuration": {
    "id": "hsv-cosine-k500-ann",
    "method": "hsv-cosine-k500-ann",
    "label": "HSV64 cosine ANN control (k=500)",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "2b9ff4c1e1e7a471efdfb435536622c3189621f4bc1fef20e2fd0684fb14e2bc",
    "exploration/registry.mjs": "cbffec208a7f2d87fd7ca405790009c6a909526e88ea37b538f2ab2194fb7e7c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### RGB512 perceptual query + cosine ANN (k=500)

Run: [2026-09-20T01-12-38.947Z-86945d5c](http://zerotwo:8224/2026-09-20T01-12-38.947Z-86945d5c/report.html). Candidate: rgb-cosine-k500-ann.

```json
{
  "configuration": {
    "id": "rgb-cosine-k500-ann",
    "method": "rgb-cosine-k500-ann",
    "label": "RGB512 perceptual query + cosine ANN (k=500)",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "approximate",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "2b9ff4c1e1e7a471efdfb435536622c3189621f4bc1fef20e2fd0684fb14e2bc",
    "exploration/registry.mjs": "cbffec208a7f2d87fd7ca405790009c6a909526e88ea37b538f2ab2194fb7e7c",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Direct precision with exact indexed palette-cell bounds

Run: [2026-09-20T01-18-35.608Z-adff6e8d](http://zerotwo:8224/2026-09-20T01-18-35.608Z-adff6e8d/report.html). Candidate: palette-precision-bounded.

```json
{
  "configuration": {
    "id": "palette-precision-bounded",
    "method": "palette-precision-bounded",
    "label": "Direct precision with exact indexed palette-cell bounds",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "12b3ffc9b0132206093584cebc26566ea14da30dfbc85aacc66032d5756128f1",
    "exploration/registry.mjs": "e20642ed4a2458df85dad26356fc86d2577ff568ed1870ace73468355560479f",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "9551515614e8fca877249f803f9154285575fcad73eab178512437e176d83c8d",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Relative accents + exact indexed named/precise color search

Run: [2026-09-20T01-18-35.608Z-adff6e8d](http://zerotwo:8224/2026-09-20T01-18-35.608Z-adff6e8d/report.html). Candidate: hybrid-indexed-precision.

```json
{
  "configuration": {
    "id": "hybrid-indexed-precision",
    "method": "hybrid-indexed-precision",
    "label": "Relative accents + exact indexed named/precise color search",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "12b3ffc9b0132206093584cebc26566ea14da30dfbc85aacc66032d5756128f1",
    "exploration/registry.mjs": "e20642ed4a2458df85dad26356fc86d2577ff568ed1870ace73468355560479f",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "9551515614e8fca877249f803f9154285575fcad73eab178512437e176d83c8d",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "c306a77b2591d38a71e9f71ebb1a4ca33dc8307386a6288f5302edcf262e833a"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Direct picked-color precision, typed Painless

Run: [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html). Candidate: palette-precision-typed.

```json
{
  "configuration": {
    "id": "palette-precision-typed",
    "method": "palette-precision-typed",
    "label": "Direct picked-color precision, typed Painless",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "eb1dda0a495e9b7d9d258bd7879dac89568b8e2e27a867ec0d9ea6e925c4fb83",
    "exploration/registry.mjs": "003140ae8aa77c95ac0d0db69c23347f35dc707863a483a866600b2d4115cbe5",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "f56c360128bb7e25c349edf20b8d4e84a47b59b1937be9396210f52ba97d979c"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Typed precision with exact indexed palette bounds

Run: [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html). Candidate: palette-precision-bounded-typed.

```json
{
  "configuration": {
    "id": "palette-precision-bounded-typed",
    "method": "palette-precision-bounded-typed",
    "label": "Typed precision with exact indexed palette bounds",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "eb1dda0a495e9b7d9d258bd7879dac89568b8e2e27a867ec0d9ea6e925c4fb83",
    "exploration/registry.mjs": "003140ae8aa77c95ac0d0db69c23347f35dc707863a483a866600b2d4115cbe5",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "f56c360128bb7e25c349edf20b8d4e84a47b59b1937be9396210f52ba97d979c"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Relative accents + typed exact indexed precision

Run: [2026-09-20T01-39-31.955Z-22f2b24e](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html). Candidate: hybrid-indexed-typed.

```json
{
  "configuration": {
    "id": "hybrid-indexed-typed",
    "method": "hybrid-indexed-typed",
    "label": "Relative accents + typed exact indexed precision",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "eb1dda0a495e9b7d9d258bd7879dac89568b8e2e27a867ec0d9ea6e925c4fb83",
    "exploration/registry.mjs": "003140ae8aa77c95ac0d0db69c23347f35dc707863a483a866600b2d4115cbe5",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "f56c360128bb7e25c349edf20b8d4e84a47b59b1937be9396210f52ba97d979c"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Picked precision with indexed OKLab centroids

Run: [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html). Candidate: palette-precision-precomputed.

```json
{
  "configuration": {
    "id": "palette-precision-precomputed",
    "method": "palette-precision-precomputed",
    "label": "Picked precision with indexed OKLab centroids",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "18a7b1c44bda5a1514d46bb093bd097eff69f5b497e49be3afdf1fe3f50ef563",
    "exploration/registry.mjs": "1165f2b25c369dcc3e4b03474c00cfc695a731d8c0cfd543d19fbfe8ee7fe537",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Indexed OKLab precision with conservative palette bounds

Run: [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html). Candidate: palette-precision-bounded-precomputed.

```json
{
  "configuration": {
    "id": "palette-precision-bounded-precomputed",
    "method": "palette-precision-bounded-precomputed",
    "label": "Indexed OKLab precision with conservative palette bounds",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "18a7b1c44bda5a1514d46bb093bd097eff69f5b497e49be3afdf1fe3f50ef563",
    "exploration/registry.mjs": "1165f2b25c369dcc3e4b03474c00cfc695a731d8c0cfd543d19fbfe8ee7fe537",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Relative accents + indexed OKLab precision

Run: [2026-09-20T02-20-53.169Z-b5b47212](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html). Candidate: hybrid-indexed-precomputed.

```json
{
  "configuration": {
    "id": "hybrid-indexed-precomputed",
    "method": "hybrid-indexed-precomputed",
    "label": "Relative accents + indexed OKLab precision",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "18a7b1c44bda5a1514d46bb093bd097eff69f5b497e49be3afdf1fe3f50ef563",
    "exploration/registry.mjs": "1165f2b25c369dcc3e4b03474c00cfc695a731d8c0cfd543d19fbfe8ee7fe537",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Native target areas + graded color quality

Run: [2026-09-20T01-55-38.776Z-219058ec](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html). Candidate: native-quality-linear.

```json
{
  "configuration": {
    "id": "native-quality-linear",
    "method": "native-quality-linear",
    "label": "Native target areas + graded color quality",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 10,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "18a7b1c44bda5a1514d46bb093bd097eff69f5b497e49be3afdf1fe3f50ef563",
    "exploration/registry.mjs": "1165f2b25c369dcc3e4b03474c00cfc695a731d8c0cfd543d19fbfe8ee7fe537",
    "exploration/methods.mjs": "57c09c585344070021fa33b935638ca79597a21f04fce8607a9175cdf218d224",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "3ec1a846b840f77938b9a95e46c476c6d8b8852d37d02877c4b00429a3dd8223",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "6c62ac50de1d998c124e106683f31c2f6c53027768df696dddd6e4f4823abeba",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### Native graded quality + stronger excess-area penalty

Run: [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html). Candidate: native-quality-asymmetric.

```json
{
  "configuration": {
    "id": "native-quality-asymmetric",
    "method": "native-quality-asymmetric",
    "label": "Native graded quality + stronger excess-area penalty",
    "module": "./adapter.mjs",
    "index": "color-exploration-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "bb3cfb6ac789785fc13ff6eeca3f8ea44d8edd1fdb1d3a8d63e1b7bcd270fd34",
    "exploration/registry.mjs": "693d0342d7b190c6e37f79de84c4fc97e978c3dd9a1d40e790e8fe0e61441ccd",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a459ad4db9ab88f4283b8884f7b722e833d2b03a8733a9561d0c8a6459466efa",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906"
  },
  "descriptorHashes": {
    "features.jsonl": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "refinement-features.jsonl": "27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638"
  }
}
```

### ClickHouse exact picked-color palette precision

Run: [2026-09-20T02-52-07.682Z-6faa9adb](http://zerotwo:8224/2026-09-20T02-52-07.682Z-6faa9adb/report.html). Candidate: clickhouse-palette-precision.

```json
{
  "configuration": {
    "id": "clickhouse-palette-precision",
    "method": "clickhouse-palette-precision",
    "label": "ClickHouse exact picked-color palette precision",
    "module": "./adapter.mjs",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 10,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "clickhouse",
    "version": "26.3.9.8",
    "topology": {
      "engine": "MergeTree",
      "nodes": 1,
      "hostname": "d96044c4ca3a",
      "containerLimits": {
        "cpus": 8,
        "memoryBytes": 12884901888,
        "source": "clickhouse-compose.yml; compare with observed metrics"
      }
    },
    "retrieval": "exact-stored-objective",
    "boundary": "query compilation + HTTP + ClickHouse filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "14a1d6a38fc00024b00b22c7ddb123797855fce85469e6d3f4b03d5238e0c92c",
    "exploration/registry.mjs": "6ef80d9f44a05bf49cc270e62fb0d8d6c808df5b1b8b3d2718100bfecc428002",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ab1d285d4bee4bf3aefa42e88b627d7ff62b74694d106eb52a9d483b02e3faf2",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "f981e5cdb686e61054987e93a98f3dc1a4c03d22235d90de807595f452902c7f",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee"
  },
  "descriptorHashes": {
    "sourceFeatures": "424e78bb42994021cb50ee3d254a777680f432be89bc66e9217307a6123be680",
    "clickhouseDocuments": "18e2668a821f0ae0fb1ece76410d21ca2777964ff3a247015ea7b121e53b57c4",
    "colorTransform": "eb24a0e60cef33d643506bd88021fa2e3020d8e9f2cdde9de14d5187a3667fc8"
  }
}
```

### Native indexed picked-color grid

Run: [2026-09-20T03-13-00.884Z-c2f20177](http://zerotwo:8224/2026-09-20T03-13-00.884Z-c2f20177/report.html). Candidate: rank-features-precision-grid.

```json
{
  "configuration": {
    "id": "rank-features-precision-grid",
    "method": "rank-features-precision-grid",
    "label": "Native indexed picked-color grid",
    "module": "./adapter.mjs",
    "index": "color-exploration-precision-grid-real-v2",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 10,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-precision-grid-real-v2",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "24575d4a33fa561d028e15683d94b49aa0a31431ef34d75f7a4be6985042391a",
    "exploration/registry.mjs": "4abd95f40371ac3778a92b60ec545a144b7fbe4dccd03b444181fef3f39060d2",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78"
  },
  "descriptorHashes": {
    "features": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "gridDefinition": "f531402cfe706819a6655897065a78d8778cccadd57e1cdd8a3ae54ebbde6d5d",
    "gridComputation": "b917afefbbce344ef7738a34493a18671e05513d23eb9902100c8f8d5b03f244"
  }
}
```

### Overlapping 1,024 regions: coverage + quality

Run: [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html). Candidate: overlap-quality-dense.

```json
{
  "configuration": {
    "id": "overlap-quality-dense",
    "method": "overlap-quality-dense",
    "label": "Overlapping 1,024 regions: coverage + quality",
    "module": "./adapter.mjs",
    "index": "color-exploration-overlap-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-overlap-real-v1",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "bb3cfb6ac789785fc13ff6eeca3f8ea44d8edd1fdb1d3a8d63e1b7bcd270fd34",
    "exploration/registry.mjs": "693d0342d7b190c6e37f79de84c4fc97e978c3dd9a1d40e790e8fe0e61441ccd",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a459ad4db9ab88f4283b8884f7b722e833d2b03a8733a9561d0c8a6459466efa",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906"
  }
}
```

### Overlapping regions + named color families

Run: [2026-09-21T14-18-17.584Z-526f791b](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html). Candidate: overlap-quality-hybrid.

```json
{
  "configuration": {
    "id": "overlap-quality-hybrid",
    "method": "overlap-quality-hybrid",
    "label": "Overlapping regions + named color families",
    "module": "./adapter.mjs",
    "index": "color-exploration-overlap-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-overlap-real-v1",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "bb3cfb6ac789785fc13ff6eeca3f8ea44d8edd1fdb1d3a8d63e1b7bcd270fd34",
    "exploration/registry.mjs": "693d0342d7b190c6e37f79de84c4fc97e978c3dd9a1d40e790e8fe0e61441ccd",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a459ad4db9ab88f4283b8884f7b722e833d2b03a8733a9561d0c8a6459466efa",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906"
  }
}
```

### Pixel cutoff: Hard cutoff

Run: [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html). Candidate: cutoff-hard.

```json
{
  "configuration": {
    "id": "cutoff-hard",
    "method": "cutoff-hard",
    "label": "Pixel cutoff: Hard cutoff",
    "module": "./adapter.mjs",
    "index": "color-exploration-cutoff-1024-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-cutoff-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "4e438b8421eab213e956b211dbf6ffeca317063aa51115ac14b0c635352b6cd4",
    "exploration/registry.mjs": "12b65c0c5aa988db4daa790f852190ea9036779365131615977e0d88007ca460",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a0b3945cb14674bfe111eed207d236e570f9a0adb4bc8e98dba645c78c92e83f",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "887d6b0f1636a1e457af26885ad93500318e8b1acbda15fe776e80a4fb687ac7",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045"
  }
}
```

### Pixel cutoff: Feathered cutoff

Run: [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html). Candidate: cutoff-feather.

```json
{
  "configuration": {
    "id": "cutoff-feather",
    "method": "cutoff-feather",
    "label": "Pixel cutoff: Feathered cutoff",
    "module": "./adapter.mjs",
    "index": "color-exploration-cutoff-1024-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-cutoff-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "4e438b8421eab213e956b211dbf6ffeca317063aa51115ac14b0c635352b6cd4",
    "exploration/registry.mjs": "12b65c0c5aa988db4daa790f852190ea9036779365131615977e0d88007ca460",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a0b3945cb14674bfe111eed207d236e570f9a0adb4bc8e98dba645c78c92e83f",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "887d6b0f1636a1e457af26885ad93500318e8b1acbda15fe776e80a4fb687ac7",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045"
  }
}
```

### Pixel cutoff: Full core, soft halo

Run: [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html). Candidate: cutoff-core-halo.

```json
{
  "configuration": {
    "id": "cutoff-core-halo",
    "method": "cutoff-core-halo",
    "label": "Pixel cutoff: Full core, soft halo",
    "module": "./adapter.mjs",
    "index": "color-exploration-cutoff-1024-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-cutoff-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "4e438b8421eab213e956b211dbf6ffeca317063aa51115ac14b0c635352b6cd4",
    "exploration/registry.mjs": "12b65c0c5aa988db4daa790f852190ea9036779365131615977e0d88007ca460",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a0b3945cb14674bfe111eed207d236e570f9a0adb4bc8e98dba645c78c92e83f",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "887d6b0f1636a1e457af26885ad93500318e8b1acbda15fe776e80a4fb687ac7",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045"
  }
}
```

### Pixel cutoff: Multiple cutoffs

Run: [2026-09-21T19-14-00.182Z-d06fdb5a](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html). Candidate: cutoff-consensus.

```json
{
  "configuration": {
    "id": "cutoff-consensus",
    "method": "cutoff-consensus",
    "label": "Pixel cutoff: Multiple cutoffs",
    "module": "./adapter.mjs",
    "index": "color-exploration-cutoff-1024-real-v1",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 5,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-cutoff-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "4e438b8421eab213e956b211dbf6ffeca317063aa51115ac14b0c635352b6cd4",
    "exploration/registry.mjs": "12b65c0c5aa988db4daa790f852190ea9036779365131615977e0d88007ca460",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "a0b3945cb14674bfe111eed207d236e570f9a0adb4bc8e98dba645c78c92e83f",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "887d6b0f1636a1e457af26885ad93500318e8b1acbda15fe776e80a4fb687ac7",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045"
  }
}
```

### Pixel cutoff: All cutoffs

Run: [2026-09-21T21-23-26.350Z-9d77559f](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html). Candidate: cutoff-all-levels.

```json
{
  "configuration": {
    "id": "cutoff-all-levels",
    "method": "cutoff-all-levels",
    "label": "All five cutoffs · registered default",
    "module": "./adapter.mjs",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-cutoff-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "f816817388433d239ced7a79f4e45a7f33a2333cd81a668292f18b722eb0783d",
    "exploration/registry.mjs": "12b65c0c5aa988db4daa790f852190ea9036779365131615977e0d88007ca460",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "9529ea681364384cb7b27740f2952a0f6cfaa75bc67e272c22ce68f7b4c392ba",
    "exploration/quality-curve.mjs": "01f9e76c7482979272bb8d78141077b7be7decdbe6f001c210f64c821f29e7eb",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "413cd7664a5d87e6c17952fe7386366dfa077c8be2cdc2d58f0c64a0ebc27195",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-blend.mjs": "b4dbf5d041a44ab3270e3ecd12aa5e7c788656ede601c7bd91af6e636bcb9357",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045"
  }
}
```

### All cutoffs: shade-aware

Run: [2026-09-21T23-14-33.424Z-046c06d3](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html). Candidate: cutoff-shade-all-levels.

```json
{
  "configuration": {
    "id": "cutoff-shade-all-levels",
    "method": "cutoff-shade-all-levels",
    "label": "Existing shade-aware · registered default",
    "module": "./adapter.mjs",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-shade-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "af88ad8cb79e3907a7ff50798383a8c2b95f443629be825d20b90acae310906b",
    "exploration/registry.mjs": "63122832bd1314a8914fc8da72cb759475a6f86e2901cb46b4179a475f9f8e27",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "9529ea681364384cb7b27740f2952a0f6cfaa75bc67e272c22ce68f7b4c392ba",
    "exploration/quality-curve.mjs": "01f9e76c7482979272bb8d78141077b7be7decdbe6f001c210f64c821f29e7eb",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "9800c19a656ea685e83a00a57f3f8af81d4f15f6725ed8a9ade609ccbd5336b3",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-blend.mjs": "b4dbf5d041a44ab3270e3ecd12aa5e7c788656ede601c7bd91af6e636bcb9357",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045",
    "exploration/shade-definition.mjs": "b4c0b5b0513c191390b1fb3ca6784584cc52dd3452041e28fe7278e09250943f",
    "exploration/shade-index.mjs": "6bd2a2d1cfff3426ce3ca70490639ec388b2d9885f13a75edefacf0b5da19117",
    "exploration/hue-definition.mjs": "9f7123bfa540fc847f97892248a42f535b24f02b5bd0587f53bba7028ab3c73c",
    "exploration/hue-index.mjs": "ce38441960b5775101cac87ac6945dc4e49c18bf16f50b403a3a4b2a9296e426"
  }
}
```

### All cutoffs: shade-aware + strict hue

Run: [2026-09-21T23-14-33.424Z-046c06d3](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html). Candidate: cutoff-shade-hue-all-levels.

```json
{
  "configuration": {
    "id": "cutoff-shade-hue-all-levels",
    "method": "cutoff-shade-hue-all-levels",
    "label": "Shade-aware with stricter hue · registered default",
    "module": "./adapter.mjs",
    "parameters": {}
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-shade-hue-1024-real-v1",
    "version": "2.11.0",
    "topology": {
      "nodes": 1,
      "primaryShards": 1,
      "jvmHeapMaxBytes": [
        2147483648
      ]
    },
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "datasetHash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
  "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
  "sourceHashes": {
    "exploration/adapter.mjs": "af88ad8cb79e3907a7ff50798383a8c2b95f443629be825d20b90acae310906b",
    "exploration/registry.mjs": "63122832bd1314a8914fc8da72cb759475a6f86e2901cb46b4179a475f9f8e27",
    "exploration/methods.mjs": "1020632d09d5d1e9760d0825c9fa3cd3912bc45543df75805ba6cda9364830a5",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
    "exploration/methods-overlap.mjs": "9529ea681364384cb7b27740f2952a0f6cfaa75bc67e272c22ce68f7b4c392ba",
    "exploration/quality-curve.mjs": "01f9e76c7482979272bb8d78141077b7be7decdbe6f001c210f64c821f29e7eb",
    "exploration/overlap-index.mjs": "8113de104d7e8079aac0d973b3c8feb44718ba2be7091ff3087a77fa34d40194",
    "exploration/overlap-regions.mjs": "fa1b265e0f5a7c06624df04e08061ecd9b6b80267e9639f00e0dfe42394b5906",
    "exploration/overlap-banks.mjs": "661284ebe268353c5337877cc34f38bf9b84ceab17cfb58d87da077d71fb8018",
    "exploration/overlap-bucket-index.mjs": "e6fe315cd7436be2799f74da0b58a79ec40a07bba5c2288e5867d0ddc5b6eef6",
    "exploration/methods-cutoff.mjs": "9800c19a656ea685e83a00a57f3f8af81d4f15f6725ed8a9ade609ccbd5336b3",
    "exploration/cutoff-definition.mjs": "2ddb90e261cb03e94e66fc9ccae720e284c690ace8ae19f579fc53a283514ab4",
    "exploration/cutoff-blend.mjs": "b4dbf5d041a44ab3270e3ecd12aa5e7c788656ede601c7bd91af6e636bcb9357",
    "exploration/cutoff-index.mjs": "a6ba4b7eee7e4ea7799840beb51b9d727acf60533c0f3094f19e244fa574f045",
    "exploration/shade-definition.mjs": "b4c0b5b0513c191390b1fb3ca6784584cc52dd3452041e28fe7278e09250943f",
    "exploration/shade-index.mjs": "6bd2a2d1cfff3426ce3ca70490639ec388b2d9885f13a75edefacf0b5da19117",
    "exploration/hue-definition.mjs": "9f7123bfa540fc847f97892248a42f535b24f02b5bd0587f53bba7028ab3c73c",
    "exploration/hue-index.mjs": "ce38441960b5775101cac87ac6945dc4e49c18bf16f50b403a3a4b2a9296e426"
  }
}
```

### Scale artifacts

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/scale/2026-09-20T00-51-14.799Z/scale.json`: Finished 2026-09-20T01:43:30.182Z. Source hashes and full source snapshots were not captured at this baseline run’s start. Later working files cannot establish its original exact source.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": 1,
    "shardsPerIndex": 1,
    "replicas": 0,
    "cpuLimit": 8,
    "containerMemoryGiB": 12,
    "javaHeapGiB": 4
  },
  "configuration": {
    "counts": [
      1000,
      10000,
      100000,
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 3,
    "methods": [
      "hsv-cosine-ann",
      "hsv-l2-raw-ann",
      "hsv-l2-unit-ann",
      "hsv-hellinger-ann",
      "rgb-hellinger-ann",
      "rgb-cosine-ann",
      "hsv-cosine-exact",
      "rgb-kernel-exact",
      "palette-area-exact",
      "histogram-area-exact",
      "histogram-composition-exact",
      "native-area-linear",
      "native-area-gauss",
      "native-area-postings",
      "feature-composition-exact",
      "rgb-cdf-wasserstein"
    ],
    "groups": {
      "features": {
        "index": "color-exploration-scale-features-v1",
        "fields": [
          "rgb4096",
          "pixel_total",
          "palette32_packed",
          "palette_total",
          "coverage_tokens",
          "rgb_cdf48_packed",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow"
        ]
      },
      "vectors": {
        "index": "color-exploration-scale-vectors-v1",
        "fields": [
          "hsv_cosine",
          "hsv_l2",
          "hsv_sqrt",
          "rgb_cosine",
          "rgb_sqrt"
        ]
      }
    }
  }
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/scale/2026-09-20T01-45-32.439Z/scale.json`: Finished 2026-09-20T01:56:24.987Z. Source hashes recorded; no archived source directory is identified in this artifact.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": 1,
    "shardsPerIndex": 1,
    "replicas": 0,
    "cpuLimit": 8,
    "containerMemoryGiB": 12,
    "javaHeapGiB": 4
  },
  "configuration": {
    "counts": [
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 1,
    "durationMs": 0,
    "methods": [
      "feature-composition-bounded",
      "histogram-area-typed",
      "histogram-composition-typed",
      "rgb-kernel-typed",
      "palette-area-typed",
      "palette-transport-exact",
      "feature-intent-balanced",
      "histogram-intent-balanced",
      "feature-intent-bounded",
      "hybrid-intent-bounded",
      "palette-direct-balanced",
      "palette-direct-precision",
      "hybrid-relative-accents",
      "hsv-cosine-k500-ann",
      "rgb-cosine-k500-ann",
      "palette-precision-bounded",
      "hybrid-indexed-precision",
      "palette-precision-typed",
      "palette-precision-bounded-typed",
      "hybrid-indexed-typed"
    ],
    "groups": {
      "features": {
        "index": "color-exploration-scale-features-v1",
        "fields": [
          "rgb4096",
          "pixel_total",
          "palette32_packed",
          "palette_total",
          "coverage_tokens",
          "rgb_cdf48_packed",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow"
        ]
      },
      "vectors": {
        "index": "color-exploration-scale-vectors-v1",
        "fields": [
          "hsv_cosine",
          "hsv_l2",
          "hsv_sqrt",
          "rgb_cosine",
          "rgb_sqrt"
        ]
      },
      "refined": {
        "index": "color-exploration-scale-refined-v1",
        "fields": [
          "palette32_packed",
          "palette_total",
          "palette_cells",
          "coverage_tokens",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow",
          "rel_sample_width",
          "rel_sample_height",
          "rel_pixel_total",
          "rel_l_mean",
          "rel_l_median",
          "rel_l_p95",
          "rel_l_p99",
          "rel_l_p999",
          "rel_l_max",
          "rel_span_p99",
          "rel_span_p999",
          "rel_highlight_10_area",
          "rel_highlight_20_area",
          "rel_highlight_30_area",
          "rel_highlight_10_contrast",
          "rel_highlight_tail_area",
          "rel_dark_background",
          "rel_dark_area50"
        ]
      }
    }
  },
  "sourceSnapshotHash": "bf8296ff03b14a1d0f79bb976a3afd57a0433f758a5de0096bd16dcaef09fbab"
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/scale/2026-09-20T02-25-41.635Z/scale.json`: Finished 2026-09-20T02:29:41.993Z. Source hashes recorded; no archived source directory is identified in this artifact.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": 1,
    "shardsPerIndex": 1,
    "replicas": 0,
    "cpuLimit": 8,
    "containerMemoryGiB": 12,
    "javaHeapGiB": 4
  },
  "configuration": {
    "counts": [
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 3,
    "durationMs": 0,
    "mergeWaitSeconds": 300,
    "methods": [
      "palette-precision-precomputed",
      "palette-precision-bounded-precomputed",
      "hybrid-indexed-precomputed",
      "native-quality-linear",
      "native-quality-asymmetric"
    ],
    "groups": {
      "features": {
        "index": "color-exploration-scale-features-v1",
        "fields": [
          "rgb4096",
          "pixel_total",
          "palette32_packed",
          "palette_total",
          "coverage_tokens",
          "rgb_cdf48_packed",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow"
        ]
      },
      "vectors": {
        "index": "color-exploration-scale-vectors-v1",
        "fields": [
          "hsv_cosine",
          "hsv_l2",
          "hsv_sqrt",
          "rgb_cosine",
          "rgb_sqrt"
        ]
      },
      "precomputed": {
        "index": "color-exploration-scale-precomputed-v1",
        "fields": [
          "palette32_packed",
          "palette_total",
          "palette_cells",
          "palette_lab_lw",
          "palette_lab_ab",
          "coverage_tokens",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow",
          "rel_sample_width",
          "rel_sample_height",
          "rel_pixel_total",
          "rel_l_mean",
          "rel_l_median",
          "rel_l_p95",
          "rel_l_p99",
          "rel_l_p999",
          "rel_l_max",
          "rel_span_p99",
          "rel_span_p999",
          "rel_highlight_10_area",
          "rel_highlight_20_area",
          "rel_highlight_30_area",
          "rel_highlight_10_contrast",
          "rel_highlight_tail_area",
          "rel_dark_background",
          "rel_dark_area50"
        ]
      },
      "refined": {
        "index": "color-exploration-scale-refined-v1",
        "fields": [
          "palette32_packed",
          "palette_total",
          "palette_cells",
          "coverage_tokens",
          "cov_red",
          "quality_red",
          "cov_orange",
          "quality_orange",
          "cov_yellow",
          "quality_yellow",
          "cov_green",
          "quality_green",
          "cov_teal",
          "quality_teal",
          "cov_cyan",
          "quality_cyan",
          "cov_blue",
          "quality_blue",
          "cov_purple",
          "quality_purple",
          "cov_pink",
          "quality_pink",
          "cov_brown",
          "quality_brown",
          "cov_black",
          "quality_black",
          "cov_gray",
          "quality_gray",
          "cov_white",
          "quality_white",
          "cov_grayscale",
          "quality_grayscale",
          "cov_strict_grayscale",
          "quality_strict_grayscale",
          "cov_near_neutral",
          "quality_near_neutral",
          "cov_dark",
          "quality_dark",
          "cov_light",
          "quality_light",
          "cov_bright",
          "quality_bright",
          "cov_vivid",
          "quality_vivid",
          "cov_muted",
          "quality_muted",
          "cov_monochromatic",
          "quality_monochromatic",
          "cov_rainbow",
          "quality_rainbow",
          "rel_sample_width",
          "rel_sample_height",
          "rel_pixel_total",
          "rel_l_mean",
          "rel_l_median",
          "rel_l_p95",
          "rel_l_p99",
          "rel_l_p999",
          "rel_l_max",
          "rel_span_p99",
          "rel_span_p999",
          "rel_highlight_10_area",
          "rel_highlight_20_area",
          "rel_highlight_30_area",
          "rel_highlight_10_contrast",
          "rel_highlight_tail_area",
          "rel_dark_background",
          "rel_dark_area50"
        ]
      }
    }
  },
  "sourceSnapshotHash": "0f70e1dc745113363862be0af65bcf625bad64efe5c4fd30fa2e952e7985f3ca"
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/rank-feature-scale/2026-09-20T01-58-20.990Z/scale.json`: Finished 2026-09-20T02:23:41.669Z. Source hashes and archived invocation sources are recorded.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": {
      "Ux7CyBPpS2alTjLoFKqbYQ": {
        "name": "8e048ff78dd1",
        "os": {
          "available_processors": 32,
          "allocated_processors": 32
        },
        "process": {
          "refresh_interval_in_millis": 1000,
          "id": 105,
          "mlockall": false
        },
        "jvm": {
          "mem": {
            "heap_max_in_bytes": 4294967296
          }
        }
      }
    }
  },
  "configuration": {
    "index": "color-exploration-rank-feature-scale-v1",
    "counts": [
      1000,
      10000,
      100000,
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 4,
    "durationSeconds": 0,
    "batchSize": 50,
    "seed": 99539473,
    "rerun": false,
    "limit": 20
  }
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/clickhouse-scale/2026-09-20T02-54-39.077Z/scale.json`: Finished 2026-09-20T02:58:26.630Z. Source hashes and an archived source snapshot are recorded.

```json
{
  "engine": "clickhouse",
  "version": "26.3.9.8",
  "table": "color_exploration_scale_v1",
  "topology": {
    "nodes": 1,
    "cpuLimit": 8,
    "containerMemoryGiB": 12,
    "maxThreadsPerRequest": 8,
    "hostname": "d96044c4ca3a",
    "engine": "MergeTree"
  },
  "configuration": {
    "counts": [
      1000,
      10000,
      100000,
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 12,
    "durationMs": 10000,
    "mergeWaitSeconds": 30,
    "filtered": true,
    "indexOnly": false,
    "maxThreadsPerRequest": 8,
    "queryCache": false,
    "serverTimeoutMs": 950,
    "timeoutBeforeCheckingExecutionSpeed": 0,
    "clientTimeoutMs": 5000
  },
  "sourceSnapshot": "/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/clickhouse-scale/2026-09-20T02-54-39.077Z/source-snapshot.json",
  "sourceSnapshotHash": "5fbd7ae1f7ae619a8a1dcd3311fd9bd76b845ce2b5e0874312666b7a67ee900a"
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/clickhouse-scale/2026-09-20T03-00-08.903Z/scale.json`: Finished 2026-09-20T03:01:04.291Z. Source hashes and an archived source snapshot are recorded.

```json
{
  "engine": "clickhouse",
  "version": "26.3.9.8",
  "table": "color_exploration_scale_v1",
  "topology": {
    "nodes": 1,
    "cpuLimit": 8,
    "containerMemoryGiB": 12,
    "maxThreadsPerRequest": 1,
    "hostname": "d96044c4ca3a",
    "engine": "MergeTree"
  },
  "configuration": {
    "counts": [
      1000000
    ],
    "concurrencies": [
      1,
      16
    ],
    "repetitions": 12,
    "durationMs": 10000,
    "mergeWaitSeconds": 30,
    "filtered": true,
    "indexOnly": false,
    "maxThreadsPerRequest": 1,
    "queryCache": false,
    "serverTimeoutMs": 950,
    "timeoutBeforeCheckingExecutionSpeed": 0,
    "clientTimeoutMs": 5000
  },
  "sourceSnapshot": "/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/clickhouse-scale/2026-09-20T03-00-08.903Z/source-snapshot.json",
  "sourceSnapshotHash": "6119c2bced44be95bfe67e2c4acfd933a2a6176ee87d270890f4602d7a373dfa"
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/precision-grid-scale/2026-09-20T03-18-52.319Z/scale.json`: Finished 2026-09-20T03:25:44.589Z. Source hashes and archived invocation sources are recorded.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": {
      "Ux7CyBPpS2alTjLoFKqbYQ": {
        "name": "8e048ff78dd1",
        "os": {
          "available_processors": 32,
          "allocated_processors": 32
        },
        "process": {
          "refresh_interval_in_millis": 1000,
          "id": 105,
          "mlockall": false
        },
        "jvm": {
          "mem": {
            "heap_max_in_bytes": 4294967296
          }
        }
      }
    }
  },
  "configuration": {
    "index": "color-exploration-precision-grid-scale-v1",
    "counts": [
      1000,
      10000,
      100000,
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 4,
    "durationSeconds": 0,
    "batchSize": 100,
    "seed": 99539473,
    "rerun": false,
    "limit": 20,
    "mergeWaitSeconds": 300
  }
}
```

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-scale/2026-09-21T14-18-19.063Z/scale.json`: Finished 2026-09-21T14:47:52.150Z. Source hashes and archived invocation sources are recorded.

```json
{
  "engine": "opensearch",
  "version": {
    "distribution": "opensearch",
    "number": "2.11.0",
    "build_type": "tar",
    "build_hash": "4dcad6dd1fd45b6bd91f041a041829c8687278fa",
    "build_date": "2023-10-13T02:55:55.511945994Z",
    "build_snapshot": false,
    "lucene_version": "9.7.0",
    "minimum_wire_compatibility_version": "7.10.0",
    "minimum_index_compatibility_version": "7.0.0"
  },
  "topology": {
    "nodes": {
      "Ux7CyBPpS2alTjLoFKqbYQ": {
        "name": "8e048ff78dd1",
        "os": {
          "available_processors": 32,
          "allocated_processors": 32
        },
        "process": {
          "refresh_interval_in_millis": 1000,
          "id": 31,
          "mlockall": false
        },
        "jvm": {
          "mem": {
            "heap_max_in_bytes": 4294967296
          }
        }
      }
    }
  },
  "configuration": {
    "index": "color-exploration-overlap-scale-v1",
    "counts": [
      1000,
      10000,
      100000,
      1000000
    ],
    "concurrencies": [
      1,
      4,
      16
    ],
    "repetitions": 2,
    "durationSeconds": 10,
    "batchSize": 250,
    "seed": 99539473,
    "rerun": false,
    "limit": 20,
    "mergeWaitSeconds": 300
  }
}
```


### Excluded attempts

- palette-direct-balanced, [2026-09-20T01-05-55.159Z-0406f877](http://zerotwo:8224/2026-09-20T01-05-55.159Z-0406f877/report.html): Invalid first round4 integration attempt: zero supported cases; superseded by corrected integration.
- palette-direct-precision, [2026-09-20T01-05-55.159Z-0406f877](http://zerotwo:8224/2026-09-20T01-05-55.159Z-0406f877/report.html): Invalid first round4 integration attempt: zero supported cases; superseded by corrected integration.
- rank-features-area, [2026-09-20T01-05-55.159Z-0406f877](http://zerotwo:8224/2026-09-20T01-05-55.159Z-0406f877/report.html): Invalid first round4 integration attempt: zero supported cases; superseded by corrected integration.
- rank-features-vibe, [2026-09-20T01-05-55.159Z-0406f877](http://zerotwo:8224/2026-09-20T01-05-55.159Z-0406f877/report.html): Invalid first round4 integration attempt: zero supported cases; superseded by corrected integration.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.
- cutoff-shade-hue-all-levels, [2026-09-21T23-04-54.211Z-070d8d5c](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): Feedback execution contains errors; retained as an excluded attempt.

### All saved feedback reports

- [Color search development evaluation](http://zerotwo:8224/2026-09-20T00-02-45.056Z-bbcaf7e0/report.html): 2026-09-20T00-02-45.056Z-bbcaf7e0; 127 assets; 3 configurations.
- [Existing formulas through real OpenSearch: loop integration check](http://zerotwo:8224/2026-09-20T00-04-40.946Z-4f7c77ee/report.html): 2026-09-20T00-04-40.946Z-4f7c77ee; 127 assets; 3 configurations.
- [Round 1: sixteen OpenSearch methods on 545 assets](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html): 2026-09-20T00-50-38.374Z-32d2dbb7; 545 assets; 16 configurations.
- [Round 2: equivalent optimizations, transport and intent refinements](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html): 2026-09-20T01-00-54.214Z-9ee49dbd; 545 assets; 10 configurations.
- [Round 3: objective sensitivity sweep (development cases only)](http://zerotwo:8224/2026-09-20T01-03-08.336Z-08292a68/report.html): 2026-09-20T01-03-08.336Z-08292a68; 545 assets; 36 configurations.
- [Round 4: direct palette precision and indexed utility profiles](http://zerotwo:8224/2026-09-20T01-05-55.159Z-0406f877/report.html): 2026-09-20T01-05-55.159Z-0406f877; 545 assets; 4 configurations.
- [Round 4 corrected integration: direct palette and indexed utilities](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html): 2026-09-20T01-07-33.778Z-ba9d2951; 545 assets; 4 configurations.
- [Round 5: relative highlights, indexed named colors and shade-first precision](http://zerotwo:8224/2026-09-20T01-11-36.841Z-66d53e54/report.html): 2026-09-20T01-11-36.841Z-66d53e54; 545 assets; 1 configurations.
- [Round 6: wider ANN retrieval after measured recall losses](http://zerotwo:8224/2026-09-20T01-12-38.947Z-86945d5c/report.html): 2026-09-20T01-12-38.947Z-86945d5c; 545 assets; 2 configurations.
- [Round 7: exact global indexed bounds for picked-color precision](http://zerotwo:8224/2026-09-20T01-18-35.608Z-adff6e8d/report.html): 2026-09-20T01-18-35.608Z-adff6e8d; 545 assets; 2 configurations.
- [Round 8: typed direct precision and exact bounded hybrid](http://zerotwo:8224/2026-09-20T01-39-31.955Z-22f2b24e/report.html): 2026-09-20T01-39-31.955Z-22f2b24e; 545 assets; 3 configurations.
- [Round 9: indexed OKLab centroids with guarded range boundaries](http://zerotwo:8224/2026-09-20T01-54-56.947Z-a6ad72cd/report.html): 2026-09-20T01-54-56.947Z-a6ad72cd; 545 assets; 3 configurations.
- [Round 10: native quality and asymmetric area refinements](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html): 2026-09-20T01-55-38.776Z-219058ec; 545 assets; 3 configurations.
- [Round 11: cached doc values with duplicate-safe indexed OKLab](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html): 2026-09-20T02-20-53.169Z-b5b47212; 545 assets; 3 configurations.
- [Round 11: ClickHouse exact picked-color palette precision](http://zerotwo:8224/2026-09-20T02-45-21.426Z-c8b05700/report.html): 2026-09-20T02-45-21.426Z-c8b05700; 545 assets; 1 configurations.
- [Round 12: ClickHouse exact palette precision with wall-clock deadline](http://zerotwo:8224/2026-09-20T02-52-07.682Z-6faa9adb/report.html): 2026-09-20T02-52-07.682Z-6faa9adb; 545 assets; 1 configurations.
- [Round 13: Native indexed picked-color grid](http://zerotwo:8224/2026-09-20T03-06-53.036Z-cafdbda3/report.html): 2026-09-20T03-06-53.036Z-cafdbda3; 545 assets; 1 configurations.
- [Round 14: Grid precision with explicit dedicated-index provenance](http://zerotwo:8224/2026-09-20T03-13-00.884Z-c2f20177/report.html): 2026-09-20T03-13-00.884Z-c2f20177; 545 assets; 1 configurations.
- [Overlapping-regions-1024-coverage-quality](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html): 2026-09-21T14-18-17.584Z-526f791b; 545 assets; 4 configurations.
- [Overlapping coverage/quality: 16, 64, 256 and 1024 buckets](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html): 2026-09-21T16-35-36.773Z-ddf75f70; 545 assets; 8 configurations.
- [Pixel membership: 4 profiles × 5 cutoffs × 4 bucket counts × 2 named modes + original baselines](http://zerotwo:8224/2026-09-21T18-52-54.244Z-1101fa3a/report.html): 2026-09-21T18-52-54.244Z-1101fa3a; 545 assets; 168 configurations.
- [Cutoff-defaults](http://zerotwo:8224/2026-09-21T19-14-00.182Z-d06fdb5a/report.html): 2026-09-21T19-14-00.182Z-d06fdb5a; 545 assets; 4 configurations.
- [Quality influence 3: original linear versus smooth power](http://zerotwo:8224/2026-09-21T19-57-25.162Z-4756a400/report.html): 2026-09-21T19-57-25.162Z-4756a400; 545 assets; 48 configurations.
- [All five cutoffs: equal through exponential weighting](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html): 2026-09-21T21-23-26.350Z-9d77559f; 545 assets; 49 configurations.
- [Shade-aware versus original all-cutoff color matching](http://zerotwo:8224/2026-09-21T22-29-58.206Z-ceda9d2e/report.html): 2026-09-21T22-29-58.206Z-ceda9d2e; 545 assets; 49 configurations.
- [Stricter hue versus existing shade-aware color matching](http://zerotwo:8224/2026-09-21T23-04-54.211Z-070d8d5c/report.html): 2026-09-21T23-04-54.211Z-070d8d5c; 545 assets; 49 configurations.
- [Stricter hue versus existing shade-aware color matching](http://zerotwo:8224/2026-09-21T23-11-56.676Z-ea2526a6/report.html): 2026-09-21T23-11-56.676Z-ea2526a6; 545 assets; 49 configurations.
- [Canonical shade and stricter-hue defaults on unchanged historical cases](http://zerotwo:8224/2026-09-21T23-14-33.424Z-046c06d3/report.html): 2026-09-21T23-14-33.424Z-046c06d3; 545 assets; 2 configurations.
- [Strong favorite snapshot 001: strict hue, linear 0.5, cutoff weighting 1](http://zerotwo:8224/2026-09-21T23-49-12.493Z-97753239/report.html): 2026-09-21T23-49-12.493Z-97753239; 545 assets; 2 configurations.
