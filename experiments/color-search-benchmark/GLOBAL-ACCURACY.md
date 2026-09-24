# Source-sample convergence for global color matching

Compared the same **100 verified wallpaper originals** at longest sides of **256 and 1024 pixels**, using the existing 18-family bank. This checks whether the smaller measurement has settled sufficiently; the denser sample is not full-resolution ground truth or a human accuracy label.

## Hard-membership implementation check

Two separately implemented predicates were checked on **80,208 comparisons** (4456 RGB values × 18 families), including all 256 neutral grays, family anchors, narrow neutral boundaries, and hue-seam examples. **2 comparisons differed**, all at deliberately constructed floating-point tolerance boundaries with outside distance below 1e-12. Their exact RGB values and results are retained in the JSON; no larger predicate disagreement was allowed. They share RGB/color-coordinate conversion helpers, so this does not independently validate color science.

## Coverage changes

Errors below are **percentage points of image area**, across 100 wallpapers per family.

| Family | Mean absolute change | p95 | Maximum | Worst wallpaper |
|---|---:|---:|---:|---|
| dark | 0.921 | 3.363 | 7.091 | wallpaper-048 |
| dark_gray | 0.189 | 1.071 | 4.257 | wallpaper-005 |
| grayscale | 0.266 | 1.240 | 3.140 | wallpaper-004 |
| black | 0.398 | 1.848 | 4.891 | wallpaper-085 |
| gray | 0.884 | 3.590 | 9.407 | wallpaper-097 |
| white | 0.225 | 0.991 | 2.845 | wallpaper-004 |
| red | 0.388 | 1.676 | 3.492 | wallpaper-019 |
| orange | 0.319 | 1.397 | 3.470 | wallpaper-092 |
| yellow | 0.199 | 0.999 | 1.875 | wallpaper-093 |
| green | 0.445 | 2.265 | 5.236 | wallpaper-062 |
| teal | 0.583 | 3.593 | 6.463 | wallpaper-011 |
| cyan | 0.570 | 2.659 | 8.010 | wallpaper-016 |
| blue | 0.533 | 2.689 | 7.209 | wallpaper-016 |
| navy | 0.559 | 2.502 | 7.429 | wallpaper-004 |
| purple | 0.062 | 0.316 | 0.953 | wallpaper-036 |
| pink | 0.118 | 0.388 | 2.997 | wallpaper-003 |
| brown | 0.631 | 2.885 | 5.713 | wallpaper-092 |
| cream | 0.192 | 0.815 | 4.198 | wallpaper-092 |

## Ranking changes

Both rankings use the joint hard-proportion objective and native float32 score ordering. Selection regret is the additional mean area error of the 256-pixel top ten, measured using 1024-pixel features, compared with the denser sample's own top ten.

| Query | Shared top ten | Same rank positions | Mean rank displacement | Selection regret, pp |
|---|---:|---:|---:|---:|
| green40 | 9/10 | 2/10 | 1.20 | 0.208 |
| red70-dark30 | 10/10 | 10/10 | 0.00 | 0.000 |
| red50-green50 | 9/10 | 3/10 | 0.90 | 0.087 |
| dark90 | 10/10 | 8/10 | 0.20 | 0.000 |
| grayscale40 | 10/10 | 5/10 | 0.80 | 0.000 |

## Narrow grayscale: wallpaper-088

For the existing grayscale family (HSL saturation within 2% of neutral, unrestricted hue and lightness):

- 32-color palette: **0.000%** coverage.
- 256-pixel source sample: **37.638%** coverage.
- 1024-pixel source sample: **39.397%** coverage.
- Sampling change: **1.759 percentage points**.

This separates palette compression error from sample-resolution sensitivity for the previously identified failure.

## Reproduce and interpret

Run `make color-global-accuracy` while latency benchmarks are idle. Source SHA256 hashes are checked. Dense measurements are cached per wallpaper under `output/global-accuracy-cache/`; [global-accuracy.json](global-accuracy.json) records helper hashes, per-family errors, exact result IDs, costs, and rank changes.

The two resolutions reuse `measureFamilies`; agreement measures sampling convergence. Sharp's resize interpolation can shift colors across hard region boundaries, so changes combine density and resampling effects. A higher-resolution reference can still be wrong about the user's intended color family, and visually similar near-ties can change order with little area-error regret.
