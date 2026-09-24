# Typed histogram scoring experiment

## Question and answer

Can the fine histogram method preserve its complete OpenSearch ranking while avoiding the large overhead of dynamic Painless lookups?

**Yes on the 545-asset corpus.** Unwrapping typed `List` variables before the pixel-bin loop and specializing that loop by target count reduced the histogram composition query's measured p95 from **544.11 ms to 7.90 ms**. Every returned score and ordered ID matched the baseline exactly. This improves an implementation of the same objective; it does not change perceived ranking accuracy.

These methods still inspect every eligible histogram. This measurement establishes neither million-document performance nor concurrent production viability. Those remain separate scale tests.

## Implementation

- `methods-fast.mjs` exports `FAST_METHODS`, `buildFastQuery`, `supportsFast`, and `typedHistogramScript`.
- The original sixteen methods are unchanged.
- Four optional variants cover histogram area, histogram composition, histogram perceptual kernel, and palette area.
- Query membership arrays, region quality, target amounts, union coverage, metadata filtering, scoring formula, and result ordering are unchanged.
- JavaScript compiles the request. OpenSearch performs all document filtering and ranking.
- The script caches typed histogram and parameter row references outside the bin loop. The loop contains no `params` lookups. Target operations are unrolled for one to ten targets.
- The source is specialized by target count and palette/histogram representation, not individual picked colors. Colors stay in request parameters.

## Correctness evidence

`methods-fast.test.mjs` passed its two compiler checks and the enabled real OpenSearch integration check. The latter compared all **545 ordered hits and float scores** for **four variants × five queries**, with exact equality in every comparison.

Queries covered red vibe, 40% green with unspecified remainder, 80% grayscale/20% red, five equal color proportions, and grayscale with red accents. Parameter/filter/sort identity is also checked before replacing the script source.

To include integration checks with the experiment's normal test command:

```sh
COLOR_EXPLORATION_FAST_INTEGRATION=1 make color-exploration-test
```

## Latency evidence

Measured 2026-09-20 against `color-exploration-real-v1` on the real scratch OpenSearch service at port 19216. All 545 assets were eligible.

- Five rotating queries, matching the correctness cases above.
- Three warmups per query and implementation.
- Thirty timed requests per implementation, concurrency one, result limit twenty.
- Baseline/typed request order alternated within each query.
- Wall time includes query compilation, serialization/HTTP, service execution, and response parsing.
- Other agents paused search requests to this service during measurement. The host was shared and not process-isolated.
- No request failures occurred.

| Objective | Baseline p50 | Typed p50 | Baseline p95 | Typed p95 | Typed maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Histogram area | 450.50 ms | 4.74 ms | 484.56 ms | 7.10 ms | 7.72 ms |
| Histogram composition | 450.59 ms | 4.94 ms | 544.11 ms | 7.90 ms | 10.89 ms |
| Histogram perceptual kernel | 450.32 ms | 4.41 ms | 476.31 ms | 8.06 ms | 9.49 ms |
| Palette area | 7.76 ms | 3.19 ms | 13.90 ms | 5.21 ms | 5.33 ms |

OpenSearch-reported mean execution time for histogram composition fell from 455.7 ms to 2.43 ms. Thirty requests provide only a small development latency sample; reported p99 equals the maximum in this sample.

The immutable baseline evaluation remains useful for accuracy. Its original histogram timing should not be used to reject the entire histogram family after this implementation improvement.

Raw requests, samples, server version, and workload details are recorded outside the repository:

`~/.local/share/wallpaperdb/color-evaluation/exploration/fast-script-benchmark.json`

## Next decision

Register these as explicitly named refinements, rerun the feedback loop, and measure their growth on the scale corpus. Preserve the exhaustive implementation as an objective/recall reference even if its million-document latency fails the one-second requirement. A small-corpus speedup is not a global-ranking shortcut or a scalability guarantee.
