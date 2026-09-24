# Cached indexing plans for favorite utilities

Implementation checkpoint, September 23, 2026. This is an optional indexing CPU optimization. It does not change query execution or the stored scoring objective. The coordinated offline benchmark completed at14:07UTC with identical output bytes.

`compileFavoriteUtilityEncoder(plan, {encodings})` prepares preset field names, digit keys, measurement validation and descriptor metadata once, then returns `encode(measurement)`. It supports `numeric`, `rank8`, `rank16`, `rankfloat`, `rank18` and `rank27`, including mixed selections. Every cutoff contribution still calls the unchanged `scoreFavoriteComponent`; component order, summation, clamping, float32 casts, integer quantization and omitted zero digits remain unchanged.

Five correctness tests pass. They compare both deep object equality and exact JSON bytes across all encodings, all nine control presets, zero/full/mixed measurements, and the complete 6,138-utility favorite bank. Property insertion order is preserved, including preset groups and digit keys. Each returned document has independent utility objects.

## Offline benchmark

```sh
make color-favorite-compiled-encoder-test
make color-favorite-compiled-encoder-benchmark COLOR_FAVORITE_ARGS='--samples 32'
```

The benchmark verifies frozen inputs and selects32 real measurements distributed across the523 source wallpapers. It compares rank16, rank18 and the original four-encoding bank using the full favorite-preset plan. Original/compiled order alternates per document. Timed generation excludes JSON serialization and correctness comparison; every output must be byte-identical. Compilation cost, per-document timings, hashes and provenance are recorded in a new external artifact directory.

These measurements will not establish total indexing throughput: synthesis, serialization, HTTP bulks, OpenSearch ingestion and merges remain separate costs.

### Measured32-document generation comparison

| Encodings | Original mean | Compiled mean | Measured generation speedup |
| --- | ---: | ---: | ---: |
| rank16 | 6.510ms | 2.937ms | 2.22× |
| rank18 | 10.733ms | 3.039ms | 3.53× |
| numeric, rank8, rank16, rankfloat | 11.328ms | 4.765ms | 2.38× |

Compilation took approximately88–91ms per encoder. All96 compared output pairs were byte-identical. Raw timings, sample IDs, document hashes and frozen provenance are retained at `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/compiled-encoder/benchmark.json`.

The subsequent full-nine-preset real indexing attempt hit the existing real node's parent memory circuit breaker: approximately2.023GB was already in use, and a16.7MB HTTP reservation exceeded its2.040GB limit. This is separate from encoder correctness and query speed. Disabling stored source does not remove mapping or ingestion memory costs. The coordinator retains the failed run and owns service-capacity recovery.

## Separate create-only runner

`favorite-compiled-index.mjs` uses the compiled encoder once per run and caches the synthesis coverage-field list. It preserves the original deterministic measurement synthesis, seed, full-corpus checks, external receipts, create-only bulks, acknowledgement validation and source/mapping identity checks. `_source` defaults off.

```sh
make color-favorite-compiled-index-test
make color-favorite-compiled-index COLOR_FAVORITE_ARGS='--mode scale --scope full --count 100000 --presets favorite --encodings numeric,rank18 --numeric-points true --index color-exploration-favorite-compiled-full100k-v1 --directory /home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-compiled/full100k-v1'
```

`--numeric-points true` requires the numeric encoding and enables `index:true` alongside doc values. The default retains `index:false`. This prepares a separate mapping for numeric-sort experiments; the encoder values remain identical. The compiled runner's mapping comparator additionally handles OpenSearch omitting the default `index:true`, while still rejecting disabled points or changed metadata.

Metadata identifies original-only indexes as `strict-hue-favorite-utilities`, precision-only indexes as `strict-hue-favorite-precision-utilities`, and mixed indexes as `strict-hue-favorite-compiled-utilities`. All declare `compiledEncoderVersion:1`, `utilityDefinitionVersion:2`, `precisionDefinitionVersion:1`, `parentUtilityDefinitionVersion:2`, and the `numericPoints` flag. Mixed-index consumers must explicitly accept this representation; existing index guards are not silently weakened.

Five runner tests pass, covering isolated CLI configuration, mapping compatibility, numeric-point defaults, representation identity and synthesis before nonlinear encoding. No service calls were made while implementing these modules.
