# Dark-red closeness: candidate metric review

Read-only mathematical design review, 2026-09-21. These are controlled predictions, not new indexed prototypes or human-validated settings. Existing corpus extraction and queries remain unchanged. Image-level reproduction is being measured separately.

## What the current metric does

The current metric uses `q = max(0, 1 - ||OKLab(pixel) - OKLab(anchor)|| / 0.24)`. The same `q` defines the five indexed admission levels and conditional average quality. `#FF0000` is an exact anchor in every bank, so approximation to the nearest anchor cannot explain this particular target's failure.

Darkening a saturated red reduces both its OKLab L and its a/b magnitude. Reducing only the L penalty therefore only partially grants the requested tolerance to darker shades. Weighting the 75%/90% layers more heavily can further punish the broad dark-red background, because those pixels never entered those indexed layers.

## Three controlled candidates

Let target be `(Lt, at, bt)` and pixel `(L, a, b)` in the existing OKLab implementation.

1. **Current baseline**: `d = hypot(L-Lt, a-at, b-bt)`.
2. **Lightness-only tolerance**: `d = hypot(wL*(L-Lt), a-at, b-bt)`, initially try `wL = 0.25`. This is a simple ablation that tests the user's lightness hypothesis. It cannot remove the accompanying chroma penalty.
3. **Shade tolerance with chromatic ratios**: `d = hypot(wL*(L-Lt), Lt*(a/L-at/Lt), Lt*(b/L-bt/Lt))`, initially `wL = 0.25`; use a separate visibility factor near black and explicit handling of zero lightness. This treats darkening along a constant chromatic direction more leniently, while neutral gray retains a substantial chromatic mismatch. The target-L scaling makes this a directional query similarity, not a symmetric color-distance metric.

For candidates 1/2 use `q = max(0,1-d/0.24)`. For the illustrative candidate 3 table only, multiply this by `visibility = clamp((L-.12)/.12, 0, 1)`. That floor is a deliberately provisional heuristic: it prevents near-black red RGB values receiving high red-vibe scores solely from channel ratios. It needs controlled near-black examples and real-image judgments before selection. Gray/black targets should retain their own neutral/lightness metric; the normalized formula must not blindly be applied to all targets.

| Pixel | Current q | L-only q | Shade-ratio q |
| --- | ---: | ---: | ---: |
| #FF0000 | 1.000 | 1.000 | 1.000 |
| #C00000 | .456 | .758 | .874 |
| #A00000 | .168 | .630 | .808 |
| #800000 | .000 | .497 | .738 |
| #600000 | .000 | .358 | .666 |
| #300000 | .000 | .131 | .339 |
| #100000 | .000 | .000 | .000 |
| #FF2200 | .941 | .953 | .941 |
| #FF6600 | .569 | .667 | .614 |
| #FF8080 | .343 | .541 | .448 |
| #FF0080 | .495 | .500 | .507 |
| #804040 | .000 | .267 | .400 |
| #800080 | .000 | .000 | .000 |
| #202020 | .000 | .000 | .000 |
| #808080 | .000 | .000 | .000 |
| #000000 | .000 | .000 | .000 |

Numbers computed from the exact RGB-to-OKLab equations in `corpus-colors.mjs`, against exact #FF0000. They are pixel qualities, not wallpaper scores. All controls except the distance formula were held fixed. The shade-ratio column uses the visibility factor described above.

## Candidate refinements and pitfalls

- An intermediate chromatic blend can interpolate `d² = (wL*ΔL)² + (1-beta)*(Δa²+Δb²) + beta*Lt²*((a/L-at/Lt)²+(b/L-bt/Lt)²)`. Beta=0 recovers L-only tolerance; beta=1 gives the shade-ratio experiment. Do not tune multiple knobs against just this one image.
- A separate darker/lighter lightness coefficient can prefer darker shades without equally forgiving pale pink: use `wDark` for `L<Lt` and `wLight` otherwise. Keeping lighter differences fully penalized is an interpretable follow-up ablation.
- HSV hue/saturation plus weak value difference is another possible directional similarity. Its easy controls are useful, but hue is unstable/undefined close to neutral, RGB saturation alone can call almost-black pixels vividly colored, and fixed hue ranges are not calibrated perception. Include an explicit neutral/visibility guard.
- Purely reducing L distance increases credit to pink too. Normalizing chromatic ratios distinguishes saturated shading from desaturation better in these swatches, but no single symmetric metric guarantees the user's broader preference for orange over pink.
- All-dark RGB reds must not automatically tie bright reds. The earlier human preference was that dulled roses read red but feel less vividly red than red illumination. Keep some brightness/visibility contribution and evaluate both examples together.
- Preserve the current strict-color mode for precise hex queries. Shade tolerance expresses a different user intent; it should be selectable or an explicit tolerance parameter while being calibrated, rather than silently changing the meaning of every existing query.
- A score improvement may still be hidden when cutoff weighting heavily favors 90%. Inspect per-level area/quality after the metric change, keeping cutoff distribution and quality influence identical between candidates.

## What existing indexes can and cannot support

- Reweighting the five existing levels changes the mixture of the same spherical regions; it cannot recover the direction of each pixel's distance. No query-side transformation of only the current coverage and mean-quality pair can determine whether a low-quality pixel differs in hue, lightness or saturation.
- Selecting several existing anchors along the red shade direction can be tried with no reindex as an approximation. Summing their overlapping coverages double-counts pixels; taking the maximum misses area distributed across distinct shades. Neither operation is an exact replacement for new pixel admission, particularly for requested percentages. Label this approximation plainly if tested.
- Existing disjoint histogram observations can evaluate a new metric over their cell centers inside the search service, with quantization error. This can provide a small-corpus comparison before rebuilding overlapping descriptors; it inherits the histogram method's service CPU/latency issues and should not be presumed viable at one million records.
- To preserve the current fast coverage/quality query structure with the revised metric, measure fresh per-anchor/per-cutoff coverage and conditional quality offline, in new versioned indexes. This changes extraction/indexing, but does not intrinsically require more per-query scoring functions than the current equivalent cutoff profile. Million-record capacity still requires fresh tests.
- A continuous query-time metric slider cannot be reconstructed exactly from a few old mean statistics. Pre-index a small set of named tolerance profiles, or choose a distribution representation that can apply arbitrary per-cell weights in the service.

## Recommended next controlled experiment

First finish the actual-image reproduction with the user's executed settings. Compare baseline, L-only, and shade-ratio profiles with fixed anchors, fixed cutoff weights and fixed quality influence. Retain this image and top-ranked counterexamples as exploratory cases rather than treating the user's image as the sole training target. Include dark saturated red, dark neutral, dark orange/brown, pink, pale red, purple, and the earlier dull-red versus glowing-red examples. Run the current feedback loop and report regression slices, especially exact-color, grayscale, dark, and percentage cases. Choose no production winner from these swatches alone.

## Two-image reproduction received from root

Root's independent pixel/live-query investigation identifies the first image as `gww23l` and the second, softer-red portrait with chairs as `9oov2d`. At quality influence 1, cutoff-blend exponents 0/3/6 give ranks 54/33/24 for the first image and 12/26/40 for the second. At influence 3, they become 38/25/19 and 24/41/47. This is evidence that amplifying conditional quality can help one reported positive while hurting the other; it is not evidence that the user specified a total ordering between the two images.

Root reports that a diagnostic HSV-red mask covers 47.6% of the first attachment and lightness accounts for 82.9% of squared OKLab distance inside that mask. The actual indexed source has only 0.68% hard-50 coverage for exact red. The second attachment's diagnostic mask covers 39.2%, with 54.9% of squared distance attributed to lightness. These masks are diagnostic heuristics, not human ground-truth percentages; attachment sampling and the retained original source are distinct evidence.

For the second image's representative soft-red swatch `#B53738`, the exact local conversion against `#FF0000` gives current q=.408, L-only q=.582, mixed chromatic normalization (beta=.5) q=.638, and full shade-ratio q=.705. Compare equally bright saturated `#B50000`: .358/.715/.773/.852 respectively. The baseline surprisingly puts the softer swatch slightly nearer the target; the candidate formulas retain a quality advantage for saturated red while giving both meaningful credit. Small differences from rounded sample values in the independent pixel probe are expected; this row is an exact controlled RGB swatch calculation, not an additional image measurement.

### Bounded recommendation after reproduction

Keep quality influence at 1 while isolating the pixel metric. The minimal first ablation is L-only tolerance (`wL=.25`) because measured lightness already explains most of the first failure and a substantial part of the second. Beside it, compare a **partial** chromatic normalization (`beta=.5`, same wL) to test the remaining darkening-related chroma penalty. Keep full normalization as a sensitivity case, not an assumed best setting. No additional cutoff-weight change should be bundled into those comparisons.

These candidates give softer red some credit without treating it as identical to saturated red. Increasing influence to 3 changes penalties on existing conditional means; it cannot recover dark-red pixels that failed admission and can unnecessarily suppress the second image. Pure hue matching goes too far in the other direction by discarding differences in saturation and visible color strength. The next calibration set must therefore keep both reported images, the earlier dull-versus-glowing red distinction, and neutral/pink/brown counterexamples. A selectable revised closeness profile needs new versioned measurements; no current ranking profile was implemented or changed during this review.

## Subsequently authorized prototype: shade-aware version 1

The root agent authorized implementation of the partial-normalization candidate as an additional selectable profile. The old indexes remain untouched. New code is `shade-definition.mjs` and `shade-index.mjs`; root and UI agents own the search/diagnostic/UI integration. This implementation does not make the illustrative full-normalization table above the production formula.

Exact version-1 formula: derive target strength `s = smoothstep((Ct/max(Lt,1e-6)-.03)/.09)`, where smoothstep clamps its input to 0..1 and returns `t*t*(3-2*t)`. Use `wL=1-.75*s` and `beta=.5*s` in the mixed formula above. Pixel and target chromatic ratios use denominator `max(L,1e-6)`. Fully neutral targets have s=0 and retain the exact old Euclidean metric.

Visibility uses `v(L)=smoothstep((L-.08)/.16)`, `g=min(1,v(L)/v(Lt))` when target visibility is positive, otherwise g=1. Multiply raw quality by `(1-s+s*g)`. This preserves exact-anchor quality 1, including dark anchors, while attenuating barely visible red pixels when the query anchor is bright red. Zero-cutoff support requires raw shade distance <=.24 (numerical boundary tolerance 1e-12) and positive visibility multiplier; merely testing q>=0 would incorrectly admit out-of-support pixels. Positive cutoffs additionally require q>=cutoff.

Only five hard layers are remeasured. All four nested anchor banks retain their existing IDs and use the existing cutoff field names inside separate `color-exploration-shade-{16,64,256,1024}-real-v1` indexes. Indexing is create-only and single-document with flush every 25; resuming checks all existing IDs, values, schema and provenance before adding missing documents. Final verification requires every corpus ID and every stored measurement to equal the hashed extraction checkpoints.

Initial `make color-shade-test`: 14 passed, one real-index integration test skipped pending preparation. The test assertion for #800000 was corrected from an invented >.60 bound to its actual .59..60 range; the frozen formula was unchanged. Extraction started with source identity `cbf86defa3539910e8b9` at shared-store `exploration/shades/cbf86defa3539910e8b9`; build log is `exploration/dark-red/2026-09-21/shade-prepare.log`.

### Completed extraction/index verification

`make color-shade-prepare` completed successfully. All four new indexes contain all 545 assets; every indexed field equals the corresponding hashed measured descriptor. Complete-ID, all-value, and metric-definition verification are true for every bank. No old indexes were modified. Extraction took 195.685 seconds (4,480,847 unique/cache-miss RGB calculations, 4,588,387,328 pair calculations); 8,192 cached color contributions bounded the cache.

| Bank | Index + verification time | Stored bytes at receipt |
| --- | ---: | ---: |
| 16 | 1.928 s | 2,528,948 |
| 64 | 2.828 s | 8,809,492 |
| 256 | 6.423 s | 54,155,377 |
| 1024 | 28.211 s | 217,225,560 |

Storage is the immediate segment state from each index's completion receipt, with no force merge; it may change during background merging. These are extraction/index-build measurements, not query-latency benchmarks.

`make color-shade-neutral-audit` also passed: all 16 zero-strength anchors, all 545 assets, all five hard layers, and both stored values were compared—**87,200 exact equalities**, zero differences, including float32 conditional qualities. Both sets of source snapshots, manifests and every descriptor hash were verified. Receipt: `exploration/shades/cbf86defa3539910e8b9/neutral-parity-audit.json`. Parent agent owns subsequent integration tests, feedback runs, UI validation and user-facing findings.
