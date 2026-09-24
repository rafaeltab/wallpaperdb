# Native area and quality refinements

These two prototypes preserve the original `native-area-linear` method and add color quality using OpenSearch's native numeric functions. They reuse the complete existing `cov_*` and `quality_*` fields on all 545 corpus assets. They introduce no images, index fields, scoring scripts, learned parameters, or local wallpaper ranking.

| Method | Vibe objective | Proportion objective |
| --- | --- | --- |
| `native-quality-linear` | Mean `sqrt(area) × quality` | Mean symmetric area fitness × quality factor |
| `native-quality-asymmetric` | Same | Mean asymmetric area fitness × quality factor; excess costs 1.5× shortfall |

## Formula and execution

For each named target, `a = cov_name / 10000` is its image area and `q = quality_name` is its conditional quality in that area. A proportion request has target area `t`.

```text
vibe score = mean(sqrt(a) × q)

delta = a − t
area fitness = max(0, 1 − abs(delta) × (delta > 0 ? excessPenalty : 1))
quality factor = 1 − 0.35 × (1 − q)
proportion score = mean(area fitness × quality factor)
```

If a target requests zero area, its quality factor is one: better quality of an unwanted color must not improve the result. The symmetric variant uses `excessPenalty = 1`; the asymmetric variant uses `1.5`. Parameters can explicitly choose area power `0.5` or `1`, quality penalty `[0,1]`, and excess penalty `[1,4]`. These are experimental heuristics rather than fitted or population-validated preferences.

The native query uses `field_value_factor` for vibe area and quality, linear decay for proportion fitness and quality, and filtered functions for the two sides of the area target. Functions multiply within a target; Boolean `should` scores sum across targets. An explicit constant weight divides by target count. The real-service probe caught that query boosts were lost with `boost_mode: replace`, so normalization uses a scoring-function weight instead.

OpenSearch documents [native field functions, filtered functions, and decay curves](https://docs.opensearch.org/latest/query-dsl/compound/function-score/). All hard eligibility conditions remain in the OpenSearch query. Missing required feature fields cannot receive a perfect default decay score; an indexed `exists` filter excludes such records. The real-corpus parity probe confirms every one of the 545 current assets has the required fields.

## Expected behavior and limitations

For a 40%-green request and perfect green quality, the asymmetric scores are `1.0` at 40%, `0.8` at 20%, `0.7` at 60%, and `0.4` at 80%. Correct area with quality `0.3` scores about `0.755`. This makes both the amount and how strongly the color feels green matter.

Partial queries leave their remainder unrestricted. **Closed palettes have no outside-color purity term.** For example, assuming equal perfect quality, 80% grayscale + 18% red + 2% blue can beat 90% grayscale + 10% red for an 80% grayscale + 20% red request. That contradicts the user's stated preference. This is an explicit accuracy limitation of this cheap native objective, not a complete replacement for composition-aware methods.

Other boundaries:

- Picked hex colors and custom RGB/HSV/HSL/OKLab ranges are unsupported.
- Relative dark/bright accents and grayscale/red accent-vibe queries are explicitly unsupported; use proportions or the specialized hybrid.
- Multi-color vibes average affinities, so one strong color can compensate for another weak color. There is no spatial model or exclusive assignment of pixels to targets.
- Monochromatic/rainbow features describe global hue distribution and are not literal area percentages.
- Scores are globally exact under this stored feature objective. Native execution avoids Painless overhead but can still visit every eligible record; it does not prove sublinear scaling or million-wallpaper latency.

## Verification

`make color-exploration-native-test` passes six query-contract checks. `make color-exploration-native-probe` checks actual OpenSearch scores for nine requests × two methods × all 545 assets: **9,810 score comparisons**, maximum absolute error **8.11 × 10⁻⁸**. It also checks hard ID/metadata filters and the asymmetric intent examples above. These algebraic assertions are not new human judgments.

Probe receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/native-refined-probes/2026-09-20T01-53-20.857Z.json`.

The probe is restricted to port 19216. It never loads the million-document instance on port 19217.

## Feedback-loop round 10

Run: [`2026-09-20T01-55-38.776Z-219058ec`](http://zerotwo:8224/2026-09-20T01-55-38.776Z-219058ec/report.html), ten timed repetitions per supported query after one warmup. The run uses all 545 assets in the real index. The new wallpapers remain unjudged; accuracy comes from existing judgment cases.

The original native method supports 32 of 37 recorded cases; each new native refinement supports 28. The difference is four accent-intent cases: the original method silently switches to its existing Painless accent objective, whereas these native-only refinements explicitly report unsupported. All methods also lack three picked-color cases and the two conceptual cases without images.

**Compare the same 28 cases** rather than treating the different-coverage aggregate as an improvement:

| Method | Common-case macro pair agreement | Common-case p95 | Failures |
| --- | ---: | ---: | ---: |
| Original `native-area-linear` | 0.735714 | 2.87 ms | 0 |
| `native-quality-linear` | 0.735714 | 2.59 ms | 0 |
| `native-quality-asymmetric` | 0.745238 | 2.41 ms | 0 |

Each common-case latency column contains 280 requests. These small-corpus times share the host with other experiment activity, and method order was not randomized; the tiny differences are not evidence of a performance win. No query error occurred. The baseline's raw 32-case macro is 0.70625, which must not be compared directly with the new methods' 28-case scores.

Category diagnostics on that common subset:

| Category | Cases | Original native | Quality | Quality + asymmetry |
| --- | ---: | ---: | ---: | ---: |
| Perceived color | 6 | 0.7333 | 0.7611 | 0.7611 |
| Vibe | 8 | 0.8458 | 0.8375 | 0.8375 |
| Combinations | 9 | 0.6593 | 0.6296 | 0.6037 |
| Proportions | 3 | 0.6111 | 0.6667 | 0.8333 |
| Semantic filtering | 1 | 1.0000 | 1.0000 | 1.0000 |
| Palette | 1 | 0.6667 | 0.6667 | 0.6667 |

Specific changes help explain the tradeoff. The real-wallpaper 20%-red case improves from 0.6667 to 1.0 with asymmetry; the 70%-green case improves from 0.5 to 0.8333. The 50/50 blue-orange case regresses from 0.6667 to 0.5. The original unblinded and blinded controlled green cases are distinct evidence and do not both improve: their asymmetry scores are 0.7333 and 0.9333 versus baseline 0.7667 and 1.0.

**Conclusion:** adding quality alone produces no net accuracy gain on the common set. Adding asymmetry produces a small aggregate gain, concentrated in some amount queries, with worse combination results. Keep these as fast native comparison options rather than selecting either as the general color-search solution. The existing single-observer judgments and quick batch are insufficient to claim that a one-point macro improvement generalizes. The missing purity objective is still a known blocker for the user's complete-composition preference.

After registry integration, `make color-exploration-test` reports 66 passing checks and 12 explicitly skipped integration checks. The separate real native probe above passed. The live browser exposes all **43 registered methods**, with **52 smoke checks passed**, including both native refinements and the independently added precomputed precision variants. Browser receipt: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/browser-qa/2026-09-20T01-55-53.636Z.json`.
