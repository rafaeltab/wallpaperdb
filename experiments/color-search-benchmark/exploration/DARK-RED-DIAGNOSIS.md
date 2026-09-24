# Dark-red closeness diagnosis

2026-09-21. Diagnosis and controlled pixel calculations, not a new ranking implementation.

## User observation

The first attached wallpaper reads strongly as #FF0000 despite much of its red being dark. The user reports that wallpapers that feel less red outrank it under **All cutoffs**, any cutoff weighting, quality influence 1. Increasing influence to 3 improves this image but demotes a second example with a softer red background. Both examples should inform the next metric experiment; the user has not supplied an exact ordering between them, explicit pairwise labels against other corpus images, or target percentages.

Images already exist in the corpus:

- First: `madness-wallhaven-gww23l`, `corpus/wallpapermadness/wallhaven-gww23l.jpg`. The WebP attachment is a resized/reencoded version.
- Second: `madness-wallhaven-9oov2d`, `corpus/wallpapermadness/wallhaven-9oov2d.jpg`. The PNG attachment is a smaller preview.

Identification used 64×64 RGB comparisons and visual confirmation. Source RMSE is 3.02/255 for the first and 1.43/255 for the second; the next unrelated candidates exceed 56/255. No new corpus assets or inferred human rankings were added.

## Reproduced behavior

64 read-only real OpenSearch replays cover both images, four banks, all-cutoff weights 0/3/6 and quality influence 1/3, plus original dense references. Smooth-power quality curve and minimum average quality 0 were used. Every replay returned all 523 real wallpapers with fixtures excluded inside OpenSearch. Inspection scores agree with search scores.

Ranks are identical in all four banks because **#FF0000 is an exact anchor in every bank**:

| Image | Influence | Equal weights (0) | Weighting 3 | Weighting 6 |
|---|---:|---:|---:|---:|
| First, dark red portrait | 1 | 54 | 33 | 24 |
| First, dark red portrait | 3 | 38 | 25 | 19 |
| Second, softer red background | 1 | 12 | 26 | 40 |
| Second, softer red background | 3 | 24 | 41 | 47 |

At equal weights/influence 1, the predominantly teal abstract `wallpaper-004` with coral ribbons ranks 50, ahead of the first image at 54. The orange/yellow sunset `wallpaper-031` ranks 30. Those are agent visual descriptions and candidate comparisons for review, not new human preference labels.

Stored measurements against #FF0000:

| Cutoff | First: admitted image area | First: conditional quality | Second: admitted image area | Second: conditional quality |
|---|---:|---:|---:|---:|
| 0% | 22.19% | 20.51% | 41.04% | 40.16% |
| 25% | 8.08% | 38.64% | 35.68% | 44.12% |
| 50% | 0.68% | 66.77% | 11.72% | 58.17% |
| 75% | 0.19% | 88.62% | 0.03% | 76.85% |
| 90% | 0.10% | 94.92% | 0% | 0% |

These cutoff areas are nested and must not be added. The 0% level still has finite distance support.

## Cause and ruled-out explanations

Current pixel quality is `max(0, 1 - Euclidean_OKLab_distance / .24)`. It measures proximity to a particular bright swatch. Saturated dark reds can be far from that bright swatch despite retaining their hue.

| Pixel compared with #FF0000 | Current quality | Quality with lightness difference scaled by 0.25 |
|---|---:|---:|
| #C00000 | 45.64% | 75.84% |
| #A00000 | 16.78% | 63.01% |
| #800000 | 0% | 49.69% |
| #FF8080 (pink) | 34.33% | 54.14% |
| #FF6600 (orange) | 56.90% | 66.71% |

Lightness is a major contributor, but darkening also reduces the magnitude of the a/b color coordinates, creating another difference from bright red. A lightness-only adjustment cannot fully address that second effect.

For a diagnostic mask of source pixels with HSV hue within 20° of red, saturation ≥60%, value ≥10%, lightness accounts for **82.8% of summed squared distance** in the first image, versus **53.8%** in the second. These masks are explanatory heuristics, not human-labeled red areas. The first mask covers 47.44% of sampled pixels; that is not a newly assigned user percentage judgment.

Scaling only the first image's lightness difference by 0.25 changes its 50% cutoff area from **0.677% to 18.530%** in an offline pixel calculation. The 90% area changes only from 0.098% to 0.128%, illustrating why heavily weighting exact matches can continue to miss the desired vibe even after some lightness tolerance.

Checks against both original source images reproduce stored 128×128 measurements after their documented basis-point/float32 rounding. Repeating pixel analysis at 512×512 preserves the first image's failure: its current 50% admitted area remains below 1%. Thus attachment reencoding, sample resolution and nearest-anchor choice do not explain the primary effect.

The quality-influence slider acts after these measurements. For vibe queries at influence 3, conditional quality is cubed: 40% becomes 6.4%, while 95% becomes 85.7%. This changes relative rankings but does not restore pixels excluded during extraction. The second image's large moderate-quality region is heavily suppressed, while the first retains small near-exact highlights. A higher rank does not imply its own score increased.

## Bounded next experiments

Hold quality influence at 1 and keep the cutoff distribution fixed. Compare:

1. Current baseline.
2. Reduced lightness penalty: `d² = (wL*ΔL)² + Δa² + Δb²`, starting with `wL=.25` as an explicit ablation.
3. Partial shade normalization: blend the ordinary chromatic difference with a difference in chromatic ratios `(a/L,b/L)`, while retaining some lightness penalty. This distinguishes saturated shading from loss of color strength. A conservative starting blend is 50%, with explicit neutral/near-black handling.

The normalized candidate is directional similarity, not necessarily a symmetric distance. It needs different handling for black/gray/white targets, near-black visibility, and very low chroma. Simply ignoring brightness or using hue alone would overcredit weak, almost-neutral colors and conflict with earlier dull-versus-glowing-red feedback. Test softer reds too, rather than optimizing solely for the first example. Preserve a precise-swatch option while exploring shade tolerance.

Candidate math against #FF0000: saturated #B50000 scores 35.8% currently, 71.5% with lightness tolerance, 77.3% with partial normalization. Softer #B53738 scores 40.8%, 58.2% and 63.8%, respectively. These are controlled pixel predictions, not wallpaper rankings or calibrated human quality labels. No winner is selected.

An exact change to pixel admission requires new measurements in versioned indexes. Existing area/mean-quality fields have discarded whether distance came from lightness or hue/chroma. Changing their scalar weights cannot reconstruct that information. New stored profiles can retain the current OpenSearch scoring structure and function count; actual runtime capacity still needs measurement. Summing existing shade-anchor coverages would double-count overlapping pixels and is not an exact solution for percentages.

## Reproduction and records

```sh
make color-dark-red-identify
make color-dark-red-diagnose
```

Both support `COLOR_DARK_RED_ARGS`; the pixel probe accepts `--image`, `--directory`, and `--output`. Exact secondary-image replay commands are recorded in the external identification report.

External root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/dark-red/2026-09-21/`.

- `identification.json`, `rank-matrix.json`, `second-example/`: source matching, all ordered service hits, parameters and diagnostic ledgers.
- `IDENTIFICATION-AND-REPLAY.md`: replay details and source snapshots.
- `pixel-diagnosis.json`, `second-pixel-diagnosis.json`: attachment pixel analysis at 128/512.
- `first-source-pixel-diagnosis.json`, `second-source-pixel-diagnosis.json`: original-source parity and sampling checks.
- `metric-options.md`: independent formula review, guards and indexing implications.
- `user-observations.json`: qualitative feedback kept separate from scored human judgments.

Diagnosis complete. No live scoring, frozen extraction definitions, mappings or indexes were changed; no new ranking profile or performance claim is implied by the offline probes. Future metric prototypes must preserve both examples and be evaluated with the broader existing cases.
