# How the color-search direction was chosen

Decision date: **2026-09-24**. The user accepted the **three-position combined
quality slider** as the direction for a future production implementation. This
document records the reasoning that led there. It does not turn the prototype
into production code or imply that every desired query is solved.

Start with the [research overview](README.md), [selected method](METHOD.md),
[measured evidence](EVIDENCE.md), and [remaining production questions](PRODUCTION-QUESTIONS.md).
The original experiment documents remain historical records; their earlier
recommendations and statements that no method was selected describe those stages.

## 1. Changing cosine to L2 was insufficient

The investigation began with the existing gateway, color extractor, OpenSearch,
and NATS pipeline. The earlier color-filter issue mentioned cosine and L2, so the
first experiment compared both using the existing 64-bin HSV representation on
100 real wallpapers. It also tested query normalization, narrower tolerances,
other distances, finer RGB histograms, and small perceptual palettes.

The important finding was a representation problem. Pixels were assigned to
coarse HSV intervals, while query similarity was measured against each interval's
representative color. A bin could therefore represent a pixel poorly before the
search distance was even applied. The broad default query and cosine's
normalization also rewarded diffuse color distributions. A literal L2 swap did
not repair that lost information.

Under one independent pixel-coverage proxy, held-out query-color nDCG@10 was
0.290 for the current cosine method, 0.410 for raw L2, and 0.871 for a 32-color
perceptual palette. These were automated proxy results on the same 100 images,
not human satisfaction percentages. The palette was a useful next experiment,
not the final architecture. [Initial findings](../../experiments/color-search-benchmark/FINDINGS.md)
retain all candidates and explain the proxy's limitations.

**Lesson:** a better vector distance cannot recover color detail already lost
during extraction. Keep descriptor fidelity, scoring behavior, and retrieval
correctness separate when evaluating a method.

## 2. Requested proportions changed the problem

The user wanted both “this wallpaper feels red” and explicit compositions such
as “40% green, with the remainder unspecified” or “50% green, 50% red.” The user
clarified that an 80%-green image should be penalized for a 40%-green request;
the amount means a target for the whole image, not a minimum or relative weight.

Palette transport and direct area-error prototypes explored those semantics.
Transport assigns each part of an image to one requested portion or a remainder,
which prevents the same area from being spent twice. It demonstrated useful
controlled behavior, but shade tolerance, palette compression, and computation
cost remained concerns. [Proportion findings](../../experiments/color-search-benchmark/PROPORTIONS-FINDINGS.md)
record that stage separately.

The user also required global search ordering. Retrieving a small candidate set
and reranking it in the application cannot establish the best results across a
million eligible wallpapers. Subsequent prototypes therefore performed filtering
and final ranking in OpenSearch, with one focused ClickHouse comparison. Exact
global bounds were explored as a way to reduce scoring work without restricting
the final search to a seed list.

**Lesson:** define query meaning and global-ranking guarantees before treating a
fast small-corpus ranking as a scalable solution. The selected method ultimately
uses overlapping marginal proportions, not transport's exclusive allocation;
that difference remains a limitation.

## 3. Human examples replaced premature method selection

The user described five related goals: perceived color, overall vibe, color
combinations, precise shades, and coexistence with semantic filters. A named
color can mean a visual impression rather than one exact RGB value. A bright red
street and muted red roses can both be red while having different red strength.
“Grayscale,” “mostly neutral,” and “monochromatic” also need different meanings.

The project first collected individual comparisons, then a batch of comparisons
to reduce review effort. The user explicitly warned that the quick batch was
uncertain and that other people could disagree. Controlled swatches were useful
for isolating behavior but did not reliably predict preferences for real
wallpapers. The [query goals](../../experiments/color-search-benchmark/COLOR-QUERY-GOALS.md)
and [submitted batch](../../experiments/color-search-benchmark/evaluation/batch-001-results.md)
preserve those qualifications.

The feedback loop was built to compare any registered candidate, parameter
setting, or combination. It keeps accuracy, query support, timing, errors, and
per-case regressions visible rather than hiding them in one aggregate score.
It uses strict human preference pairs, preserves ties and uncertainty, and
reports unsupported cases explicitly. Large-window diagnostic rankings are
separate from timed top-20 searches. See the [feedback-loop contract](../../experiments/color-search-benchmark/evaluation/loop/README.md).

**Lesson:** do not turn a small, reused, single-reviewer development set into a
claim of universal accuracy. Do not compare headline percentages across methods
with different supported queries as if they measured the same task.

## 4. Broad experiments exposed the area-versus-quality distinction

The service-backed comparison expanded to 54 registered implementations:
53 OpenSearch methods and one ClickHouse method, before the later favorite
optimization variants. The families included cosine/L2/Hellinger vectors,
histograms, adaptive palettes, scalar named-color features, composition
penalties, transport, indexed utilities, exact bounds, relative highlights,
and hybrids. No learned ranking or image embeddings were used.

Separating **coverage** from **quality** proved useful. Coverage describes how
much of the image belongs to a color region; quality describes how closely those
pixels match it. A mediocre match occupying a large area and an excellent small
accent should not become indistinguishable merely because both have the same
weighted color mass. The user preferred inspecting this distinction directly.

Fine non-overlapping histograms, including a bin-by-bin score inspector, did not
feel as promising to the user as overlapping coverage/quality neighborhoods.
Those neighborhoods let one pixel contribute to several nearby anchors. The
inspector made the measurements and score contributions visible, then added
hue/lightness and hue/saturation views, adjustable quality influence, minimum
quality, and 16/64/256/1,024-bin comparisons.

The original overlap experiment also exposed limitations: nearest-anchor
boundaries can cause large membership errors, and broad named-color behavior is
not interchangeable with literal swatch matching. The later direction does not
erase those observations. [Method inventory](../../experiments/color-search-benchmark/exploration/METHODS.md),
[overlap findings](../../experiments/color-search-benchmark/exploration/OVERLAPPING-REGIONS.md),
and [accuracy findings](../../experiments/color-search-benchmark/exploration/ACCURACY-FINDINGS.md)
retain the alternatives and counterexamples.

**Lesson:** more bins alone are not a guarantee of better perception. Preserve
the distinction between area, conditional match quality, and the final score.

## 5. Multiple cutoffs made tolerance adjustable

A single hard membership cutoff created a visible cliff. The experiments added
several cutoff profiles, then an all-cutoffs version using five nested levels:
0%, 25%, 50%, 75%, and 90% pixel-match quality. Every level stores its own
coverage and mean quality and receives a positive score coefficient.

Two controls affect different parts of this calculation. Quality influence
penalizes weak mean quality within a layer. Cutoff weighting changes how strongly
strict layers contribute relative to broad ones. Weighting all layers equally
and favoring strict layers produce different, useful rankings without changing
the underlying pixel measurements. [All-cutoff notes](../../experiments/color-search-benchmark/exploration/ALL-CUTOFFS.md)
explain the weighting and inspection behavior.

The linear quality formula at high influence could clip many contributions to
zero. A smooth power curve avoided that cliff, but its numeric setting was not
equivalent to the same setting on the linear curve. The user's later favorite
was explicitly **linear influence 0.5**; replacing it with power 0.5 would change
the selected behavior.

**Lesson:** controls that both sound like “quality” may change different
mechanisms. They can be linked into a simpler preference path without being
mathematically interchangeable.

## 6. Dark red and orange examples refined the color measurement

The user identified dark and softer red wallpapers that received too little
credit for a pure-red query. Increasing query-time quality influence fixed some
rankings while making other red examples worse. The shade-aware experiment
therefore changed the offline color comparison itself: it reduced the penalty
for lightness differences in chromatic colors, partly normalized color channels
by lightness, and retained a visibility guard against almost-black colors.

Next, the user preferred a red pagoda/moon scene to a bright orange/yellow sky
that ranked above it. The clarification was that hue must be **more similar to
count**. A smooth hue gate retained full credit through a 10-degree OKLab hue
gap, reduced credit to zero by 30 degrees, and preserved neutral behavior. This
fixed that reported pair in all 24 tested settings, compared with four for the
previous shade-only method. Historical real-image agreement improved in nine
settings and declined in fifteen, so the selected example did not prove a
universal improvement. [Shade-aware findings](../../experiments/color-search-benchmark/exploration/SHADE-AWARE.md)
and [hue-tolerance findings](../../experiments/color-search-benchmark/exploration/HUE-TOLERANCE.md)
record both progress and regressions.

The user then endorsed a strong snapshot: **all cutoffs, shade-aware plus strict
hue**, cutoff weighting 1, linear quality influence 0.5. Both 256 and 1,024 bins
were liked, with little visible difference to the user. The [frozen favorite](../../experiments/color-search-benchmark/exploration/FAVORITE-SNAPSHOT.md)
preserves exact settings and source fingerprints.

**Lesson:** query-time score tuning cannot always repair the wrong definition of
color closeness. Perceived shade tolerance can be directional, and stronger hue
separation can coexist with tolerance for darker versions of a color.

## 7. Moving calculations to indexing preserved the useful behavior

The original favorite calculated five layer scores for each requested color on
every eligible document. Several-color queries became expensive at a million
records. Reducing the stored bank from 1,024 to 256 did little to reduce this
per-query work because each requested color still selected one anchor and five
layers. [Original performance findings](../../experiments/color-search-benchmark/exploration/FAVORITE-PERFORMANCE.md)
record the failed profiles as well as successful selective queries.

Optimization experiments tried fused scripts, precomputed numeric utilities,
several quantized indexed representations, direct numeric sorting, lean result
fetching, and global bounds. A utility is simply the complete score for one
requested color and one offered setting, calculated before querying. OpenSearch
can then read and combine one stored utility per target rather than recomputing
all five layers.

The numeric representation retained the favorite formula, apart from small
float32 grouping differences that can reorder nearly tied results. It provided
the most useful broad-query baseline. Global bounds were also useful for some
combination workloads, but no universal dispatcher was established. Direct
sorting was extremely fast on repeated single-target requests yet failed a
broader arrival workload. The [optimization results](../../experiments/color-search-benchmark/exploration/FAVORITE-OPTIMIZATION-RESULTS.md)
are evidence for workload-specific choices, not a promise that every query is
fast at any load.

**Lesson:** preserve the scoring objective while moving reusable arithmetic to
indexing. Test a broad set of requested fields and independently arriving
queries; repeated-query latency alone can conceal an important limit.

## 8. Storage made simpler controls valuable

Precomputing every combination of three influence values and three weighting
values, for every color and every 5% target amount, multiplies stored values.
The favorite-only million-record utility index used 56.049 decimal GB. A naive
nine-times estimate was roughly 504 GB, but the full nine-preset million-record
index was **not built** because disk capacity was insufficient.

This discussion also corrected a scope misunderstanding: the original roughly
20 GB measurement covered the full **1,024-bin schema at 100,000 records**, not
one million. The much smaller original million-record index was only a workload
projection. [Storage-scope correction](../../experiments/color-search-benchmark/exploration/FAVORITE-NINE-PRESETS-CURRENT.md#original-approximately-20-gb-claim-scope-correction)
keeps the record counts, schemas, and measured-versus-estimated distinction.

The user accepted 10% requested-amount steps and proposed combining influence
and cutoff weighting. A new prototype compared the original controls with
three- and five-position linked sliders, using the same real wallpapers and
precomputed scores. The three-position version stores 10,044 utilities per
image; the five-position version stores 16,740. These are exact field counts,
not measured million-record disk savings.

## 9. Accepted direction

On 2026-09-24 the user accepted the three-position version:

| Preference | Linear quality influence | Cutoff weighting |
| --- | ---: | ---: |
| Relaxed | 0 | 0 |
| Favorite / default | 0.5 | 1 |
| Strict | 1 | 3 |

Use 256 anchors, all five shade-aware strict-hue layers, 10% proportion profiles,
and precomputed numeric scores ranked globally by OpenSearch. The middle setting
retains the endorsed favorite. The positions are a useful preference path, not
equal steps on a calibrated perceptual scale.

The [linked-slider prototype](../../experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md)
contains all 523 real wallpapers plus 22 indexed fixtures excluded from its
gallery. It preserves matched original feedback results at the offered settings.
Its three-preset million-record storage, performance, ingestion, and production
integration remain unmeasured. The accepted direction is a basis for that work;
the [remaining questions](PRODUCTION-QUESTIONS.md) define what still needs to be
settled before shipping.
