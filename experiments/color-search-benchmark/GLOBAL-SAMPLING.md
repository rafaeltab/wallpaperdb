# Original-pixel sampling versus resizing

Compared all **100 checksum-verified wallpapers** using deterministic jittered samples of original decoded RGBA pixels. No resize or interpolation occurs in the new sampler. Nominal sample counts are **65,536** and **262,144**, adjusted slightly to a rectangular grid; images smaller than a target are counted in full.

## How it samples

Sampler version: `original-rgba-continuous-strata-xorshift32-v1`. The seed is derived from the version, original SHA256, requested sample count, and replicate number. Each equal continuous image stratum contributes one uniformly jittered location; its containing original pixel is copied verbatim. Equal continuous strata avoid overweighting smaller cells caused by rounding cell boundaries to integer pixels. Alpha bytes are preserved, and the existing area measurement weights each sample by alpha.

## Whole-corpus comparison

The high-density original-pixel sample is the reference here, **not full-image ground truth**. Errors aggregate 100 wallpapers × 18 families and are percentage points of visible image area.

| Method | Mean absolute error, pp | p95, pp | Maximum, pp |
|---|---:|---:|---:|
| resize256 | 0.7012 | 3.2826 | 35.7992 |
| resize1024 | 0.3292 | 1.2418 | 33.3741 |
| jitter65536 | 0.0242 | 0.1052 | 0.3019 |

## Joint proportion ranking

Selection regret is the additional mean high-density-reference error of the method's top ten relative to the reference top ten. Native float32 score ordering and ID ties are preserved.

| Query | Method | Shared top ten | Same positions | Selection regret, pp |
|---|---|---:|---:|---:|
| green40 | resize256 | 9/10 | 3/10 | 0.1806 |
| green40 | resize1024 | 10/10 | 7/10 | 0.0000 |
| green40 | jitter65536 | 10/10 | 10/10 | 0.0000 |
| red70-dark30 | resize256 | 10/10 | 10/10 | 0.0000 |
| red70-dark30 | resize1024 | 10/10 | 10/10 | 0.0000 |
| red70-dark30 | jitter65536 | 10/10 | 10/10 | 0.0000 |
| red50-green50 | resize256 | 9/10 | 2/10 | 0.1319 |
| red50-green50 | resize1024 | 10/10 | 8/10 | 0.0000 |
| red50-green50 | jitter65536 | 10/10 | 10/10 | 0.0000 |
| dark90 | resize256 | 10/10 | 6/10 | 0.0000 |
| dark90 | resize1024 | 10/10 | 5/10 | 0.0000 |
| dark90 | jitter65536 | 10/10 | 8/10 | 0.0000 |
| grayscale40 | resize256 | 8/10 | 5/10 | 0.6959 |
| grayscale40 | resize1024 | 8/10 | 7/10 | 0.6959 |
| grayscale40 | jitter65536 | 10/10 | 10/10 | 0.0000 |

## Exact diagnostic counts

Every original pixel was counted for wallpapers 088, 097, 016, and 048, in bounded memory chunks. Two extra independent jitter seeds at each sample level supplement the main seed on these four images. The table shows each main method's worst error among the 18 families, in percentage points.

| Wallpaper | Original pixels | Resize 256 | Resize 1024 | Jitter 65k | Jitter 262k |
|---|---:|---:|---:|---:|---:|
| wallpaper-016 | 2,666,000 | 9.2402 | 2.0313 | 0.1210 | 0.1356 |
| wallpaper-048 | 24,064,000 | 16.6844 | 14.1823 | 0.1764 | 0.0135 |
| wallpaper-088 | 10,680,000 | 3.5229 | 1.7334 | 0.1063 | 0.0604 |
| wallpaper-097 | 8,075,520 | 13.1273 | 3.7206 | 0.1339 | 0.0547 |

## Wallpaper-088: strict grayscale coverage

| Measurement | Coverage |
|---|---:|
| palette32 | 0.0000% |
| resize256 | 37.6379% |
| resize1024 | 39.3969% |
| jitter65536 | 39.6701% |
| jitter262144 | 39.6076% |
| exact | 39.6301% |

This separates palette compression, resized-color bias, and original-pixel sampling error for the known narrow-neutral failure.

## Reproduce and interpret

Run `make color-global-sampling` only when latency benchmarks are idle. [global-sampling.json](global-sampling.json) records every original hash, sampler seed and grid, per-family errors, complete top-ten comparisons, and exact-subset replicate errors. Regenerable raw measurements live in `output/global-sampling-cache/`; prior data and OpenSearch indexes are unchanged.

Full decoding still has an ingestion cost even when only a sample is classified. Jitter removes interpolation and regular-grid aliasing, but the finite sample remains variable. Four exact diagnostics and three seeds do not establish a universal error bound. The family membership definitions are held fixed, so this evaluates their pixel-area measurement rather than whether people agree with those definitions.
