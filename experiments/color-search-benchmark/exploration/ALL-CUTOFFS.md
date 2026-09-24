# All cutoff levels with adjustable weights

Throwaway prototype, 2026-09-21. User question: can every stored cutoff participate, with a slider ranging from equal weights to a strong preference for close color matches?

## Controls and scoring

On [the inspector](http://zerotwo:8227/), choose **Pixel cutoff: All cutoffs**. It supports 16, 64, 256 and 1,024 bins. The existing **Multiple cutoffs** method keeps its original three-level blend.

**Cutoff weighting** ranges from 0 to 6 in steps of 0.1. At zero, all five cutoff scores receive 20% weight. Increasing it favors stricter levels exponentially. All five coefficients remain positive; an individual component can still score zero because it has no matching area, fails minimum average quality, or has a zero quality factor. Weights are coefficients, not guaranteed shares of the final score.

For cutoff `c` in `[0, .25, .5, .75, .9]` and slider value `k`:

```text
weight(c) = exp(k × (c / .9 − 1)) / sum_over_levels(exp(k × (level / .9 − 1)))
score = mean_over_targets(sum_over_levels(weight × componentScore))
```

The exponential uses the actual cutoff positions, including the smaller gap from 75% to 90%. The ratio between the 90% and 0% coefficients is `exp(k)`, about 403 at the strongest setting. The UI displays all five percentages.

| Cutoff | Equal weights (`k=0`) | Strongest preference (`k=6`) |
|---|---:|---:|
| 0% | 20% | 0.171% |
| 25% | 20% | 0.903% |
| 50% | 20% | 4.782% |
| 75% | 20% | 25.319% |
| 90% | 20% | 68.825% |

**Quality influence** still changes the quality factor inside each component. **Minimum average quality** gates each component independently; a failing component's coefficient is not redistributed. Proportion queries compare each level's coverage to the same requested percentage. Zero-percent target exemptions stay unchanged. Broad named-family features, including abstract dark/grayscale vibes, remain single components; this slider applies to anchored colors.

The pixel cutoff selector is hidden for this version. API method `cutoff-all-levels` accepts `cutoffBlendExponent` in [0,6], default 0, and canonicalizes valid `pixelCutoff` values to 0. Other methods reject this new parameter. Explicit color ranges are unsupported because the blend has no single selected range. Quality curve API defaults remain linear; the inspector starts with power. At influence 1 those curves agree.

## Execution and inspection

The same five hard-cutoff coverage/conditional-quality measurements already exist in all four indexes. No images, extraction definitions, mappings or stored values change. The query-only helper `cutoff-blend.mjs` leaves the frozen measurement code untouched and is included in feedback provenance.

OpenSearch computes every candidate's score and global ordering. Query compilation calculates five scalar coefficients; no wallpaper candidates are reranked in the application. The query uses five components per anchored target. The diagnostic ledger records each actual coefficient and score contribution. Its coverage/quality averages are explanatory summaries, not a replacement scoring formula.

Saved result inspection uses the executed slider setting, even if current controls have changed. The bin-color modal uses that same saved distribution; its weighted membership display is a per-pixel visual aid, not a wallpaper score. Nonmatching colors remain visible as tiny squares.

### Inspect individual cutoff layers

The bin-color modal now includes a **Cutoff layer** dropdown. It opens in **Combined**, labeled with the weighting from the inspected search, and offers standalone **0%, 25%, 50%, 75% and 90%** layers. Each standalone layer displays its hard membership before its blend coefficient is applied, so a low-weight layer remains easy to examine. Switching back to Combined restores the exact saved distribution.

The original three-level consensus also exposes all five layers, including ones outside its active blend. Hard, feathered and core/halo profiles offer their current setting and each cutoff using the same kernel. Original fixed-region methods keep their existing preview.

Changing this selector only requests representative colors from the existing color-sampling endpoint. It does not rerun search, reorder wallpapers or alter scores. Each layer is sampled at its own support radius, preserving detail in narrow ranges. Hue/lightness and hue/saturation tabs remain available; excluded colors retain tiny squares. Layer selection resets to the current combined/profile view on opening another bin, and canceled or superseded requests cannot replace the latest layer.

Selector validation: six new request/options tests; the overlap unit/HTTP suite passes 77 checks with ten unrelated OpenSearch integration tests intentionally not run. The inspector server suite passes 12/12, including the new static browser-module route. Browser QA passes 24 bank/view combinations plus saved-weight restoration, original/legacy profiles, both axes, tiny nonmatches, delayed out-of-order responses, one injected failure followed by retry, and Escape/focus behavior. Layer switches make no search or inspection requests. Desktop/mobile views have no page overflow. Receipts, the reproducible browser script and screenshots are saved in external `exploration/color-layers/2026-09-21/`. Scoring is unchanged, so the earlier feedback results remain applicable; no new ranking campaign was run for this selector.

## Validation and feedback

Implementation validation is complete:

- `make color-cutoff-integration`: 43/43 passed, no skips. Includes real OpenSearch ranking reversal as weighting changes, score reconstruction, partial quality gates, both quality curves and percentages, all four banks, and legacy parity.
- `make color-overlap-integration`: 81/81 passed, no skips. Inspector-only server checks also pass 12/12 (included in that suite).
- `make color-cutoff-smoke`: 100 configurations passed, including all four banks at new exponents 0/3/6. HTTP order and scores match direct service queries; all fixture exclusions remain inside OpenSearch, including requests to include fixtures.
- Browser: 12/12 bank/exponent combinations pass. Preview and ledger weights agree; maximum score reconstruction discrepancy is `1.46e-8`. Saved-result inspection and all four membership modals preserve the executed exponent after current controls are edited. Rapid live changes resolve to the final 4.2 setting. Switching back to old methods omits the unsupported parameter. Both color tabs work; nonmatches stay visible at 20% square size. No browser errors, failed API requests or desktop/mobile page overflow. Browser closed.

The [feedback sweep](http://zerotwo:8224/2026-09-21T21-23-26.350Z-9d77559f/report.html) completed successfully. It compares all four banks at exponents 0/2/4/6 and quality influence 1/3 against the existing consensus method at starting cutoffs 0% and 50%, plus the canonical default: 49 configurations. Each supports 31 of 37 cases, with six explicit unsupported cases and zero errors. There are 4,557 timed requests, using one warmup, three repeats, concurrency 1 and top 20; accuracy uses a 1,000-result window. See `configs/all-cutoffs.json`.

All 49 configurations have zero missing supported judgments and zero eligibility violations. Candidate p95 latency is **1.86–5.48 ms**, maximum **49.59 ms**, with zero timed requests at or above one second on the 545-asset corpus. These measurements do not establish latency on a million wallpapers.

The strongest weighting (`k=6`) improves overall and real-image-only agreement over equal weights (`k=0`) in all eight matched bank/influence comparisons. Real-image gains range from **0.62 to 5.56 percentage points**, and persist when uncertain preferences are excluded. Each configuration still regresses on 1–5 individual cases. Proportion-case agreement improves in these endpoint comparisons; vibe agreement sometimes declines. This demonstrates a useful tuning tradeoff, not a universally better endpoint or an optimal exponent.

Agreement on the 27 supported real-image cases (183 assessed preference pairs), averaging each query equally:

| Bins | Quality influence | Equal weights | Strongest weighting |
|---|---:|---:|---:|
| 16 | 1 | 68.33% | 71.17% |
| 16 | 3 | 73.02% | 73.64% |
| 64 | 1 | 65.56% | 67.78% |
| 64 | 3 | 69.63% | 72.10% |
| 256 | 1 | 68.02% | 73.33% |
| 256 | 3 | 73.33% | 75.19% |
| 1,024 | 1 | 66.79% | 72.10% |
| 1,024 | 3 | 68.40% | 73.95% |

These configurations all use the power quality curve. The canonical API default uses linear quality at influence 1, which produces the same results as power at influence 1. Saved analysis also compares every new setting to both original-consensus controls; no production method or bank count is selected. The consolidated findings contain 52 valid default methods and 308 sensitivity configurations, with zero artifact-read warnings.

Artifacts are retained outside the worktree at `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/all-cutoffs/2026-09-21/`; feedback runs retain their original source snapshots and query plans.

HTTP smoke receipt: `exploration/cutoff-inspector/2026-09-21T21-22-17.490Z/validation.json` under the same shared store. Browser receipts and both viewport screenshots are in the all-cutoffs directory. Independent review found no blocking formula, diagnostic, provenance or scope issue.

The immutable feedback run is `runs/2026-09-21T21-23-26.350Z-9d77559f/`. Its `all-cutoff-findings.json` records all settings, per-case changes and paired comparisons. Analysis code/logs are in the all-cutoffs artifact directory. Main OpenSearch remains green, all visual/report services remain running, and the isolated scale node remains stopped. No reindexing, image changes or commits occurred.

Final independent audit (`all-cutoff-audit.json` beside the run) verifies all 36 query-source hashes against both the workspace and immutable source snapshot, including the new helper. Every raw timed request reconciles to the reported counts and maximum. `default-power-i1-parity.json` confirms identical saved IDs, scores and statuses between the canonical default and the 1,024-bin equal-weight power configuration at influence 1. Implementation and all evaluation/audit work are complete; the all-cutoffs artifact directory also contains `final-validation.json`.

Reproduce from the repository root:

```sh
make color-cutoff-integration
make color-overlap-integration
make color-cutoff-smoke
make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/all-cutoffs.json'
make color-exploration-summary
make color-overlap-inspector
```

## Performance limits

This adds no index storage, but five score components per anchored color can cost more query CPU than the existing one- or three-component versions. Exponentiation for the blend is done once during query compilation; changing the weighting does not introduce a new per-document script. The existing smooth-power quality curve can still use its Painless quality function.

No new million-record campaign is claimed for this method. Earlier unfiltered five-color consensus queries already failed the strict one-second limit on the synthetic million-record projection. A fast 545-asset feedback run cannot establish production capacity, especially with many concurrent users. Accuracy observations remain correlated single-reviewer development judgments, with the added archive wallpapers unjudged. No production winner is selected.
