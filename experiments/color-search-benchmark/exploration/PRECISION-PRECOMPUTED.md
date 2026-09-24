# Indexed OKLab precision prototype

## Question

Can indexing each palette centroid in perceptual coordinates reduce service CPU without losing the direct-palette precision behavior?

The existing typed scorer converts all 32 RGB centroids to OKLab for each matching document. Each conversion requires three gamma `pow` calls and three `cbrt` calls. This prototype moves those conversions into descriptor preparation, then uses ordinary arithmetic and a square root during scoring. It remains an OpenSearch Painless query; no images or scores are ranked in the application.

## Representation

`encodePaletteLab(feature)` in `methods-precision-precomputed.mjs` produces two `long` arrays. `PRECOMPUTED_FIELDS` exports their mappings.

- `palette_lab_lw`: stable slot in the upper bits, twenty bits of quantized L, fifteen bits of exact integer pixel count.
- `palette_lab_ab`: the same stable slot, twenty bits each for quantized a+0.5 and b+0.5.

Every coordinate has a step of 0.000001. Original RGB entries are sorted with duplicate entries preserved, matching numeric doc values, then assigned increasing slots. Those slots keep both arrays aligned after OpenSearch sorts their numeric values, including repeated packed RGB/count entries and centroids sharing an L/a/b coordinate. Maximum packed integers remain below JavaScript's exact-integer limit. Original RGB palette entries and exact counts remain available.

The extra arrays occupy 16 bytes per centroid before doc-value compression, at most 512 bytes per image. This is an upper raw-payload calculation, not measured OpenSearch store size.

## Error and boundary behavior

The Euclidean coordinate-rounding error is at most `sqrt(3) * 0.5e-6`; the implementation adds a small arithmetic margin, giving `LAB_ERROR = 8.661254037844386e-7`.

The requested anchor retains its original full-precision OKLab coordinates. If the rounded distance is within `LAB_ERROR + 1e-8` of the requested radius, the script recomputes that centroid from its original RGB. This preserves the discontinuous membership decision, including zero-radius queries. Other centroids use their stored coordinates. It therefore avoids a tiny coordinate change adding or removing a large palette cluster at the edge.

For a positive radius, each returned quality score differs from the original scorer by at most `(1-edgeWeight) * LAB_ERROR / radius`, plus float32 response rounding. At the default radius 0.12 and edge value 0.5, that theoretical score difference is about 0.00000361. A very small radius can magnify coordinate error, so this is a distinct experimental method rather than a silent replacement of the reference scorer.

The bounded variant uses the same original-RGB `palette_cells` postings and exhaustive cell extents. It explicitly adds `2 * LAB_ERROR` to the existing conservative pruning distance margin. Its final global result is exact for the fixed-point-coordinate scoring objective, subject to the same stable-index requirement as the previous bound. The representation itself remains quantized and the 32-centroid palette remains lossy.

## Reproduction

```sh
make color-exploration-precision-precomputed-index
COLOR_EXPLORATION_PRECISION_PRECOMPUTED_TEST=1 make color-exploration-test
make color-exploration-precision-precomputed-probe
```

The descriptor file and indexing receipt live outside the worktree under shared `exploration/precision-precomputed-features.jsonl` and `exploration/precision-precomputed-index-receipt.json`. All 545 assets are present. The indexer preserves existing method fields.

## Results

Diagnostic artifact: shared `exploration/precision-precomputed-probe-2026-09-20T01-54-27.197Z.json`.

The diagnostic compares every score on all 545 assets for nine queries (4,905 comparisons): four picked colors, zero radius, flat edge quality, and three queries placed directly around a real centroid's membership boundary. Every score stayed within its stated numerical error bound. The largest observed difference was 0.00000240. Zero-radius and flat-edge queries had identical scores. Every top-20 ID set matched the original typed scorer; eight complete rankings were identical, while #080808 had a lower-ranked near-tie reorder. All nine bounded results exactly matched the new scorer's exhaustive top 20.

Alternating 30 warmed, single-client trials per method produced:

| Scorer | p50 call ms | p95 call ms | Mean OpenSearch took ms |
|---|---:|---:|---:|
| Original typed RGB conversion |6.15|7.86|4.43|
| Precomputed coordinates |6.03|7.07|3.97|

This is a modest difference on 545 assets, and these short query measurements include ordinary service variation. It does not yet establish a material CPU or million-document improvement. Eliminating transcendental operations also adds doc-value reads, so the larger benchmark remains necessary.

Feedback round 9: `2026-09-20T01-54-56.947Z-a6ad72cd`.

| Method | Supported cases | Human pair-preference agreement, query macro | p95 ms | Errors |
|---|---:|---:|---:|---:|
| palette-precision-precomputed |3 / 37|0.794444|6.81|0|
| palette-precision-bounded-precomputed |3 / 37|0.794444|17.06|0|
| hybrid-indexed-precomputed |35 / 37|0.754762|12.27|0|

These scores retain the corresponding previous method's human-feedback agreement. Precision-only and hybrid scores cover different cases and should not be compared as if they shared an evaluation population. All 545 assets are indexed; the added wallpapers remain unjudged. The hybrid routes supported picked-color queries to the bounded precomputed scorer and other queries to the existing relative-accent hybrid. The browser was restarted after registration.

### Numeric duplicate correction before scale indexing

A disposable OpenSearch index confirmed that sorted **numeric** doc values retain duplicate packed entries. The initial encoder incorrectly removed duplicates, which could both lose matching mass and misalign the original-RGB fallback for later palette slots. This was fixed before the million-document precomputed index was built: every occurrence now receives its own stable slot.

Regression tests first reproduced a score of 0.36621022 instead of the reference 0.7324219 for two identical red clusters. After the fix, ordinary-radius score differences stay within the stated rounding tolerance, and zero-radius red/black queries match the reference scores exactly. A second fixture puts duplicate black entries before green and red entries, verifying fallback alignment after duplicates. The disposable indexes are deleted after testing; the service evidence is shared `exploration/precision-duplicate-probe.json`.

None of the 545 original palette descriptors contains an identical packed duplicate, so their encoded fields and previous feedback rankings are unchanged. The full 3,270-score real-corpus comparison and bounded top-20 parity checks passed again. Synthetic mixtures can contain duplicates, making this a necessary scale-data correction.

### Retained execution optimization: cache doc-value lists

The precomputed scorer now obtains its L/count, a/b, and original-RGB doc-value lists once per document, then reuses them inside the centroid loop. The scoring arithmetic, numeric representation, and boundary fallback are unchanged.

Artifact: shared `exploration/precision-docvalues-cache-probe-2026-09-20T02-18-56.749Z.json`. Nine complete 545-document rankings (4,905 scores) were identical. Across 105 alternating trials per implementation and seven picked colors:

| Implementation | p50 call ms | p95 call ms | Mean service took ms | Mean call ms |
|---|---:|---:|---:|---:|
| Repeated per-centroid document lookups |5.41|8.16|4.19|5.72|
| Lists cached once per document |2.16|3.11|0.86|2.28|

The improvement was large enough to retain, while remaining a small-corpus, single-client measurement. The artifact archives both script sources. Baseline SHA-256: `f57644dee9fd43919f5baa28b924668e2789588c6fe184d76bc0619924de3d3a`; retained script SHA-256: `170e00498c0979e499e2ef70659271a94983129c959b66553fdbae08645d9c56`. The retained source exactly matches the measured candidate. Its containing module SHA-256 immediately after the change was `420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8`.

The complete suite then passed with both duplicate and 545-document service checks enabled: 74 passed, 12 intentionally skipped. The cache diagnostic reconstructs the repeated-lookup control from the retained scorer so it remains reproducible.

Feedback round 11 captures the final execution and encoding changes with updated source fingerprints: `2026-09-20T02-20-53.169Z-b5b47212`. Prior round 9 remains immutable.

| Method | Supported cases | Agreement | p95 ms | Maximum ms | Errors |
|---|---:|---:|---:|---:|---:|
| palette-precision-precomputed |3 / 37|0.794444|3.65|3.65|0|
| palette-precision-bounded-precomputed |3 / 37|0.794444|15.21|15.21|0|
| hybrid-indexed-precomputed |35 / 37|0.754762|11.36|13.86|0|

All agreement scores remain unchanged. These timings are the feedback loop's small-corpus measurements, separate from the million-document scale campaign. The browser was restarted after round 11 to load the retained implementation.
