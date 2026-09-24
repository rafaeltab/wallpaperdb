# Base512 utility precision refinements

Implementation checkpoint, September 23, 2026. Real-service fidelity and performance are pending the coordinator's isolated benchmark window. No speedup or relevance improvement is claimed here.

## What changes

Both methods reuse the existing 256-bin, shade-aware strict-hue measurements and the unchanged whole-utility precomputation. They retain the existing quality and cutoff-weight presets and 5% proportion grid. OpenSearch performs global filtering and ranking.

| Method | Stored integer scale | Rank-feature terms per requested color | Utility rounding bound before query arithmetic |
| --- | ---: | ---: | ---: |
| `favorite-utility-rank18` | 262,143 | 2 | 0.00000190736 |
| `favorite-utility-rank27` | 134,217,727 | 3 | 0.00000000372529 |

The integer is split into base512 digits. Each positive digit is between 1 and 511 and survives Lucene's nine-significant-bit encoding exactly. Zero digits are omitted. Terms receive the corresponding place-value boost divided by the integer scale and number of requested colors. A required zero-score clause retains eligible wallpapers whose utility is zero.

These are quantized scoring objectives. Retrieval is exact for the stored objective. Final scores still use float32 boosts, products and sums, and precomputing whole utilities changes arithmetic grouping compared with the saved favorite. More integer precision does not guarantee identical final scores or tied ordering.

Rank-feature fields are separated by encoding and control preset. For example, `utility_rank18_q050_w1` stores the two digits for each target utility under keys ending in `_d0` and `_d1`. This keeps encoded per-field term-frequency sums below Lucene's signed-integer limit for a full preset bank. Index mappings disable `_source` by default to avoid storing and later decompressing large diagnostic documents.

## Modules

- `favorite-precision-utilities.mjs`: definitions, mapping, document encoding, global query builder and offline correctness oracle.
- `favorite-precision-index.mjs`: create-only real/synthetic indexing, external receipts, source/mapping identity, verified acknowledgements and final count checks.

Neither module modifies the preserved scorer, original utility encodings or existing indexes. One unchanged numeric utility pass supplies both new encodings.

## Verification completed

`make color-favorite-precision-test color-favorite-precision-index-test` passes ten offline tests. Coverage includes more than ten thousand values per encoding, exact digit representation, rounding bounds, zero and near-one scores, metadata and zero-document eligibility, all nine control presets, mixed-target query-term reconstruction, per-field frequency bounds, CLI isolation and synthesis before nonlinear utility computation.

The runner defaults to all 545 original assets in real mode. Scale mode uses the original 523 real source wallpapers, fixed seed and coherent measurement mixtures, with 100,000 or 1,000,000 documents. Fixture exclusion remains a query/UI choice for the real corpus. New index names and new external artifact directories are mandatory.

Example coordinated invocation:

```sh
make color-favorite-precision-index COLOR_FAVORITE_ARGS='--mode real --scope full --presets all --index color-exploration-favorite-precision-real-v1 --directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-precision/real-v1'
```

Add `--dry-run --samples 3` to calculate sample documents without service requests. Full-schema storage and memory must be measured separately from a small workload projection.

## Full-corpus fidelity runner

`favorite-precision-fidelity.mjs` reuses the original 16-query suite across all nine quality/cutoff-weight presets: 144 query/settings combinations and 288 new-method comparisons. Each query ranks all 545 assets in the native baseline and precision index. It checks native arithmetic, encoded digit reconstruction, actual service score errors, complete ordering, inversions and top20 overlap. Every target's fixed-point rounding error is checked separately from final float32 arithmetic.

The runner saves query bodies, all-document offline oracles, service rankings, progress, source graph snapshots and before/after index fingerprints in a new external directory. It rejects missing assets, changed index generations, mismatched mappings/metadata/plans and source changes. It accepts only the retained real service on port19216. Six offline runner tests pass; they include all144 query/settings combinations and an existing-directory guard that fails before service access.

```sh
make color-favorite-precision-fidelity COLOR_FAVORITE_ARGS='--directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-precision/fidelity-v1'
```

The callable API is `runFavoritePrecisionFidelity({directory, precisionIndex, allPresets})`; the default index is `color-exploration-favorite-precision-real-v1` and all presets are enabled. `--favorite-only` narrows the run to the saved controls; `--index` selects another complete precision index. These comparisons establish implementation fidelity, not perceived relevance.

The separate human-feedback config, `configs/favorite-precision-feedback.json`, compares the original favorite, existing rank16 and both new encodings. It preserves the existing extra perceived-red case and evaluation workload. Registry and adapter integration are coordinated separately; creating the config does not run any queries.
