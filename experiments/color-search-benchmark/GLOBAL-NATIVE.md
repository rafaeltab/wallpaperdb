# Native global ranking by color-family area

This is a throwaway prototype. Run `make color-global-native-probe` against the dedicated OpenSearch 2.11 instance at `http://127.0.0.1:19216`. It creates only the scratch index `color-global-native-probe` and writes [probe evidence](global-native-probe.json).

## Result so far

The real OpenSearch 2.11 / Lucene 9.7 probe passed **36 complete-ranking comparisons** on 334 generated feature documents across three shards: numeric percentage scoring, indexed percentage tokens, and finer numeric scoring. Six queries were each checked with and without a metadata filter. Every returned score and complete result order exactly matched the integer JavaScript reference, including ties, zero scores, and fractional percentage requests. Two additional checks verified native quality sorting after area score. These are arithmetic/control examples, not human relevance judgments or additional wallpaper images.

For the profiled two-family query, numeric scoring evaluated all 334 parents. The token query scored 102 parents and received 69 minimum-competitive-score updates, with both score-only and `_score,id` sorting. This is evidence that competitive scoring works for this query shape; the small probe does **not** establish production speed. Token query construction and scorer setup cost more than the simpler numeric query, and profiling itself adds overhead. See the parent benchmark for larger-scale timing, resource, and pagination measurements.

## Model and accuracy boundary

Each wallpaper has one measured source-pixel coverage fraction per fixed color family. Query `[{family:'red', amount:.4}]` ranks proximity to **40% total red**; 80% red is farther away. Unrequested families do not contribute to the score.

The 18 fixed families are `dark`, `dark_gray`, `grayscale`, `black`, `gray`, `white`, `red`, `orange`, `yellow`, `green`, `teal`, `cyan`, `blue`, `navy`, `purple`, `pink`, `brown`, and `cream`. Their exact anchor colors and RGB/HSL/HSV region definitions are exported as `NATIVE_FAMILIES` in [global-native.mjs](global-native.mjs). Regions use the existing `containsRange` and `rangePreference` semantics. The bank is fixed before corpus extraction and performance evaluation.

In particular:

- `dark`: black anchor, HSV hue unrestricted, saturation unrestricted, value at most 25%.
- `dark_gray`: black anchor, HSL hue unrestricted, saturation at most 2%, lightness at most 10%.
- `grayscale`: black anchor, HSL hue unrestricted, saturation at most 2%, all lightness values.

These are **marginal areas**, meaning each family is measured independently. Families overlap: a dark red pixel can count toward both dark and red. Thus two requested fractions do not imply an exclusive partition of the image. Requests need not sum to 100%, and there is no independently scored “other” bucket. This differs from the earlier joint transport model, which assigns each pixel's area only once. It also limits custom range flexibility to the indexed family bank.

The tradeoff is deliberate: richer source-pixel family features can avoid palette quantization failures for narrow gray regions while making global indexed ranking practical. It is not a claim that independent family fractions preserve the original transport objective or solve arbitrary overlapping composition queries.

## Indexed representation

`toNativeDocument({id, features, qualityMass})` returns only these mapped fields:

| Field | Value |
|---|---|
| `id` | Stable keyword identifier |
| `cov_<family>` | Rounded fraction × 100, integer 0–100 |
| `fine_<family>` | Rounded fraction × 10,000, integer 0–10,000 |
| `coverage_tokens` | One keyword per family, such as `red:40` |
| `quality_<family>` | Mean center preference within matching pixels × 10,000; zero when absent |

`features` contains the actual source-pixel fraction. `qualityMass` contains the sum of pixel area × center preference, not the conditional mean; the adapter divides by coverage. Every family gets explicit fields and a token, including zero coverage. Common cohort/partition/reference metadata is added by the caller.

For whole-percentage requests, the bucket representation introduces at most 0.5 percentage point of area rounding per family. If both source and requested fractions are rounded, the absolute-error difference is bounded by one percentage point per family. The fine representation reduces those bounds to 0.005 and 0.01 percentage point, respectively. These are representation bounds, not guarantees about color-family perception or image sampling.

## Two native queries with the same bucket objective

For `n` requested families and integer amount `aᵢ`, the score is:

```text
score = Σ (U − abs(observedᵢ − requestedᵢ))
```

Maximizing this score exactly minimizes summed absolute fraction error. `U=100` for buckets, or `U=10000` for fine numeric fields. Each requested family has equal importance; requested amount remains a target fraction, not a score weight.

### Numeric linear decay

`nativeQuery(colors, options)` uses one `function_score` linear decay per family: origin at the requested integer, scale `U/2`, decay `0.5`, zero offset, and weight `U`. Scores are summed and replace the underlying query score. This implements the formula above with built-in numeric functions. Numeric fields support native range filters. [OpenSearch 2.11 function-score documentation](https://docs.opensearch.org/2.11/query-dsl/compound/function-score/)

`precision:'bucket'` is the default. `precision:'fine'` selects `fine_<family>` and `U=10000`.

### Inverted percentage tokens

`tokenQuery(colors, options)` creates one constant-score term clause for each possible integer percentage, boosted by that bucket's integer utility. Exactly one clause per requested family matches each wallpaper. Boolean `should` adds those constant scores. Even a utility-zero clause remains eligible, so the query can return all matching parents rather than discard poor matches. [OpenSearch 2.11 constant-score documentation](https://docs.opensearch.org/2.11/query-dsl/compound/constant-score/) and [Boolean query documentation](https://docs.opensearch.org/2.11/query-dsl/compound/bool/)

There are 101 clauses per requested family. The prototype caps requests at ten families to keep the color clauses below the server's usual 1,024-clause limit. The token representation intentionally stays at whole-percentage precision; fine numeric scoring is available separately.

Neither query uses an application candidate pool, script scoring, ANN, or a production index. Every metadata-matching parent is globally eligible, subject to the selected fixed-family objective.

### Why not `distance_feature`?

That query is for supported date and spatial fields, not numeric family coverage. The probe sends a syntactically valid request against `cov_red` and records OpenSearch 2.11's rejection of the integer field. Numeric linear decay is the supported alternative used here. [OpenSearch specialized-query documentation](https://docs.opensearch.org/latest/query-dsl/specialized/index/)

## Quality, filters, and stable ordering

Both helpers return a complete search request with `_source:false`, disabled exact hit counting, and `_score` descending followed by `id` ascending. Set `stableSort:false` for score-only performance comparisons. Raw metadata and area filters are supplied as `options.filter`, an array of native query clauses. The helpers also accept `size`, `from`, `search_after`, `pit`, `profile`, and `track_total_hits`.

`qualityTieBreak:true` supports a single-family query. With several requested families, an explicit family id may be supplied instead. Quality is a separate descending numeric sort after `_score`; it cannot let a worse area match outrank a better area match. The prototype does not invent a combined multi-family quality objective or pack a secondary preference into a fragile floating-point score.

`nativeReference` and `tokenReference` return `{score,error,normalizedError,secondary,sort}` for independent global-oracle comparisons. `error` is summed absolute fraction mismatch, not necessarily a value below one for multiple overlapping families. Token reference always uses bucket precision.

## Fine ranking with safe indexed bounds

The fine numeric fields also support the parent's bounded global-search experiment. Given **any K eligible documents in the same point-in-time view**, let `T` be the largest fine summed absolute error among those K. Every document with error at most `T` must satisfy `abs(fineᵢ − requestedᵢ) ≤ T` for every selected family, because each error component is nonnegative.

Those inclusive numeric range constraints can therefore be applied before global fine scoring without losing any better or tied result. The seed supplies only a bound; it does not define the final candidates. Correctness requires the same metadata filters and snapshot, enough eligible seed documents, inclusion of score ties, and a bound that covers the requested pagination depth. When the bounds are weak, this safely degrades toward a full eligible-document scan. The parent runner owns the implementation and its proof/benchmark evidence.
