# Preserve duplicate target weights without reindexing

## Decision proposed

Add three separately named query wrappers: `favorite-utility-numeric-multiplicity`, `favorite-utility-sorted-multiplicity`, and `favorite-utility-bounded-multiplicity`. Keep every preserved method intact. Use existing numeric indexes; sorted/bounded parents still use the point-enabled index.

Group identical **resolved utility fields**, retaining the original target count as denominator. Encode a group's multiplicity inside `field_value_factor.factor`, not as an outer query boost. The field includes anchor or named feature, requested percentage, quality setting and cutoff setting.

For example, three equally weighted requested targets resolving to red20, red20, blue20 should compute `(2/3 × U(red20)) + (1/3 × U(blue20))`. Red20 and red40 are separate utilities. Two red50 requests remain requests for the red50 utility; this proposal does not reinterpret them as red100.

This restores the intended mathematical mean. Grouping changes float32 rounding relative to an ideal repeated-term sum. It intentionally changes the known erroneous score when targets resolve to one field. Distinct fields keep the parent body byte-for-byte, including filters, sort, limits and fetch behavior.

## Evidence and cause

The saved `execution-fidelity/audit-independent-v1.json` confirms literal duplicates and nearby red colors resolving to one anchor receive half the intended two-target score. The original preserved method and numeric method agree on that erroneous value. Their mutual agreement therefore does not establish intended arithmetic correctness.

Lucene 9.7 merges identical Boolean SHOULD clauses by adding their boosts. [BooleanQuery source, lines378–407](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/BooleanQuery.java)

OpenSearch2.11's function-score implementation passes that boost to its inner query. With replacement scoring, the final function value replaces the inner query score. This explains why the merged query loses multiplicity. [FunctionScoreQuery source, lines319–341 and497–516](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FunctionScoreQuery.java)

Putting multiplicity into the field factor makes it part of the function's value, independently of the outer query boost. The factor is a float; multiplying the numeric field by it occurs in double precision before the function score's float conversion. [FieldValueFactorFunction source, lines51–54 and98–125](https://raw.githubusercontent.com/opensearch-project/OpenSearch/2.11.0/server/src/main/java/org/opensearch/common/lucene/search/function/FieldValueFactorFunction.java)

Do not blindly change rank-feature wrappers: their boost handling is different, and the current duplicate diagnostics did not establish a matching defect there. This proposal is restricted to numeric field-value-factor parents.

## Bound compatibility

The initial proposal keeps the existing bounded executor unchanged for distinct utility fields. For duplicate utility fields, it issues one complete corrected OpenSearch query without pruning. That remains globally exact for the corrected stored objective: no shortlist or local reranking. This fallback can cost more than bounded execution and needs its own latency measurement.

Do **not** simply replace the old target count by the unique-field count in its threshold. Multiplicities create unequal weights. Do not assume the old float proof applies merely because weights sum to one mathematically.

A later bounded variant can preserve pruning using a threshold computed from the actual grouped float weights. Let `w_g = float32(count_g / N)` and assume indexed utilities are float32 values in[0,1]. Its service objective is approximately `float32(sum_g float32(u_g × w_g))`, with the service's actual float accumulation path verified during implementation. Lucene's ordinary disjunction scorer sums into a double before its final float cast. [DisjunctionSumScorer source](https://raw.githubusercontent.com/apache/lucene/releases/lucene/9.7.0/lucene/core/src/java/org/apache/lucene/search/DisjunctionSumScorer.java)

A conservative upper envelope, avoiding dependence on addition order, is:

1. For each group use `p_g(x) = nextFloatUp(float32(x × w_g))`.
2. Start `upper=0`, then repeatedly set `upper=nextFloatUp(float32(upper+p_g(x)))`.
3. Binary-search float32 x in[0,1] for the smallest x whose upper envelope reaches the seed kth score restored to float32.
4. Keep the OR filter `any unique utility >= x`, inclusively retaining ties. If the lower bound is zero or cannot be safely represented, run the complete query.

Each positive outward-rounded addition bounds the exact sum of its inputs. If all utilities are below the chosen threshold, each is at most the preceding float32 value, whose upper envelope is below the kth seed score. Such a document cannot win. This is a proposed proof outline; it is **not implemented or service-validated** in this patch. Distinct-target execution should continue delegating to the existing executor to preserve existing benchmark requests exactly.

## Offline checks completed

`make -f <this directory>/Makefile test` passes6/6. Tests use external staging with absolute imports into the frozen worktree; no worktree files or services were changed.

- Literal duplicates and distinct hex colors resolving to one anchor get a single factor1 term.
- Red/red/blue gets factors2/3 and1/3; distinct requested amounts stay separate.
- All144 existing query/preset combinations, for each of the three wrapper parents, retain byte-identical bodies.
- All8,184 wide workload bodies retain byte-identical bodies: **none contains duplicate resolved utility keys**. Therefore this correction does not change that workload's service query.
- Unknown numeric clause shapes reject instead of rewriting part of an unfamiliar objective.
- Duplicate bounded queries use a complete corrected global query; distinct targets delegate unchanged. Transport order, timeouts, abort signal and ID doc-value decoding are preserved.

The proposal source, tests, unapplied new-files patch, test output and31-file source hash manifest are in this directory. No corrected query has yet run against OpenSearch.

## Next service validation

Use a new external artifact directory and the existing545-image indexes. Compare corrected duplicate scores against an independent grouped arithmetic oracle, include mixed multiplicities and nearby-anchor collisions, and retain the old erroneous output as diagnostic evidence. Check all ordinary cases against the preserved parent. Measure duplicate fallback latency separately. A later pruning variant must prove and test its weighted bound, PIT consistency, zero/tie behavior, filters, cancellation and full-corpus ranking agreement.
