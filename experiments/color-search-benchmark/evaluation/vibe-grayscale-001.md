# vibe-grayscale-001: neutral grayscale appearance

Status: **user judged; corrected ordering confirmed; version 3**. Category: **Vibe**. Development anchor.

## Request

> grayscale

The intended appearance is neutral gray, black, and white. This request is distinct from simply using little color or using mainly one colored hue. Whether a faint tint remains an acceptable match is for the user to judge.

No percentage, exact shade, or subject is specified. This case describes a user-visible appearance, not a numerical saturation cutoff or pixel-membership oracle.

## Review

[Open the six-image comparison](http://zerotwo:8221/evaluation/vibe-grayscale-001.html).

Describe how well each whole wallpaper fits and whether any tint affects that judgment. An overall order, specific comparisons, and finer scores are welcome if useful. There is no required set of labels or numeric scale. Preserve ties, uncertainty, and acceptable alternative orders instead of forcing a full ranking.

The page uses existing whole-image JPEG previews without cropping, on the same neutral background as the red case. Clicking opens the original. Stable A–F presentation letters are not ranks. The page shows no source filenames or titles, method names, color descriptions, computed measurements, or scores.

## Provenance

| Label | Wallpaper | Original SHA256 |
| --- | --- | --- |
| A | wallpaper-092 | `56283b09d526e4f07384bab7eda59157c22ece79371ce37b896b7247dbc23604` |
| B | wallpaper-066 | `09e67407b86208f17e1122ca6395c02cf7e34acac3a4d468cd7a5e8eecf934c4` |
| C | wallpaper-096 | `640bc7d99597ee2a16569726b71936b562b1c84fbdb6db882d0ffb0d0e1bab3f` |
| D | wallpaper-070 | `926206385f2509d9e1d911668ea0109ff25654963efe6bfe4a66c89778d04849` |
| E | wallpaper-007 | `c818094c152bbe35cf864abda86dae5f18a069b716124f4102b44c49478e6850` |
| F | wallpaper-061 | `c9687d1401a91e906ced6d39e5873ebc20f29a95c853959773b175bfc551904a` |

These images were manually selected from the existing corpus for discussion of neutral appearance, faint tints, one-hue palettes, and low color. Selection does not assign an expected judgment. The fixed nonsorted order above is preserved for this review.

Originals and existing previews were not recolored, resized, or otherwise edited for this case. Full source URLs, source commit, filenames, and original dimensions are in [the JSON record](vibe-grayscale-001.json). Existing JPEG previews can differ from originals because of display size and encoding.

## Judgment log

### User response 001

| Label | User assessment | User's percentage expression |
| --- | --- | --- |
| A | Monochromatic, technically not grayscale, yet more grayscale than not grayscale. | Not supplied |
| B | Pretty much the definition of grayscale. | 100% grayscale |
| C | Not grayscale. | 0% grayscale |
| D | Pretty much the definition of grayscale. | 100% grayscale |
| E | Very close to grayscale; hard to see in the darker parts. | About 50–80% grayscale |
| F | Pretty much the definition of grayscale. | 100% grayscale |

These are subjective descriptions, not measured pixel coverage or calibrated numeric scoring targets. Preserve E's range and uncertainty; do not assign A an inferred numerical percentage. The exact raw response is preserved in the JSON record.

**Written order, verbatim:** `A + D + F, E, A, C`.

### User response 002 — correction confirmed

> yep, mistyped sorry

The user confirmed that the first A was a typo for B. **Confirmed order: B, D and F together first, then E, A, C.** The top group has no required internal ordering or requirement for equal numerical model scores.

The JSON record preserves both raw responses, the corrected groups, and adjacent-group preferences. These preferences derive from one ordering judgment, not independent evaluation cases.

The judgment format remains open. Coarse labels do not imply equal quality: finer comparisons within a label can be recorded independently. Do not invent score values or a numeric scale for the user.

If the user provides regional estimates as in the red case, record those separately from whole-image acceptability and overall ordering. Do not infer a numerical threshold for grayscale, or assume that a tinted image is unacceptable before human review.
