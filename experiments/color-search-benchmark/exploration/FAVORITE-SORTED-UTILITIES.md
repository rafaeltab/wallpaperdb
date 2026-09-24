# Favorite numeric-sort experiment

Status: implemented and unit tested; no live index or performance results yet.

Both prototypes retain the existing numeric utility formula, controls, float32 storage, and metadata filters. For a single target, its stored utility is the whole score, so OpenSearch can sort directly on that field. Equal utilities use `id` ascending; a missing value sorts as zero, consistent with the numeric score query. Multiple targets use the unchanged numeric scoring query.

| Method | Single-target execution | Returned score |
| --- | --- | --- |
| `favorite-utility-sorted` | Numeric field sort, `track_scores: false` | First OpenSearch sort value copied unchanged |
| `favorite-utility-sorted-scored` | Same sort, `track_scores: true` | Original OpenSearch `_score` |

The fast adapter never filters or reorders hits. It only exposes the server's sort value in the common response shape. Use `searchFavoriteSortedUtilities(...)` or the exported decoder when integrating it; the ordinary `searchIndex` correctly rejects its null `_score` values.

## Why two variants?

OpenSearch supports field sorting with optional score tracking and a custom missing value. [OpenSearch 2.11 sorting documentation](https://docs.opensearch.org/2.11/search-plugins/searching-data/sort/)

Lucene's numeric comparator can skip uncompetitive documents using indexed numeric points. The new mapping enables both `index: true` and `doc_values: true` for each existing float utility, and disables stored source. It requires a separate index. [Lucene 9.7 numeric comparator](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/comparators/NumericComparator.java)

The score-tracking control has an important implementation cost: OpenSearch 2.11 adds a maximum-score collector alongside the field-sort collector, and that collector requests complete scoring. [OpenSearch collector construction](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/search/query/TopDocsCollectorContext.java#L426), [maximum-score collector](https://github.com/opensearch-project/OpenSearch/blob/2.11.0/server/src/main/java/org/opensearch/action/search/MaxScoreCollector.java#L54)

Lucene combines differing collector score modes into a complete mode; its combined leaf collector does not forward the numeric competitive iterator. Our inference is that preserving `track_scores: true` defeats the main skipping opportunity here. This makes it a useful control, while the variant without score tracking is the performance candidate. A real OpenSearch profile and benchmark must establish the actual benefit. [Lucene multi-collector](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/MultiCollector.java)

## Boundaries

- Single-target rankings should match the existing numeric utility objective exactly; they still inherit its rounding differences from the original five-layer scorer.
- Multi-target searches receive no numeric-sort optimization.
- Numeric points add indexing work and storage. This prototype makes no measured size or speed claim.
- Filtering, score ties, and segment layout can affect skipping.
- Normalizing a server sort value is part of the adapter latency and must remain inside the measured request boundary.

## Verification

`make color-favorite-sorted-test`: six tests cover mapping isolation, inherited controls, zero values, metadata filtering, unchanged multi-target queries, response order and ties, partial-response rejection, and adapter routing. All passed without service traffic.
