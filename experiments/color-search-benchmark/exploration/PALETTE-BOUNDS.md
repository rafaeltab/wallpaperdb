# Exact palette precision with indexed cell bounds

`palette-precision-bounded` accelerates the direct-palette shade-first objective for one picked hex color and one OKLab radius. It still ranks the final result globally inside OpenSearch. The ANN seed is a way to obtain a useful score threshold, not the final candidate set.

## Necessary bound

The direct precision score is:

```
score = min(1, matchingArea / minimumSupport) * meanMatchingQuality
quality = 1 - (1 - edgeWeight) * distance / radius
```

Quality is defined inside the requested radius; outside colors do not match. Since the area factor is at most 1 and a weighted mean is no larger than its largest member, an image scoring at least `S` must contain a palette centroid with quality at least `S`. That centroid must be within:

```
radius * min(1, (1 - S) / (1 - edgeWeight))
```

For an edge weight of 1, the whole radius remains eligible. A zero or insufficient seed threshold disables pruning. Float score thresholds are lowered before deriving bounds, and distance bounds receive an additional numerical margin.

## Indexed representation

Each document stores the RGB4096 cells containing its **original RGB24 palette centroids** in `palette_cells`. A one-time exhaustive calculation visits every one of the 16,777,216 RGB8 colors and stores the minimum and maximum OKLab coordinates inside each of the 4096 cells. Each cell covers 4096 RGB8 values. The boxes are padded outward by 0.000002 per coordinate. This covers the interior of each cell as well as its corners.

The distance from the query color to a cell's enclosing OKLab box is a lower bound on distance to every centroid represented by that cell. An indexed `terms` query retains every document having a potentially qualifying cell. The final direct-palette script scores all documents passing that necessary condition.

## Service calls and consistency

1. Native RGB cosine ANN proposes up to 100 seed IDs.
2. OpenSearch scores those IDs with the exact direct-palette objective and returns its top 20.
3. The final OpenSearch query combines the original eligibility filters, conservative cell terms, and exact direct-palette scoring.

The application reads a service-returned kth score and compiles bounds; it never reorders documents. ANN underfill is never assumed to mean complete retrieval. The exactness argument assumes that the index and eligibility metadata remain stable across calls; production requires a consistent versioned search view/PIT or an equivalent mechanism.

`seedIndex` may refer to a separate vector index with the same document identities and metadata. Weak seeds or loose boxes can cause the final query to score many documents. Latency must therefore be measured on varied queries and concurrency, rather than inferred from the proof.

## Verification

Shared bounds artifact: `exploration/palette-cell-bounds-v1.json`. The generator recorded all 16,777,216 points and 4096 complete cells. The main 545-asset index received `palette_cells`, with receipt `exploration/palette-cell-index-receipt.json`.

`COLOR_EXPLORATION_PALETTE_BOUNDS_TEST=1 COLOR_EXPLORATION_PALETTE_BOUNDS_INTEGRATION=1 make color-exploration-test` passed 44 tests with 8 unrelated integration skips. The new checks covered:

- 320,000 sampled RGB8 centroids across four anchors and four thresholds, confirming box coverage and preservation of possible winners.
- An unseeded winner returned by the final global query.
- Exact top 20 ID and score parity against exhaustive direct-palette search for warm red, muted green, gray, and near black on the 545-asset corpus.

The proof preserves the implemented palette objective. It does not remove palette compression error or establish perception accuracy, million-document latency, or sufficient concurrency.

## Representation diagnostic: two grayscale failures

Offline descriptor calculations applied the same grayscale region (`OKLab chroma <= 0.035`) to the original sampled pixels, RGB4096 cell centers, palette centroids snapped to those cells, and the original RGB24 palette centroids. These calculations inspect representation error; prototype queries continue to run in OpenSearch.

| Wallpaper | Original sampled pixels | RGB4096 histogram | Palette32 with RGB4096 lookup | Direct RGB24 Palette32 | Direct palette error |
|---|---:|---:|---:|---:|---:|
| `wallpaper-042` | 79.41% | 34.25% | 37.42% | 82.94% | +3.53 percentage points |
| `wallpaper-048` | 71.66% | 42.21% | 42.38% | 70.45% | −1.21 percentage points |

Direct centroid comparison removes most of the observed membership loss: absolute error falls from 41.99 to 3.53 percentage points for the first palette and from 29.28 to 1.21 for the second. The residual error is material evidence that a 32-color palette remains an approximation. A centroid can represent pixels on both sides of a grayscale boundary. The sampled-pixel column is the reference for this hand-authored region, not an independent human judgment of grayscale.

Source: shared `features.jsonl`, IDs `wallpaper-042` and `wallpaper-048`; integer palette and histogram counts retain their full mass. The existing direct-service membership tests independently verify that the Painless implementation matches the centroid membership calculation.

## Unimplemented follow-up: bound required quality mass

The current index condition asks whether a document has any sufficiently close centroid. A tiny close-colored patch may pass that condition even when it cannot achieve the required overall score. The shade-first objective also implies:

```
matchingQualityMass >= score * minimumSupport
```

Precomputed per-cell palette masses could provide an additional conservative condition. One option is an indexed sum of each cell's mass multiplied by an upper bound on its quality. Another bounds how much mass must lie above a chosen quality level. Both would need an implementation that guarantees an upper bound despite index quantization; ordinary rank-feature truncation can underestimate values, so conservative upward rounding is required.

The follow-up [quality-mass assessment](PALETTE-MASS-BOUNDS.md) verifies its proof and OpenSearch query composition, and measures offline selectivity on the 545 assets. Implementation is deferred: dark/neutral candidate reductions are small, and the necessary native `function_score` wrapper loses competitive top-k skipping. The current prototype does not depend on it.
