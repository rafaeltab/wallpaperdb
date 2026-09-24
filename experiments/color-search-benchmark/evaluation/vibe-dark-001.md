# vibe-dark-001: overall dark appearance

Status: **user judged; version 2**. Category: **Vibe**. Development anchor.

## Request

> dark

A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.

No percentage, exact shade, or subject is specified. This case describes a user-visible appearance, not a numerical darkness cutoff or pixel-membership oracle.

## Review

[Open the six-image comparison](http://zerotwo:8221/evaluation/vibe-dark-001.html).

Describe how well each whole wallpaper fits. An overall order, specific comparisons, and finer scores are welcome if useful. There is no required set of labels or numeric scale. Preserve ties, uncertainty, and acceptable alternative orders instead of forcing a full ranking.

The page uses existing whole-image JPEG previews without cropping, on the same neutral background as the earlier cases. Clicking opens the original. Stable A–F presentation letters are not ranks, and their mappings are specific to this case. The page shows no source filenames or titles, method names, image descriptions, computed measurements, or scores.

## Provenance

| Label | Wallpaper | Original SHA256 |
| --- | --- | --- |
| A | wallpaper-054 | `2b92b1ab944cdcb6274ea959fecf9c6a62bed4062c22ba7615b4a14b82557c1e` |
| B | wallpaper-022 | `544c5a8d83c439fcdda97d55f923c22ca930abe871abb5028fcd6ca1dde52078` |
| C | wallpaper-010 | `bc9b1d219e079cc53c647266f91517cb9464ae4a6d16c9b1c653bfc64eaadc86` |
| D | wallpaper-067 | `5c6c38c093055c135f55dc68c55e191606de32a63ccffd9df6733cde26df655e` |
| E | wallpaper-091 | `9bd46d4e1b4034bb9a238d194a691f7370e349ca95c283bd06a539b60a687052` |
| F | wallpaper-068 | `0a4f4018a08fc37855662e2f4f59c34b6a210fc3949453eb1fe79da977daf224` |

Manually selected existing corpus images to discuss overall darkness, bright highlights, colored areas, larger light areas, and midtones. These are sampling considerations, not expected relevance judgments or search results. The fixed nonsorted order above is preserved for this review.

Originals and existing previews were not recolored, resized, or otherwise edited for this case. Full source URLs, source commit, filenames, and original dimensions are in [the JSON record](vibe-dark-001.json). Existing JPEG previews can differ from originals because of display size and encoding.

## Judgment log

### User response 001

| Label | User description | Estimated area | Perceived darkness of that area |
| --- | --- | --- | --- |
| A | Not really dark, more light; some darkness from the foreground. | 10–20%, associated with the foreground | Not separately supplied |
| B | Definitely dark, but not maximum dark. | 80% | 70% |
| C | Not dark. | Not supplied | Not supplied |
| D | Nice and dark; explicitly generalizing a gradient. | 90% | 100% |
| E | 60% area at 100% dark. | 60% | 100% |
| F | 50% area at 90% dark. | 50% | 90% |

**Confirmed overall order: D > B > E > F > A > C.**

The exact raw response is preserved in the JSON record. Area and darkness strength are separate subjective estimates, not measured coverage, luminance coordinates or whole-image scores. A's foreground range has no separately supplied darkness-strength value. C's qualitative judgment does not assign an exact 0% pixel count. D's 100% darkness is an explicit simplification of a gradient, not a claim that the area is uniformly RGB black. Unmentioned areas remain unannotated.

**Useful comparison:** B ranks above E, despite the described region being larger but less dark. Preserve the direct preference; the approximate estimates and unannotated remainder do not establish or refute a universal area-times-darkness formula. The five adjacent preferences in JSON derive from one ordering judgment, not five independent cases.

The query does not impose a numerical cutoff or require black, grayscale, or a particular subject. These judgments establish preferences among these six images; they do not specify a universal rule for highlights or colored regions.
