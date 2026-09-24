# Color-query goals — ongoing design discussion

## Status and working agreement

The user wants to establish an **accuracy/performance feedback loop before narrowing methods**, then use it to compare options, combine them and optimize iteratively. On 2026-09-20 they explicitly corrected the assistant's premature shortlist-first proposal. The [common evaluation loop](evaluation/loop/README.md) is the current deliverable; existing formulas are initial integration controls, not selected finalists. Earlier experiments remain evidence, not an approved product design. In particular, a fixed catalogue of 18 regions is not an accepted restriction.

This document preserves user-stated goals and distinguishes them from proposed terminology and open questions. No representation, score formula, query interface or retrieval algorithm is selected here.

**Current evidence:** 37 logical judged records, comprising 13 prior records and all 24 comparisons in [batch 001](evaluation/batch-001-results.md). The user qualified the entire new batch: “I have submitted the answers, I went quite quickly, so dont regard this as 100% accurate human perception preference, some of these will be ranked very differently by different people”. These are one observer's quick-pass preferences, not definitive or universal ground truth. Variation between people is expected but unmeasured. Preserve the reported orders, specific uncertainties and raw notes; do not invent numerical confidence, weights or ties. Related queries and reused images are not independent validation evidence.

## User-stated goals

### Perceived color

Users search by how a wallpaper feels. For the intended red-search behavior, orange can feel more red than pink does, despite pink's relationship to lighter reds. Sufficient area of nearby, relevant colors can be preferable to a small patch of exact red.

This is a product expectation, not a claim that every observer orders every orange and pink sample that way. A successful representation must be evaluated against the intended judgments rather than assuming a geometric distance defines them.

In the first real-wallpaper review, the user distinguished **color identity** from **strength of the color impression**: both muted roses and bright red illumination are recognized as red, but the illumination creates a stronger red vibe. The roses' deliberate dulling weakens that impression without making their color cease to be red. This explains A > F in [perceived-red-001](evaluation/perceived-red-001.md). The original region-area estimates and ranking remain unchanged. No numerical color-space definition of brightness/dullness, universal brightness rule, or generalization to every color has been selected.

The user further clarified that A's red itself has higher match quality than F's; the initial four response categories could not express that finer difference. Two regions labeled “acceptable red” need not have equal perceived quality. Preserve this finer regional preference separately from the overall wallpaper order, without inventing numerical scores or assuming an extra image-context mechanism is required.

### Vibe

Users ask for dark, light, grayscale, bright or a general red theme. Some want strict grayscale; others accept a slightly brown or otherwise tinted, nearly single-hue appearance. A red theme can include varied supporting colors. A uniformly bright red wallpaper is not automatically the intended best result.

In [vibe-grayscale-001](evaluation/vibe-grayscale-001.md), the user describes neutral examples B/D/F as 100% grayscale, C as 0%, E as about 50–80% with uncertainty in dark parts, and monochromatic A as technically not grayscale but more grayscale than not. The confirmed preference is B/D/F together first, then E, A, C. Preserve these subjective descriptions and partial acceptance of tint; they do not establish measured pixel coverage, a saturation cutoff or a universal rule for monochromatic images.

In [vibe-dark-001](evaluation/vibe-dark-001.md), the user separately estimates how much area is dark and how strongly it feels dark. Confirmed order: D > B > E > F > A > C. In particular B (80% area at 70% darkness) outranks E (60% area at 100% darkness); D's 90% at 100% is explicitly a generalization of a gradient. Preserve direct preferences alongside approximate regional descriptions. These are not luminance definitions, numeric whole-image scores or a settled rule for combining area and strength; unmentioned areas remain unannotated.

### Combinations

- Mostly neutral/low-color imagery with red as the remaining colored accent.
- Trans-flag-inspired pink, white and sky blue, potentially with requested proportions.
- Fall colors: green, red, orange and yellow.
- City-at-night appearance: mostly dark with small, very bright areas.
- Nationally inspired palettes, such as white/red for Japan or red/white/blue/orange for the Netherlands; these are appearance requests, not necessarily pictures of flags.

Combinations can express relative amounts, a palette theme, or background/accent relationships. The examples do not establish one universal objective for all three.

In [combination-gray-red-001](evaluation/combination-gray-red-001.md), the confirmed order for “mostly grayscale, with red accents” is F > E > A > B > D > C. The user found this difficult. B has good red and white that may technically qualify as grayscale, yet feels like “white with red” rather than the intended grayscale-with-red appearance. F best expresses the combination with a grayscale background and red roses, though their muted red is a limitation. A's weak grayscale appearance and red that does not pop out make it frustrating to grade. E has really good red and an estimated 30% grayscale area of decent quality on buildings.

These are image-specific judgments with an explicit ranking, not calibrated absolute grades. They do not exclude white from grayscale, prove a need for spatial features, impose a tonal-distribution rule or establish universal weights for the two components. F is best of this set, not a confirmed ideal. Preserve the user's difficulty and A-specific dissatisfaction alongside the ranking.

The [three-image follow-up](evaluation/combination-gray-red-002.md) establishes a positive reference: A, a red telephone box against a neutral scene, is described as “Beautiful bright red with perfect grayscale, textbook example.” Confirmed order: A > C > B. C's red is slightly darker but still vibrant; B's roses have reduced red and a slightly blue-ish grayscale background. Preserve the distinction between darker and dulled, without assigning numeric color coordinates or a universal brightness preference. The roses' earlier description remains valid historical evidence; this new observation does not establish why the tint was noticed here. No numeric whole-image grades or area percentages were supplied.

For the controlled [50% green / 50% red case](evaluation/composition-green-red-001.md), the user reports **B > D > E > F > A > C**, but explicitly doubts how the pure-color examples represent real wallpaper preferences. In particular, E over A may not hold for natural images. Preserve the supplied order and this transfer caveat together. B is a perfect reference within the constructed set; A/C's relative green:red balance does not establish that both requested whole-image amounts are met. No universal blue veto, purity weight or amount-versus-shade tradeoff follows.

The related [natural-image review](evaluation/composition-green-red-real-001.md) is judged for the same 50% green / 50% red query: **D > A > B > C**. D is really good but needs brighter red and green to feel perfect; A feels nicely red and green but has insufficient red; B's red is not strong enough. C is explicitly not what the user seeks for this query, without an explanation or hard eligibility rule. These observations distinguish perceived amount, color strength and overall relevance without supplying exact coverage, score gaps, an ideal match or a universal brightness preference. B's weak red must not automatically become a low-area label. Different scenes cannot isolate the effect of blue or recreate the controlled A/E comparison.

The [natural-image partial-composition review](evaluation/composition-green-red-real-002.md) received **A > B > D > C** in batch case 1 for **40% green, 40% red, remaining 20% any color**, with no case-specific note and the batch-wide caveat above. It reuses the same original photos with fresh shuffled labels. These remain whole-image targets, not a normalized 50/50 ratio. It adapts the previously authorized partial-query direction to photos; the stripe version stays deferred rather than cancelled. Both requested amounts and the unspecified remainder change, so responses cannot isolate a remainder-only effect. Treat both photo reviews as related development evidence subject to recognition and carryover, not independent or fully blind validation.

The submitted batch also compares the same grayscale/red images under **80% grayscale / 20% red** and **80% grayscale / 10% red** (cases 17–18). The roses/poppies preference reverses, with the explicit note that the roses have too much red at the lower target. This is useful query-sensitive evidence, subject to the whole-batch caveat; both the red target and unspecified remainder change, so it does not isolate one cause or determine scoring weights. Case 17 again distinguishes the desired grayscale appearance from white-with-red. Preserve that perceptual observation without technically excluding white from grayscale. The user says C > B definitely feels better despite not knowing why; missing explanation is not uncertainty about that order.

#### Concrete user ordering preferences

For **80% grayscale / 20% red**:

| Wallpaper | User judgment |
| --- | --- |
| 90% grayscale / 10% red | Should rank higher |
| 80% grayscale / 18% red / 2% blue | Should rank lower |

This establishes that avoiding 2% unrequested blue outweighs the larger gray/red proportion mismatch in this particular comparison. It is an ordering preference, not an instruction to exclude every image containing blue. It does not establish that palette purity always outranks any amount mismatch.

For **80% grayscale / 10% red**, leaving 10% unspecified:

| Wallpaper | User judgment |
| --- | --- |
| 90% grayscale / 10% red | Scores highly |
| 80% grayscale / 18% red / 2% blue | Also scores highly; no strong preference between the two |

The user tentatively expects the second wallpaper might win on technical grounds but does not require that ordering. Preserve “both good, winner unsettled” as the product judgment; no algorithm should be selected merely to force that tentative tie-break.

**Clarification confirmed:** the user meant 18% red, not 1%. Both queries compare the same two complete wallpaper compositions. There is no unknown 17% of the image.

**Working interpretation, not a settled universal rule:** a fully specified palette signals a stronger preference against outside colors; a partially specified palette leaves some room for other colors. Percentage closeness still matters, with its interaction with that preference unresolved. Do not convert requested percentages into minimum requirements or infer that any amount of arbitrary outside color is acceptable.

### Precision

Some users pick a specific shade such as `#FF2200`, signaling that closeness to that color matters. The user explicitly clarified that the goal is colors as close as possible, with nearby colors still eligible; this is not an exact-equality-only filter. Fine shade distinctions must remain expressible. A distance formula, any optional cutoff, and general weighting against amount remain design questions.

In [precision-shade-001](evaluation/precision-shade-001.md), the user ranks B/D together first, then A, then C. B (10% target shade) and D (40% target shade) are described as precise matches with “pretty sure” confidence. A (40% #FF4400) feels a bit light; C (40% #FF0000) noticeably darker. Preserve these perceived descriptions without turning them into measured lightness coordinates. The smaller target-color region outranks larger nearby-color regions here; this does not establish that any tiny exact patch always wins or that amount never matters. The top group imposes no internal ordering or identical numerical-score requirement. Lower-ranked nearby colors are not labeled rejected.

### Semantic filtering

Color search composes with tags, descriptions and other search signals. Subject matter and visual appearance are distinct requests: “contains a rainbow” need not be inferred from color, while “uses rainbow colors” should work for images without a literal rainbow.

In [semantic-red-city-001](evaluation/semantic-red-city-001.md), the user treats the city tag as required: B's red leaves match red but are excluded for subject mismatch. Assuming C qualifies as city, the confirmed order is **C > D > A**. C has a red vibe; D's red sign is a stronger match than A's car lights, though both D and A are weak red matches and remain eligible. C may be a village or a less tall city area; the user would accept an author identification as a village. This is conditional relevance evidence, not verified metadata or a universal author-authority rule. A's “city 100%” means an unequivocal subject match, not measured area or a calibrated confidence score. Do not generalize this case to all natural-language subject requests or place excluded B at the bottom of a ranking.

## Prior requirements still relevant

The [40% green case](evaluation/proportion-green-001.md) adds a confirmed example of asymmetric amount preference: **F > C > D > A > B > E**. C20% ranks above A60% using the same source shade, although both differ from the40% target by20 percentage points. The user explains that40% feels like “less than half,” so green occupying more than half feels off. This is evidence for the particular comparison and perceived balance; it does not establish a universal undershoot preference, a hard50% limit or a discontinuous scoring step.

F40% has the right amount and is very green. B40% and D40% have the right amount according to the user, but feel more gray and more yellow than green, respectively. C outranks D; A outranks B. These demonstrate specific amount/quality tradeoffs without supplying a universal weight or effective-green percentage. Preserve both amount and shade observations rather than silently converting quality into fractional area.

- Explicit percentages are targets: for “40% green, remainder unspecified,” 80% green should rank below a comparably matching 40% green image.
- The amount-hidden, shuffled [closer-amount follow-up](evaluation/proportion-green-002.md) gives a **tentative** order A > E > C > B > F > D (“something like that?”). All three equal-error pairs favor their under-target example, including pairs below half; B nevertheless outranks F, so this is not a blanket preference for less green. The user supplied no explicit interchangeability groups or substantial gaps. Preserve the ordering's uncertainty without inventing ties, confidence numbers, a sharp50% boundary or a scoring formula.
- Queries may specify several portions, including totals below 100%.
- The user expressed interest in separate color-range controls and a graded center preference, with the center worth 100% and the edge 50%. Earlier prototypes interpreted that as full accepted area plus a separate preference for central colors; this interpretation should be revisited against the broader product goals rather than treated as the only possible score.
- Query correctness must be considered over the eligible collection. Reranking an arbitrary capped candidate subset does not establish global winners.
- Priorities: perceived accuracy and speed are crucial; flexibility follows; then service resources, OpenSearch resources and finally storage.

## Proposed distinctions to discuss — not accepted decisions

### Color family versus precise shade

A named-color query such as “red” may use a perceptual family and amount/prominence preferences. A picked hexadecimal shade expresses a more specific target. They can share underlying measurements without being forced to use identical tolerances or ordering.

### Separate dimensions within vibe

- **Strict grayscale:** the user's neutral-only intent, with any practical tolerance still to define.
- **Low saturation / muted:** weak color, potentially across several hues.
- **Monochromatic:** concentrated around one hue, potentially brown, blue or another color and potentially strongly saturated.
- **Lightness:** dark versus light appearance.
- **Colorfulness:** subdued versus vivid color.
- **Highlight distribution:** how much bright area appears against the rest of the image.

“Bright” may refer to lightness, colorfulness, highlights or a combination. These are proposed distinctions, not settled UI controls or numerical definitions. A global average alone would not distinguish a dark scene with a few bright lights from a uniformly medium-light image with the same average.

### Global properties versus composition portions

Darkness and redness can describe the same image area. A proposed global “dark” vibe constraint should therefore coexist with color amounts rather than automatically consume an exclusive composition portion. Explicit portions and overlapping global properties may need different semantics. The earlier joint-allocation scorer does not settle this product question.

### Palette theme versus background and accents versus exact proportions

“Fall colors,” “neutral with red accents,” and “40% red / 60% neutral” need not rank identically. Background/accent queries may also prefer an absence of competing accent colors. A pixel-area histogram does not say whether a color forms one object, many objects or scattered noise; whether that spatial distinction matters remains open.

### Preferences versus strict constraints

Closeness can affect ranking, while users seeking precision may also want strict exclusions. The current examples support discussing both, without silently turning every color preference into a hard filter.

## Remaining discussion

The concrete comparisons are recorded, including uncertainty about how the pure-color composition order transfers to real wallpapers. The broader tradeoff between proportion closeness and unrequested colors remains open; preserve these examples before generalizing how unspecified area changes that preference.

The batch adds five explicitly uncertain pairs: case 5 A/B, case 6 B/D, case 7 B/D, case 23 C/A and case 24 B/D. Keep those flags alongside the submitted strict orders. Case 19's tentative black/dark remark has an ambiguous referent and does not establish that black fails a dark query. The [batch results](evaluation/batch-001-results.md) retain the complete observations; an ordinal position alone does not imply rejection or a measured preference gap.

The user permits downloading 1,000 or more wallpapers if useful and asks to keep them outside a worktree for future reuse. This expands case-sourcing scope without selecting a search method or authorizing benchmarks. [CORPUS-STORAGE.md](CORPUS-STORAGE.md) records the shared collection and source provenance.

The user proposed a structured evaluation phase, similar to Evalite: score candidate solutions on several criteria and optimize iteratively. [EVALUATION-PHASE.md](EVALUATION-PHASE.md) records a proposed process for joint discussion. No metric weights, framework, candidate method or implementation work has been selected by that proposal.

## Implications for the options discussion

The [method-choice discussion paper](METHOD-CHOICE-DISCUSSION.md) retains research on candidate representations and retrieval, but its shortlist-first recommendation is superseded. The [common feedback loop](evaluation/loop/README.md) should enable broad comparison before selection. Explicit amount targets are only one query goal. Fixed-region counts, fine or multiresolution histograms, palettes and learned representations remain options; none is chosen by this document. Better storage precision alone does not establish better perceived relevance. A method's disagreement with an individual preference should be reported and inspected rather than automatically called an incorrect algorithm.
