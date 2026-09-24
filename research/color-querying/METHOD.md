# Selected color-search method

Accepted direction: **256 overlapping color anchors, shade-aware strict-hue
matching, all five cutoff layers, three linked quality preferences, and
precomputed numeric scores ranked by OpenSearch.** Requested amounts use 10%
steps. The middle preference preserves the user's favorite exactly at the
mathematical-formula level.

This describes the accepted prototype behavior and its limitations. It does not
specify a finished production API, event contract, deployment, or migration.
See [research path](RESEARCH-PATH.md), [evidence](EVIDENCE.md), and
[production questions](PRODUCTION-QUESTIONS.md).

## The idea in plain language

For each wallpaper, measure how much of it matches many reference colors and how
good those matches are. Treat a darker red as a useful match for red while
requiring its hue to remain close. Keep several levels of closeness rather than
using one abrupt definition of what counts.

Calculate the final fit for each offered color, amount, and quality preference
before a user searches. At query time, select the appropriate stored fit scores
and let OpenSearch combine them across every eligible wallpaper. This preserves
global ordering without retrieving a limited candidate set to rerank in the
application.

The main tradeoff is deliberate: more extraction/indexing work and storage buy
less per-query scoring work. Restricting the controls to three linked settings
and 10% amounts reduces the number of precomputed answers.

## 1. Sample the image and choose color anchors

The prototype reads the original image, applies its orientation, converts it to
sRGB, keeps alpha, and resizes to a 128×128 sample using fill resizing. It then
composites each sampled pixel onto black and rounds its RGB channels. These
choices are part of the descriptor definition; changing them can change scores.
They describe still-image measurements and do not establish a strategy for video
or live wallpapers.

The original 1,024-anchor bank starts with the eight RGB cube corners and unique
named-color seeds. It adds colors through deterministic farthest-point selection
in OKLab from a 17×17×17 sRGB grid, rounded to exact RGB8 colors. The 256-anchor
bank is a deterministic subset of that original bank: start with the eight cube
corners, then repeatedly choose the remaining anchor farthest from the selected
set in OKLab. Original IDs are retained.

An anchor is a reference color with a neighborhood, not an exclusive histogram
bucket. A pixel may belong to several neighborhoods. The user selects any hex
color, but the query resolves it to the nearest available anchor by ordinary
OKLab distance. The query therefore uses that anchor's measured behavior rather
than an exact new measurement around the requested hex. This approximation
remains even with shade-aware matching.

Sources: [anchor definition](../../experiments/color-search-benchmark/exploration/overlap-regions.mjs),
[nested banks](../../experiments/color-search-benchmark/exploration/overlap-banks.mjs),
[shade/hue extraction](../../experiments/color-search-benchmark/exploration/hue-index.mjs).

## 2. Measure area and match quality at five levels

The pixel-to-anchor comparison is deliberately tolerant of shading for chromatic
colors. It reduces the lightness penalty, partially compensates for color-channel
changes associated with darkening, and reduces credit for almost-black source
colors. A separate hue gate requires the hue to remain close: fully chromatic
anchors keep full hue credit through a 10-degree OKLab hue difference and fade
to zero by 30 degrees. Neutral anchors retain their previous distance behavior.
These angles are OKLab hue angles, not the HSL coordinates used by the inspector.

For each anchor, keep five nested measurements. A pixel enters a layer when its
match quality reaches that layer's threshold: **0%, 25%, 50%, 75%, or 90%**.
The 0% layer still has finite color-distance support and a positive visibility
and hue gate; it does not admit arbitrary unrelated pixels merely because their
quality is zero.

Each layer stores two separate values:

- **Coverage:** the fraction of sampled image area admitted to that layer.
  An admitted pixel contributes its full area, even if its quality is low.
- **Conditional mean quality:** the average match quality of admitted pixels.
  This is zero when no pixels are admitted.

Coverage is rounded to integer basis points, from 0 to 10,000. Quality is a
float32 value from 0 to 1. Layers overlap, and anchor neighborhoods overlap;
summing their coverages does not yield a union or a disjoint image palette.
High-quality pixels can contribute to all five layers of several anchors.

Sources: [shade measurement](../../experiments/color-search-benchmark/exploration/shade-definition.mjs),
[hue gate](../../experiments/color-search-benchmark/exploration/hue-definition.mjs),
[extraction and rounding](../../experiments/color-search-benchmark/exploration/hue-index.mjs).

## 3. Score the requested intent

The method distinguishes two query modes.

**Color vibe:** reward a substantial matching area and good color quality.
Coverage uses a square root, so increasing coverage has diminishing returns.
This lets a smaller strong color region compete with a larger weaker one; it
does not guarantee that any particular small accent will outrank a large area.

**Requested proportion:** reward closeness to the requested whole-image amount.
For “40% green,” both too little and too much green lower the score. Excess is
penalized 1.5 times as strongly as shortfall. Each cutoff layer compares its own
coverage with the same requested amount; the scorer does not first collapse
the layers into one averaged green percentage.

Other colors can occupy an unspecified remainder. The method does not normalize
40% into 100%, nor let excess requested green disappear into that remainder.
However, it also has no independent penalty for an unwanted color outside the
requested neighborhoods. Even when requested amounts total 100%, the method
remains a set of marginal color targets; it does not enforce exclusive palette
allocation or exact palette purity.

For either mode, score each cutoff layer, combine the layers with their cutoff
weights, then average requested targets equally. A larger requested percentage
changes the desired amount; it does not automatically give that target more
weight than another target.

Sources: [query and target resolution](../../experiments/color-search-benchmark/exploration/methods-cutoff.mjs),
[score reference](../../experiments/color-search-benchmark/exploration/favorite-optimized-scoring.mjs).

## 4. Offer three linked quality preferences

| Preference | Quality influence | Cutoff weighting | Meaning |
| --- | ---: | ---: | --- |
| Relaxed | 0 | 0 | Ignore mean-quality penalties within a layer; weight all five layers equally. |
| Favorite / default | 0.5 | 1 | Preserve the user's favored balance of area and quality. |
| Strict | 1 | 3 | Apply stronger mean-quality penalties and favor stricter layers. |

The prototype calls the last position **Strictest**. These are provisional UI
labels; the selected parameter pairs are the concrete decision.

Quality influence and cutoff weighting are different mechanisms. Influence
changes the penalty for the layer's mean quality. Weighting changes how much
each layer's complete score matters. Linking them provides a useful preference
path without claiming an exact conversion between the two controls.

Even the relaxed position still uses shade/hue membership and five
quality-based cutoffs. “Quality influence 0” does not mean every pixel counts as
the selected color. Conversely, “strict” changes ranking preference; it does not
automatically become a hard exclusion rule or remove all weak results.

The selected curve is **linear**, not smooth power. Linear influence 0.5 has
quality multiplier `0.5 + 0.5 × quality` for vibe. There is no single smooth-power
exponent that reproduces this curve for every quality. The original smooth-power
prototype remains research history, not a silent substitute for the favorite.

Sources: [linked preset definitions](../../experiments/color-search-benchmark/exploration/linked-strictness.mjs),
[frozen favorite](../../experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md).

## 5. Precompute one fit score for each offered request

A **utility** is the complete single-target fit score: the result of combining
that target's cutoff layers for one mode, amount, and linked preference. It is
not a coverage percentage or a new color measurement.

For each target, store one vibe utility and eleven requested-amount utilities:
0%, 10%, 20%, through 100%. Store these for all three preferences. The prototype
includes 256 anchor targets and 23 named-feature targets:

```text
279 targets × 12 profiles × 3 preferences = 10,044 numeric utilities per wallpaper
```

That is **36 utility values per anchor**, plus the named-feature utilities and
ordinary metadata. It is a field/value count, not a count of separate OpenSearch
indexes. The three-choice prototype stores the whole bank in one index.

The prototype represents each utility as a float field with numeric indexing and
doc values. It disables stored `_source` and retrieves IDs through doc values.
These describe the tested layout; the production representation, reindexing
source, and metadata integration must be designed explicitly. The actual
million-record disk cost of this three-preset layout is not measured.

For a search, select the stored field for each resolved target and preference.
OpenSearch applies metadata eligibility filters and averages those utilities,
sorting by score and then ID. All eligible documents participate, including
zero-score documents. No color candidate ranking is performed in TypeScript.
An ordinary query reads one utility per requested target instead of five
coverage/quality pairs per target.

The utility is stored as float32. Precomputing layer sums changes the grouping
of floating-point operations relative to the original query. The formula is
preserved at offered settings, but near-tie order is not promised to be bitwise
identical. Measured parity and its tolerance are in [evidence](EVIDENCE.md).

Sources: [utility definitions and native query](../../experiments/color-search-benchmark/exploration/favorite-utilities.mjs),
[linked index builder](../../experiments/color-search-benchmark/exploration/linked-strictness-index.mjs),
[completed linked prototype](../../experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md).

## Named colors, vibes, and unsupported meanings

By default, concrete color names resolve through their declared swatches to
anchors. Abstract features such as dark, light, grayscale, strict grayscale,
near-neutral, vivid, muted, monochromatic, and rainbow keep their separate
hand-authored definitions. They are not all reduced to a single black, white, or
gray swatch. The full utility bank retains 23 named-feature targets, including
the alternate broad color-family interpretations.

Named features have one score component, so cutoff weighting has no effect on
them. Quality influence still applies where the underlying feature uses it.
Monochromatic and rainbow values describe distribution properties, not literal
areas of pixels belonging to those words. The prototype can compare numeric
targets for those features, but a displayed percentage would describe that
distribution-strength value rather than physical image coverage. Whether to
expose such controls needs an explicit product decision.

The selected prototype supports explicit combinations such as 80% grayscale /
20% red. It does not implement “grayscale with red accents” without proportions
or “dark with bright spots” as a special composition objective. Custom RGB/HSV/HSL
range controls and arbitrary per-query cutoff geometries are also unsupported
in this precomputed bank. Tags can constrain eligibility; this method does not
infer a city, flag, season, or other semantic subject from color alone.

Source: [named-feature definitions](../../experiments/color-search-benchmark/exploration/corpus-colors.mjs)
and [query support checks](../../experiments/color-search-benchmark/exploration/methods-cutoff.mjs).

## Known duplicate-target limitation

The intended aggregation averages every requested target contribution. The
existing numeric prototype can deviate when multiple targets resolve to the
same complete utility field: Lucene can collapse identical query clauses, while
the original target-count denominator remains. Distinct hex colors may trigger
this by choosing the same anchor and amount.

The linked prototype retains that historical behavior. A separate repeated-target
weights prototype corrects it and has arithmetic regression evidence, but it was
not silently incorporated into the linked snapshot. A production contract must
explicitly choose duplicate handling and validate that choice. This is an
implementation defect to resolve, not a desirable part of the color preference.
See [multiplicity findings](../../experiments/color-search-benchmark/exploration/FAVORITE-MULTIPLICITY.md).

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
