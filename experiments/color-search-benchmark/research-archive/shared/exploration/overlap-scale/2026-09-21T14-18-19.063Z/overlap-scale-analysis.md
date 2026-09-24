# Overlapping coverage/quality: completed scale campaign

Source: `scale.json`, finished 2026-09-21T14:47:52.150Z. This analysis reads the saved artifact only. Reproducible transformation: `overlap-scale-analysis.jq`; complete derived data: `overlap-scale-analysis.json`.

## One million documents

Both variants pass this campaign at concurrency1 and4, and **fail at concurrency16**. The two failures are five-color percentage queries. Successful-request p95 alone hides the failures.

| Variant | Concurrency | Attempts | p95 ms | Maximum ms | Timeouts | ≥1 second | Unique strict failures | Attempt throughput/s | OpenSearch CPU ms/attempt | Client CPU ms/attempt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Dense | 1 | 121 | 341.70 | 358.55 | 0 | 0 | 0 | 12.08 | 83.14 | 2.30 |
| Dense | 4 | 486 | 346.80 | 368.98 | 0 | 0 | 0 | 47.45 | 81.95 | 1.96 |
| Dense | 16 | 748 | 831.60 | 1083.64 | 7 | 6 | 11 | 71.94 | 110.63 | 1.83 |
| Hybrid | 1 | 124 | 337.13 | 347.19 | 0 | 0 | 0 | 12.36 | 81.85 | 1.32 |
| Hybrid | 4 | 487 | 344.32 | 377.50 | 0 | 0 | 0 | 47.71 | 81.97 | 1.32 |
| Hybrid | 16 | 745 | 826.63 | 1013.42 | 9 | 6 | 13 | 71.68 | 109.95 | 1.43 |

All16 errors were `OpenSearch query timed out; partial hits rejected`. There were12 attempts lasting≥1000ms; four were also timeout errors, so there were24 unique failed attempts. Eight complete responses also exceeded one second. Some rejected timeouts arrived before one second and still fail the criterion.

Every strict failure occurred at one million documents and concurrency16:

| Variant | Query | Timeouts | ≥1 second | Unique strict failures |
|---|---|---:|---:|---:|
| Dense | Five named colors,20% each | 5 | 3 | 7 |
| Dense | Five picked colors,20% each | 2 | 3 | 4 |
| Hybrid | Five named colors,20% each | 3 | 3 | 6 |
| Hybrid | Five picked colors,20% each | 6 | 3 | 7 |

Each of these query shapes had31 attempts per concurrency16 profile. Their median attempt latency was887.63–909.19ms; successful p95 ranged995.72–1021.98ms. Two-color percentage queries followed at approximately478.91–497.79ms p95. All raw failure records remain in the derived JSON.

All192 warmup requests across eight method/stage groups passed; the48 one-million warmups also passed. Warmups are counted once per method/stage, not three times for the concurrency profiles sharing them. All lower-count timed requests passed. Across the complete campaign there were163,981 timed attempts;2,711 were at one million.

## Growth

For a tenfold increase from100,000 to1,000,000 documents:

| Variant | Concurrency | p95 at100k, ms | p95 at1M, ms | Multiplier |
|---|---:|---:|---:|---:|
| Dense | 1 | 39.58 | 341.70 | 8.63× |
| Dense | 4 | 39.99 | 346.80 | 8.67× |
| Dense | 16 | 100.00 | 831.60 | 8.32× |
| Hybrid | 1 | 37.70 | 337.13 | 8.94× |
| Hybrid | 4 | 39.01 | 344.32 | 8.83× |
| Hybrid | 16 | 99.85 | 826.63 | 8.28× |

This is substantial slowdown, not effectively constant query time. At concurrency16 observed attempt throughput fell from533–534/s to71.7–71.9/s. The queries use exact native numeric functions over the stored objective; this campaign provides no block-max pruning or sublinear-scaling claim.

## Index and resources

- Cumulative measured indexing time: **1,496.97s (24.95 minutes)**, excluding interleaved query profiles and waits. The900k final addition took1,346.44s at668.43 documents/s.
- Saved one-million storage snapshot: **16,455,916,608 bytes**, or16.46GB/15.33GiB, approximately16.46kB per document;39 segments, one primary, zero replicas, `_source` disabled.
- The1k storage snapshot says208 bytes despite1k visible documents; treat that early snapshot as pre-flush/stale and do not extrapolate it. Storage changes across stages also reflect segment/merge state.
- Whole-process OpenSearch CPU averaged81.85–83.14ms per attempted query at concurrency1/4, and109.95–110.63ms at concurrency16. These include background activity, not isolated query profiling.
- Sampled OpenSearch heap peaks ranged1.52–2.72GiB for the six one-million profiles, against a4GiB heap. Sampling roughly once per second can miss peaks and excludes native memory/page cache.
- Sampled benchmark-client RSS peaked374–406MiB. The client had also prepared/indexed data and retained corpus descriptors; this is not production gateway memory or a per-query allocation measurement. Client CPU averaged1.32–2.30ms per attempt.
- The saved node reports32 allocated processors; that field does not prove the Docker CPU quota. Verify deployment limits from separate container configuration evidence.

## Limits of this result

The one million documents are deterministic mixtures of545 measured descriptors, not one million independent photographs. Each profile is a short10-second closed-loop run, so it is not a production arrival-rate guarantee. Percentiles describe successful requests; errors remain separately counted. The corpus diversity/arrival checks are separate experiments and must not replace these failures. No extrapolation to100million documents is justified.
