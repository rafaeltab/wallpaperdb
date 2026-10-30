# Use precomputed color utilities with three quality levels

Accepted on September 24, 2026. Move expensive color scoring into indexing and offer the user-selected three-position quality slider. This approves the behavior, not the prototype code for production. The [research record](../research/color-querying/README.md) contains the supporting exploration.

## Context

Users preferred shade-aware matching with strict hue admission and all five coverage/quality cutoff layers contributing. They saw little difference between 256 and 1,024 bins. Query-time scoring became expensive at scale, while reranking a limited candidate set could miss the best eligible wallpaper. Precomputation prioritizes correct rankings and fast queries over flexible controls and storage savings.

## Decision

Use 256 overlapping color bins with the research method's shade-aware, strict-hue similarity. Pixels may contribute to several anchor neighborhoods. Shade tolerance credits darker chromatic colors, visibility adjustment limits near-black credit, and the hue gate reduces credit for different hues. Neutral targets retain separate treatment. Picked colors resolve to their nearest anchor; exact hexadecimal-color discrimination is not promised.

Measure five nested layers per bin at minimum similarity levels of zero, 25%, 50%, 75% and 90%. Even the zero layer has finite color support. Each layer records its image coverage and conditional quality, the average similarity of admitted pixels.

Score each layer before combining them. Vibe queries reward coverage with diminishing returns and the selected quality influence. Proportion queries reward closeness to the requested area, penalize excess more than shortfall, and apply a smaller quality penalty. Combine layer scores with normalized cutoff weights, then average requested targets. Preserve the [scoring method](../research/color-querying/METHOD.md); scoring averaged measurements is not equivalent.

The quality slider selects these parameter pairs:

| Setting | Quality influence | Cutoff weighting |
| --- | ---: | ---: |
| Relaxed | 0 | 0 |
| Favorite, the default | 0.5 | 1 |
| Strict | 1 | 3 |

Retain the linear quality curve. These pairs are not equal perceptual intervals. Influence controls each layer's quality penalty; weighting favors stricter layers. Named abstract features have no cutoff layers, so weighting does not affect them.

Support proportions in 10% steps. Precompute one vibe utility and eleven proportion utilities per target and quality setting. With 256 anchors and 23 named features, this produces 10,044 numeric fields per wallpaper. Utilities are relevance scores, not measured percentages. OpenSearch ranks all eligible records using the selected prototype's native numeric path. Capped candidate reranking, global bounds and other experimental executors are excluded.

## Production integration decisions

Confirmed on September 30, 2026 for [#266](https://github.com/rafaeltab/wallpaperdb/issues/266). Correct values and rankings take priority, followed by performance and then responsibility split. The [selected prototype](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/LINKED-STRICTNESS-PROTOTYPE.md) defines sampling, named features, float32 utility values and OpenSearch aggregation order. Judge near-tie parity against that numeric path, not a differently grouped evaluation of the formula.

Preserve repeated target contributions through the researched [multiplicity correction](https://github.com/rafaeltab/wallpaperdb/blob/30edcb2a61e6c4cc915a61807210a3ab5e924d96/experiments/color-search-benchmark/exploration/FAVORITE-MULTIPLICITY.md). [Group identical complete utility keys](../../apps/gateway/src/capabilities/catalogue/colors.ts) and weight each by [multiplicity divided by the original target count](../../apps/gateway/src/adapters/opensearch/query.ts). This corrects clause collapse while preserving the intended mean and distinct-target numeric path. Rank eligible records, including zero-score records, by descending relevance and ascending wallpaper ID. Preserve reversible pagination on an unchanged index; no new snapshot consistency model is selected.

Retain versioned measurements in NATS so utilities can be recalculated without decoding originals when the measurement definition is unchanged. Initially, Color Extractor measures matching area and conditional quality; Gateway derives utilities during projection. That split may change for correctness or performance within context boundaries. No new database is required. Event retention remains subject to [#162](https://github.com/rafaeltab/wallpaperdb/issues/162).

[ADR 0012](0012-own-stable-assets-and-immutable-sources-in-media.md) fixes measurement provenance to the Asset's first Default Source and analysis version. Measurements remain stable for the Asset's lifetime despite default changes, Source replacement/withdrawal and ordinary Source-byte cleanup. Initial color/display divergence is accepted while Visual continuity is deferred; no permanent historical-byte hold is selected. Measurement and scoring definitions are unchanged.

Replace the color query contract, histogram extraction and search representation. There are no production or external consumers requiring compatibility; the maintainer will recreate infrastructure/storage and upload images again. Migration, backfill, rebuild tooling, parallel indexes and staged cutover are unnecessary. Durable facts, replay-safe consumers and exclusion of incomplete color records remain required. The single-color picker sends a default-quality vibe query; the advanced picker remains [#36](https://github.com/rafaeltab/wallpaperdb/issues/36).

Extraction and indexing share immutable anchor geometry, cutoff order and named target identifiers as an explicit shared-kernel exception. One data-only [definition](../../packages/events/src/color-vocabulary.ts) keeps retained descriptor positions consistent. Extraction owns matching, named membership and coverage policy; event schemas and broker behavior remain outside its capability.

## Consequences and limits

Precomputation adds indexing work and storage and gives up independent sliders and intermediate percentages. Grayscale and other named queries remain supported. Overlapping measurements describe independent targets, not a disjoint palette. They add no unwanted-color penalty and cannot express every grayscale-plus-accent intention. The [query contract](../../apps/gateway/src/graphql/schema.ts) supports one through ten targets, zero-percent targets and totals above 100%, leaving unspecified portions unconstrained.

The [evidence](../research/color-querying/EVIDENCE.md) is not a production capacity guarantee. The selected prototype contains 523 real wallpapers. Million-record tests used synthetic records derived from that corpus and a different, favorite-only utility bank. The full three-setting bank's million-record storage, mixed-setting concurrency and production behavior remain unmeasured; the earlier 56.05 GB result is not its size. A million-record capacity campaign or invented traffic target is not a completion gate for #266. Deployment performance and recovery validation belong to [#240](https://github.com/rafaeltab/wallpaperdb/issues/240); the [production guidance](../research/color-querying/PRODUCTION-QUESTIONS.md) separates those checks from settled correctness decisions.
