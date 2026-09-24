# proportion-green-001 — 40% green, remainder unspecified

Status: **user judged**, case version 2. Development anchor; amount/shade observations and whole-result ordering recorded separately.

[Open the review](http://zerotwo:8221/evaluation/proportion-green-001.html) · [Structured record](proportion-green-001.json)

## Query and purpose

**“40% green; the rest doesn’t matter.”**

The user has already specified that 40% means a target for total green, not a minimum: a comparable 80%-green result should rank below 40%. This case explores amount and color-quality tradeoffs for that named-color request. No picked hex, tolerance, subject or scoring formula is specified.

The six controlled examples compare one source shade at 20%, 40%, 60% and 80% area, plus two alternative source shades at 40%. There is no target swatch. The user has judged these particular shades below; a general definition of named-green membership remains open.

## Presentation and construction

All fixtures are plain 1600 × 900 SVGs with the same #707070 background and a centered, full-height, opaque colored rectangle. No textures, gradients, masks, filters or external assets. The whole image is displayed at the same dimensions per viewport.

The review labels show **colored-band area**, not automatically perceived green coverage. Exact band percentages are supplied so this review concerns preference rather than success at estimating geometry. Hex codes are hidden in the review page; there is no highlighted “correct” green.

| Label | Source band color | Geometric band area | Background area | Band x / width |
| --- | --- | --- | --- | --- |
| A | #22BB44 | 60% | 40% | 320 / 960 |
| B | #668066 | 40% | 60% | 480 / 640 |
| C | #22BB44 | 20% | 80% | 640 / 320 |
| D | #99BB22 | 40% | 60% | 480 / 640 |
| E | #22BB44 | 80% | 20% | 160 / 1280 |
| F | #22BB44 | 40% | 60% | 480 / 640 |

These are fixture facts, not relevance grades or perceptual measurements. Full source hashes are pinned in the JSON.

## Review instructions

Describe how each example fits the request. Supply an order if useful, with ties or uncertainty welcome. Mention amount, color quality, or both. If a shade does not feel green, say so. No numeric scale or required membership threshold.

## Interpretation boundaries

- The shown area belongs to the constructed band. Do not substitute it for a human judgment of green membership, quality or apparent total green.
- Same-shade amount comparisons and same-area shade comparisons are available within this set. The colors are sampling choices, not a green-membership oracle.
- The alternate shades change multiple visual qualities; this does not isolate only hue, saturation or lightness.
- The 20% and 60% bands are equally far from 40% in geometric percentage points. That fact does not require equal relevance or symmetric penalties.
- Do not assume a duller or less prototypical green counts as a fractional amount of an ideal green. Keep quality and amount observations separate.
- The remainder is the same gray throughout. This case cannot establish tolerance for arbitrary colorful remainders or how additional green in the remainder would count.
- The goal is matching the search request, not general aesthetic preference. No particular shade has been declared the ideal named green.
- Related fixtures belong to one development group. Results will need real-wallpaper validation and cannot choose an algorithm by themselves.
- Browser scaling can antialias edges; source geometry and opaque interior colors are the known facts. No claim about the user's display calibration.

## User judgments

**Confirmed order: F > C > D > A > B > E.**

| Label | User's amount observation | User's shade observation |
| --- | --- | --- |
| A | Too much green | No separate shade description |
| B | Right amount of green | Does not feel very green; more gray than anything |
| C | Too little green | No separate shade description |
| D | Right amount of green | More yellow than green |
| E | WAY TOO MUCH GREEN | No separate shade description |
| F | Right amount of green | Very green |

F supplies a positive reference in this set. The user associates the 40% target with **less than half**: having more than half green feels off.

C's 20% band ranks above A's 60% band, using the same source shade and equal absolute deviations of 20 percentage points from the target. A symmetric absolute-area-error rule alone would tie them; the user's preference distinguishes them. This is evidence for this pair, not a chosen penalty formula or a universal rule for percentage queries.

C also outranks D's 40% band, while A outranks B's 40% band. Exact geometric amount does not by itself explain the order. Preserve B/D's “right amount” descriptions alongside their shade limitations; the user supplied no numeric conversion from color quality to perceived green amount.

The response does not establish rejection above 50%, a sudden jump at 50%, behavior exactly at 50%, or whether other percentage targets have similar asymmetry. No rejection labels, numeric whole-image grades or score distances were supplied.

### Raw response

> A Too much grean
> B Right amount of green, but it doesnt feel very green its more gray than anything
> C Too little green
> D Right amount of green, but its more yellow than green
> E WAY TOO MUCH GREEN
> F Right amount of green and it is very green
>
> F, C, D, A, B, E
>
> 40% feels like 'less than half', so if you have more than half green that makes it feel off


## Preparation checks

Source SVG colors, centered geometry and stated areas match the record; all six SHA-256 hashes are verified. Desktop (1280 × 1400) and mobile (390 × 844) browser checks show six loaded fixtures with equal 16:9 sizes per viewport, visible area labels, no target swatches and no horizontal overflow. The desktop sheet was visually inspected. All six fixture URLs and the review page returned HTTP 200; the page was checked through the local tailnet interface. These checks verify presentation and source facts, not the user's display calibration or preferred ordering.
