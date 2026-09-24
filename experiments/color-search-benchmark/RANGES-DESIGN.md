# Prototype design: color regions and image proportions

This extends the proportion experiment with a region around each selected color. It is separate throwaway code; the earlier cosine/L2/palette results remain unchanged.

## Meaning of a query

A target consists of an anchor color, an absolute fraction of image area, and one or more region constraints. For example:

```json
[
  {"color":"#FF0000","amount":0.7,"ranges":[{"space":"hsl","h":0.1,"s":0.2,"l":0.15}]},
  {"color":"#000000","amount":0.3,"ranges":[{"space":"hsl","h":1,"s":0.02,"l":0.1}]}
]
```

This requests approximately 70% reddish area and 30% dark neutral area. A pixel must satisfy **every constraint** listed for its target. Constraints on two spaces mean an intersection, not a choice between alternatives.

Fractions remain absolute: 40% green with 60% unspecified does not become a 100% green query. The confirmed default is close to 40% total, with excess penalized. Minimum mode separately means at least 40%.

## Region controls

| Space | Shape and interpretation |
|---|---|
| OKLab | A ball around the anchor with an absolute perceptual-coordinate radius, from 0 to 1.5. |
| RGB | Independent red, green, and blue tolerances around the anchor, on encoded sRGB channels from 0 to 1. |
| HSL | Independent hue, saturation, and lightness tolerances. |
| HSV | Independent hue, saturation, and value tolerances. |

RGB, saturation, lightness, and value tolerances are absolute component differences: `.1` means ten percentage points, not 10% of the anchor's value. Boundaries are inclusive with a small numerical tolerance. Zero radius includes the anchor itself.

Hue uses the shortest angular difference around the circle. Its tolerance is expressed as a fraction of the maximum difference of 180°: `.1` allows ±18°, `.2` allows ±36°, and `1` allows every hue. Red at approximately 359° is close to red at approximately 1°. HSL hue wraps, and gray has no meaningful hue. These are properties of the color model; the choice to reject restricted-hue achromatic anchors and candidates is this prototype's explicit policy. [W3C CSS Color 4](https://www.w3.org/TR/css-color-4/#the-hsl-notation)

### Two different meanings of “black”

- **Dark neutral gray:** anchor `#000000`, HSL `h:1, s:.02, l:.1`. Accepts `#161616`; excludes medium gray and saturated dark blue.
- **Any dark color:** anchor `#000000`, HSV `h:1, s:1, v:.25`. Accepts dark saturated blue, red, green, and neutral gray.

HSV value and HSL lightness differ; their saturation coordinates also differ. A dark chromatic color may remain highly saturated. Treating undefined black/gray hue as red would be an implementation error. [Qt QColor documentation](https://doc.qt.io/qt-6/qcolor.html#the-hsv-color-model)

## Ranking: area first, central shades second

The user's refinement is that the anchor should have full quality and the region edge half quality. **This does not halve an edge pixel's area.** An image with 70% valid edge colors still supplies 70% of the requested region.

The graded mode therefore minimizes a pair of costs in strict priority order:

1. **Composition cost:** match the requested area fractions using hard region membership.
2. **Color cost:** among equally good compositions, prefer pixels closer to each region's anchor.

This is lexicographic optimization: a better second cost never compensates for a worse first cost. A correct 70% portion near the region edge wins over an incorrect 65% portion exactly at the anchor. For equally correct 70% portions, the anchor wins.

For a point inside a region, let `t` measure its normalized distance to the edge: 0 at the anchor, 1 at the boundary. OKLab divides the distance by the radius. Channel boxes take the largest normalized channel difference; combined constraints take the largest of their normalized distances. A zero-width axis only accepts its anchor coordinate, subject to numerical tolerance.

```text
quality(t) = 2^(−t²)
secondary color cost = 1 − quality(t)

anchor: t = 0 → quality 1.0
edge:   t = 1 → quality 0.5
```

Any channel tolerance of `1` means **unrestricted** and is ignored in center preference. This applies to RGB channels, hue, saturation, lightness, and value. Thus an “any dark color” HSV query does not prefer neutral dark gray over equally dark saturated blue; only its constrained value coordinate matters. Hue has no preferred direction for an achromatic anchor and must not invent a red center. OKLab radius `1.5` remains a radial preference rather than a special unrestricted flag.

The transport solver allocates the palette's actual area weights. Requested destinations have fixed demands. Each palette portion can be allocated only once. In graded mode, primary cost is 0 for an accepted region and 1 otherwise; secondary cost uses the in-region quality above, 1 outside, and 0 for the unspecified destination. Exact mode charges primary cost 1 when requested-region pixels are placed in the unspecified destination; minimum mode leaves that destination free.

Two comparison modes remain useful:

- **Hard:** every accepted shade gets equal quality; rank by composition alone.
- **Soft outside:** full affinity inside the region and a Gaussian decline only outside. This compares an alternative boundary treatment, rather than the user's new center-preference rule. It is not the default graded interpretation.

The returned fit score is a ranking score, not accuracy, confidence, or a matching-pixel percentage. The transport plan always fills requested demands, including with mismatching pixels when necessary; raw incoming flow is not evidence that a requested color exists.

## Overlap is a joint allocation problem

Overlapping regions may describe the same pixels. `available[j]` measures each region separately and therefore may sum above 100%. `assigned[j]` measures accepted mass actually allocated to that destination and cannot count a pixel twice. `overlap` is image mass accepted by two or more regions; `outside` is accepted by none.

**Zero composition cost means a feasible partition into requested portions.** It does not mean each independent region's coverage equals its requested amount. If two regions both accept the whole image and each requests 50%, their independent available areas are 100% and 100%, while a valid assignment allocates 50% to each. A 20% patch accepted by two regions cannot satisfy two separate 20% portions by itself.

Same anchor with different constraints represents different regions and must remain separate. Exact duplicates, including reordered constraints, merge by adding their requested fractions. Assignments can be nonunique; they do not identify spatial image segments.

## Durable validation and fixtures

Run `make color-ranges-diagnose`. The assertions live in [ranges-diagnose.mjs](ranges-diagnose.mjs). [ranges-fixtures.json](ranges-fixtures.json) describes **20 synthetic SVGs with analytically known areas**, independently of the downloaded wallpaper corpus. Their images have only the specified flat-color rectangles, so labels do not contaminate the area fractions.

Checks cover exact 70/30 compositions; neutral-black versus any-dark regions; hue wrapping and unrestricted hue; undefined-hue handling; RGB channel boundaries; AND constraints; zero radii; duplicate and overlapping regions; exact versus minimum proportions; prepared/raw parity; and invalid inputs. Graded cases verify that edge mass remains full area, boundary color quality is half, area takes priority over centrality, and unrestricted axes do not bias shade preference. A separate exhaustive unit-allocation oracle checks the two-cost solver on 300 seeded small transport problems without sharing its residual-network implementation; another 500 continuous two-cost problems are checked against a closed-form 2×2 optimum.

An additional audit case exposed a numerical color-conversion hazard: nominal white can acquire a spurious high HSL saturation after an approximate OKLab→RGB round trip, because HSL divides by a quantity approaching zero near white. The implementation now treats RGB channel spreads no larger than `1e-6` as achromatic; this is far below one 8-bit channel step. The regression confirms that stored pure-white palettes remain inside a grayscale region.

**Validation on 2026-09-16:** all **28 diagnostic groups passed**. Across the 300 exhaustive and 500 continuous oracle cases, maximum primary-cost disagreement was `2.22e-16`; maximum secondary-cost disagreement was `1.11e-16`. These are numerical correctness checks of the chosen objective, not human relevance measurements.

## Limits that matter

1. **A 32-color palette can straddle a hard boundary.** A cluster center may fall inside a region even when some represented pixels fall outside, or the reverse. Narrow RGB/HSL/HSV constraints make this more noticeable. The primary reference should classify an independent sample of original pixels, then compare palette scores and rankings against that reference.
2. **Hard boundaries are intentionally discontinuous.** A tiny color shift outside the region can change area attribution. Graded quality smooths preference inside the region; it does not change the primary membership boundary.
3. **Coordinate boxes are not perceptually uniform.** Equal RGB or HSL changes need not look equally different. OKLab is the perceptual-radius option; its distances are still approximations of human judgment.
4. **Range overlap changes the meaning of exact proportions.** Treat the query as a joint allocation into portions and explain the overlap rather than presenting independently summed region counts as a literal composition.
5. **Geometry is absent.** Matching 70% red above 30% black and matching scattered pixels with the same fractions are equivalent here.
6. **Closest results can still be weak.** Known-area fixtures establish semantics, not usefulness on arbitrary wallpapers. Keep real-image results and original-pixel agreement separate from synthetic correctness claims.

This extension needs its own retrieval-recall experiment before production use. Earlier vector candidate rankings were tuned for color presence; region and proportion queries can favor different images.
