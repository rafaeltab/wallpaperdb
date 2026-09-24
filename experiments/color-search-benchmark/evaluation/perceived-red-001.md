# perceived-red-001: named-color red

Status: **user judged; version 4, with A/F explanation and finer color-quality preference**. Category: **Perceived color**. Development anchor.

## Request

> red

A general color preference with no explicit percentages, exact shade, or subject constraint. Whether this formulation captures the user's intended default search is itself open to correction.

## Review

[Open the six-image comparison](http://zerotwo:8221/evaluation/perceived-red-001.html).

The original review requested great/acceptable/poor/unsure labels and optional ordering. The user supplied richer annotations: perceived amounts of red at different quality levels, descriptions of the relevant image regions, and a separate overall ordering. These annotation types are preserved separately. No overall great/acceptable/poor label has been inferred for an image.

The page uses existing whole-image JPEG previews without cropping, on one neutral background. Clicking opens the original. Presentation letters are stable IDs for this review, not ranks. No method names, computed amounts or scores are shown.

## Provenance

| Label | Wallpaper | Original SHA256 |
| --- | --- | --- |
| A | wallpaper-027 | `4f250c07835e1350bf69761a6f794aa39c606d59ec13ef4701197add92073b34` |
| B | wallpaper-077 | `d9d6c2683ed6006555e18a5cd09324d58df7a1f7297250f6de7e92306c37b35c` |
| C | wallpaper-060 | `418326fa9dcc4734b2a9d8c07fa6b1a5a10cdb575b44f81fd4e7e6a54a9e1c89` |
| D | wallpaper-082 | `ea18b09ac6c9e02f10beed4fbeeeb6568c5588f3c21e99dc89fbd7b699249690` |
| E | wallpaper-037 | `e045df734cd14f4b9abbf24c6abd8614b26ee9c6245a6a33f6ff1e983d1c7643` |
| F | wallpaper-048 | `d5a9bd75a36c39dc3346e36af87ab4c51514b51527a3c7e9851e0b331e945790` |

These six were manually chosen from the existing corpus contact sheets for varied appearances, independently of search outputs. The original files were not recolored or edited. Full source URLs and filenames are in [the case record](perceived-red-001.json).

## Judgment log

### User response 001

**Overall order, most to least red: E > D > A > F > C > B.** The user specified that this is “Purely based on feeling.”

| Image | User's description | Estimated area and quality of red |
| --- | --- | --- |
| A | The lit part feels very red | 30% acceptable red |
| B | The sky feels somewhat red | 50% poor red |
| C | The leaf feels very red | 10% great red |
| D | The flowers or leaves feel very red | 40% great red |
| E | The sky feels extremely red | 30% great red, 60% acceptable red, 10% poor red |
| F | The roses feel red | 50% acceptable red |

These are **visual estimates**, not measured pixel percentages. Unmentioned image areas remain unannotated. A great-red region does not automatically make the whole wallpaper a great match: C has a great-red region and ranks fifth in this group.

The ordering is the user's explicit judgment. No numerical gaps between positions, quality weights, whole-image relevance grades, or universal area-versus-shade formula are inferred. Adjacent preferences in the JSON record are derived from this single ordering, not independent user observations. The judgment applies to this general red query, not automatically to precise-shade or requested-percentage queries.

The full original response is preserved in `rawUserResponses` in [the JSON record](perceived-red-001.json).

### User response 002: why A ranks above F

The user identifies the relevant colors in **both A and F as red**. In F, the roses are explicitly dulled: they remain red when naming their color, but do not create a strong red vibe. A feels like bright red light shining onto the street, creating a stronger red impression. The user describes red as a powerful, strong color whose perceived strength is diminished by dulling it.

This explains A > F without changing either area estimate or the original ranking. It distinguishes **recognizing a color** from **how strongly that color shapes the image's overall impression**.

The explanation is recorded in full in `user-response-002`. “Brighter” and “dulled” are the user's perceptual descriptions; no saturation, luminance, HSV-value measurement or universally increasing brightness preference is inferred. The explanation concerns this general-red query, not every possible query involving muted red.

### User response 003: coarse labels hide a finer preference

The user clarified that **the red in A itself scores higher than the red in F**, but the initial four-label format could not express that distinction. Both receiving “acceptable” does not mean that their red quality is equal.

Record two distinct confirmed preferences: A's red regions have higher perceived red-match quality than F's red regions, and A ranks above F in overall redness. No numeric quality scores were supplied. Keep the original labels and raw replies, supplemented by this finer comparison.

This identifies a limitation in the annotation format. It does not establish that an area-and-color-quality approach necessarily needs a separate spatial/context scoring component. Future reviews should allow descriptions, finer scores or relative judgments without forcing all nuance into the initial labels; a numerical scale has not yet been selected.
