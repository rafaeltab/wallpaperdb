# Relative contrast descriptors

These are **extraction-time measurements**, stored as a separate external sidecar. They do not score or filter live queries in JavaScript. A prototype can combine them into a score inside OpenSearch.

## Why add them

An absolute “bright” threshold returned zero bright area for the pale geometric lines in `wallpaper-005`, even though those lines visibly contrast with its dark background. Global brightness and small relative highlights are different properties. A higher-resolution lightness sample captures narrower details than the initial 128×128 descriptors.

The descriptor design uses generic thresholds and distribution statistics, not particular wallpaper IDs or human ranking positions. It preserves background darkness, highlight amount, and contrast as separate inputs so alternative service-side scoring formulas can be compared.

## Extraction

Run **`make color-exploration-refinement-features`**. Each registered source is hash-verified, oriented, converted to sRGB, composited on black for transparency, and resized to a 512×512 equal-area sample. OKLab lightness is computed on each sampled pixel before color quantization. Quantiles use linear interpolation between ordered samples.

The extraction processes every asset in the expanded manifest, including all ZIP images and controlled fixtures. It writes temporary files and atomically replaces the completed sidecar. A failed extraction leaves the previous sidecar intact. The original corpus manifest and `features.jsonl` are not modified.

Artifacts, outside the worktree:

- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/refinement-features.jsonl`
- `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/refinement-features-manifest.json`

The manifest records the extraction definition, code hash, source ID/hash sequence fingerprint, output hash, sample size, image count, and elapsed time.

## Fields

All fractions/lightness values use **0–1**, not percentages. `p999` means the 99.9th percentile.

| Field | Meaning |
| --- | --- |
| `id`, `sha256` | Existing corpus ID and verified source hash |
| `rel_sample_width`, `rel_sample_height`, `rel_pixel_total` | Sampling geometry and sample count |
| `rel_l_mean`, `rel_l_median` | Mean and median OKLab lightness |
| `rel_l_p95`, `rel_l_p99`, `rel_l_p999`, `rel_l_max` | Upper distribution tail and maximum |
| `rel_span_p99`, `rel_span_p999` | Corresponding upper quantile minus median |
| `rel_highlight_10_area` | Fraction at least 0.10 lightness above the median |
| `rel_highlight_20_area`, `rel_highlight_30_area` | Same for 0.20 and 0.30 lightness |
| `rel_highlight_10_contrast` | Mean lightness difference above median, conditional on the 0.10 highlight region; zero when absent |
| `rel_highlight_tail_area` | Fraction above median plus half the p99.9 span; zero if span < 0.02 |
| `rel_dark_background` | `clamp((0.6 − median) / 0.6)` |
| `rel_dark_area50` | Fraction with OKLab lightness ≤ 0.5 |

Relative spans and highlight areas remain invariant under a uniform **additive lightness shift** without clipping. This is not a claim of invariance under multiplying gamma-encoded RGB channels. Absolute background darkness intentionally changes with lightness.

## Initial extraction result

Completed **545/545 assets**, **48.93 seconds**, on 2026-09-20. Sidecar SHA-256:

`27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638`

Illustrative measurements for the existing dark-accent case:

| Wallpaper | Median L | Relative highlight area (+0.10 L) | p99.9 span | Background darkness |
| --- | ---: | ---: | ---: | ---: |
| `wallpaper-005` | 0.168416 | 3.1815% | 0.679906 | 0.719306 |
| `wallpaper-022` | 0.258979 | 15.8348% | 0.635364 | 0.568368 |
| `wallpaper-032` | 0.412945 | 13.4655% | 0.527356 | 0.311759 |
| `wallpaper-015` | 0.281782 | 18.6714% | 0.712668 | 0.530364 |

The pale lines now produce a nonzero region and strong relative contrast. These figures are measurements, not new human labels and not a claim that one formula now reproduces every preference.

## Validation and limits

**`make color-exploration-refinement-feature-test` — 6 tests pass.** Checks cover uniform fields, dim thin highlights, shift invariance, finite/ordered quantiles, alpha compositing, input preservation, and hash failure leaving the previous sidecar intact.

These are global statistics. They do not locate spots, distinguish a bright edge from a compact object, or determine a scene's actual background. The median can belong to a large foreground object. Sampling can still lose subpixel details, and percentile tails intentionally downweight very rare maxima. Spatial/edge descriptors remain a separate possible refinement.

## OpenSearch indexing and initial scorer

**`make color-exploration-refinement-index`** verifies the sidecar hash, exact corpus ID coverage, each source hash, and existence of every document in the scratch index. It explicitly maps all 18 `rel_*` fields as floats before bulk updates, avoiding accidental integer mappings when the first value is zero. Updates contain only the new relative fields. A receipt is saved outside the repo as `refinement-index-receipt.json`.

On 2026-09-20, **545 documents were updated and verified** in `color-exploration-real-v1`.

`methods-relative.mjs` defines `hybrid-relative-accents`. Its relative branch recognizes either the evaluation's dark-with-bright-spots text or the visual browser's dark + bright vibe targets. Proportional requests and custom color ranges use the hybrid's declared fallback, rather than silently becoming a relative-accent request. Root registry routing uses `feature-intent-bounded` for named queries and `palette-direct-precision` for picked colors/ranges.

The Painless score uses these components:

```text
darkness = dark_area50²
contrast = min(1, p99.9_span / 0.4)
support = min(1, relative_highlight_area / 0.01)
small_area = exp(-max(0, relative_highlight_area - 0.05) / 0.15)
score = darkness × contrast × support × small_area
```

The 1% support amount, 5% preferred maximum, 15% decay scale, contrast scale, and exponent are explicit experimental heuristics. No image ID, learned weight, or human rank is used in this formula. All matching documents are scored inside OpenSearch; this branch has no candidate truncation.

**Live correctness probe:** all 545 service scores matched the offline arithmetic oracle within **2.82 × 10⁻⁸**. The probe also verified hard eligibility and exclusion filters. Cold first-request timings (17 ms OpenSearch, 46 ms HTTP) are merely integration observations and do not establish million-document speed.

For the existing four-image dark-accent case, the service now orders `wallpaper-005`, `wallpaper-022`, `wallpaper-032`, `wallpaper-015`, matching that supplied order. This is one quick-pass development case, not evidence of general preference accuracy; the normal feedback loop must evaluate the hybrid on all supported cases.

`make color-exploration-relative-test` passes **5 additional tests** covering intent routing, absence/size/contrast behavior, hard metadata filters, parameter validity, sidecar coverage/hash validation, explicit mappings, and update-field isolation. The standalone service probe is `methods-relative-probe.mjs` and can be run through the corresponding Make target when registered.
