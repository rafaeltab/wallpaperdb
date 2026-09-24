# ANN retrieval recall diagnostic

`make color-exploration-recall` compares the six native vector methods with global exact `knn_score` searches in the same OpenSearch index. Each ANN result ID is independently scored by the exact service query, so native cosine score conversion cannot distort the comparison. No application reranking is used by the prototype.

The diagnostic reports:

- **Strict recall@20:** overlap with the exact top-20 IDs.
- **Tie-aware recall@20:** how many returned IDs meet the exact twentieth-score boundary, accepting alternative members of an equal-score tie.
- Missing slots, exact-score boundary regret, and first-result regret.
- Actual returned size 20 with native `k` 20, 100, and 500, plus isolated single-client timings.

The four intents are red vibe, 40% green, 50% red/50% green, and picked #FF2200. Small-corpus filters use deterministic ID hashes because the real images all share partition 0; scale filters use indexed partition subsets of approximately 10% and 1%. Each nonempty filtered case uses its actual eligible count when fewer than 20 documents exist.

## Real corpus: 545 assets

Artifact: shared `exploration/recall/2026-09-20T01-11-08.096Z-ea35d7c3.json`.

| Method | Worst tie-aware recall, k=20 | k=100 | k=500 |
|---|---:|---:|---:|
| HSV cosine |0.85|1.00|1.00|
| HSV raw L2 |0.90|1.00|1.00|
| HSV unit-sum L2 |1.00|1.00|1.00|
| HSV Hellinger |1.00|1.00|1.00|
| RGB Hellinger |0.95|1.00|1.00|
| RGB cosine |0.85|0.95|1.00|

There were 216 method/query/filter/k records and 648 measured ANN trials, with no query failures. Strict and tie-aware recall agreed in this corpus; the misses were not merely alternate tied IDs. Typical p95 query-call latency was 3–4 ms. Those timings do not establish million-document performance or concurrent throughput.

Every artifact includes source hashes, OpenSearch version, node topology, index settings, initial/final document counts, exact reference hits, ANN hits, exact scores of returned IDs, and per-trial metrics. A count change marks the run as inconsistent; benchmark indexes should remain stable throughout.

Environment controls: `COLOR_EXPLORATION_RECALL_BASE`, `_INDEX`, `_OUTPUT`, `_METHODS`, `_KS`, `_LIMIT`, `_REPEATS`, and `_PROFILES`. Exact reference requests allow 60 seconds because they are a diagnostic oracle, not a proposed production query path.

## Million-document diagnostic

Artifact: shared `exploration/recall/2026-09-20T01-44-09.561Z-7e1ca159.json`.

Ran against the isolated OpenSearch 2.11.0 node on port 19217, index `color-exploration-scale-vectors-v1`, one primary shard, zero replicas, 4 GiB JVM heap. The index contains 1,000,000 **synthetic mixtures of real image descriptors**, not one million distinct wallpapers or new human judgments. Index count stayed unchanged throughout the run. The 10% filter selected 99,743 documents and the 1% filter selected 10,065 documents.

All 216 method/query/filter/k records and 648 measured trials completed without errors or underfilled result pages. The run took 32 seconds, including exact reference work. Every score below comes from OpenSearch; the diagnostic only compares service result IDs and exact service scores afterward.

| Method | Worst tie-aware recall@20, k=20 / 100 / 500 | p95 query-call ms, k=20 / 100 / 500 |
|---|---|---|
| HSV cosine |0.30 / 0.85 / 1.00|9.79 / 22.12 / 33.08|
| HSV raw L2 |0.65 / 0.80 / 1.00|6.19 / 20.39 / 30.13|
| HSV unit-sum L2 |0.90 / 1.00 / 1.00|8.74 / 19.20 / 31.33|
| HSV Hellinger |0.80 / 0.95 / 1.00|8.71 / 20.40 / 37.97|
| RGB Hellinger |0.75 / 0.95 / 0.95|14.19 / 38.51 / 59.41|
| RGB cosine |0.55 / 0.85 / 0.90|14.97 / 49.03 / 67.07|

These are isolated, warmed, single-client diagnostic timings across four queries and three filter profiles. They are separate from the concurrent scale benchmark and do not establish production throughput. Exact 512-dimensional reference searches took up to 3.56 seconds; the oracle deliberately has a longer timeout than the proposed production query budget.

### What the misses mean

Larger native `k` substantially improved agreement with the global vector objective. At `k=500`, all four HSV methods found an equivalent global top 20 in every tested case. Neither RGB method achieved that for every broad query: RGB Hellinger had one wrong boundary result in one query, and RGB cosine had two in the warm-red picked-color query. These are observations on this graph and workload, not a recall guarantee for other queries or indexes.

For RGB cosine, picked #FF2200, no metadata filter, `k=500`, strict and tie-aware recall were both 0.90. The exact twentieth score was 1.3600863; the two lower-scoring returned results had exact scores 1.3594719 and 1.3559481. Their score deficits were 0.0006144 and 0.0041382. Thus the missing matches were not interchangeable equal-score ties. The first result was still globally optimal. Across all `k=20` cases, the maximum first-result score deficit was 0.0115992 for RGB cosine; score deficits belong to their particular vector objective and cannot be compared as perceptual distances across methods.

The worst recall at each `k` occurred on broad queries. Across all methods and queries:

| Eligible subset | Worst tie-aware recall, k=20 / 100 / 500 |
|---|---|
| All 1,000,000 |0.30 / 0.80 / 0.90|
| 99,743 metadata matches |0.60 / 0.85 / 1.00|
| 10,065 metadata matches |1.00 / 1.00 / 1.00|

Forty-five trials had a visible exact-score tie at the twentieth boundary, and nine trials had a higher tie-aware score than strict ID recall. The table uses tie-aware recall to avoid treating equivalent tied documents as retrieval errors. Strict overlap, all exact scores, and per-trial boundary deficits remain in the artifact.

This directly exposes the limitation of using an approximate vector candidate set as the final search result: increasing `k` improves recall but provides no global ordering guarantee. The exact bounded palette prototypes use ANN only to obtain a conservative score threshold, then run a global service query with a mathematically necessary filter; a weak seed makes that filter less selective rather than removing otherwise eligible winners.

Reproduce on an idle scale node:

```sh
COLOR_EXPLORATION_RECALL_BASE=http://127.0.0.1:19217 \
COLOR_EXPLORATION_RECALL_INDEX=color-exploration-scale-vectors-v1 \
make color-exploration-recall
```
