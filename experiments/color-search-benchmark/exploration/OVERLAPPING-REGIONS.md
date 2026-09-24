# Overlapping coverage and quality — prototype

## Question and status

2026-09-21: the requested prototype is **complete**, including feedback evaluation, pixel-fidelity measurements, million-record load tests and visual checks. The inspector is **http://zerotwo:8227/** and both methods are also in **http://zerotwo:8225/**. The histogram inspector remains on port 8226. This is an additional experiment, not a production selection: broad named-color accuracy regresses in dense mode, nearest-anchor boundaries can cause large errors, and five-color queries fail the one-second limit under the heavier tested load.

## Representation

### Hide controlled color examples from wallpaper results — 2026-09-21

The overlap inspector now always excludes the 22 controlled color-test assets from wallpaper search in OpenSearch, and the **Include controlled test swatches** control has been removed. Its heading describes the 523 real wallpapers. Older clients sending `includeFixtures: true` cannot reintroduce these examples. The indexed test corpus and saved judgments remain available for repeatable evaluation; only this visual inspector's eligibility rule changed.

An independent audit found all 22 SVGs in the controlled-fixture cohort, with no additional clear solid-color fixtures among the 523 real assets. Two almost-black archive images are genuine topographic artwork and remain eligible. Live validation covers 24 method/count/query combinations with 100 returned hits each and explicit legacy fixture inclusion: no controlled examples returned. The gallery loads normally and has no fixture toggle. Receipt: external `exploration/overlap-inspector-qa/2026-09-21-hide-fixtures/` under the shared evaluation store. Both color-modal tabs still show nonmatching reference swatches as tiny squares.

### Keep nonmatching colors visible — 2026-09-21

The color modal now includes reference colors across the hue/lightness and hue/saturation planes, including colors outside the selected bin. **Nonmatching colors stay at 20% square width**, with their true opaque color, and remain clickable. Matching colors retain the existing 50–100% size range. Hover, tap and the detail strip explicitly label zero-quality colors **Does not count**; the legend includes the tiny zero-contribution square.

Reference colors are evaluated with the original OKLab membership formula after conversion to the exact RGB8 hex shown. They are not assumed to be nonmatches merely because the earlier accepted-color lattice had no sample in that cell. The lightness tab uses fully saturated references at each nominal hue/lightness coordinate; the saturation tab uses 50%-lightness references. Exact grays occupy their separate column; nonzero saturation is impossible for that column. Hueless black/white/zero-saturation references repeat across nominal hue columns in the usual HSL plane, while their actual HSL detail correctly reports no hue.

References merge with the existing accepted examples in each cell, preserving the best actual match and all distinct sampled colors. A reference that really matches displays its actual quality. This is a display addition: matching, scoring, index data and the average-quality cutoff semantics stay unchanged.

Validation: **76 integration tests pass, zero skipped**, including five new reference-membership and cell-merge regression tests. **57 browser checks pass** across all four counts and both tabs, verifying visible zero-quality squares, unchanged positive-quality sizes, click/hover details, detail-strip visibility and the legend. Desktop/mobile screenshots show the full range with tiny nonmatches, no unintended horizontal overflow and no JavaScript errors. Artifacts: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-visible-nonmatches/`.

### Separate color modal with hue/lightness and hue/saturation tabs — 2026-09-21

The matching-color view now opens in its **own wide modal** when a bin is clicked, or through **Explore matching colors** in the bin details. The wallpaper inspector stays open underneath. Closing or pressing Escape returns focus to the selected bin. Both **Hue × Lightness** and **Hue × Saturation** tabs use actual HSL coordinates: 72 hue columns in 5° steps, a separate no-hue column for exact grays, and 21 vertical positions in 5% steps. Low lightness/saturation appears at the top. The anchor hue is centered horizontally to keep nearby reds together across 0°; gray anchors use the full hue range starting at 0°. This replaces the earlier square atlas's equal-count grouping.

Each occupied cell displays its highest-quality sample, preserving the exact anchor when present. Selecting a cell exposes **all** its sampled colors below, sorted by the remaining HSL dimension. No accepted samples are lost by this projection. Sample colors remain opaque, with square side length proportional to their original OKLab match quality. HSL only controls display coordinates; membership, scoring and indexes are unchanged. Blank cells mean no examples in the representative sample, not proof that every possible color at those coordinates is excluded.

The wide grid retains its aspect ratio on mobile and scrolls horizontally, initially centering the anchor. Tabs support arrow/Home/End keys; grid arrows skip empty cells with a reading-order fallback so isolated grayscale anchors cannot trap keyboard navigation. A top-modal Escape handler prevents a browser grouped-close request from also dismissing the wallpaper inspector. The asynchronous response guard remains effective when a modal closes and another bin opens.

Validation: **71 integration tests pass, zero skipped**, including eight new HSL/layout tests. **114 browser checks pass** across all bucket counts, covering coordinate positions, all-sample conservation, cell inspection, tab behavior, no extra requests on tab switching, keyboard reachability, focus restoration and stale responses. Real browser Escape checks pass after both programmatic and pointer opening. Desktop and mobile screenshots show a wide grid, visible anchor on mobile, and no horizontal overflow outside the intentional grid scroller; there are no JavaScript errors.

Artifacts: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-color-modal/`. Reproduce with `make color-overlap-integration`; use **http://zerotwo:8227/**. All three visual services remain running. No relevance or scale rerun is required for this presentation change.

### Accepted colors inside a selected bin — 2026-09-21

The initial view showed **Colors that match this bin** beside the main grid, above that wallpaper's measured coverage/quality; it is superseded by the separate modal above. This is a representative view of colors accepted by the bin, including colors absent from the current wallpaper. Every displayed swatch is an opaque, exact RGB8 color whose membership is checked against the original region. Square side length scales with raw quality: 100% at the anchor and 50% at the edge. The outlined swatch is the exact anchor. Hover, tap or keyboard focus shows hexadecimal color, quality and OKLab distance; arrow keys follow the visible grid.

Samples are grouped by hue and then dark-to-light within columns. Near-neutrals are grouped first; the hue seam falls in the largest gap between sampled hues, keeping neighboring reds together. The atlas groups colors for inspection rather than claiming calibrated axes or color-frequency measurements. The same region has identical samples across all four bucket counts. The quality-influence and minimum-quality controls affect the wallpaper's aggregate score, not this membership geometry; low-quality example colors remain visible even with a high average-quality cutoff.

`GET /api/region-colors?regionIndex=N&bucketCount=1024` provides a read-only geometry response independently of wallpaper search. A local OKLab lattice at step 0.012 samples the fixed radius-0.12 sphere. The inverse conversion rejects out-of-gamut points before RGB8 rounding, then recomputes membership from each actual displayed RGB8 value. Duplicate colors are removed and the exact anchor is always included. At most 1,024 examples are retained deterministically across lightness/hue order, with sampling metadata explaining any reduction. A bounded 32-region cache shares samples across counts. This visualization leaves extraction, index fingerprints, stored data and ranking unchanged.

Validation: **63 integration tests pass, zero skipped**, including sampling, membership, black/white/corner colors, sparse bank IDs and the read-only endpoint. **112 browser checks pass** across all counts, including zero-coverage bins, proportional sizes, full opacity, dark-to-light columns, exact sample details, keyboard navigation, average-cutoff semantics, delayed stale responses, reopening the inspector and retaining the executed bank. Desktop 1440×1100 and mobile 390×1000 screenshots show no horizontal overflow; the browser reports no JavaScript errors. The initial CSS scale check was adjusted to 1e-6 tolerance for browser numeric serialization; the displayed sizing formula did not change. Red has 830 examples, black 100 and white 563 in this sampling scheme. These counts describe display examples, not wallpaper pixels or additional color buckets.

QA script, receipt and screenshots: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-matching-colors/`. Reproduce checks with `make color-overlap-integration`; try the view at **http://zerotwo:8227/**. This display-only follow-up needs no new relevance or scale campaign. Both previous comparison services remain running.

### Bucket-count comparison — 2026-09-21

The **Color buckets** selector at **http://zerotwo:8227/** switches between **16, 64, 256 and 1,024** regions. The original 1,024 remains the default. Both dense and named-family hybrid methods support every count, with the same query, quality-influence slider, minimum-quality cutoff and live-update behavior. Saved results retain their executed count when the controls change. The inspector shows the selected bank in a 4×4, 8×8, 16×16 or 32×32 hue/lightness grid, retaining sparse original region IDs and per-region score explanations.

Smaller banks are deterministic nested subsets of the original measured 1,024 anchors: seed the eight RGB cube corners, then use farthest-point selection in OKLab. The 16/64/256 prefixes share anchors; the 1,024 bank keeps the exact original definition and ordering. Radius 0.12, boundary quality 0.5, extraction samples, stored measurements and score formulas are unchanged. Each smaller index contains only its selected coverage/quality pairs, plus the same 23 named-feature pairs and metadata. Projection validation compares every stored scalar and all 545 IDs with the original corpus. No image re-extraction, histogram merging or coverage normalization occurs.

The API uses `parameters.bucketCount`, accepting exactly 16, 64, 256 or 1024. Queries route to separate real OpenSearch indexes; ranking stays entirely in OpenSearch. These are count configurations of the existing two methods, so the main comparison remains at 47 registered methods. Named-only hybrid queries produce identical scores and rankings across counts; picked-color queries and dense concrete named colors resolve within the selected bank.

| Buckets | Physical index | Primary store bytes, 545 documents |
| --- | --- | ---: |
| 16 | `color-exploration-overlap-16-real-v1` | 787,877 |
| 64 | `color-exploration-overlap-64-real-v1` | 1,738,298 |
| 256 | `color-exploration-overlap-256-real-v1` | 5,661,052 |
| 1,024 | `color-exploration-overlap-real-v1` | 20,849,819 |

All indexes have the same 523 real wallpapers and 22 fixtures, one segment and zero deleted documents at the recorded snapshot. The original index and extraction fingerprints are preserved. Smaller banks use fewer anchors with the same radius, which can leave colors farther from their nearest available anchor; increasing the count is not a guaranteed monotonic improvement in perceived relevance.

#### Feedback-loop results

Run `2026-09-21T16-35-36.773Z-ddf75f70` evaluates all eight configurations with quality influence 1× and minimum quality 0%, five timed repeats after one warmup at concurrency one. Each supports the same 31 of 37 cases, with six explicitly unsupported cases, 233 assessed pairs and zero errors. All 1,240 timed samples pass. Agreement below weights each supported query equally; it differs from the earlier 28-case named-only comparison.

| Buckets | Dense agreement | Hybrid agreement | Dense query p95 | Hybrid query p95 |
| --- | ---: | ---: | ---: | ---: |
| 16 | 72.47% | 74.41% | 1.82 ms | 1.78 ms |
| 64 | 65.59% | 73.33% | 1.92 ms | 1.65 ms |
| 256 | 67.04% | 73.87% | 2.14 ms | 2.14 ms |
| 1,024 | 66.40% | 74.41% | 4.24 ms | 3.55 ms |

These reuse the existing quick, single-observer development judgments; no new human labels were invented. Coarser quantization fitting these cases does not establish a preferred production count. Latency and storage describe only this 545-document corpus. No new million-record campaign was run, and the original large-scale limitations below still apply.

Validation passes **57 integration tests with zero skips**, **104 live API comparisons** and **53 browser checks**, including physical-index routing, selected-bank identity, service score parity, sparse IDs, slider preservation, live debounce/cancellation and saved-count inspection. Desktop/mobile screenshots show no horizontal overflow or JavaScript errors. Ports 8225 and 8226 remain available alongside the updated inspector.

Artifacts under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`:

- `runs/2026-09-21T16-35-36.773Z-ddf75f70/` — immutable eight-configuration feedback run; [browser report](http://zerotwo:8224/2026-09-21T16-35-36.773Z-ddf75f70/report.html).
- `exploration/overlap/bucket-projections/16-901e21f7f39a4df9ac10/`, `64-9a1bb54e299af52b656b/`, `256-0841d63256a57b6ec8e3/` — verified projections, provenance and source snapshots. Earlier projection revisions remain as historical evidence.
- `exploration/overlap-inspector/2026-09-21T16-33-20.814Z/validation.json` — 104 live API comparisons. An initial geometry check differed by floating-point roundoff between runtimes; coordinates now use 1e-12 tolerance while IDs and hex colors remain exact.
- `exploration/overlap-inspector-qa/2026-09-21-bucket-counts/` — browser receipt, scripts, screenshots, integration output and feedback log.

Reproduce with `make color-overlap-bucket-index` (build or verify existing smaller indexes), `make color-overlap-bucket-index COLOR_OVERLAP_ARGS='--verify'` (verify all four), and `make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/overlap-bucket-counts.json'`. The regular overlap integration and inspector smoke commands cover all counts.

### Minimum-quality contribution cutoff — 2026-09-21

The inspector adds a **Minimum quality** slider from 0% to 100%, in 1% steps, with a reset to 0%. The threshold applies to each requested region's stored average conditional quality (or the corresponding broad named feature). It does not recompute which individual pixels enter the region. At or above the threshold, the existing contribution and quality-influence factor apply; below it, that target's contribution is zero. The 0% default retains previous behavior. A target requesting 0% of a color is exempt because it rewards absence.

For each applicable target, `qualityGate = conditionalQuality >= float32(minimumQuality) ? 1 : 0`; the final target contribution is the existing area factor × quality factor × qualityGate × target weight. OpenSearch implements the cutoff through a native range-filtered zero weight. Passing targets keep the original averaging denominator. Other target contributions remain available, and wallpapers scoring zero can remain visible. The cutoff remains active when quality influence is 0×. Native comparisons and diagnostic comparisons use the same float32 threshold so an indexed 70% quality passes a 70% cutoff.

The cutoff participates in the existing 350 ms live-update behavior and saved query/parameter snapshots. Result captions show it; target cards and region details explain failed cutoffs; the score grid shrinks zero-contribution regions. The API accepts `minimumQuality` as a fraction from 0 to 1 and rejects invalid values before calling the service.

Validation: **45/45 integration tests pass, none skipped**, including native OpenSearch gates at 0%, 70% and 100%, exact/just-below decimal boundaries, both methods/modes, independent multi-target contributions, zero-score retention, zero-percent exemption and interactions with quality influence. All nine HTTP checks and 14 original preset parity checks pass. Browser QA passes 23 checks, including saved-cutoff inspection, real zero-score diagnostics/grid sizing, live debounce/cancellation, reset and zero-influence behavior. Desktop/mobile checks show no JavaScript errors or horizontal overflow. No reindexing or new scale-capacity claim was required.

Artifacts: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-minimum-quality/`; preset parity run `exploration/overlap-inspector/2026-09-21T16-03-29.032Z/` under the same external store.

### Quality influence and live updates — 2026-09-21

The port-8227 inspector now has a **Quality influence** slider from 0× to 3×, in 0.05 steps, with a reset to 1×. At 0×, quality is ignored; 1× reproduces the original scoring; larger values penalize weaker matches more strongly. This changes the influence of already-stored quality, not pixel membership or extraction. Both dense and hybrid variants support it.

With slider value `m` and conditional quality `q`, the quality factor is:

- Vibe: `max(0, 1 - m * (1 - q))`.
- Positive proportion target: `max(0, 1 - 0.35 * m * (1 - q))`, using the existing default quality penalty 0.35.
- Zero proportion target: 1, regardless of quality.

The existing area factor and target averaging stay the same. At 75% quality, for example, vibe retains 100% / 75% / 25% of its area score at 0× / 1× / 3×. Proportions retain 100% / 91.25% / 73.75%. Native OpenSearch field-value/linear-decay functions compute the global ranking; the application does not rerank candidates. At 0× with the minimum-quality cutoff also at 0%, ranking does not require or read quality fields.

**Update live as I change the query** is optional and initially off. When enabled, all query controls (including advanced JSON, amounts, method, result limit and fixture inclusion) search after a 350 ms pause. New edits immediately abort and invalidate older searches. Invalid input pauses live requests; turning the toggle off or pressing Cancel clears pending live requests. Manual search remains available. Result captions and inspection requests retain the executed query, method and normalized parameters, even if controls have since changed.

Validation: `make color-overlap-integration` passes 40/40 tests, none skipped, including native ordering at five influence settings across both modes/methods, real-corpus score-ledger parity, and nine HTTP tests. `make color-overlap-inspector-smoke` passes all 14 original preset parity checks. Browser QA passes 26 checks, including real ranking changes, debouncing, invalid-input pause/recovery, saved-parameter inspection, live-off cancellation and an intentionally delayed superseded response. Desktop/mobile visual checks show no horizontal overflow or JavaScript errors. The previous scale measurements apply to the original 1× setting; no new load-capacity claim is made for other values.

Artifacts: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-quality-live/` (browser receipt, QA script and screenshots); original-preset parity run `exploration/overlap-inspector/2026-09-21T15-49-33.781Z/` under the same external store.

### Inspector grid follow-up — 2026-09-21

The user found the scattered anchor order and equal-sized swatches hard to interpret. The inspector now defaults to **score contribution**: zero-contribution anchors shrink to 22% of their cell width, with positive contributions scaled by `0.22 + 0.78 × sqrt(contribution / largestContribution)`. The full button remains clickable. Coverage and conditional-quality views use the same relative sizing with their respective measurements; an equal-size anchor view is also available. Original swatch colors are preserved in every view.

The color atlas groups anchors by OKLab hue (near-neutrals first), splits them into 32 equal-count hue groups, and sorts each column by OKLab lightness, dark to light. Positions stay stable between wallpapers and queries, while original region IDs are retained. This is an ordered atlas, not a calibrated hue/lightness plot. Keyboard navigation follows visual positions, with vertical boundary movement staying in the same column. White outlines identify query-read regions independently of whether they contribute a positive score. Broad named features are explicitly identified outside the dense grid.

Validation: 19 live browser checks for values, sizes, identities, ordering, selection, hit areas and keyboard movement; 10 further checks for named-only hybrid queries and two-color proportions; desktop and 390-pixel mobile visual inspection; no JavaScript errors or horizontal overflow. One initial multi-color QA assertion was tighter than CSS transform serialization precision; correcting the check to 0.000001 tolerance passed with no application change. Screenshots and QA scripts: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-inspector-qa/2026-09-21-grid/`. This is a presentation update; the stored descriptors and score definitions are unchanged.

### Indexed fields

- 1,024 deterministic in-gamut sRGB anchor colors, distributed by farthest-point sampling in OKLab. Cube corners and named color swatches seed the selection.
- Each anchor has a radius of 0.12 in OKLab. A pixel inside the radius contributes its full area; its quality decreases linearly from 1 at the center to 0.5 at the boundary.
- Store coverage in basis points (0–10,000) and conditional mean quality (0–1), separately for every region. Zero coverage has zero quality. One pixel may contribute to many regions; coverage totals across regions need not equal 100%.
- Extract from the original images sampled at 128×128, rotated, converted to sRGB, and alpha composited onto black. Do not derive the new representation from the old 32-color palette or histogram centers.
- Keep existing named-feature coverage/quality fields for broad named colors and abstract vibes.

## Query experiment

Two variants share the same index and native OpenSearch scoring objective:

1. `overlap-quality-dense`: concrete named color swatches and picked hex colors resolve to the nearest region. Abstract vibes retain their named-feature interpretation.
2. `overlap-quality-hybrid`: broad named colors/vibes retain their existing interpretation; picked colors resolve to the nearest region.

The nearest region is an explicit approximation, visible in the inspector. Fixed radius/edge quality are part of the descriptor; unsupported controls must be rejected. Multiple requested proportions are independent marginal targets, not a disjoint allocation. These summaries do not contain the joint information needed to recover arbitrary union area or enforce palette purity.

For example, the red anchor `#FF0000` is region `o0004`. A hypothetical document with 20% coverage and 90% conditional quality stores:

```json
{
  "cov_o0004": 2000,
  "quality_o0004": 0.9
}
```

Coverage is a basis-point integer; quality is a float, not another percentage of image area. A proportion target uses `max(0, 1 − amountError × excessMultiplier) × (1 − 0.35 × (1 − quality))`. Excess has multiplier 1.5, shortfall 1. A zero desired amount ignores quality. Vibe uses `sqrt(coverage) × quality`. Multiple target scores are averaged equally. These are experiment parameters, not calibrated universal preferences.

Ranking uses the existing native asymmetric coverage/quality objective to isolate representation changes. All filtering and final ranking run in OpenSearch. The service never retrieves and reranks a candidate subset. Diagnostic calculations on a selected image explain the score and do not determine result order.

## Validation plan

1. Build a dedicated real index with all 545 assets (523 photographs, including all 418 archive members, and 22 fixtures).
2. Verify pixel overlap, coverage/quality separation, zero-area behavior, native score parity, filtering, and service result order.
3. Run both variants and controls through the existing immutable feedback loop. Compare common cases; preserve unsupported cases and unjudged images.
4. Add a dedicated inspector on port 8227 and register both methods in the existing comparison.
5. Measure staged synthetic-descriptor scale on the isolated OpenSearch node, including one million records and concurrency when feasible. Preserve every failure and response of one second or more. Synthetic performance records are not new human accuracy evidence.

All extracted data, images, index snapshots and run artifacts stay in the external shared store. Findings and exact artifact paths will be added here as work completes.

## Real corpus and correctness

- `color-exploration-overlap-real-v1`, OpenSearch 2.11.0, port 19216: exactly 545 source IDs verified, all 2,048 region fields explicitly stored, including zeros. Existing named fields are retained.
- Extraction took 136.58 seconds; indexing and verification took 1.21 seconds. The initial index store size was 20,849,710 bytes.
- Each sampled pixel matches 67.57 regions on average. Images have 621.76 occupied regions on average. These overlapping measurements are deliberately not a distribution summing to one.
- 32 live single-document explanations matched native scores within 0.000002. Five named hybrid queries reproduced all 545 scores and result orders from `native-quality-asymmetric` exactly.
- Ordinary ranking reads only the selected coverage/quality fields: one pair per query target, not the whole bank. The inspector reads all 1,024 pairs for one selected wallpaper.

Descriptor directory: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap/eb7da7a0e75d5a510930/`; descriptor SHA-256 `721d43782edd281b369d47724dc1733806004c7783960771c3356de5a82555c2`.

## Feedback findings

Immutable run: `2026-09-21T14-18-17.584Z-526f791b`, [report](http://zerotwo:8224/2026-09-21T14-18-17.584Z-526f791b/report.html). Both new variants support 31 of 37 logical cases; six are explicitly unsupported. All service calls succeeded. No judgments were changed. These remain one observer's development preferences, including the quick-pass uncertainty caveat; imported archive images remain unjudged.

Fair comparisons use identical cases, with each query contributing equally:

| Method | 28 shared named cases | 29 cases shared with histogram |
| --- | ---: | ---: |
| Dense overlapping regions | 65.65% | 65.23% |
| Overlapping regions + named families | 74.52% | 73.79% |
| Existing native coverage/quality | 74.52% | Not all supported |
| Fine histogram intent method | Not all supported | 75.63% |

The dense variant's main regressions are broad named green/red amount queries. A spherical neighborhood around the displayed green swatch is not the full perceived green family. More anchors do not repair that interpretation by themselves. Keeping broad named regions preserves previous named performance exactly, while adding picked-color queries.

On the three existing picked-color cases, both new variants score 73.33% agreement versus 80% for the histogram control. The original controlled shade case falls to 20%; the two real-photo precision cases remain at 100%. Three related development cases do not establish general precision quality. The current area-weighted vibe objective still rewards amount, which can conflict with the importance of closeness in a color-picker query.

Same-case IDs and exact metric calculations: external `exploration/overlap-feedback-comparison.json`. Full 545-asset query p95 was 3.51 ms for dense and 3.81 ms for hybrid in this run; these are small-corpus results, not scale claims.

## Nearest-anchor fidelity audit

An independent brute-force extraction recomputed all 5,450 anchor/image measurements (545 assets × ten picked colors). Coverage and float32 conditional quality matched the stored representation exactly: **zero mismatches**. This separates measurement correctness from approximation of the user's requested center.

Across the 4,913 RGB-grid samples, nearest-anchor displacement has median 0.01841, p95 0.02760, and maximum 0.03009 OKLab, up to 25.07% of the indexed radius. This grid is a sample, not a proof over all sRGB values. Named seed colors have exact anchors. `#FF2200` resolves to `#FF0000`; `#4C8C72` resolves to `#508F80`.

Across 523 photographs × ten requested colors, absolute coverage error relative to direct measurement around the actual requested hex averages 0.430 percentage points, with p95 2.294 points. Among 3,363 pairs with nonzero requested or indexed coverage, mean error is 0.668 points and p95 is 3.262 points. **The worst observed error is 93.475 points.** Quality-mass error across all photo/color pairs averages 0.286 points, p95 1.677 points, maximum 51.850 points.

Concrete boundary failure: for `madness-wallhaven-lyykvy`, requesting `#20B8D0` directly measures 94.855% matching area, while its indexed anchor `#20BFD0` measures 1.38%. Its large flat cyan background lies close to the hard spherical boundary. Moving the center a little moves almost the whole background across that boundary. This is not an extractor error. Increasing anchor count reduces typical displacement but does not guarantee a small worst-case area error for binary membership. The 50%-quality edge still has a hard jump from inside to outside.

Broad named red and the dense red swatch also mean very different things: mean coverage over all assets is 20.712% versus 1.916%. The representation does not automatically improve named-color semantics merely by adding anchors.

Audit artifact: external `exploration/overlap/fidelity/2026-09-21T14-23-17.030Z/fidelity.json`, including per-color distributions, worst images, exact sampling/source fingerprints, and independently measured fields. `make color-overlap-fidelity` reproduces it. This is descriptor fidelity evidence, not additional human relevance judgments.

## Visual and functional validation

- **150 integration tests pass, zero skipped**, including the existing prototypes, both inspectors, overlap extraction, the fidelity audit and native score parity.
- Five additional diversity-probe tests pass. The live probe verifies the completed index and current geometry/descriptor fingerprints. A startup guard initially rejected OpenSearch's reordered metadata keys; canonical value comparison against the original checkpoint fixed that validation error before any diversity timing samples were taken.
- Original comparison: 47 methods / 56 live checks passed. The new inspector: 14 live query cases matched the comparison's service order and scores.
- Desktop 1440×1000 and mobile 390×844 checks passed with no JavaScript errors or horizontal overflow. All 1,024 regions render, and opening an old result preserves its executed query and method even after controls change.
- The inspector states that totals are marginal targets; it does not label `100 − summed target amounts` as measured unspecified image area.
- QA receipts/screenshots/source hashes: external `exploration/overlap-inspector/2026-09-21T14-19-37.496Z/` and `exploration/overlap-inspector-qa/2026-09-21/`.

The inspector runs as `wallpaperdb-color-overlap-inspector.service` under the user systemd manager, bound to `0.0.0.0:8227`. Tailnet-hostname HTTP access was checked locally. The transient service survives the chat but must be recreated after reboot. `make color-overlap-inspector` starts it when the port is free; its environment must include the installed Node executable in PATH.

## Million-record scale results

Isolated node 19217, index `color-exploration-overlap-scale-v1`, one shard, eight CPU quota, 4 GiB heap, 12 GiB container. Stages: 1,000 / 10,000 / 100,000 / 1,000,000 synthetic mixtures; concurrency 1/4/16; at least ten seconds per profile. All ranking runs in OpenSearch. Mixed workload adds picked-color proportion queries to the common named/precision workload. Descriptor areas and quality masses are mixed separately before reconstructing conditional quality; these are not one million real photographs.

Artifact: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/overlap-scale/2026-09-21T14-18-19.063Z/scale.json`. The campaign finished with 24 profiles and 163,981 timed attempts across all sizes. All 192 warmups passed, including 48 at one million records. Analysis JSON, Markdown and its reproducible jq script are saved beside the raw artifact.

| Variant | Concurrent clients | p95 | Maximum | Timeout errors | Attempts ≥1s | Strict result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Dense | 1 | 341.70 ms | 358.55 ms | 0 | 0 | Pass |
| Dense | 4 | 346.80 ms | 368.98 ms | 0 | 0 | Pass |
| Dense | 16 | 831.60 ms | 1,083.64 ms | 7 | 6 | **Fail** |
| Hybrid | 1 | 337.13 ms | 347.19 ms | 0 | 0 | Pass |
| Hybrid | 4 | 344.32 ms | 377.50 ms | 0 | 0 | Pass |
| Hybrid | 16 | 826.63 ms | 1,013.42 ms | 9 | 6 | **Fail** |

Every failed/slow attempt belongs to `five-color-portions` or `picked-five-colors`. There are **24 distinct failures**: 16 timeout errors plus 12 attempts at or above one second, with four belonging to both groups. OpenSearch partial results are rejected even when the timeout response arrives before one second. Successful-request percentiles do not excuse those failures.

At 100,000 records both variants passed concurrency 1/4/16, with C16 p95 around 100 ms and maximum 193 ms. Increasing to one million raises p95 **8.28–8.94×**; this native function-score approach still scans the eligible population and does not maintain constant latency as the corpus grows. There is no 100-million-record claim.

Final quiet index snapshot: **1,000,000 documents, 16,455,916,028 bytes (16.46 GB), 40 segments**, with source disabled. Cumulative measured indexing time was **24.95 minutes**. Early small-stage store counters can be stale or reflect unmerged segments; use the saved final snapshot rather than extrapolating from them.

At one million records, observed OpenSearch CPU cost is about 82 ms per attempt at C1/C4 and 110 ms at C16. Sampled JVM heap peaks range from 1.52 to 2.72 GiB against the 4 GiB heap. Sampled benchmark-client RSS is 374–406 MiB, including retained corpus, indexing buffers and measurements; it is not the gateway's memory cost. The separate inspector process was observed around 86 MiB RSS after functional QA. Samples and CPU counters are observations, not guaranteed peaks or exclusive query costs.

### Scheduled arrivals

Both methods passed **20 and 50 requests/second**, each tested for 30 seconds, with 4,200 total timed requests and no errors, client rejections or one-second observations. At 50 requests/second:

| Variant | p95 | Maximum |
| --- | ---: | ---: |
| Dense | 161.94 ms | 369.69 ms |
| Hybrid | 171.01 ms | 377.55 ms |

This uses the shared **21 supported query shapes**, while the closed-loop campaign above has **24** after adding picked-color proportion queries. The percentiles are not interchangeable; the passing arrival test does not erase the five-color failures under the heavier mix/load. Artifact: external `exploration/arrival-load/2026-09-21T14-48-34.482Z/load.json`.

### Region-diversity probe

An additional **1,280 requests** exercised **128 different region anchors and 256 numeric color fields**, using a vibe query and a 40%-amount query for each anchor. All passed, including the first pass. At C4, p95 was **68.57 ms**, maximum **77.98 ms**; at C16, p95 was **197.51 ms**, maximum **212.77 ms**. The first sequential pass had p95 **72.21 ms** and maximum **76.79 ms**; caches were not flushed, so this is not a guaranteed cold-cache test.

These are single-color queries at exact indexed anchors. They isolate region diversity from nearest-anchor approximation and complex composition cost. They do not establish that all 1,024 regions or arbitrary multi-color requests meet the same latency. Artifact: external `exploration/overlap-diversity/2026-09-21T14-51-44.595Z-3773950/probe.json`.

The scale node is stopped after validation, with its indexes retained. All three visual services remain available. No wallpapers were added to git and no commits were made.

## Reproduce

```sh
make color-overlap-index COLOR_OVERLAP_ARGS='--verify'
make color-overlap-integration
make color-overlap-inspector
make color-overlap-inspector-smoke
make color-overlap-fidelity
make color-exploration-evaluate COLOR_EXP_ARGS='--methods overlap-quality-dense,overlap-quality-hybrid,native-quality-asymmetric,histogram-intent-balanced --label overlap-comparison'
make color-exploration-scale-up
make color-overlap-scale COLOR_OVERLAP_ARGS='--counts 1000000 --concurrency 1,4,16 --repeats 2 --duration-seconds 10 --batch-size 250 --rerun'
make color-overlap-diversity COLOR_OVERLAP_ARGS='--concurrency 4,16 --repeats 2'
make color-exploration-arrival-load COLOR_EXP_ARGS='--methods overlap-quality-dense,overlap-quality-hybrid --index color-exploration-overlap-scale-v1 --rates 20,50 --seconds 30'
make color-exploration-scale-stop
```

Start the inspector command only when its existing service is stopped or the port is free. Run heavy measurements sequentially. Real index creation without `--verify` intentionally refuses to replace an existing index. Scale resumption checks descriptor/generator/mapping identity and retains previous measurements.
