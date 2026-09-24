# Prototype design: requested color proportions

**Question:** Can the 32-color palette rank images near a requested composition, including a partially specified composition? This is a prototype design and audit, separate from the earlier coverage experiment.

**Confirmed meaning:** “40% green, the rest unspecified” means close to **40% total green**. An image with 100% green should not tie an image with 40% green. The unspecified part may contain any other color. A separate “at least” mode is useful for comparing the alternative interpretation.

## Proposed ranking

Represent the image by palette colors `x[i]` with area weights `p[i]`, summing to one. A query contains colors `y[j]` with **absolute image fractions** `a[j]`; the unspecified fraction is `u = 1 − sum(a)`. Do not renormalize a 40% query to 100%.

Find nonnegative flows `f[i,j]` assigning every portion of the image to a requested color or the unspecified destination:

```text
minimize       E = sum(i,j, f[i,j] * C[i,j])
subject to     sum(j, f[i,j]) = p[i]       for each image palette entry
               sum(i, f[i,j]) = a[j]       for each requested color
               sum(i, f[i,other]) = u
               f[i,j] >= 0
```

These conservation constraints mean that the same 20% of an image cannot supply 20% red **and** another 20% orange. Splitting a palette entry between two similar targets is allowed, but its total contribution cannot exceed its stored area. This is a discrete transport linear program; exact EMD solvers enforce both marginals. [POT `emd` reference](https://pythonot.github.io/all.html#ot.emd)

Use the existing OKLab representation, retaining perceived lightness and chromatic differences rather than hue alone. OKLab is a practical perceptual approximation, not an exact model of human color judgments. [OKLab author's description](https://bottosson.github.io/posts/oklab/)

```text
affinity[i,j] = exp(−distance_OKLab(x[i], y[j])² / (2 * sigma²))
C[i,j]       = 1 − affinity[i,j]

exact composition: C[i,other] = max(j, affinity[i,j])
at least:          C[i,other] = 0
```

The exact-composition remainder cost makes it expensive to hide excess requested colors in the unspecified fraction. For isolated exact hues, querying 40% green gives an error of approximately `abs(greenFraction − .40)`, independent of the identities of unrelated colors. With a full 100% query there is no remainder and the two modes coincide.

Adding an extra destination is a standard way to express partial transport. **The complementary affinity cost above is our application-specific design**, not a formula established by the cited paper. It makes the exact mode a query-dependent transport score, not a metric Wasserstein distance. The zero-cost remainder expresses the partial/at-least interpretation. [Chapel et al., Partial Optimal Transport, sections 2–3](https://proceedings.neurips.cc/paper/2020/file/1e6e25d952a0d639b676ee20d0519ee2-Paper.pdf)

Rank by smaller `E`. A displayed `1 − E` is a fit score, **not matching-pixel percentage or probability**. A missing 1% accent can still leave a fit of approximately .99, because it accounts for only 1% of image area.

## Why the earlier score is insufficient

The previous weighted geometric mean asks whether each requested color has appreciable coverage. Its weights express importance, not desired proportions. A 40% green query is therefore indistinguishable from a 100% green query after normalization. Independent per-color affinities can also count a pixel toward several nearby colors. Transport models the absolute proportions jointly.

The complementary remainder is necessary: a free remainder alone makes 40% green and 100% green equally good when their shades match. Calling that “exact 40%” would be incorrect.

## Inputs and explanations

- Fractions must be finite and nonnegative, with a positive total no larger than one. Reject impossible totals; tolerate only floating-point roundoff. Zero rows carry no preference and may be removed.
- Merge identical canonical colors by adding fractions. Do not automatically merge merely similar colors; the user may intend separate red and orange portions.
- Sorting input colors or palette entries must not change the score. Several equally optimal flows can exist, so individual transport assignments need not be unique.
- Normalize only small numerical drift in image descriptor mass. User amounts remain absolute.
- Reuse sigma `.06` as a preregistered starting point from the earlier experiment; compare broader/narrower values without claiming a newly tuned setting is independently validated.
- **Do not display transport inflow as measured coverage.** Each requested destination receives its requested amount even when that color is absent; the solver then pays a large color mismatch. Affinity-weighted assigned support and an independently estimated palette composition are more honest explanations.
- Independent Gaussian coverages may sum above 100% for nearby colors. If the UI needs a composition bar, use an explicitly described exclusive allocation (for example, nearest target with affinity weighting and a remainder). This is a diagnostic estimate, not the optimized transport plan or literal pixel segmentation.

## Controlled cases to preserve

The numeric expectations below assume distinct hues whose cross-affinities are effectively zero. Small Gaussian tails make those values approximate.

| Query and candidates | Required behavior |
|---|---|
| 40% green; images with 0%, 20%, 40%, 60%, 100% green and unrelated background | Exact-mode errors approximately `.4, .2, 0, .2, .6`; at-least errors `.4, .2, 0, 0, 0`. |
| 40% green; 40% green/60% blue versus 40% green/60% black | Equal quality when both background shades are far from green. |
| 80% red/20% black; matching image versus 20% red/80% black | Matching image wins; reversed isolated composition costs approximately `.6`. |
| 50% green/50% red; exact mix versus all green | Exact mix wins; missing half the requested composition costs approximately `.5`. |
| Five colors at 20% each | Exact composition wins; removing one color and reallocating its portion produces approximately `.2` error when missing hue is distinct. |
| 20% red/20% orange, 60% other; only 20% red-orange area available | That same 20% cannot satisfy both requested portions; inspect conserved row sums. |
| Two duplicate green rows at 20% each versus one green row at 40% | Identical score and canonical query. |
| 40% green versus 100% green queries on the same candidates | Different rankings; amounts are not relative weights. |
| Input/palette permutations, tiny weights, decimal totals | Stable finite cost, conserved mass, no negative flows. |
| Synthetic supply `[.5,.5]`, demand `[.5,.5]`, costs `[[0,.1],[.05,1]]` | Optimal cost `.075`; greedy cheapest-first costs `.5` and is wrong. |

Use an exact residual-network/min-cost solver rather than greedy assignment. For a 32-entry image and a small number of query colors, this is small enough to prototype directly. Independently check objective values and row/column conservation against another linear-program solver on random and adversarial matrices before trusting ranking results.

## Accuracy limits and evaluation

1. **Near hues remain ambiguous.** Mass conservation prevents double counting; it does not require separate spatial regions. Broad tolerance can make one intermediate shade a cheap substitute for several nearby target shades. Include red/orange/yellow and two almost-identical reds in diagnostics.
2. **Shade and amount trade off.** A perfect amount of a nearby shade can lose to a somewhat different amount of the exact shade. That tradeoff is set by sigma and the chosen ground cost. Very broad sigma eventually makes every color similar; very narrow sigma makes almost every shade wrong.
3. **A precise requested hex is not a broad color name.** Dark forest green and bright lime should not automatically be interchangeable. A future color-family control requires separate evaluation.
4. **32 clusters approximate the image.** Gradients, tiny accents, and several colors within one cluster can distort area estimates. Compare rankings with finer descriptors or an independent higher-resolution pixel judge; do not treat the compressed palette as ground truth.
5. **Closest does not imply good.** Rank every image as requested, but expose the fit and composition diagnostics. A 100-image corpus may contain no convincing 50/50 red-green or five-color example.
6. **Spatial composition is absent.** The score does not distinguish left/right halves from scattered pixels with the same colors and area fractions.
7. **Retrieval needs its own experiment.** Earlier RGB/cosine candidate recall measured coverage queries. Exact proportions can favor less dominant-color images; do not assume that retrieval recipe preserves proportion-ranking winners. Exhaustively score the 100-image corpus for this prototype.

Use synthetic known-area fixtures to establish semantics, then real wallpapers to inspect usefulness and descriptor error. Any agreement with another automated color model is proxy agreement, not user-validated accuracy. Keep the original benchmark's metrics and findings unchanged; record composition results separately.

## Independent solver audit

Run `make color-proportions-audit`; results are saved to [proportions-audit.json](proportions-audit.json). The audit implementation enumerates feasible integer-unit allocations using dynamic programming, independently of the scorer's graph, residual edges, or potentials. It also solves continuous 2×2 cases analytically by choosing the better endpoint of the one-dimensional feasible interval.

The first audit agreed with the solver on **500 seeded exhaustive cases, their 500 reversed permutations, and 1,000 continuous 2×2 cases**. Maximum objective discrepancies were `2.22e-16` and `1.11e-16`, respectively. Residual rerouting, exact/at-least semantics, nearby-hue conservation, duplicate merging, and equidistant ties also passed.

It found two numerical edge cases: individually tiny supplies could be skipped even when their combined mass exceeded the solver's stopping tolerance; correcting a slightly over-one query by subtracting from its final tiny amount could make that amount negative. Both were fixed: all positive residual capacities remain eligible, and roundoff is removed from the largest requested amount. Their explicit reproductions now pass, as do all eight audit groups. This audits the implemented objective; it does not establish visual relevance.
