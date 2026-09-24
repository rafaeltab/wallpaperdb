# Global dynamic color-region ranking in OpenSearch

**Implemented:** OpenSearch 2.11.0 can rank every eligible document by the exact hard-region proportion objective for **one or two arbitrarily defined color regions**. Region definitions and image percentages are supplied with each query. This prototype does not retrieve a bounded vector candidate set and rerank it in the application.

**Explicit scope:** up to 32 palette entries, one or two distinct regions after duplicate merging, RGB/HSL/HSV/OKLab constraints, AND combinations of constraints, exact or minimum proportions. **Graded center preference and soft outside boundaries are unsupported** by this implementation and are rejected. It preserves the hard joint-allocation semantics; it does not claim to reproduce the later graded objective.

Implementation: [global-dynamic.mjs](global-dynamic.mjs). Validation: `make color-global-dynamic-probe`, with compact results in [global-dynamic-probe.json](global-dynamic-probe.json).

## Representation

Each document has a keyword `id`, an integer `palette_size`, and up to **224 numeric doc-value fields**:

```text
p00_w, p00_r, p00_g, p00_b, p00_L, p00_A, p00_B
...
p31_w, p31_r, p31_g, p31_b, p31_L, p31_A, p31_B
```

Each slot stores area weight, encoded sRGB coordinates, and OKLab coordinates. All palette numeric fields use `double`, with `doc_values: true` and `index: false`. Weights are normalized at serialization and again when scoring. This avoids intentionally quantizing values near narrow color boundaries. The separate field names preserve the association between each color and its weight.

Do not replace these with seven ordinary parallel numeric arrays: sorted numeric doc values expose numeric ordering, so array position cannot safely identify a palette entry across fields. [Lucene 9.7 `SortedNumericDocValues`](https://lucene.apache.org/core/9_7_0/core/org/apache/lucene/index/SortedNumericDocValues.html)

Doc values support per-document field access from scripts and sorting without reading `_source`. [OpenSearch doc-values documentation](https://docs.opensearch.org/latest/mappings/mapping-parameters/doc-values/)

The mapping is deliberately straightforward. A packed representation or custom Lucene/OpenSearch extension could reduce per-document overhead, but would need a separate correctness and speed comparison. This experiment prioritizes preserving the measured descriptor.

## Exact joint region proportions without a flow solver per document

For two regions A and B, classify each palette entry into a membership mask and sum its weight:

| Mass | Membership |
|---|---|
| `m0` | Neither region |
| `m1` | A only |
| `m2` | B only |
| `m3` | Both regions |

Let the requested fractions be `a`, `b`, and unspecified remainder `u = 1 − a − b`. The greatest accepted mass that can be allocated to the requested portions is:

```text
matched = min(
  a + b,
  m1 + m2 + m3,
  a + m2 + m3,
  b + m1 + m3
)

exact cost   = 1 − min(m0, u) − matched
minimum cost = a + b − matched
```

These are the four limiting cuts of the tiny bipartite assignment problem: total demand, total accepted supply, the limit imposed by A's capacity, and the limit imposed by B's capacity. This is our reduction of the binary-cost transport objective, checked against the existing general continuous min-cost solver. A single region uses `b = 0`, with no mass in B-only or both categories.

The overlap is allocated once. A 20% patch that belongs to both A and B cannot fulfill separate 20% portions twice. In exact mode, accepted excess cannot disappear into the unspecified remainder for free. Zero cost means a feasible partition into the requested portions, not that each region's independently measured coverage equals its requested fraction.

## Query execution and pagination

The Painless script reads each document's palette and classifies its entries against query parameters. It reads RGB fields only for queries needing RGB/HSL/HSV and OKLab fields only for queries needing OKLab. HSL and HSV are calculated in the script using the same achromatic and boundary tolerances as the JavaScript reference. The script source stays fixed; changing colors and percentages changes its parameters.

The query sorts by numeric script cost ascending, then by the keyword document `id`. Using script sorting avoids the float32 `_score` representation. OpenSearch supports numeric Painless script sorting. [OpenSearch script-sort example](https://docs.opensearch.org/latest/api-reference/script-apis/exec-stored-script/)

The outer query is `match_all` or the caller's ordinary filter clauses. There is no ANN/k-NN filter, candidate limit, or application reranking stage. `size` controls returned page length; it does not cap the eligible collection being ranked. A caller must reject timed-out or failed-shard results rather than treating partial execution as a complete global ranking.

Use PIT with `search_after` and the complete returned sort tuple `[cost, id]`. A PIT freezes the eligible index state; the ID gives a stable ordering within exactly tied numeric costs. Ordinary `search_after` without PIT can observe changes between pages. [OpenSearch pagination documentation](https://docs.opensearch.org/latest/search-plugins/searching-data/paginate/)

```js
import {
  mappingProperties,
  toDynamicDocument,
  dynamicQuery,
  referenceScore,
} from "./global-dynamic.mjs";

// Create an isolated index with mappingProperties plus application metadata fields.
const document = toDynamicDocument({ id: "wallpaper-001", palette });

const body = dynamicQuery(colors, {
  mode: "target",              // or "minimum"
  boundary: "hard",            // other boundary modes explicitly rejected
  filters: [{ term: { cohort: "real" } }],
  size: 20,
  source: false,
  // pit: { id: pitId, keep_alive: "2m" },
  // searchAfter: previousPage.at(-1).sort,
});

const expected = referenceScore({ id: "wallpaper-001", palette }, colors);
```

### Exported API

| Export | Contract |
|---|---|
| `mappingProperties` | OpenSearch property mappings, including `id` and `palette_size`. |
| `toDynamicDocument(doc)` | Accepts `{id, palette}`; `palette32` is also accepted. Returns only dynamic descriptor fields and `id`; the caller adds metadata. |
| `dynamicQuery(colors, options)` | Complete search body. Options: `mode`, hard-only `boundary`, `filters`, `size`, `source`, `trackTotalHits`, `searchAfter`, and `pit`. |
| `referenceScore(doc, colors, options)` | JavaScript closed-form result `{cost, score, masses, targets, mode, boundary}`. |
| `hardTransportCost(masses, amounts, mode)` | Independently callable four-mask formula. |
| `painlessSource`, `slotFields` | Script and field layout for inspection or integration. |
| `runProbe()` | Recreates only `color-global-dynamic-probe` on the dedicated loopback endpoint, checks native behavior, and records results. |

## Validation actually performed

The probe ran against **OpenSearch 2.11.0 / Lucene 9.7** at `http://127.0.0.1:19216`, using its own three-shard index:

- **2,352 exhaustive cases:** every five-unit membership distribution and two-color demand split, in exact and minimum modes, compared with the general continuous transport solver.
- **120 documents:** the existing 100 real wallpapers plus 20 synthetic fixtures with known areas.
- **22 native queries:** all existing region presets plus hue wrapping, zero RGB radius, overlapping regions, and different regions sharing an anchor; both proportion modes.
- **Maximum native-vs-JavaScript cost difference:** `3.33e-16`.
- **Maximum JavaScript-vs-general-transport cost difference:** `5.55e-16`.
- **Filtered PIT pagination:** all 100 real-wallpaper IDs returned exactly once in pages of 13 across three shards, including tied costs.
- Unsupported graded mode and more than two distinct regions are rejected explicitly.

These results establish numerical agreement for the represented palettes and tested queries. They do not establish a production latency target or original-pixel accuracy. The separate shared benchmark owns large-load timings and resource measurements.

## Limits and next decisions

1. **This still uses the approximate 32-color descriptor.** Moving the same calculation into OpenSearch removes candidate loss; it does not recover color detail lost during clustering. Compare to original-pixel references for narrow region boundaries.
2. **Work grows with the eligible collection.** Each document evaluates at most 32 entries against two regions and four constraints each. The script has bounded per-document loops, but global ranking still requires work over eligible documents. Millions of documents need measured latency and concurrency results, not extrapolation from the 120-document correctness probe.
3. **Two regions are an explicit prototype cap.** The four-mask closed form cannot be silently extended by independently scoring more colors. General overlap semantics need a larger exact assignment formulation or a separately validated restriction on query regions.
4. **The graded tie-break is absent.** Hard composition equality uses ID order. It does not prefer the anchor over a region edge; that needs an exact secondary objective implemented globally.
5. **Pagination repeats search work.** A PIT provides a consistent snapshot; it does not cache a globally ranked result list. Measure repeated-page cost separately.
6. **Production integration is future work.** This module writes a scratch descriptor, not production NATS events or gateway index mappings. A versioned palette event and backfill would be needed before applying this representation to the application.

The probe is isolated to `color-global-dynamic-probe` on port 19216. It leaves earlier benchmark indexes, prior outcomes, and production mappings untouched.
