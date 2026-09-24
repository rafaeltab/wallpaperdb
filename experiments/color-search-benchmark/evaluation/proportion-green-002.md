# proportion-green-002 — closer amounts for a 40% green request

Status: **user judged with a tentative order**, case version 3 / shuffled presentation version 2. Related follow-up to [proportion-green-001](proportion-green-001.md), in the same development group.

[Open the review](http://zerotwo:8221/evaluation/proportion-green-002.html?v=2) · [Structured record](proportion-green-002.json)

## Query

**“40% green; the rest doesn’t matter.”**

No exact shade or subject is part of the query. All six fixtures use the same #22BB44 band and #707070 remainder as the earlier vivid-green examples. Only band width changes.

The preceding case established C20% > A60% despite equal geometric deviation from 40%. The user explained that 40% feels like less than half. This follow-up gathers comparisons closer to the target and around half, without assigning expected outcomes.

## Construction and presentation

All fixtures are 1600 × 900 SVGs with one opaque centered full-height band over the same gray background. No gradients, filters, textures or external assets. Candidate band percentages, hex values and computed match scores are hidden. The requested 40% remains visible. The page does not introduce a cutoff hypothesis.

| Label | Band area | Gray remainder | Band x / width |
| --- | --- | --- | --- |
| A | 39% | 61% | 488 / 624 |
| B | 49% | 51% | 408 / 784 |
| C | 31% | 69% | 552 / 496 |
| D | 51% | 49% | 392 / 816 |
| E | 41% | 59% | 472 / 656 |
| F | 29% | 71% | 568 / 464 |

The geometry is known, not a preferred ranking. Source hashes are pinned in the JSON.

## Review prompt

Rank the matches if possible, with brief descriptions, ties or uncertainty. Identify examples that feel practically interchangeable and differences that feel substantial. No numeric scale is required. These strength descriptions are distinct from an ordering.

## Design rationale and limits

Three pairs have equal absolute geometric error from the 40% target:

| Pair | Amounts | Absolute error | Contrast |
| --- | --- | --- | --- |
| A / E | 39% / 41% | 1 percentage point each | Small under/overshoot near the target |
| C / B | 31% / 49% | 9 percentage points each | Under/overshoot with both amounts below half |
| F / D | 29% / 51% | 11 percentage points each | Under/overshoot when one amount exceeds half |

B49% → D51% and C31% → F29% both move two percentage points farther from the target. User descriptions of these differences may help distinguish an across-half concern from more general undershoot preference. These are comparison opportunities, not predictions or scoring rules.

- A ranking alone cannot establish the size, shape or continuity of a penalty. Do not infer a sudden jump at 50% just from 49% ranking above 51%.
- 50% itself is not included; do not invent a judgment exactly at half.
- The user has already discussed the less-than-half hypothesis. This is an informed follow-up, not an independent blind discovery exercise.
- Candidate amounts were shown in version 1. Version 2 hides them and shuffles every label at the user's request; prior exposure still prevents claiming an independent blind review.
- Preserve negligible differences, no internal ordering requirement, uncertainty and strong preferences distinctly. Do not require identical model scores for a group.
- The 40% exact fixture was judged in the previous case; there is no new 40% candidate here. Do not fabricate cross-case pairwise preferences.
- Remainder color and shade are held fixed; no new conclusions about unrelated shades, colorful remainders or other targets follow.
- Source band fractions are geometric facts. Perceived coverage, match quality and preferred order remain human judgments.
- All variants belong to the existing green-target-amount development group. Any observations still need natural-image validation.
- Browser scaling may antialias edges. No display calibration or fine perceptual discrimination guarantee is made.

## User judgments

**Tentative order: A > E > C > B > F > D.**

The user qualifies the order with **“something like that?”**. This uncertainty belongs to the overall ordering. It does not supply ties, numerical confidence or mandatory numerical score gaps.

| Label (presentation 2) | User observation |
| --- | --- |
| A | right amount of green |
| B | a bit too much green |
| C | Slightly too little green |
| D | too much green |
| E | almost right amount of green |
| F | too little green |

No explicit practically-interchangeable groups or substantial pairwise gaps were given. Keep these unassigned. These are qualitative amount descriptions, not measured area estimates.

Within this tentative order, each under-target example outranks its equally distant over-target counterpart, including comparisons wholly below half. B nevertheless outranks F, so this is not a rule that less green always wins. The case supports investigating asymmetric preferences, without defining a universal penalty or a sharp boundary at half. B/D also differ in absolute error; their positions do not measure a sudden change or the size of a score gap.

### Raw response

> A right amount of green
> B a bit too much green
> C Slightly too little green
> D too much green
> E almost right amount of green
> F too little green
>
> A, E, C, B, F, D
>
> something like that?


## Preparation checks

Version 1 preparation: all six source hashes, colors, centered geometries and stated band areas matched the structured record. Desktop (1280 × 1400) and mobile (390 × 844) browser checks show six loaded fixtures with uniform 16:9 sizes per viewport, visible percentages and no horizontal overflow. The desktop screenshot was visually inspected. All fixture routes returned HTTP 200; the page returned HTTP 200 through the local tailnet interface. These checks verify source facts and presentation, not display calibration or perceptual equivalence.

## Presentation revision 2

The user requested: “Can you remove the percentages and shuffle them so it is less biased?” Candidate percentages are removed from the review sheet. A persisted random shuffle with no fixed points gives every image a different A–F label. New revision-specific full-size aliases preserve the original bytes while avoiding old labels in link filenames. Source image IDs stay stable; the JSON retains the superseded mapping in presentationHistory. At the time of the shuffle, no relevance judgments had been received. The recorded response uses the version 2 labels above.

Revision 2 checks passed: desktop/mobile browser checks found six loaded examples, no candidate percentages or old amount elements, revision-specific links and no horizontal overflow. A separate read-only audit verified every label changed, all aliases match original hashes, and HTML/JSON/comparison mappings agree. The browser was closed after verification.
