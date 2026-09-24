# Global joint proportions from indexed family unions

**Implemented:** exact hard-area matching for one or two indexed color families using **one numeric doc value for a single family, or three for a pair**. It preserves overlap and excess-area semantics while avoiding per-query scans of each document's 32 palette entries.

This is a fifth prototype alongside the dynamic region script and marginal-coverage approaches. Its query vocabulary is the fixed **18-family bank** exported by `global-native.mjs`. Family area and pairwise union area are measured when documents are prepared. The shared data preparation measures alpha-weighted source-image samples up to 256×256 pixels; these are more detailed than the 32-entry palette, but are still samples rather than every original pixel.

Implementation: [global-joint.mjs](global-joint.mjs). Probe: `make color-global-joint-probe`. Results: [global-joint-probe.json](global-joint-probe.json).

## Why store unions?

Separate family coverage does not reveal overlap. An image can be 40% blue and 40% dark because the same 40% is dark blue. It cannot supply two separate 40% portions from that one patch.

For each pair A and B, store `union(A,B)`: the image fraction belonging to either family. Then their overlap is `coverage(A) + coverage(B) − union(A,B)`. The two marginal fractions and their union determine all four membership areas, so they are sufficient for exact hard two-family transport.

### Mapping

- 18 `covj_<family>` fields.
- 153 `unionj_<first>__<second>` fields, with family IDs sorted lexicographically.
- All 171 fields are `double`, with both indexing and doc values enabled.
- Keyword `id` supplies the deterministic final sort key.

The converter requires every family fraction and union. Missing unions cannot be treated as disjointness. It clamps only numerical drift within `1e-10` and rejects inconsistent unions outside the interval `max(ca,cb)` through `min(1,ca+cb)`. Double storage avoids deliberate percentage bucketing.

## The objective

Let `ca`, `cb` be observed family coverage, `u` their observed **union**, `a`, `b` the requested image fractions, and `Q = a + b`:

```text
accepted = min(Q, u, a + cb, b + ca)

exact error   = max(Q, u) − accepted
minimum error = Q − accepted
```

`accepted` is the maximum area assignable to the requested portions without double counting. The exact objective also penalizes requested-family area that would have to spill into the unspecified remainder. The minimum objective permits extra matching area.

For a single family:

```text
exact error   = abs(coverage − requested)
minimum error = max(0, requested − coverage)
```

The query ranks by `1 − error`. Fractions are absolute and cannot sum above 100%. Duplicate family entries merge. Explicit 0% requests remain meaningful: a single-family exact query at 0% favors absence. Zero error expresses a feasible joint partition, not equality of independent overlapping family coverages to each requested portion.

## Global execution

The query uses an OpenSearch `script_score` around the full metadata-filtered query. Its fixed Painless script reads the relevant one or three fields, evaluates the formula, and returns a nonnegative score. It has no per-palette or transport loop. The entire eligible collection participates; there is no fixed vector candidate set or application reranking stage.

OpenSearch supports Painless script scoring with query parameters. Script scoring requires expensive queries to remain enabled. [OpenSearch script-score documentation](https://docs.opensearch.org/latest/query-dsl/specialized/script-score/)

The sort is `_score` descending, then `id` ascending. **OpenSearch scores are float32**, so extremely close double-precision errors can tie. `jointReference` retains double `cost` and `exactScore`, but its `score` and `sort` model the actual float32 order. This is exact evaluation of the measured objective with native score quantization, not arbitrary-precision ranking. [OpenSearch score precision](https://docs.opensearch.org/latest/query-dsl/compound/function-score/#the-script-score-function)

The native response can serialize a float as `0.8` even though its binary float32 value is `0.800000011920929`. Compare `Math.fround(hit._score)` with the reference when checking bit-level score agreement.

## Certified error bounds

`jointQuery(..., {maxError: T})` adds necessary indexed range filters before scoring. A two-family exact match with error no greater than `T` must satisfy:

```text
ca >= a − T
cb >= b − T
Q − T <= union <= Q + T
```

Minimum mode requires the two lower marginal bounds and the lower union bound. Single-family mode uses the direct lower/upper coverage interval, omitting the upper limit for minimum mode.

These conditions follow from the objective; they are not heuristic candidate selection. Every document meeting the error limit remains eligible. For exact matching, the conditions alone need not be sufficient, so the script also checks the full objective.

The implementation expands bounds by `1e-10` to retain numeric boundary matches. The script returns zero for `error > T + 1e-10`, and `min_score = max(0, 1 − T − 1e-10)` removes those rejected documents. Thus the stated threshold is inclusive within that explicit numerical allowance.

A threshold does not by itself prove that the returned page contains the collection's overall top K. A bounded-search caller can establish a valid threshold from any K eligible seed documents, then execute the bound against the **whole eligible index**, using the same PIT. When reproducing native `_score` order, its bound must also include the full float32 tie interval at the Kth score; otherwise an equal-scoring document with a smaller ID could be incorrectly excluded. The separate shared benchmark/wrapper owns this search procedure.

## API

```js
import {
  JOINT_PROPERTIES,
  toJointDocument,
  jointQuery,
  jointReference,
} from "./global-joint.mjs";

const indexed = toJointDocument({
  id: "wallpaper-001",
  features, // all 18 raw family area fractions
  unions,   // all 153 raw unions, keys such as "blue__dark"
});

const colors = [
  { family: "dark", amount: .3 },
  { family: "red", amount: .7 },
];

const body = jointQuery(colors, {
  mode: "target", // or "minimum"
  size: 20,
  filters: [{ term: { cohort: "real" } }],
  _source: false,
  // maxError: .2,
  // pit: { id: pitId, keep_alive: "2m" },
  // search_after: previousPage.at(-1).sort,
});

const expected = jointReference(indexed, colors);
```

`jointReference` accepts either raw `{features, unions}` or mapped `covj_`/`unionj_` fields. It returns `cost`, `error` (an alias), float32 `score`, double `exactScore`, `sort`, threshold `eligible`, canonical `colors`, and `mode`. Additional exports are `normalizeJointQuery`, `unionKey`, `JOINT_PAIRS`, `JOINT_SCRIPT`, and `JOINT_EPSILON`.

Pagination accepts the complete returned `[score, id]` tuple and PIT options. Reject timed-out or failed-shard responses; partial search results cannot establish the global ranking.

## Validation performed

The three-shard `color-global-joint-probe` ran on the isolated OpenSearch 2.11 service at port 19216:

- **2,352 exhaustive objective checks** against the general continuous transport solver.
- **65 analytical documents** built from four concrete colors realizing neither, dark-only, blue-only, and overlapping dark/blue membership. Every family and union is derived from those color areas.
- **216 native searches**, covering one/two families, exact/minimum mode, metadata filtering, explicit zero fractions, and near-boundary values.
- **180 of those searches used certified bounds**, including zero, .05, .2, .6, and one. Complete IDs and float32 scores matched the independent reference.
- **31 qualifying documents** traversed exactly once through filtered, bounded PIT pagination in pages of seven.
- Invalid totals, missing unions, unsupported graded mode, and more than two distinct families are rejected.

The shared harness owns the 100-wallpaper quality comparison and large-index resource/latency results. The small probe confirms the formula, query implementation, and inclusion boundaries; it does not establish production throughput.

## Tradeoffs

1. **Queries choose indexed families.** Custom hex anchors and adjustable range widths need the dynamic prototype or a new family bank and backfill.
2. **One or two requested families only.** Pairwise unions do not capture all higher-order overlap needed for arbitrary three-plus-family joint allocation. Independent marginal scoring would change semantics.
3. **No center preference.** Coverage and unions cannot reproduce the graded transport tie-break. Equal native scores use ID order.
4. **Source sampling still limits accuracy.** The objective is exact for stored measurements, not every full-resolution pixel or human judgment of the color names.
5. **Resource cost shifts to indexing.** Eighteen families require 153 union fields. Extra storage and index preparation buy a much smaller query-time calculation. The scale benchmark must measure whether this produces the desired speed.
6. **A broad bound can still scan many documents.** Indexed necessary conditions help only when selective. Their existence does not guarantee latency or prove competitive skipping of all low-ranking documents.
