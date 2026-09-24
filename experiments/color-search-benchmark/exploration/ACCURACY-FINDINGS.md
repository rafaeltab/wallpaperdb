# Accuracy findings from frozen feedback runs

The named-color refinements improve agreement with the recorded preferences over the HSV controls. The remaining differences between the named finalists are small and query-dependent. The broader hybrid adds useful precision and accent behavior, but this evidence does not establish an overall winner.

## Follow-up: overlapping coverage/quality regions — 2026-09-21

Two additional methods share a bank of 1,024 overlapping regions measured from original sampled pixels. On 28 shared named-color cases, the dense swatch interpretation scores **65.65%** agreement; preserving broad named families scores **74.52%**, exactly matching the existing native coverage/quality control. The picked-color path scores **73.33%** across three related precision cases versus **80%** for the histogram intent control. These are the same development judgments, not a new human evaluation.

An independent pixel audit confirms stored measurements exactly, but a shifted hard boundary can produce large errors relative to the actual picked color. The worst observed coverage error is **93.475 percentage points**, despite a mean of **0.430 points** across real-photo/color pairs. [Overlapping-region findings](OVERLAPPING-REGIONS.md) records the exact cases, denominators, support, artifacts and limitations. This follow-up does not establish an overall accuracy improvement.

## What is being measured

Scores below are **query-macro pairwise agreement**: each assessed query contributes equally; a reversed human preference earns zero and a model score tie earns half credit. They are not percentages of wallpapers that users would consider good. All selected runs share dataset fingerprint `e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc` and corpus fingerprint `ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b`.

There are 37 logical cases, including two conceptual cases without image sources. The corpus contains 545 assets: 523 real wallpapers and 22 controlled fixtures. Newly imported wallpapers remain unjudged. Accuracy uses a diagnostic window of up to 1,000 results so judged images can be compared; normal timing uses 20 results. The final hybrid's top-20 windows contain only 33 of 264 recorded pairs, so its aggregate diagnostic agreement is not a measured top-20 relevance grade.

These are development judgments from **one observer**. Twenty-four were explicitly completed quickly, with expected disagreement between people. Earlier cases retain their own qualifications, including uncertainty about transferring pure-color fixtures to real wallpapers. Related cases reuse images, and refinements were explored on these judgments; there is no held-out validation or independent population estimate. Removing explicitly uncertain pairs is a sensitivity check, not a cure for those limitations.

## Comparisons on explicitly shared cases

| Method | Supported / 37 | All-six common set: 17 cases, 135 pairs | Named common set: 28 cases, 216 pairs | HSV common set: 20 cases, 152 pairs |
|---|---:|---:|---:|---:|
| HSV cosine ANN |20|57.84%|—|54.00%|
| HSV raw L2 ANN |20|55.88%|—|54.00%|
| rank-features-vibe |28|73.43%|74.11%|—|
| native-quality-asymmetric |28|74.51%|74.52%|—|
| feature-intent-bounded |32|74.12%|75.12%|—|
| hybrid-indexed-precomputed |35|74.12%|75.12%|74.92%|

An em dash means the method does not cover the entire column's set; no smaller intersection is substituted. The common sets are defined below. Excluding explicitly uncertain pairs changes the 17-case results to 55.88%, 56.67%, 73.82%, 74.90%, 74.51%, and 74.51% in table order. All four 28-case aggregate scores remain unchanged under that sensitivity check.

Simply changing the historical HSV cosine objective to raw L2 does not improve the full shared 20-case average. It helps some color/precision cases and hurts others. This raw-L2 control also retains the historical unnormalized query construction; it should not be read as a verdict on every possible L2 representation.

On the **32 cases shared by the named bounded method and hybrid**, agreement rises from **71.98% to 75.10%**. The difference is concentrated in the dark-with-bright-spots case, where the relative-lightness refinement changes agreement from 0 to 1. It is a useful specific correction, not broad independent evidence. Adding the three picked-color cases brings the hybrid's separately reported 35-case aggregate to 75.48%; that larger-set percentage should not be compared directly with a 28-case aggregate.

## Category and coverage tradeoffs

The following rows use identical category subsets within the 28-case named set:

| Recorded category | Cases | Rank features | Native asymmetric | Named bounded / hybrid |
|---|---:|---:|---:|---:|
| Perceived color |6|76.11%|76.11%|76.11%|
| Vibe |8|84.58%|83.75%|84.58%|
| Combinations |9|64.81%|60.37%|63.33%|
| Proportions |3|63.89%|83.33%|77.78%|

The native asymmetric objective does better on these three proportion cases but gives up agreement on combinations. Rank-feature utility profiles preserve useful named-color/vibe accuracy with quantized indexed utilities, but lack custom picked colors and joint accent behavior. The named bounded method adds four accent cases; the hybrid adds three picked-shade cases. On those same three precision cases, hybrid agreement is **79.44%**, versus **32.22% HSV cosine** and **43.33% raw L2**. Only three cases support that comparison.

All four named methods score the one semantic eligibility case perfectly, but that is only one small city-tag example. Tags were required for eligibility; this does not validate semantic retrieval generally.

## Specialized picked-color grid refinement

The later native grid prototype is assessed on the same **three precision cases and 17 strict human-preference pairs** as the continuous palette scorer. It has **87.78% query-macro agreement**, versus 79.44% for the continuous objective (whether executed in OpenSearch or ClickHouse).

| Precision case | Continuous palette | Native grid |
|---|---:|---:|
| Picked shade fixture |80.00%|80.00%|
| Warm red, quick batch |91.67%|100.00%|
| Muted green, quick batch |66.67%|83.33%|

This amounts to one corrected preference and one resolved model-score tie. It is a useful development result, with very little independent human evidence. The grid approximates the continuous objective through interpolation and integer utilities. Its mean top-20 ID overlap with that reference is 81.47% across 17 diagnostic colors, and individual score deviations can be large near support boundaries. Mid-gray has only 30% top-20 ID overlap; its top result remains the same and mean reference-utility loss is 0.01185. That is representation/objective drift, not failed global retrieval: OpenSearch ranks the indexed formula globally. It is not evidence that the continuous objective is perceptually correct or that the grid is generally better.

Frozen grid report: [round13](http://zerotwo:8224/2026-09-20T03-13-00.884Z-c2f20177/report.html). Its exact-reference comparison uses the final [ClickHouse round12](http://zerotwo:8224/2026-09-20T02-52-07.682Z-6faa9adb/report.html), whose scores/orders match the original-RGB OpenSearch precision reference. Neither method supports the other 34 logical cases.

## Four useful remaining disagreements

These are existing judgments to investigate, not newly assigned labels or tuning targets. Orders below are restricted to the judged images.

1. **Red feel — `perceived-red-001` (73.33%, earlier discussion).** The observer put the somewhat-red sky `wallpaper-077` last; the hybrid puts it second, above the red leaves, illuminated street, roses, and small red leaf. The observer explicitly distinguished vivid red illumination from dulled red. This isolates a remaining mismatch in named-red strength/area behavior; it is not an ANN candidate omission.
2. **Natural 50% green / 50% red — `composition-green-red-real-001` (50%, earlier discussion).** The observer preferred `wallpaper-082` first and described it as a good match needing brighter colors. The hybrid places it last, behind tulips, leaves, and the tulip field that the observer disliked. This is a useful real-image counterexample to trusting proportion fixtures alone. The recorded evidence does not establish whether the cause is family membership, area estimates, or how those signals are combined.
3. **Picked #FF2200 — `precision-shade-001` (80%, controlled fixture).** Both exact-shade examples remain above the alternatives, as requested. The remaining reversal is lighter-looking #FF4400 versus darker-looking #FF0000: the observer preferred #FF4400, while the current symmetric OKLab distance favors #FF0000. This tests the distance objective itself, after fixing the larger area-versus-shade problem; it does not imply that every lighter neighbor should always win.
4. **80% grayscale with red — `composition-gray-red-batch-001/002` (50% each, quick batch).** The red-umbrella image was first in both the closed 80/20 query and partial 80/10 query, but ranks third in both. The observer also distinguished a grayscale appearance from a mostly white image, and changed the roses' position when requested red fell to 10%. These paired cases expose the unresolved interaction between grayscale appearance, amount, and free remainder. They do not justify a universal hard exclusion for an extra color.

## Keep three error sources separate

- **Objective agreement:** the tables above compare stored scoring objectives with recorded human orderings. Even an exact global result can disagree with the desired feel.
- **ANN retrieval recall:** whether approximate search finds the best documents for its own vector objective. In the separate million-descriptor diagnostic, worst tie-aware HSV-cosine recall@20 was 30% at k=20 and 100% at k=500; RGB cosine still reached only 90% in its worst k=500 case. Better recall does not fix a poor color objective. See [RECALL.md](RECALL.md).
- **Representation loss:** whether indexed descriptors preserve the desired image evidence. RGB4096 centers severely changed grayscale membership on two real images; direct RGB24 centroids reduced that loss, while the palette remained approximate. Fixed-point OKLab changed observed scores by at most 0.00000240 in its probe. These numerical checks do not establish perceptual agreement. See [PALETTE-BOUNDS.md](PALETTE-BOUNDS.md) and [PRECISION-PRECOMPUTED.md](PRECISION-PRECOMPUTED.md).

## Frozen evidence and exact set definitions

Reports preserve case-level disagreements, human observations, source fingerprints, and configurations:

- HSV controls: [round 1](http://zerotwo:8224/2026-09-20T00-50-38.374Z-32d2dbb7/report.html).
- Named bounded: [round 2](http://zerotwo:8224/2026-09-20T01-00-54.214Z-9ee49dbd/report.html).
- Rank features: [corrected round 4](http://zerotwo:8224/2026-09-20T01-07-33.778Z-ba9d2951/report.html); the earlier integration attempt is excluded.
- Native asymmetric: [round 10](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html).
- Final cached hybrid: [round 11](http://zerotwo:8224/2026-09-20T02-20-53.169Z-b5b47212/report.html).

The **17-case set** is the exact intersection of complete cases from all six selected methods:

```text
composition-blue-orange-batch-001, composition-blue-orange-batch-002
composition-green-red-001, composition-green-red-real-001, composition-green-red-real-002
perceived-blue-batch-001, perceived-green-batch-001, perceived-orange-batch-001
perceived-pink-batch-001, perceived-red-001, perceived-red-batch-001
proportion-green-001, proportion-green-002
proportion-green-real-batch-001, proportion-green-real-batch-002
proportion-red-real-batch-001, semantic-red-city-001
```

The **28-case set** is that set plus `composition-gray-red-batch-001/002`, `palette-rainbow-batch-001`, `vibe-dark-001`, `vibe-dark-batch-001`, `vibe-grayscale-001`, `vibe-light-batch-001`, `vibe-monochromatic-batch-001`, `vibe-near-neutral-batch-001`, `vibe-strict-grayscale-batch-001`, and `vibe-vivid-batch-001`.

The **20-case HSV set** is the 17-case set plus `precision-muted-green-batch-001`, `precision-shade-001`, and `precision-warm-red-batch-001`. The **32-case named/hybrid set** is the 28-case set plus `combination-gray-red-001/002`, `combination-gray-red-batch-001`, and `vibe-dark-accents-batch-001`.
