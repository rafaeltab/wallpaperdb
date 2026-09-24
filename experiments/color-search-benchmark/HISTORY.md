# Color search: implementation and history audit

Recorded 2026-09-15. This is a read-only source/history audit for the 100-wallpaper experiment; it does not change production behavior. Benchmark measurements and conclusions belong in the main experiment report.

## Previously discussed alternative: L2

[GitHub issue #8, Color filtering](https://github.com/rafaeltab/wallpaperdb/issues/8) explicitly recommends comparing `cosinesimil` with `l2`. Its notes say to normalize histogram vectors to sum to one, use soft query vectors, account for black/white/gray, and consider exact reranking after ANN retrieval. The issue had no comments when read with `gh issue view 8 --json number,title,body,comments,url`.

The checked-out git history contains these relevant steps:

| Commit | Change |
| --- | --- |
| `ce9c600` (2025-11-30) | Adds `experiments/cosine_color_accuracy` |
| `5448bbe` (2025-12-02) | Renames the experiment's development script |
| `36a562f` | Adds production HSV histogram strategy |
| `72a0bdd` | Adds event-driven color extraction |
| `2afd913` (2026-05-07) | Adds OkLab-based query vectors and spread strategies |
| `23aea11` | Adds extracted-color projection and cosine OpenSearch mapping |
| `4c9db4e` | Adds GraphQL color sorting |
| `de04bff` | Adds the browse color picker |

`git log HEAD --oneline -S'l2' -- apps/gateway experiments apps/color-extractor` returned no commits. Therefore the issue documents the intended alternative, but there is no checked-in production L2 implementation in that history.

## Exact current baseline

### Extraction

- `apps/color-extractor/src/services/sharp-histogram-provider.ts`: reads image through `ImageReader`, obtains dimensions with Sharp, resizes to approximately 10,000 pixels while preserving aspect ratio, ensures alpha, then provides raw pixels to the histogram strategy. There is no explicit color-profile or grayscale channel conversion at this seam.
- `apps/color-extractor/src/services/hsv-embedding-strategy.ts`: hard-assigns each visible pixel to one of 64 bins. Bins 0–47 are 12 hue bins × 2 saturation bins × 2 value bins. Saturation below 0.1 instead uses bins 48–63, a 16-step value ramp. Chromatic saturation/value split at 0.5. Alpha weights pixel counts; fully transparent pixels are skipped. The result is L1-normalized (sum = 1), except entirely transparent images produce an all-zero vector.
- `apps/color-extractor/src/services/color-extraction-processor.ts`: publishes this histogram with `colorSpace: 'hsv'`.

### Query construction

- `apps/web/src/lib/browse-filters.ts:85`: the browse UI sends one color with `amount: 1`, omitting `spread`.
- `apps/gateway/src/services/color-sort.service.ts`: converts the requested hex color to OkLab; computes distances to representative centers of those 64 HSV bins; fills each query component with `amount * exp(-distance² / (2 * sigma²))`.
- Default strategy is `linear`, default spread 0.5, minimum sigma 0.1 and maximum sigma 0.5: **the UI therefore uses sigma 0.3**. `COLOR_SPREAD_STRATEGY` can select `linear`, `exponential`, or `exact`; `exponential` defaults to about 0.2236. `exact` places the color in its nearest OkLab center, which is not necessarily its extraction HSV bin.
- Chromatic centers use hue at the midpoint of each 30-degree bin, saturation 0.3/0.75 and value 0.25/0.75. Achromatic centers use `(bin + 0.5) / 16`.
- Contributions for multiple colors are added; individual kernels and the final query are **not normalized**. Thus `amount` is a kernel amplitude, not necessarily the intended fraction of normalized query mass. This distinction does not affect cosine's invariance to scaling the entire query, but matters for L2 and mixed colors with different kernel sums.

### OpenSearch request

- `apps/gateway/src/opensearch/mappings.ts:35`: `colorHistogram` is a 64-dimensional `knn_vector`, HNSW, Lucene engine, `space_type: 'cosinesimil'`; index k-NN is enabled.
- `apps/gateway/src/repositories/wallpaper.repository.ts:32`: constant `COLOR_SORT_K = 10_000`.
- `apps/gateway/src/repositories/wallpaper.repository.ts:290`: `bool.must` contains `knn: { colorHistogram: { vector, k: 10000 } }`; metadata constraints are outer `bool.filter` clauses. There is no relevance threshold. This is ranking, not a color exclusion filter.
- Forward requests sort by `_score desc`, then `wallpaperId asc`; backward requests reverse those directions. Pagination uses the returned sort values in `search_after`.
- `apps/gateway/src/graphql/resolvers.ts:168`: resolver builds the production query, requests `limit + 1`, and reverses backward pages. API results expose the wallpapers rather than the raw color score.
- `infra/docker-compose.yml:65`: the repository pins local OpenSearch to **2.11.0**. Test alternatives on this version and distinguish native ANN from script scoring. Do not infer supported Lucene metrics from latest-version documentation alone.

For a fair experiment preserve a native baseline request, then compare at least (a) a literal metric-only switch with the unnormalized current query and (b) L2 with a sum-normalized query. These are different changes. L2-normalizing both vectors makes squared Euclidean distance a monotonic transform of cosine, so it cannot improve ranking by itself.

## Concrete query/bin mismatch probe

A standalone Python transcription of the production sRGB→OkLab matrices, HSV centers and Gaussian formula was executed during this audit. This is a mathematical probe, not a substitute for executing production TS and OpenSearch in the benchmark.

| Query | Bin for an image of that exact color | Query's closest center | Default query sum | Bins above half peak weight |
| --- | ---: | ---: | ---: | ---: |
| Red `#FF0000` | 3 | 3 | 32.318 | 31 |
| Yellow `#FFFF00` | 11 | 63 (white) | 19.275 | 23 |
| Green `#00FF00` | 19 | 15 | 20.613 | 22 |
| Cyan `#00FFFF` | 27 | 62 (light gray) | 25.186 | 27 |
| Blue `#0000FF` | 35 | 31 | 28.845 | 34 |
| Magenta `#FF00FF` | 43 | 43 | 24.616 | 25 |
| Black `#000000` | 48 | 48 | 20.059 | 28 |
| White `#FFFFFF` | 63 | 63 | 21.303 | 23 |

Consequences to verify experimentally:

1. Current query kernels are broad: around one third to one half of all bins receive at least half the largest weight in these examples.
2. The nearest-center query and HSV extraction implement different quantizers. For pure yellow and cyan, `exact` places query mass in an achromatic bin although extraction places the identical pixel in a chromatic bin. Narrowing the Gaussian can amplify the same mismatch.
3. Cosine divides by document L2 norm. For L1-normalized histograms, highly distributed images have smaller norms; with a broad kernel this can reward a colorful/diffuse distribution over a concentrated target color. This is a mathematical hypothesis to evaluate on the 100 images, not yet a measured quality conclusion.
4. A better metric cannot recover brightness/saturation detail already discarded by 2×2 chromatic bins. A higher-resolution or perceptual palette representation may be required if metric changes are insufficient.

## Event and schema integration

1. `WallpaperUploadedConsumerService` consumes `wallpaper.uploaded` from its configured stream (`WALLPAPER` in the usual setup), durable `color-extractor-wallpaper-uploaded-consumer`. Non-image events are ignored. Image events invoke `ColorExtractionProcessor`.
2. `EventsService`/`WallpaperColorsExtractedPublisher` publish `wallpaper.colors.extracted` using the shared event publisher/envelope.
3. `packages/events/src/schemas/wallpaper-colors-extracted.ts`: payload has `wallpaperId`, `colorHistogram` and `colorSpace`; validation requires a nonempty numeric array and nonempty colorSpace, but does not encode dimensionality, normalization or extraction version.
4. `apps/gateway/src/consumers/wallpaper-colors-extracted.consumer.ts`: consumes from hardcoded stream `WALLPAPER`, durable `gateway-wallpaper-colors-extracted`, and calls repository `addColorData`.
5. `addColorData` is an OpenSearch scripted update with `refresh: true`, `retry_on_conflict: 3`. It overwrites histogram/colorSpace; it is not an upsert. An extracted-color event arriving before the wallpaper document relies on consumer retries.

For a metric-only prototype, existing histograms are sufficient. A new representation needs extraction, event/projection and index changes plus a backfill/replay plan. Version the representation rather than silently replacing the meaning of existing 64-dimensional data.

`IndexManagerService.createDefinition` returns immediately for an existing index; editing a mapping file does not migrate a running index. `wallpaperIndexDefinition` uses the physical index name `wallpapers`. Benchmark against isolated indices, and create a new mapped index/reindex plan for any eventual metric or dimension change.

`apps/color-extractor/test/color-extraction-pipeline.integration.test.ts` already demonstrates S3 upload → NATS upload event → real extractor → colors event. `apps/gateway/test/event-consumers.test.ts` covers projecting colors events. These are useful building blocks for exercising real seams without changing production services.

## Existing experiment: useful context, not a ready benchmark

`experiments/cosine_color_accuracy` hardcodes `/home/rafaeltab/Downloads/wallpapermadness`, loads PNG/JPG files, quantizes full-resolution pixels to an arbitrary OkLab palette, L2-normalizes counts, and ranks locally by cosine. It has no recorded dataset manifest, labels, metrics, native OpenSearch validation or NATS integration.

Its `Vector.fromInverseDistance` name is misleading: the active code returns a one-hot nearest-palette-bin vector, not an inverse-distance embedding. `embed.ts` ignores alpha and keys its RGB cache with base 255 rather than 256, so distinct RGB triplets can collide. Reuse conceptual ideas cautiously; do not use its outputs as a trustworthy production baseline.

## Scope and open checks

- No production files were edited for this audit.
- The report's algorithm observations are grounded in the current source. The 100-image benchmark must validate quality and score behavior on the real runtime.
- A 100-document corpus with k=10000 will not assess ANN recall, metadata filtering shortages, or pagination truncation at production scale. Report those as scale limitations rather than claiming the small experiment validates them.
