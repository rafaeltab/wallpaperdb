# composition-green-red-001 — 50% green, 50% red

Status: **user judged**, case version 2, with explicit uncertainty about transfer to real wallpapers. Development anchor in the green-red-specified-remainder group.

[Open the review](http://zerotwo:8221/evaluation/composition-green-red-001.html) · [Structured record](composition-green-red-001.json)

## Query

**“50% green, 50% red.”**

Both percentages are targets. No precise shades or subject are specified. The supplied ordering and its realism caveat are recorded below; no general tradeoff formula or exclusion rule is established.

The user previously authorized this comparison and a later **“40% green, 40% red, the rest unspecified”** request using the same images. After the first judgment they expressed a realism caveat. The assistant is deferring the second stripe query and prioritizing natural-image validation. Preserve its prior authorization; this is a workflow adjustment, not an explicit user cancellation.

## Construction and presentation

Each source is a 1600 × 900 SVG completely filled by opaque full-height vertical bands. Green is left, red follows, and blue, when present, is at the right edge. Base source colors are green #22BB44, red #FF2200 and blue #2255EE. One fixture changes only the green fill to #668066. These names describe fixture selection; they do not establish perceptual membership or user relevance.

Candidate amounts, color codes, variant names and scores are absent from captions, alt text and displayed filenames. Only the requested query amounts are visible. A single SystemRandom shuffle is pinned for reproducible annotation; page refresh does not reshuffle.

### Authoring facts — not shown in the review

| Label | Green-band source area | Red-band source area | Blue-band source area | Green fill |
| --- | --- | --- | --- | --- |
| A | 49% | 49% | 2% | #22BB44 |
| B | 50% | 50% | 0% | #22BB44 |
| C | 40% | 40% | 20% | #22BB44 |
| D | 50% | 50% | 0% | #668066 |
| E | 35% | 65% | 0% | #22BB44 |
| F | 65% | 35% | 0% | #22BB44 |

Hashes and rectangle coordinates are pinned in the JSON. All six source files are locally constructed fixtures, with no edits to corpus wallpapers.

## Review prompt

Describe how each image fits the query and give a preferred order. Ties, uncertainty and negligible differences are welcome. There is no required numeric score scale.

## Interpretation boundaries

- These six examples compare source ratios, a different green shade, and small/larger outside-blue areas. None supplies expected human relevance by construction.
- The source label “muted green” is a selection hypothesis; earlier shade judgments do not automatically transfer into this two-color context.
- Source red is not assumed to be every user's ideal red. Both colors may influence perceived balance.
- The reciprocal ratio examples have equal geometric errors but need not have equal human relevance.
- The earlier grayscale/red conceptual cases do not determine whether any blue must be penalized or excluded here.
- Blue is placed consistently at the right edge. Its area, shape and location may affect salience; no general rule about arbitrary layouts follows.
- “50%/50%” fully specifies requested amounts, but this case does not preassign a purity-versus-proportion tradeoff or a hard color exclusion.
- Subjective amount, color quality, whole-image preference, and any explicit rejection remain separate annotations.
- Preserve uncertain orderings without inventing ties, numerical confidence or score gaps.
- The planned second query changes requested amounts and leaves a remainder. Any ranking change may involve both effects; this pair does not perfectly isolate an “unspecified remainder” flag.
- Both queries and all variants form one related development group. The second review follows exposure to the first; do not treat it as independent held-out evidence.
- This is a controlled initial comparison, not natural-image or production-scale validation.

## User judgments

**Reported order for this constructed set: B > D > E > F > A > C.**

| Label | User description |
| --- | --- |
| A | This is very close to the right ratio, but it has an extra color |
| B | This is the perfect example |
| C | This has a lot of blue, red and green are in the right ratio |
| D | Its green, but not very green |
| E | Too little green |
| F | Too much green |

B is called the perfect example within this sheet. A and C have the right or almost-right relative green:red balance, but extra blue means their whole-image target amounts are not both 50%. Preserve “ratio” separately from amount correctness.

**Explicit realism caveat:** the user finds these pure-color examples difficult to translate into a real preference, because people do not normally search for pure-color blocks. In particular, the user does not know whether A should rank below E in a real image. Keep the supplied fixture order, with this transfer uncertainty attached; do not generalize an outside-color veto or scoring weight from it.

No ties, numerical ratings, quality factors or exclusion labels were supplied. Earlier single-green and conceptual gray/red judgments are separate evidence.

### Raw response

> A This is very close to the right ratio, but it has an extra color
> B This is the perfect example
> C This has a lot of blue, red and green are in the right ratio
> D Its green, but not very green
> E Too little green
> F Too much green
>
> B, D, E, F, A, C
>
> TBH, with these pure colors it is hard to tell what my real preference is. No body is searching for pure colors so I dont know if I would actually score A below E in a real example.


## Preparation checks

All six SVG hashes, fill colors, contiguous rectangle positions and widths match the record; each fixture covers the full canvas once and its source fractions total 100%. All six assets and the page returned HTTP 200, including page access through the local tailnet interface. Desktop (1280 × 1400) and mobile (390 × 844) browser checks show six loaded images, uniform 16:9 sizes per viewport, no candidate percentages and no horizontal overflow. The desktop screenshot was visually inspected. These checks verify source facts and presentation, not perceptual relevance or display calibration.
