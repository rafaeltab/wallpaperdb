# Color method options: perception and representation

Research/design review: **2026-09-19**. No method selected or implemented by this review.

This document compares ways to represent and score appearance. OpenSearch execution is a separate design axis: a useful appearance score still needs a retrieval plan that preserves the intended winners. See the current [joint discussion paper](METHOD-CHOICE-DISCUSSION.md) and [OpenSearch feasibility review](METHOD-OPTIONS-OPENSEARCH-REVIEW.md). [GLOBAL-OPTIONS.md](GLOBAL-OPTIONS.md) retains earlier execution research; its historical implementation priorities are not new authorization.

Evidence: [color-query goals](COLOR-QUERY-GOALS.md), [24 submitted comparisons](evaluation/batch-001-results.md), and their linked earlier cases. There are **37 logical judgment records**, with related queries, reused images and one reviewer. The entire new batch carries the user's quick-pass and interpersonal-variation caveat. These observations help distinguish hypotheses; they do not establish universal preferences or enough independent evidence to train a complex ranking model.

## Main proposal for discussion

Compare **interpretable color/vibe measurements** with **a finer color distribution that supports arbitrary shades and ranges**, retaining cosine/L2 as controls. Consider transport as a separate quality challenger, and add spatial or learned features only where they answer demonstrated shortcomings. These components can coexist; they are not six mutually exclusive architectures.

The critical distinction is between:

- **Amount:** how much of the image belongs to a requested color or appearance.
- **Match quality:** how convincingly that area matches, including dull versus vivid red or proximity to a picked shade.
- **Composition:** how requested amounts, other colors and unspecified area interact.
- **Context:** whether the arrangement or overall image makes those colors feel prominent.

These are proposed modeling distinctions, not settled UI controls or a prescribed formula. A representation should preserve information needed to study them separately before a score combines them.

The existing judgments already caution against making amount closeness an absolute first priority: in the controlled 40%-green case, the user preferred 20% convincing green to an example described as the right amount but too yellow. If those amount and quality descriptions are retained, a strictly amount-first ordering cannot reproduce that preference. The evidence supports comparing tradeoffs without treating the earlier prototype's amount-first rule as settled intent.

## Six options

| Option | What it changes | Most promising use | Main limitation |
| --- | --- | --- | --- |
| 1. Existing histogram with cosine / L2 | Distance over the same stored descriptor | Cheap controls; diagnose metric-only improvement | Missing color meaning and composition semantics remain missing |
| 2. Named-color and vibe measurements | A small, explicit set of appearance measurements | Common color/vibe queries; understandable amount targets | Fixed measurements cannot fully express arbitrary picked shades/ranges |
| 3. Fine color distribution with smooth query functions | More detailed color evidence and query-dependent matching | Precise shades, flexible ranges, proportions | More values and query work; global distribution omits arrangement |
| 4. Palette/distribution transport | How color mass is matched to a desired composition | Full palettes and nearby-color substitutions | Unspecified area and named-color meaning require extra design |
| 5. Spatial or prominence features | Where color appears and how concentrated it is | Background/accents or focal-color appearance | More extraction/modeling; current evidence does not prove necessity |
| 6. Learned embedding or constrained ranker | Learned appearance similarity or combination of measurements | Broad vibe and residual preferences | Exact percentages/shades need explicit evidence; current labels are sparse |

### 1. Existing histogram, cosine versus L2

Keep the extractor and query construction fixed when comparing these metrics; otherwise this is not a metric-only control. L2 compares coordinate differences, whereas cosine compares vector direction. Neither gives two neighboring color bins a special relationship merely because their represented colors are similar. Cross-bin matching addresses a different issue from changing a bin-by-bin distance. [Rubner, Tomasi and Guibas, sections 2–4](https://ai.stanford.edu/~rubner/papers/rubnerIjcv00.pdf).

Two mathematical cautions for hypothetical query encodings:

1. If a single-color query is encoded only as `0.4 × green_vector`, cosine gives the same ordering as `0.8 × green_vector`: scaling the query does not change its direction. This does not claim the repo currently encodes every proportion query this way.
2. Encoding a partial query as `[green=.4, red=0, blue=0, ...]` under ordinary L2 treats unspecified colors as desired zero values. It can prefer spreading the remaining mass across many bins. For example, `[.4,.3,.3]` is closer to `[.4,0,0]` than `[.4,.6,0]`, despite both having exactly the requested green and an unspecified remainder.

Therefore the controls are useful, but L2 alone is not a solution to “40% green, any other colors.” Normalization and query construction are part of the method and must be recorded. With both vectors normalized to unit L2 norm, squared L2 equals `2 − 2×cosine`; those exact comparisons produce the same ordering.

### 2. Interpretable named-color and vibe measurements

Store measurements such as red-family area, green-family area, neutral area, several lightness-band amounts, hue concentration, and color-strength summaries. Named families can use definitions informed by perceptual labels rather than distance to a single RGB sample. Research has explicitly learned color names from real images and distinguished pixel-only from region-informed naming; that supports considering this as a separate representation choice, not adopting its model or color vocabulary unchanged. [Van de Weijer, Schmid and Verbeek](https://lear.inrialpes.fr/people/vandeweijer/papers/cvpr07.pdf).

Potential strengths:

- “Red” can differ from “close to #FF0000”; pink need not be strongly rewarded as red.
- Measured green amount can be compared to 40% or 70%, making query-sensitive order changes expressible.
- Lightness-band amounts can distinguish a predominantly dark image with bright highlights from an image uniformly near the mean lightness.
- Neutral area plus its tonal distribution offers a hypothesis for white-with-red versus the desired grayscale-with-red appearance.

Costs and limits:

- The definitions need calibration against diverse images and reviewers. Handwritten rules are interpretable, not automatically accurate.
- A single red-area number loses the difference between dulled roses and vivid red illumination. Preserve a separate strength distribution or statistic.
- Fixed features constrain arbitrary shade/range requests unless complemented by richer color data. Changing definitions may require regenerating measurements.
- More lightness variation must not become a universal condition for “grayscale.” White remains technically neutral; the user's requested overall appearance is separate evidence.

This option is attractive for a simple first score and common-query execution. It should not silently establish a permanent small catalog of allowed color controls.

### 3. Fine color distribution with smooth query functions

Store a distribution over perceptual color cells, potentially at several color-space resolutions. Here “several resolutions” means coarse and fine **color cells**, not necessarily different image sizes or spatial grids. At query time, a color family, picked shade, or range assigns a membership and a quality to each occupied cell.

For illustration, if cell `j` has area `h_j`, accepted-area indicator `m_j`, and in-range quality `k_j`, keep:

```text
accepted area A = Σ h_j m_j
quality evidence Q = Σ h_j m_j k_j
```

The user's center=100% / edge=50% preference can live in `k_j` while accepted area remains counted fully. A smooth membership estimate is also an option, but then its sum is an expected/fuzzy coverage measurement with its own calibration. It must not be silently equated with area and simultaneously used as a vividness discount.

**Failure to avoid:** 80% weak green with quality .5 is not automatically 40% green. The user has already described examples as the right amount but weak color. Keeping only the product of amount and quality destroys that distinction.

This representation can support named families, narrow shade-distance functions, neutral/dark/colorful summaries and query-dependent range controls. Query functions can be prepared once per query; dot products over stored cells can calculate some features. That arithmetic does not establish fast search across millions of documents: query scoring and safe index pruning still need an execution design.

Important limits:

- Finer cells reduce representation loss, but do not establish that a particular distance matches named-color perception.
- A palette of a few centroids is a different compression choice: a centroid can conceal colors on both sides of a narrow grayscale boundary. Fine cells still have boundary error, whose effect depends on resolution.
- An unordered color distribution cannot distinguish arrangements with identical color counts. That is a precise limit, not evidence that arrangement matters in every existing case.
- RGB/HSV/HSL and perceptual-distance controls need explicit meanings. A percentage of “distance” is otherwise underspecified; hue also has no meaningful direction at exact zero saturation.

### 4. Optimal transport over color mass

Represent a wallpaper as colors with amounts, then find a least-cost assignment of image mass to the requested colors. Moving red mass to nearby orange may cost less than moving it to blue. Earth Mover's Distance is a transport-based distribution comparison and has been studied for color image retrieval and partial matching. Its ground cost defines similarity between individual colors. [Rubner, Tomasi and Guibas](https://ai.stanford.edu/~rubner/papers/rubnerIjcv00.pdf).

Its appeal is mass conservation: one unit of image area cannot independently fill several exclusive composition portions. It can use a fine histogram or an adaptive palette, and its cost can be category-aware rather than plain color-coordinate distance.

However, transport does **not** settle our query semantics:

- **Unrestricted-remainder trap.** For 40% green plus a zero-cost 60% wildcard destination, an 80%-green image can send 40% green to the green target, then its extra 40% green and 20% other colors to the wildcard. A 40%-green image can also attain zero cost. This violates the user's target-amount intent. Count total green independently or otherwise penalize overshoot; ordinary free disposal does not suffice.
- **Purity is not automatic.** For the user's idealized 80%-gray/20%-red query, transporting 90%-gray/10%-red costs `.10 × distance(gray,red)`, while 80%-gray/18%-red/2%-blue costs `.02 × distance(blue,red)`, assuming metric ground distances and only these bins. The preferred first image wins only if the declared costs make that inequality hold. No generic perceptual color distance guarantees it. An explicit outside-palette penalty or different composition objective may be needed.
- **Overlap needs semantics.** Red and dark can describe the same pixels. Exclusive portions need joint allocation; a global dark preference plus a red amount can intentionally overlap. Transport's exclusivity should not be imposed on both query forms.

A transport score is a worthwhile quality challenger if its added expressive power is valuable. It is a harder starting point for broadly fast, exact OpenSearch ranking than a small set of additive stored features. An expensive exhaustive score can serve as a reference on a bounded corpus, but that is a proposed future experiment, not production feasibility or present authorization.

### 5. Spatial and prominence features as an addition

Possible additions include color summaries within a coarse grid, largest connected color regions, contrast between an accent and its surroundings, or color prominence estimated by a salience model. A spatial pyramid is an established way to retain approximate layout using histograms within progressively smaller image regions. Its published scene-recognition results are not a validation of our color-search task. [Lazebnik, Schmid and Ponce](https://www.micc.unifi.it/bagdanov/pdfs/cvpr06b.pdf).

This could help distinguish a coherent red subject from scattered red noise, or a colored foreground against a neutral background. The blue batch note suggests focal prominence as a possible reason for an ordering, but explicitly remains a hypothesis.

Try simpler global explanations first: lightness distributions can already represent dark-with-highlights; color-strength summaries can already distinguish weak roses from strong red illumination. White-with-red may differ from grayscale-with-red in tonal distribution before geometry matters. A location-sensitive descriptor can also unfairly punish a valid accent merely because it is off-center. Keep literal image area separate from any salience-weighted measure.

### 6. Learned representation or a constrained learned ranker

Two materially different possibilities:

1. **Image/text embedding:** use a pretrained representation to compare phrases such as “grayscale with vivid red accents” to whole images. CLIP demonstrates learning image/text representations from paired data and zero-shot concept matching; its paper also reports weaknesses on some abstract tasks including counting. It does not establish reliable pixel percentages or exact shade discrimination. [Radford et al.](https://proceedings.mlr.press/v139/radford21a/radford21a.pdf).
2. **Small ranker over explicit measurements:** learn how query targets, amount errors, color quality, outside colors and optional contextual features should combine. Constraints could preserve documented behavior, such as excess green remaining excess when quality weakens.

The second option can complement options 2–5 and need not involve a large image model. It could learn different amount/quality tradeoffs for named-color, precise-shade and palette-theme requests. The first might capture appearance that hand-designed summaries miss, but can also introduce subject associations that belong in semantic search rather than color ranking.

At present, neither should be calibrated to reproduce every submitted position. We have too few independent cases and reviewers to demonstrate a complex model's generalization. Reused wallpapers can make image memorization look like perceptual success; pairwise preferences derived from one order are not independent labels. A learned output also needs a compatible OpenSearch retrieval/ranking plan—application reranking of an arbitrary candidate cap cannot establish global correctness.

## Concrete checks that separate the options

| Observed intent or case | What a candidate must express | What it does not prove |
| --- | --- | --- |
| 40% green should beat comparable 80% green | Total amount closeness, including overshoot | A symmetric loss or universal preference for undershoot |
| Roses move below poppies when red target falls from 20% to 10% | Query-dependent ranking and amount sensitivity | A pure effect of remainder; both request fields changed |
| Pink does not feel red in the submitted red comparison | Named-family meaning beyond naive proximity to red | A universal sharp border between all pink/red shades |
| White with red does not convey the desired grayscale with red | Overall appearance beyond a neutral-area scalar | White is non-neutral, or spatial features are necessarily required |
| Mostly dark with small bright areas | Dark and bright area distribution, not just average lightness | A requirement for a learned model or a fixed spatial location |
| Close to #FF2200 | Fine color distinctions and nearby-shade eligibility | Any tiny exact patch must always beat broad nearby color |
| Right amount but weak green | Separate amount and convincing color quality | Quality should numerically halve physical coverage |
| Dark red matches red and dark | Deliberate overlap for global properties; explicit semantics for portions | Every named property consumes its own exclusive part of the image |

## A shortlist to choose together

If the user wants a compact first comparison, propose these **roles**, not selected implementations:

1. **Controls:** current descriptor with cosine and L2, explicitly recording normalization and query encoding.
2. **Interpretable challenger:** named-color/vibe measurements with amount, quality and outside-color evidence kept separate. Use a small transparent score to expose assumptions.
3. **Flexible challenger:** finer color distributions, smooth shade/range quality and explicit composition semantics. Compare common queries with the interpretable challenger as well as precise/range queries it cannot express.
4. **Optional composition reference:** transport with corrected remainder and overshoot handling, if we want to learn whether its joint assignment improves perceived results enough to justify its cost.

Spatial/prominence features and a learned ranker are possible additions to these challengers. They should enter a focused comparison when a failure actually distinguishes them from richer global color evidence. This is a recommendation for discussion; do not begin any of these experiments from this document alone.

### Discussion questions with real design consequences

- For the first comparison, is **common named colors/vibes plus precise hex matching** enough, or must **arbitrary user-defined ranges** be present immediately? This changes how much can be precomputed, not just the UI.
- When no image has both ideal amounts and convincing colors, which **amount/quality tradeoffs** should the first comparison expose? Existing judgments argue against universal strict amount-first ordering, but do not set a universal compensating weight or score shape.
- For a full palette, should we explicitly model **outside-color dislike** separately from amount error? The gray/red example supports investigating it; the pure-color green/red example has a realism caveat.
- Should transport be included as a bounded quality reference in the first round, or held until the simpler models show a composition failure? This is the clearest scope/cost decision among the proposed methods.

No additional one-at-a-time judgment collection is required before discussing these options. Future human reviews should remain batchable, retain uncertainty and separate reviewer variation from model and retrieval errors.
