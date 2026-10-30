# Selected color-search method

The accepted method uses 256 overlapping anchors, shade-aware strict-hue
matching, five cutoff layers, three linked preferences, and precomputed
OpenSearch scores. Proportions use 10% steps; the middle preference retains
the favorite formula. The production
[GraphQL schema](../../../apps/gateway/src/graphql/schema.ts) and
[Catalogue admission and target resolution](../../../apps/gateway/src/capabilities/catalogue/colors.ts)
define its complete request contract. See [research path](RESEARCH-PATH.md),
[historical evidence](EVIDENCE.md), and [production decisions and remaining work](PRODUCTION-QUESTIONS.md).

## The idea in plain language

Measure matching area and quality against reference colors, then precompute fit
scores for each offered color, amount, and preference. OpenSearch combines the
selected scores across all eligible wallpapers. This moves arithmetic from
search to indexing at the cost of storage; three linked settings and 10% amounts
limit the number of stored scores.

## 1. Sample the image and choose color anchors

The prototype applies original-image orientation, converts to sRGB with alpha,
and fill-resizes to 128×128. It composites sampled pixels onto black and rounds
RGB channels. These choices define the still-image descriptor; video and live
wallpapers need a separate sampling strategy.

The original 1,024-anchor bank starts with the eight RGB cube corners and unique
named-color seeds. It adds colors through deterministic farthest-point selection
in OKLab from a 17×17×17 sRGB grid, rounded to exact RGB8 colors. The 256-anchor
bank is a deterministic subset of that original bank: start with the eight cube
corners, then repeatedly choose the remaining anchor farthest from the selected
set in OKLab. Original IDs are retained.

Pixels may belong to several anchor neighborhoods. Hex queries resolve to the
nearest stored anchor by ordinary OKLab distance, so even shade-aware matching
approximates the requested hex with that anchor's measurements.

Sources: [anchor definition](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/overlap-regions.mjs),
[nested banks](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/overlap-banks.mjs),
[shade/hue extraction](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/hue-index.mjs).

## 2. Measure area and match quality at five levels

The pixel-to-anchor comparison is deliberately tolerant of shading for chromatic
colors. It reduces the lightness penalty, partially compensates for color-channel
changes associated with darkening, and reduces credit for almost-black source
colors. A separate hue gate requires the hue to remain close: fully chromatic
anchors keep full hue credit through a 10-degree OKLab hue difference and fade
to zero by 30 degrees. Neutral anchors retain their previous distance behavior.
These angles are OKLab hue angles, not the HSL coordinates used by the inspector.

Each anchor has nested layers at 0%, 25%, 50%, 75%, and 90% pixel quality.
Even the 0% layer requires finite color-distance support and positive visibility
and hue gates. Each layer stores:

- Coverage, the admitted fraction of sampled area, rounded to integer basis
  points from 0 to 10,000. Every admitted pixel contributes its full area.
- Conditional mean quality, a float32 mean from 0 to 1, or zero for an empty layer.

High-quality pixels can contribute to all five layers of several anchors.
Summed coverages therefore do not describe a union or disjoint palette.

Sources: [shade measurement](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/shade-definition.mjs),
[hue gate](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/hue-definition.mjs),
[extraction and rounding](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/hue-index.mjs).

## 3. Score the requested intent

Catalogue accepts one through ten targets, each with one six-digit sRGB hex or
supported name. Vibe and favorite quality are the defaults. Vibe omits a
percentage; proportions require 0 through 100 in exact 10% steps. Intermediate
values are rejected. Each target may override mode and quality, otherwise
inheriting query defaults. The schema defines protocol values; Catalogue owns
admission, defaults, and resolution.

Vibe rewards area with diminishing returns through square-root coverage and
applies a match-quality penalty. A small strong region can compete with a
larger weak one, without a guaranteed accent preference.

Proportions reward closeness to the whole-image target. For "40% green," excess
is penalized 1.5 times as strongly as shortfall. Each layer compares its own
coverage with that amount, without first averaging the layers' coverages.

A partial request keeps its unspecified remainder without renormalization;
excess requested color still incurs a penalty. There is no independent penalty
for unwanted colors outside the requested neighborhoods. Even a 100% total
does not enforce exclusive region allocation or palette purity.

Each proportion target is admitted independently, including requests in which
every percentage is zero or the total exceeds 100%. This follows the
[approved query ticket](https://github.com/rafaeltab/wallpaperdb/issues/307):
overlapping target measurements do not require a disjoint composition summing
to 100%. Historical prototype UI admission checks do not change this contract.

Score each layer, combine layers with cutoff weights, then average targets
equally. Requested percentages change desired amounts, not target weights.

Sources: [query and target resolution](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/methods-cutoff.mjs),
[score reference](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/favorite-optimized-scoring.mjs).

## 4. Offer three linked quality preferences

| Preference | Quality influence | Cutoff weighting | Meaning |
| --- | ---: | ---: | --- |
| Relaxed | 0 | 0 | Ignore mean-quality penalties within a layer; weight all five layers equally. |
| Favorite / default | 0.5 | 1 | Preserve the user's favored balance of area and quality. |
| Strict | 1 | 3 | Apply stronger mean-quality penalties and favor stricter layers. |

The prototype calls the last position Strictest. These are provisional UI
labels; the selected parameter pairs are the concrete decision.

Influence changes the mean-quality penalty within a layer. Weighting changes
the contribution of each layer's complete score; the controls are not
mathematically interchangeable.

Relaxed still uses shade/hue membership and five quality cutoffs. Strict
changes ranking preference without hard exclusion of weak results.

The selected linear curve gives vibe multiplier `0.5 + 0.5 × quality` at
influence 0.5. No smooth-power exponent reproduces it for every quality;
the historical smooth-power prototype is not a substitute.

Sources: [linked preset definitions](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/linked-strictness.mjs),
[frozen favorite](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md).

## 5. Precompute one fit score for each offered request

A utility is the complete single-target fit score: the result of combining
that target's cutoff layers for one mode, amount, and linked preference. It is
not a coverage percentage or a new color measurement.

For each target, store one vibe utility and eleven requested-amount utilities:
0%, 10%, 20%, through 100%. Store these for all three preferences. The prototype
includes 256 anchor targets and 23 named-feature targets:

```text
279 targets × 12 profiles × 3 preferences = 10,044 numeric utilities per wallpaper
```

The prototype stores the bank in one index as indexed float fields with doc
values, disables `_source`, and retrieves IDs through doc values. Production
keeps metadata, measurements, and provenance in source while excluding utilities;
see [mapping](../../../apps/gateway/src/adapters/opensearch/mappings.ts) and
[ADR 0006](../../adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md#production-integration-decisions).
The three-preset million-record disk cost remains unmeasured.

The [native query](../../../apps/gateway/src/adapters/opensearch/query.ts)
filters metadata, contributor eligibility, and utility-version readiness before
ranking every eligible document, including zero-score records. It reads one
utility per target instead of five coverage/quality pairs. IDs come from doc
values and metadata from source. Timeouts, shard failures, or malformed responses
report unavailability.

Scores sort descending, with ascending wallpaper-ID ties. The existing
[score/ID cursors](../../../apps/gateway/src/capabilities/catalogue/implementation.ts)
support forward and reverse traversal on an unchanged index; there is no new
snapshot consistency model. [Production guidance](PRODUCTION-QUESTIONS.md)
covers retained measurements, complete-document updates, and installation scope.

Precomputing float32 layer sums changes operation grouping and can reorder
near ties relative to the original per-layer formulas. Production preserves the
selected float32 encoder and native execution order. [EVIDENCE.md](EVIDENCE.md)
records historical parity and tolerances.

Sources: [utility definitions and native query](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/favorite-utilities.mjs),
[linked index builder](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/linked-strictness-index.mjs),
[completed linked prototype](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md).

## Named colors, vibes, and unsupported meanings

Production fixes the thirteen concrete color names to their selected swatches
and resolves each swatch to its nearest anchor. The ten abstract names,
grayscale, strict grayscale, near-neutral, dark, light, bright, vivid, muted,
monochromatic, and rainbow, select their separate named utility fields. The
[Catalogue resolver](../../../apps/gateway/src/capabilities/catalogue/colors.ts)
owns this resolution. The full utility bank retains all 23 named-feature
targets, including the alternate broad color-family measurements; they do not
add another request interpretation for concrete names.

Named features have one score component, so cutoff weighting has no effect on
them. Quality influence still applies where the underlying feature uses it.
Monochromatic and rainbow values describe distribution properties, not literal
areas of pixels belonging to those words. The prototype can compare numeric
targets for those features. GraphQL exposes the supported proportions, whose
meaning is distribution strength rather than physical image coverage. Advanced
picker design remains [#36](https://github.com/rafaeltab/wallpaperdb/issues/36).

The selected prototype supports explicit combinations such as 80% grayscale /
20% red. It does not implement "grayscale with red accents" without proportions
or "dark with bright spots" as a special composition objective. Custom RGB/HSV/HSL
range controls and arbitrary per-query cutoff geometries are also unsupported
in this precomputed bank. Tags can constrain eligibility; this method does not
infer a city, flag, season, or other semantic subject from color alone.

Source: [named-feature definitions](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/corpus-colors.mjs)
and [query support checks](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/methods-cutoff.mjs).

## Repeated resolved targets

Lucene can collapse identical utility clauses while retaining the original
target-count denominator. Distinct hex colors resolving to the same anchor and
amount can therefore lose contributions in the frozen prototype.

The separate correction prototype has arithmetic regression evidence. Production
adopts it: group identical complete keys and apply
`multiplicity / original target count`. Keys include resolved
target, mode, proportion, and quality, so different proportions remain separate.
Distinct-target clauses retain the selected native path. The
[resolver](../../../apps/gateway/src/capabilities/catalogue/colors.ts) records
multiplicities and the [query adapter](../../../apps/gateway/src/adapters/opensearch/query.ts)
applies their factors. Verify duplicate cases separately from frozen-snapshot
parity; see the [production decision](../../adr/0006-use-precomputed-color-utilities-with-three-quality-levels.md#production-integration-decisions)
and [multiplicity findings](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-MULTIPLICITY.md).

## Appendix: precise mathematical definition

The formulas below describe the real-number objective. The source modules also
preserve float32 rounding, inclusive-boundary tolerances, and OpenSearch's
operation order where required for experimental parity.

### Pixel quality

Let a source pixel have OKLab coordinates `(Lp, ap, bp)` and an anchor have
`(La, aa, ba)`. Define `clamp(x)` on `[0,1]`, and
`smoothstep(x) = clamp(x)² × (3 − 2 × clamp(x))`. Divisions by lightness use a
minimum denominator of `10⁻⁶`.

```text
anchor strength s = smoothstep((sqrt(aa² + ba²) / max(La, 10⁻⁶) − 0.03) / 0.09)
lightness weight = 1 − 0.75s
relative-chroma blend β = 0.5s

ordinary difference = (ap − aa, bp − ba)
normalized difference = La × (ap/max(Lp,10⁻⁶) − aa/max(La,10⁻⁶),
                              bp/max(Lp,10⁻⁶) − ba/max(La,10⁻⁶))

d² = ((1 − 0.75s) × (Lp − La))²
     + (1 − β) × |ordinary difference|²
     + β × |normalized difference|²
```

At `s=0`, this is ordinary Euclidean OKLab distance. Define brightness visibility
`v(L) = smoothstep((L − 0.08) / 0.16)`. Relative visibility is
`min(1, v(Lp)/v(La))` when `v(La)>0`, otherwise 1. Final visibility is
`V = 1 − s + s × relativeVisibility`.

Let `h` be the angular separation of the source and anchor chromatic vectors in
OKLab. For defined hue, `H = smoothstep((30° − h) / 20°)`; undefined source hue
receives `H=0` for a chromatic anchor. The hue gate is `G = 1 − s + sH`.

```text
pixel quality = V × max(0, 1 − d/0.24) × G
support requires d ≤ 0.24, V > 0, and G > 0
```

Pure neutral anchors skip the hue gate and retain their original behavior.
The comparison depends on the anchor's strength and visibility, so this is a
directional shade-tolerance model, not a symmetric color-distance metric.

### Coverage and mean quality

For threshold `t` in `{0, 0.25, 0.5, 0.75, 0.9}`, admit supported pixels with
pixel quality at least `t`. Coverage `c_t` is admitted pixel count divided by
total sampled pixel count, rounded to basis points for storage. Mean quality
`q_t` is the mean pixel quality of admitted pixels, stored as float32, or zero
when no pixels are admitted. The implementation uses a `10⁻¹²` boundary tolerance
and clamps an admitted boundary quality up to its cutoff before accumulation.

### Layer score

Let `I` be linear quality influence and `a` be the requested proportion. All
amounts below are fractions, not percentages.

```text
vibe layer score = sqrt(c_t) × max(0, 1 − I(1 − q_t))

proportion area fit = max(0, 1 − (a − c_t))        if c_t ≤ a
                     max(0, 1 − 1.5(c_t − a))    if c_t > a

proportion quality factor = max(0, 1 − 0.35I(1 − q_t))   if a > 0
                            1                           if a = 0

proportion layer score = area fit × quality factor
```

The selected minimum-average-quality gate is zero. A zero-percent target rewards
absence and intentionally bypasses the quality penalty. A positive requested
amount with no matching pixels can still receive nonzero fit because these are
soft ranking functions, not hard minimum-coverage constraints.

### Combine layers and targets

For cutoff weighting `w`, each anchored target uses:

```text
α_t = exp(w × (t/0.9 − 1)) / Σ_j exp(w × (j/0.9 − 1))
target utility = Σ_t α_t × layer score_t
wallpaper score = mean of requested target utilities
```

The sum in the denominator ranges over the five cutoff levels. Their rounded
percentage coefficients are:

| Cutoff | Relaxed, w=0 | Favorite, w=1 | Strict, w=3 |
| --- | ---: | ---: | ---: |
| 0% | 20.00% | 11.01% | 2.45% |
| 25% | 20.00% | 14.54% | 5.63% |
| 50% | 20.00% | 19.19% | 12.96% |
| 75% | 20.00% | 25.33% | 29.81% |
| 90% | 20.00% | 29.93% | 49.15% |

These are coefficients, not guaranteed fractions of the final score: a layer
can contribute zero. Its weight is not redistributed. A named feature instead
uses its single component with coefficient 1.
