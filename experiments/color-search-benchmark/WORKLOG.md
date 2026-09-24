# Color search investigation — durable work log

## Request and scope

Compare production color filtering with the previously discussed OpenSearch vector comparison on **100 varied real wallpapers**. If that does not give good results, prototype other options. Record setup, evidence, findings, and remaining work here across compactions. Experimental changes only until the evidence supports a production proposal.

## Plan

- [x] Trace production extraction, NATS event, projection, and query.
- [x] Locate prior alternative: GitHub issue #8 suggests `cosinesimil` and `l2`.
- [x] Freeze 100-wallpaper corpus with provenance, hashes, and color diversity summary.
- [x] Run existing extractor and gateway query code against isolated OpenSearch 2.11.
- [x] Compare native cosine, raw L2, normalized L2; verify rankings against exact math.
- [x] Build independent relevance measurements and inspect visual results.
- [x] If needed, prototype narrower query kernels, histogram metrics, perceptual color coverage, and palette matching.
- [x] Record limitations, recommendation, reproduction command, and interactive visual report.
- [x] Review benchmark correctness; rerun final experiment and clean up scratch infrastructure.

## Known facts / constraints

- Repo HEAD initially clean. Existing production uses 64 hard-assigned HSV bins (12 hue × 2 saturation × 2 value plus 16 grayscale), alpha weighted and L1 normalized.
- `SharpHistogramProvider` resizes to approximately 10,000 pixels before extraction.
- `ColorSortService` builds Gaussian weights around bin centers using OKLab distances. Default spread 0.5 gives sigma 0.3. Query is not L1 normalized.
- Gateway index is Lucene HNSW cosine; search uses k=10,000, descending score (through resolver), ascending wallpaper ID tie break.
- Issue #8 explicitly proposes cosine versus L2. A metric-only change and a normalized-L2 change must be measured separately.
- Existing experiment `experiments/cosine_color_accuracy` uses a different descriptor and hard-coded absent local image directory; it is not the production baseline.
- User confirmed: substantial visible color coverage is the target. Also inspect whole-palette / multiple-color behavior as secondary cases.
- Use a dedicated scratch OpenSearch and NATS; leave other worktrees and their services alone.
- Use Make targets for runnable commands. No production source edits are needed to benchmark.

## Evaluation discipline

Synthetic diagnostic images are **additional** to the 100 actual wallpapers. Do not claim synthetic cases are real-image evidence. Report pixel-based relevance as a proxy, separately from visual judgments, not as human ground truth. Preserve all rankings and settings, including unsuccessful candidates. Do not equate 100-image latency with production-scale performance.

## Delegation

- `trace_color_history`: HISTORY.md, current path and earlier discussion.
- `comparison_research`: RESEARCH.md, primary-source algorithm support and tradeoffs.
- `wallpaper_corpus`: 100 genuine wallpapers, manifest, downloader and CORPUS.md.
- Root: reproducible runner, live OpenSearch/NATS path, evaluation, visual inspection and synthesis.

## First executed red diagnostic

Command: `REQUIRE_SELF_MATCH=1 make color-benchmark-diagnose` (failed as expected). Imports production extractor and query builder. Pure yellow `#FFFF00` ranks white ahead of yellow; cyan ranks light gray; green ranks yellow. Output captured in `output/diagnostics.json`. Query sums range 19–32 versus image histogram sum 1.

Ranked hypotheses shown to user before benchmarking:
1. Metric/normalization bias: cosine rewards diffuse histograms; L2 normalization changes ranking. Predict metric comparisons improve some cases.
2. Broad default kernel (sigma .3): distant colors receive substantial weight. Predict narrowing improves hue selectivity.
3. Coarse/inconsistent descriptor: query uses OKLab bin centers, image uses HSV boundaries. Predict metric-only swaps cannot correct solid-color mismatch; finer perceptual descriptors improve it.

The diagnostic is a synthetic minimized case, separate from real wallpaper evaluation.

## Full experiment checkpoint

- Final manifest SHA256: `74574cc2fa3cd32a0eac5d7fd6831dafa72447f7c5cc92c94b29b88c480c58d8`; exactly100 genuine originals, 294 candidate selection pool, 248MiB. Source commit pinned in CORPUS.md.
- `make color-benchmark-extract` passed:100 upload events +100 color events; source hashes verified; both consumers delivered100 with zero pending/redelivery; exact extraction/projection equality. OpenSearch2.11.0/NATS2.10.29.18 production repository searches and pagination checked.
- `make color-benchmark-rank` passed on14 candidates ×28 queries ×100 wallpapers. OpenSearch/local score error below6.1e-7. Native cosine/L2 and Faiss RGB scores/recall checked.
- Independent review found and fixed a prototype k-means input alias (first centroid needed cloning). 99%-red/1%-blue centroid diagnostic now guards it; full rankings rerun after fix.
- Evaluation audit also fixed null-nDCG queries accidentally dropping from all aggregates, and multi-color precision now requires10% of EACH requested color. Graded multi-color nDCG still uses geometric mean.
- Development-only selection chooses palette32 sigma.06 and RGB512 sigma.08. Post-fix holdout CIELAB30 nDCG:current.290; rawL2.410; normalizedL2.209; RGB.705; palette.871. These are proxy scores, not user approval. Full metric sensitivity results in results.json/summary.json.
- Hybrid analysis: holdout RGB top20→palette nDCG.829, top50→palette.871. Worst top10 palette retention at20 candidates only.5; cannot recommend small shortlist universally. Current cosine top20→palette only.525.
- Some pure bright shades have NO substantial real matches in this corpus despite coarse color diversity. Explicitly report this rather than treating nearest fallback as good.
- `report.mjs` builds interactive report with query/method/proxy selectors, blind mode and corpus gallery; server running on127.0.0.1:8220 (agent session66057).
- Blind visual reviewer is evaluating8 anonymous comparison sheets after final clone fix. Waiting for VISUAL-BLIND.md, then root can decode output/blind-key.json.
- Final remaining work: finish independent audit, final full one-command rerun to capture source hashes, inspect report, write FINDINGS.md, record verification, stop scratch services while leaving static report available.

## Completed

- Final **`make color-benchmark` passed** in full; results timestamp `2026-09-15T22:31:55.817Z`. All source fingerprints verified against current scoring/pipeline code and corpus. Report embeds this same result timestamp.
- Blind judgments recorded before unblinding in VISUAL-BLIND.md. Decoding in VISUAL-RESULTS.md: palette preferred in seven useful-match sheets, no convincing result for magenta. Conservative slot counts: current4/40, rawL2 5/40, palette18/40. This was model visual review, not human ground truth.
- FINDINGS.md contains measured comparisons, failure mechanisms, sensitivity, candidate-shortlist tests, remaining visual weaknesses, and a concrete production direction. README.md records one-command reproduction.
- Independent audit verified all metric aggregations, all112 shortlist simulations and the chosen parameters. Three implementation/evaluation defects were corrected before final results.
- `make color-benchmark-down` completed: only the experiment's OpenSearch/NATS containers/network removed. Static report remains available at http://127.0.0.1:8220/report.html; server can be restarted with `make color-benchmark-serve`.
- Repository change scope: Makefile commands and `experiments/color-search-benchmark/` only. No production code changes, commit, PR, or external publication. Downloaded images (~252MiB including previews) stay ignored; manifest and numerical evidence are retained.
- Intended investigation is complete. Future production implementation, threshold calibration with human judgments, and scale validation are recommendations rather than unfinished requirements of this experiment.
