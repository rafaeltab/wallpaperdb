# First-round accuracy diagnostics

Read-only review of saved run **2026-09-20T00-50-38.374Z-32d2dbb7**, performed 2026-09-20. This diagnoses implementation mechanisms; it does not add human labels or declare a final winner.

The 37 logical cases come from one observer, include related images, and include a quick batch with explicit uncertainty. The 418 ZIP images remain unjudged. Reported values below use strict-pair query macro agreement with explicitly uncertain pairs removed. Scores from different methods are not directly comparable.

## Comparable coverage

The global aggregates cover different subsets: histogram methods complete 33 cases, native features 32, and swatch vectors 20. Comparing just their global means would mix method quality with support coverage.

All 16 methods share **17 fully covered cases**:

| Method | Agreement on the same 17 cases |
| --- | ---: |
| HSV cosine ANN / exhaustive reference | 0.5588 |
| HSV raw L2 ANN | 0.5667 |
| HSV unit-sum L2 ANN | 0.5294 |
| HSV Hellinger ANN | 0.4667 |
| RGB Hellinger ANN | 0.4608 |
| RGB cosine ANN | 0.5647 |
| RGB perceptual kernel | 0.6020 |
| Palette area | 0.7569 |
| Histogram area | 0.7588 |
| Histogram composition | 0.6451 |
| Native linear / Gaussian area | 0.7275 |
| Native coverage postings | 0.7265 |
| Native feature composition | 0.6373 |
| RGB marginal Wasserstein | 0.4608 |

These are development diagnostics on a small shared subset, not estimates of population preference accuracy. The large output window makes all judged images available here; it is separate from top-20 production behavior.

## 1. Partial-query purity accidentally adds a large underfill penalty

The initial composition score adds:

`outsidePenalty * max(0, 1 - matchedUnion - unspecifiedRemainder)`

For **40% green, 60% unspecified**, this is exactly:

`outsidePenalty * max(0, 0.4 - greenArea)`

With the first-round default `outsidePenalty = 6`, it adds six times the missing-green amount on top of ordinary area error. An image with too much requested green gets no corresponding extra term. This is an unintended strong asymmetry for a query where the remainder is free, and goes against the user's stated concern about overshooting 40%.

Observed consequences:

- Proportions category agreement drops from **0.589** for histogram area to **0.289** for histogram composition.
- In `proportion-green-real-batch-001`, human-first `wallpaper-093` moves from second among judged results to last. Query agreement drops **0.6 → 0.2**.
- In `proportion-red-real-batch-001`, human-first `wallpaper-029` moves from first to third. Agreement drops **0.8333 → 0.3333**.
- In `composition-blue-orange-batch-002`, partial 40% blue + 40% orange, histogram composition ranks the human-first `wallpaper-058` last.

**Refinement to test:** apply closed-palette purity only to full compositions, or when the user explicitly disallows extra colors. Keep target amount and color quality independent for partial compositions. A small deliberate excess penalty is a separate experiment, not something implied by outside-color arithmetic.

## 2. Quantized bin centers lose large neutral regions

The RGB4096 representation stores 16 bins per channel and classifies every pixel in a bin using the bin center. Near a narrow chroma threshold, that center can have different membership from the original pixels.

Recomputed grayscale membership using the exact same OKLab chroma threshold (`<= 0.035`):

| Image | Original sampled pixel area | RGB4096-center area | Difference |
| --- | ---: | ---: | ---: |
| `wallpaper-042` | 79.41% | 34.2468% | −45.16 percentage points |
| `wallpaper-048` (roses) | 71.66% | 42.2119% | −29.45 points |
| `wallpaper-029` | 69.62% | 64.7217% | −4.90 points |

In the original grayscale-with-red case, the human ranks the roses first. Histogram composition gives them **zero**; native pixel-derived features give **0.5642791**. The histogram's outside penalty amplifies its lost neutral area.

**Refinements to test:** use the already extracted actual-pixel measurements for named families; evaluate arbitrary ranges directly against adaptive palette coordinates, finer cells, or cell membership bounds. The initial palette scorer also snaps its centroids through the RGB4096 lookup, so it inherits some of this loss. Faster scripts alone do not fix the representation error.

## 3. Absolute brightness misses visible thin highlights

In `vibe-dark-accents-batch-001`, every initial area/composition method reverses all assessed strict pairs (**agreement 0**).

Human-first `wallpaper-005` contains pale thin geometric lines on black. Its sampled absolute features are:

- Dark area: **99.92%**.
- Bright area under the initial absolute cutoff: **0%**.

The current dark × bright-accent formula therefore returns zero. Human-last `wallpaper-015` (ocean rocks and bright foam) has **91.05%** dark and **4.45%** bright, so it scores about **0.91**. The geometric lines are visible in the real thumbnail; “zero bright pixels at the selected threshold” does not capture their visual contrast against the background.

**Refinement to test:** relative highlight contrast, upper-lightness tails, and finer sampling that preserves narrow details. Record background darkness, highlight area, and highlight contrast separately. One quick ranking does not justify tuning a formula to this exact order, but the zero response to visible lines exposes a structural limitation.

## 4. Picked-shade intent is overwhelmed by area

The controlled precision case has:

- A: 40% `#FF4400`.
- B: 10% exact `#FF2200`.
- C: 40% `#FF0000`.
- D: 40% exact `#FF2200`.

Human order: **B = D, A, C**. The user explicitly noticed B was narrower and still tied it with D on shade match.

The initial area × quality model ranks **D, C, A, B**; B's score is **0.2015** against D's **0.5108**. The `area^0.65` factor overwhelms shade closeness, and perceptual Euclidean distance also puts C ahead of A contrary to this user's shade judgment.

**Refinement to test:** for explicit picked-color queries, saturate the contribution from area once a meaningful region is present, then emphasize shade match. Keep this distinct from broad named-color vibe scoring. Test multiple reasonable support thresholds and directional color-space alternatives without claiming the synthetic case determines general photographic preference.

## Implications for the next round

1. Fix partial-query semantics before optimizing composition parameters.
2. Preserve actual-pixel named-family measurements; do not confuse quantization artifacts with user preference.
3. Test direct palette range evaluation alongside histogram/native hybrids.
4. Add generic relative-contrast descriptors for dark accents.
5. Treat precise color selection as a different weighting policy from named-color vibe.
6. Compare every refinement on both shared-support cases and its complete support coverage, including unchanged anchor cases. Preserve the first round as the baseline.

None of these recommendations requires learned embeddings or model training. Their production ranking still belongs inside OpenSearch; extraction-time descriptors are allowed.
