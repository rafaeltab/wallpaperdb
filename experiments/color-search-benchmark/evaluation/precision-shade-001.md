# precision-shade-001: a picked shade and its visible amount

Status: **user judged; version 2**. Category: **Precision**. Controlled development anchor.

## Request

> Color picker: #FF2200

Find wallpapers matching the picked shade. No amount, subject or other palette constraint is specified. The user clarified that selecting a color expresses a preference for colors as close as possible; it does not require exact equality. No distance formula, tolerance cutoff or universal amount tradeoff has been chosen.

[Open the four-example comparison](http://zerotwo:8221/evaluation/precision-shade-001.html).

## Review questions

1. Which examples match the picked shade closely enough?
2. Which complete examples would the user prefer as search results? Ordering is optional.

These were the review questions. Keep shade observations and overall result preferences separate. The user has now clarified proximity semantics and supplied the ordering below; nearby shades are not automatically excluded.

## Controlled construction

These are simple locally authored SVG compositions, not natural wallpaper photographs. All have a 1600 × 900 canvas, a #707070 background and a centered, full-height color band. Only the shade and band width vary.

| Label | Accent color | Source area | Rectangle x / width | Source SHA256 |
| --- | --- | --- | --- | --- |
| A | `#FF4400` | 40% | 480 / 640 | `25f57d1977de25453b81f741391fd3bb9e2c0c2aabfda04f88b0c945e1f8400b` |
| B | `#FF2200` | 10% | 720 / 160 | `b49b84a58e54f58e7c6759925c452daf701f0f57bbae90dc612070c16f627429` |
| C | `#FF0000` | 40% | 480 / 640 | `9044c6aa6612b6d97b271cdf81cd5d6d2e850f974262e797376dbcccaf2b1b10` |
| D | `#FF2200` | 40% | 480 / 640 | `a8eb2098ab14bcc4d488700c40884239e2aca40ef82c191920145dbefd1ef9b4` |

The source files are [A](fixtures/precision-shade-001-a.svg), [B](fixtures/precision-shade-001-b.svg), [C](fixtures/precision-shade-001-c.svg), and [D](fixtures/precision-shade-001-d.svg). All colors are standard sRGB hex values. There are no gradients, filters, opacity, textures or masks. No external image source or generated raster is used.

These construction percentages and color codes are hidden on the review page. They establish the fixture contents, not expected human judgments. The equal RGB-channel steps do not establish equal perceptual distances.

- A/C/D compare shade at the same amount.
- B/D compare amount at the same encoded shade.
- B versus A/C compares a smaller exact-color region with larger nearby-color regions, without a prescribed winner.

## Presentation and validation

The target swatch is repeated beside every example on the same gray surround. Whole 16:9 compositions render at an equal size within each viewport, with no crop. The page background matches earlier reviews. Fixed A–D labels imply no relevance order.

Desktop 1280 × 1120 and mobile 390 × 844 browser checks confirmed all four assets loaded, identical rendered sizes per viewport, no horizontal overflow, and target swatches of rgb(255,34,0). SVG rectangle geometry and fills were inspected. This verifies the page construction, not color calibration on the user's display; scaled edges may be antialiased.

Browser-rendered screenshots were inspected. Source hashes and fixture geometry are recorded in [JSON](precision-shade-001.json). Original photo files, corpus manifest, descriptors and OpenSearch indexes were not changed.

## Judgment log

### User response 001

| Label | User observation |
| --- | --- |
| A | A bit light. |
| B | Less wide, but pretty sure it matches the target precisely. |
| C | Noticeably darker. |
| D | Pretty sure it matches the target precisely. |

**Confirmed order: B and D together first, then A, then C.** There is no required internal order or requirement for identical numerical model scores within the top group.

**User clarification, verbatim:**

> Now the goal for us is not to filter by exactly this color and only this color, but by colors that are as close to it as possible, it means the color is important to the user.

The picked color expresses shade priority, with near colors still eligible. The user has not assigned an acceptability cutoff, numerical grades or a particular distance formula. B/D's “pretty sure” remains part of the observation, separate from the fixture's known hex equality. A's lightness and C's darkness are perceived descriptions, not measured color-space coordinates.

In this comparison, B's 10% target-color area ranks above A/C's 40% nearby colors, and ties in the top group with D's 40% target color. This is evidence for this case, not a universal rule that amount never matters or a tiny exact-color speck always wins. A/C's lower ranking does not mean rejection. The three adjacent-group preferences derive from one ranking judgment.

The exact raw response is preserved in JSON alongside the original review intent and the clarified intent.

This is one related development group. Future real-wallpaper cases should check whether these simple preferences transfer; the four variants are not independent held-out examples. If only an order is supplied, leave explicit shade acceptance unjudged.

## Source-value check requested by the user

The user asked how accurate their color descriptions were. The SVG source files were re-read, confirming both B and D exactly encode the target. B occupies 10% of the composition, and D 40%.

The following values were calculated from the encoded sRGB channels using [W3C's relative-luminance definition](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). RGB distance is ordinary Euclidean distance on the encoded 0–255 channels; it is included as a simple comparison, not a selected ranking method.

| Example | Source color | Source area | Relative luminance | Raw RGB distance to target |
| --- | --- | --- | --- | --- |
| target | `#FF2200` | — | 0.224041 | 0 |
| A | `#FF4400` | 40% | 0.253942 | 34 |
| B | `#FF2200` | 10% | 0.224041 | 0 |
| C | `#FF0000` | 40% | 0.212600 | 34 |
| D | `#FF2200` | 40% | 0.224041 | 0 |

A has higher relative luminance than the target, and C has lower relative luminance, supporting the directions of the user's light/dark observations. The colors also differ in hue: A shifts toward orange, while C is pure sRGB red. Luminance is not a calibrated measure of how much difference this user must perceive.

A and C are equally distant from the target in raw RGB coordinates. The user's A-over-C preference remains human relevance evidence; these calculations neither invalidate it nor establish a universal preferred distance metric. No human judgment, acceptance threshold or ranking was revised by this source-value check.
