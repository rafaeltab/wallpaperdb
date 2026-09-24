# Source-disabled indexes can still have expensive fetches

## Finding

The precision-fidelity run retrieved all 545 results with `_source:false` and the default stored-ID fetch path. Its source-disabled index does **not** guarantee that large document payloads are absent from stored-field blocks. A later controlled comparison preserved its score/filter/sort behavior and reduced all-document fetching from seconds to milliseconds. The source mechanisms below explain why this fetch path can be expensive; these are diagnostics, not production latency measurements.

When `_source` is disabled or filtered, OpenSearch2.11 stores the original document in the hidden `_recovery_source` field, together with a numeric marker. This permits recovery from operation history. Disabling the user-facing source therefore does not immediately eliminate its storage. [SourceFieldMapper, lines186–200](https://github.com/opensearch-project/OpenSearch/blob/2.11/server/src/main/java/org/opensearch/index/mapper/SourceFieldMapper.java#L186-L200)

Recovery-source pruning is a merge operation. The pruning policy consults its retention query and can keep every source in a segment when every document still qualifies. Reaching zero active merges does not demonstrate that all recovery payloads have been removed. [RecoverySourcePruneMergePolicy, lines63–93](https://github.com/opensearch-project/OpenSearch/blob/2.11/server/src/main/java/org/opensearch/index/engine/RecoverySourcePruneMergePolicy.java#L63-L93)

## Why retrieving only IDs can still hurt

With `_source:false` alone, OpenSearch still creates a stored-field visitor to obtain hit metadata. With `stored_fields:"_none_"`, it skips that visitor and the stored-field read. For at least ten adjacent document IDs, the fetch phase selects its sequential stored-fields reader, which uses the Lucene reader intended for merging. Retrieving every live document is particularly likely to take this path. [FetchPhase, lines142–150,211–222 and311–316](https://github.com/opensearch-project/OpenSearch/blob/2.11/server/src/main/java/org/opensearch/search/fetch/FetchPhase.java#L142-L150)

Lucene's merge-mode reader eagerly decompresses the entire stored block. Normal access also enters the compressed stored-document reader before choosing individual fields, though sliced large documents can be decoded incrementally. Consequently, rejecting `_source` from the response does not establish that large stored payloads were never read or decompressed. This also means the all545 diagnostic and a20-hit user query can have different fetch behavior. [Lucene9.7 stored-fields reader, lines458–472 and485–610](https://github.com/apache/lucene/blob/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/codecs/lucene90/compressing/Lucene90CompressingStoredFieldsReader.java#L458-L610)

## Completed controlled comparison

The `fetch-fidelity-v1` run completed at 2026-09-23 15:36:43 UTC. Numeric, 27-bit and direct-sort variants preserved exact IDs, orders and raw score values across 432 comparisons and 235,440 document scores. An independent audit also checked unchanged request bodies apart from fetch settings, source/reference hashes and before/after index identities.

Twenty-four same-index A/B pairs alternated stored-ID and docvalue-ID retrieval across four query shapes, three methods and two limits. Limit1000 returned all545 documents. Median elapsed times across the four query shapes were:

| Method | All545: stored / docvalue | Top20: stored / docvalue |
| --- | ---: | ---: |
| Numeric | 5,925 /3.69ms | 5.96 /3.36ms |
| 27-bit | 3,741 /6.39ms | 7.10 /6.73ms |
| Direct sort | 1,797 /3.64ms | 9.22 /3.27ms |

All twelve all-document comparisons strongly favored docvalue retrieval, with stored requests above one second and docvalue requests below14ms. Top20 results were mixed: docvalue retrieval was faster in eight of twelve pairs and had a52ms outlier. The paired experiment demonstrates a material fetch-path effect on these indexes. It does not isolate every millisecond to decompression, establish universal top20 gains, or measure concurrent capacity. There was one pair per query/method/limit, not repeated latency sampling.

Evidence is under the external experiment root in `fetch-fidelity-v1/`: complete rankings, request bodies, raw `diagnostics.jsonl`, `fidelity.json`, and `audit-independent-v1.json`. Audit implementation: external `independent-fetch-audit-v1.py`.

## Implementation boundary

For future diagnostics and application queries, request `_source:false`, `stored_fields:"_none_"`, and `docvalue_fields:["id"]`. Read IDs from `fields.id[0]`; default `_id` can be omitted when stored fields are disabled. Validate IDs, scores, result cardinality and ordering exactly as before. This changes fetching, not color scoring, eligibility or the global sort.

The completed comparison verifies identical IDs/scores and records elapsed/service timing. Detailed query/fetch CPU profiling remains separate; the specific decompression mechanism is supported by source rather than a recorded CPU profile.

Storage reports should include the observation time and segment state. Do not project an early all-encoding real index's size onto a selected single-preset1M schema. A merge experiment, if needed, must remain explicitly separate from the naturally settled index; it must not replace the original evidence or hide ingestion and retention costs.

## Production result payload

The current prototype returns IDs and scores, then its visual lab reads image metadata from the retained corpus manifest. A production gateway also needs display metadata. The final query boundary should include that payload, for example by fetching suitable scalar metadata through doc values alongside `id`, or by a measured small metadata lookup. Fetching large stored-field blocks immediately afterward could reintroduce the avoided cost. This integration is not implemented or included in these ID-and-score prototype timings.
