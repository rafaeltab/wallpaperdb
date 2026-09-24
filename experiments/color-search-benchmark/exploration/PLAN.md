# Broad service-backed color query exploration

## Active: optimize the preserved favorite — September 23

User authorized broad optimization prototypes, accepting discrete controls, 256 bins and more storage. Preserve the original snapshot and prefer the same scoring mechanism. [FAVORITE-OPTIMIZATION.md](FAVORITE-OPTIMIZATION.md) is the active plan/checkpoint. Initial parallel work covers a fused scorer, precomputed native utilities with several precision encodings, and a separate benchmark harness. Root owns indexing, UI, feedback evaluation and serialized service traffic. Prior completion below remains historical.

## Completed: performance test of the strong favorite — 2026-09-22–23

Tested `strict-hue-favorite-001` unchanged: 256/1,024 bins, shade-aware + strict hue, all cutoffs weighted at 1, linear quality influence 0.5. [FAVORITE-PERFORMANCE.md](FAVORITE-PERFORMANCE.md) is the full report, protocol, resource record and continuation reference.

**Conclusion:** current OpenSearch execution misses the one-second requirement for unrestricted complex queries at one million synthetic records. Both banks pass single-color vibe through C16; 40%-green fails C16; five colors time out at C1. Two-color queries fail C16 in the original campaign, and 1,024 bins also fail C4 in the confirmation. Original 1M data are a 70-measurement-field projection, not a full-schema capacity claim. Every 100k profile and every metadata-filtered 1M profile in the primary campaign passed. Scheduled single-color arrivals pass through the tested 16 requests/sec, p95 about 253 ms; this is not maximum capacity.

Primary: 140 profiles / 860,660 timed requests, independently audited. Arrival: eight profiles / 1,740 requests, independently audited. Full schemas at 10k/100k: 24 profiles each, full256 36,329 timed requests and full1024 combined 33,213, zero timing failures; exact 100k top-20 ID/score parity. Full1024 retains a merge-settle stop and default-source mapping resume failure; separate read-only completion resolves the remaining query stage with immutable parent provenance. Normal maintenance leaves 100k storage at 4,786,014,183 bytes (256) and19,139,629,133 bytes (1,024). Confirmation: 19 profiles / 1,979 timed requests, six failed profiles; all 1,719 successful responses exactly match original scores. All audits pass; sources and favorite remain frozen.

External artifact root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-performance/2026-09-22/`. Directories: `projection/`, `arrival/`, `full256/`, `full1024/`, `full1024-completion/`, `maintenance/`, `maintained/`, `resources/`, `resources-full/`. Each phase includes raw evidence, source snapshots and independent audit receipts. `resource-summary.py` reproduces kernel summaries. Helper tests: scale/corpus 16, arrival 8, completion 5, confirmation 5, maintenance 8 pass. No score optimization or hybrid quality curve was implemented.

**Final checkpoint September 23, 00:38 UTC:** all measurements, audits and cleanup complete. Kernel observer stopped normally; only scale OpenSearch 19217 stopped at 00:37:55 with volume/indexes retained. Real OpenSearch 19216 green, favored indexes 545 assets each, visual services 8225/8226/8227 return HTTP 200 through zerotwo; inspector 8227 confirmed again after shutdown. Favorite manifest/archive and all seven recursive source graphs unchanged. `final-validation.json` captures checks. No pending benchmark, agent, test or cleanup work. No commits or image/archive files added to Git. Future optimization experiments should preserve this favorite and compare exact global ordering and performance against this evidence.

## Strong favorite to preserve — 2026-09-21

User endorsed `strict-hue-favorite-001`: **All cutoffs: shade-aware + strict hue**, cutoff weighting favorite **1**, quality favorite **linear 0.5**, and **256 / 1,024 bins as joint favorites**. Weighting and influence remain adjustable. Similar perceived importance of quality/coverage is a user goal, not a proven equal-weight formula. Unspecified controls are explicitly inherited defaults in the saved configuration.

See [FAVORITE-SNAPSHOT.md](FAVORITE-SNAPSHOT.md), [snapshot manifest](snapshots/strict-hue-favorite-001.json) and [replayable feedback configuration](configs/strict-hue-favorite-001.json). Preserve the exact endorsed behavior and source references as later methods evolve. The user likes smooth power's interaction, but no single power exponent reproduces linear 0.5. A separate future hybrid can use linear on 0–1 and power above 1; it preserves the favorite exactly and is continuous at 1, with a slope change. This is recorded as a proposal, not silently substituted into the favorite or existing curves. No query or index code changed for this snapshot.

The exact favorite configuration is verified in feedback run `2026-09-21T23-49-12.493Z-97753239`: both banks have 32 supported/six unsupported cases and zero errors; 192 timed requests, p95 6.17/6.23 ms, maximum 38.51 ms on 545 assets. The manifest pins a 635-file external source archive, dependency files, extraction fingerprints and both index receipts. Source archive SHA-256 is `25cb051d58244b05c923adf2d52fccc470cc5600af2f0b6913c7a1dfb18a6ddd`. Checksums and archive contents verified. Joint-favorite preference remains unchanged by evaluation. No scoring changes; no pending work for this checkpoint.

## Completed: stricter hue within shade-aware matching — 2026-09-21

Live at http://zerotwo:8227/ as **All cutoffs: shade-aware + strict hue** (`cutoff-shade-hue-all-levels`), alongside the unchanged previous methods. The user's clarification is implemented literally: hue must stay closer to count, while darker-red shade tolerance is retained. Fully chromatic anchors keep full hue credit through 10° circular OKLab hue, then fade smoothly to zero at 30°; near-neutral targets blend toward the old metric. These are not HSL axis angles. All four bin counts, five cutoffs, weighting, quality controls, live updates and saved-query inspection remain available. Filtering and global ranking stay in OpenSearch with the same query formula.

All four separate `color-exploration-shade-hue-{count}-real-v1` indexes contain 545 verified assets; the gallery shows 523 real wallpapers and excludes fixtures in OpenSearch. Frozen extraction identity `334de5f444ac67fb606b` is under external `exploration/hues/`. Extraction took 253.497 seconds, indexing plus verification 38.64 seconds. Full audit confirms 2,790,400 coverage values only narrow admission and 87,200 neutral values remain identical. No prior measurements or indexes were replaced.

User example identities: preferred pagoda `madness-wallhaven-ogg7ql`; orange sky `wallpaper-031`. The old shade method fails this pair in 20/24 tested configurations; the new method passes 24/24. At quality influence 1 and equal cutoff weights, ranks change pagoda 91→81 and orange sky 52→112. Weighting 3 gives 101→92 and 61→121; weighting 6 gives 95→87 and 81→135. These ranks agree across banks because #FF0000 is an exact shared anchor. Both earlier red portraits retain or improve rank in all 24 settings. The change works mainly by reducing orange credit; it does not invent additional red area. Reported user ranks 93/61 were not exactly reproduced because the original controls were unknown.

Valid main feedback run `2026-09-21T23-11-56.676Z-ea2526a6` contains 49 configurations, 32 supported/six unsupported cases each, zero errors and 4,704 timed requests. Candidate p95 ranges 2.006–7.111 ms; maximum 55.466 ms. Historical-only agreement improves in eight paired settings and declines in 16; real-image-only agreement improves in nine and declines in 15. At the canonical default, historical real-image agreement is 70.86→72.47%, while all historical supported cases are 70.11→71.29%. This is a useful new option, not a universal winner. The one newly selected pair is reported separately from historical feedback; its source case is opt-in, leaving the original 37-case dataset stable. A separate legacy-default run `2026-09-21T23-14-33.424Z-046c06d3` records 186 timings and exact historical score/order parity, with no errors or ≥1-second results.

The first attempt `2026-09-21T23-04-54.211Z-070d8d5c` exposed unsupported fields in the new case's source query. It is preserved and excluded from valid findings. The source query was normalized, and a regression now verifies feedback normalization → interpretation → all three query compilers; evaluation tests pass 49/49. The analyzer's post-run canonical-parameter assertion was corrected for the runner's normalized empty object, without changing searches. A copy-only metadata/UI clarification after benchmarking explains partial chromatic strength; query and extraction behavior are unchanged.

Validation: 14 hue, 43 cutoff and 15 shade integration tests pass with no skips. Full replay includes 48 searches and 192 matching score ledgers. Independent audit recomputes raw timing, preference and prior-portrait results. Browser QA passes 25 checks and 36 API requests with no errors, covering four banks, all six layers/two axes, hue credit, tiny nonmatches, saved/live sliders, old methods and mobile. Root reviewed desktop/mobile screenshots; browser is closed. Both inspector and comparison were restarted; all four visual/report services are active, OpenSearch is green, and five page checks return HTTP 200. One initial cold findings request timed out at 15 seconds; its completed-cache retry returned in 32 ms. This report-rendering observation is not a color-query latency measurement.

Consolidated findings contain 54 valid default methods, 404 sensitivity configurations and zero read warnings. See [HUE-TOLERANCE.md](HUE-TOLERANCE.md) for equations, exact settings and regressions. External receipts: `exploration/shade-pair/2026-09-21/` for diagnosis, build/tests/browser/final health; `exploration/hue-aware/2026-09-21/` for feedback logs and replays; the two valid run directories for immutable results/source snapshots. Single-reviewer development feedback is not held-out population evidence. Small-corpus timings do not establish million-record/high-concurrency capacity; earlier expensive multi-color scale failures remain relevant. No wallpapers or archives committed. No pending work.

## Completed: shade-aware all-cutoffs comparison — 2026-09-21

Live at http://zerotwo:8227/ as **All cutoffs: shade-aware** (`cutoff-shade-all-levels`). The original all-cutoff method and other comparisons remain available. The new version uses the same five cutoff layers, distribution slider, quality influence, minimum quality, named-color handling and 16/64/256/1,024 banks. Its pixel metric partially normalizes chroma and relaxes lightness for chromatic anchors, with smooth neutral and near-black handling. This is a provisional directional tolerance; exact swatch distance remains available in the original methods. Filtering and global ranking remain in OpenSearch; there is no application reranking.

All 545 assets were remeasured and indexed in four separate `color-exploration-shade-{count}-real-v1` indexes. The gallery retains 523 real wallpapers and excludes fixtures in OpenSearch. All IDs, stored values and measurement provenance were verified. A full-corpus neutral audit found 87,200 exact matches with the original measurements. Extraction took 195.685 seconds; indexing plus verification took 39.39 seconds. Initial index sizes were 2.53 / 8.81 / 54.16 / 217.23 MB. Original measurement files and indexes remain unchanged.

Feedback run `2026-09-21T22-29-58.206Z-ceda9d2e` compared 49 configurations: 31 supported and six unsupported cases each, zero errors, 4,557 timed requests, candidate p95 1.728–6.573 ms and maximum 46.094 ms. Across 24 paired settings, overall agreement improved in 19 and declined in five; real-image-only agreement improved in eight, declined in 13 and tied in three. At 1,024 bins, influence 1 and equal cutoff weights, real-image agreement rose from 66.79% to 70.86%, with ten improved cases, four regressions and 17 unchanged cases across the full supported set. This is not a universal accuracy improvement or a production winner.

A separate 48-search replay returned all 523 real wallpapers each time; 192 OpenSearch inspections reproduced search scores. At influence 1 and equal weights, `madness-wallhaven-gww23l` moved from rank 54 to 8 and `madness-wallhaven-9oov2d` from 12 to 9. At weighting 3 they moved 33→10 and 26→24; at weighting 6, 24→14 and 40→38. No human relevance labels were invented for these examples. Broader rankings still expose regressions, including a leaf/sky swap in the first red case and some red/green combinations.

Validation: 15 shade integration tests and 43 cutoff integration checks pass without skips; overlap unit checks pass 80 with ten unrelated integration skips; all 14 inspector HTTP checks pass. Browser QA passed 25 checks with 31 successful API requests, all banks, every layer and both axes, live sliders, saved settings, legacy methods and mobile layout; zero console errors. Browser closed. The inspector, original comparison, histogram inspector and report services remain active; OpenSearch is green. Consolidated findings contain 53 valid default methods, 356 sensitivities and zero read warnings.

[SHADE-AWARE.md](SHADE-AWARE.md) records formulas, paired results, regressions and reproduction. Frozen measurements are under external `exploration/shades/cbf86defa3539910e8b9/`; evaluation, replay and browser receipts are under external `exploration/shade-aware/2026-09-21/`. Small-corpus timings do not establish million-record or concurrent production capacity; previous expensive multi-color scale failures remain relevant. Single-reviewer development judgments are not held-out population evidence. No pending implementation or validation work; no wallpapers or archives committed.

## Completed diagnosis: dark red feels much redder than its score — 2026-09-21

User supplied `/home/rafaeltab/.t3/userdata/attachments/2e3d9373-52f7-4563-8387-0de843690bfe-d63b0812-971c-45c5-b37a-0a5300402a78.webp`, a portrait with a substantial saturated dark-red background. Their judgment: it feels much more like #FF0000 than the present search credits; some images that do not feel red outrank it. They suspect overly strict lightness matching, especially for darker shades. Record this as a qualitative user observation, not an invented exact pairwise ranking or percentage label. Exact current UI controls requested asynchronously; meanwhile reproduce several existing settings.

User subsequently supplied the softer-red seated portrait at `/home/rafaeltab/.t3/userdata/attachments/2e3d9373-52f7-4563-8387-0de843690bfe-77086804-ada2-49ae-8fa0-a84ed419b6cb.png`: All cutoffs at influence 1 undercredits the first, while influence 3 improves it but demotes the second. Matched existing IDs are `madness-wallhaven-gww23l` and `madness-wallhaven-9oov2d`. Sixty-four real OpenSearch replays reproduce the tradeoff; ranks are identical across all banks because #FF0000 is exact in every bank. First source admits only 0.68% at cutoff 50%; second admits 11.72% but virtually none at 75/90. Cubing conditional quality favors tiny near-exact highlights while suppressing softer broad regions.

Root pixel analysis reproduces all ten stored measurements (area/quality at five levels) per source with exact basis-point/float32 assertions. In the first image, L explains 82.8% of squared distance within an explicitly heuristic saturated-red mask. Darkening also shrinks a/b coordinates. Downweighting L to .25 improves 50% admission to 18.53%, but does little for the strictest layer; partial shade normalization is a second candidate. This is diagnostic math, not an indexed implementation or a fix already applied.

[DARK-RED-DIAGNOSIS.md](DARK-RED-DIAGNOSIS.md) records measurements, tradeoffs, formulas, next controlled experiments, and the distinction between exact swatch similarity and shade tolerance. New Make commands `color-dark-red-identify` and `color-dark-red-diagnose` retain evidence under external `exploration/dark-red/2026-09-21/`. User observations are stored there separately from scored labels; no invented pairwise preferences were added. All diagnosis tasks are complete; live scoring and indexes remain as before. A revised metric requires a separately versioned measurement/index experiment; no production choice or new scale claim was made.

## Completed follow-up: cutoff layer selector in color modal — 2026-09-21

The bin-color modal now has a small **Cutoff layer** selector: current combined view using the inspected search's saved weighting, plus individual 0/25/50/75/90% layers. The combined and consensus methods use hard layers; single-profile variants preserve their membership kernel. Original fixed-region methods retain their current preview. The existing representative-color API samples every selected layer at its own resolution. This changes inspection only, with no scoring, extraction, index or feedback-judgment changes. Both axis tabs, tiny nonmatches, saved state, request cancellation and modal focus are preserved.

Implementation is live after restarting the inspector. The helper's six tests pass; `make color-overlap-test` passes 77 checks with ten unrelated integration checks intentionally skipped. `make color-overlap-inspector-test` passes all 12 server tests, including serving the new browser module. Browser QA passes all 24 bank/view combinations, legacy profiles, saved weighting, preview-only requests, both axes, tiny nonmatches, a deliberately delayed stale response, injected failure/retry, and child-only Escape/focus restoration. Desktop/mobile screenshots show the dropdown without page overflow. Receipts live in external `exploration/color-layers/2026-09-21/`. [ALL-CUTOFFS.md](ALL-CUTOFFS.md) records semantics and evidence. No new ranking benchmark is needed for this display-only change; no implementation work remains.

## Completed follow-up: all cutoff levels with adjustable weights — 2026-09-21

User requested an additional version using all five levels, with equal weights at one slider endpoint and exponentially more weight on strict cutoffs at the other. Keep the existing three-level consensus. Planned method `cutoff-all-levels` uses hard measurements at 0/25/50/75/90%, with `w(c) = exp(k * (c / .9 - 1)) / sum(exp(...))`, `k = cutoffBlendExponent` in [0,6], default 0. All weights stay positive. Quality influence and minimum-quality gates remain independent. Named-family features remain scored once.

Implementation and UI are live at port 8227. Backend/helper/diagnostics, API validation, membership samples and provenance are complete. Tests: 43 cutoff integration + 81 overlap integration pass, zero skips; 100 HTTP configurations preserve service order and exclude fixtures; 12 browser bank/exponent combinations pass, including saved settings, live changes and both membership tabs. Desktop/mobile screenshots and receipts are saved under `exploration/all-cutoffs/2026-09-21/` in the external shared store. Browser closed. Independent review found no blockers. Existing indexes and all frozen extraction definitions remain unchanged.

The 49-configuration feedback sweep completed successfully: `2026-09-21T21-23-26.350Z-9d77559f`, 31 supported/six unsupported cases each, 4,557 timed requests, zero errors or one-second responses, candidate p95 1.86–5.48 ms, maximum 49.59 ms. Strongest weighting improves overall and real-image-only aggregate agreement over equal weighting in all eight matched bank/influence pairs, with real-image gains of 0.62–5.56 percentage points, but individual cases and some vibe-query aggregates regress. The corpus and labels do not establish general accuracy or production performance.

[ALL-CUTOFFS.md](ALL-CUTOFFS.md) records exact formulas, controls, results, tradeoffs and artifacts. Consolidated findings: 52 valid defaults, 308 sensitivity configurations, zero read warnings. OpenSearch remains green, all visual/report services active; the scale node remains stopped. No pending implementation or benchmark work. No new million-record capacity claim; prior complex consensus scale failures remain relevant.

## Completed follow-up: smooth quality influence — 2026-09-21

**Live at http://zerotwo:8227/**. The quality-curve selector offers Smooth power and Original linear penalty across all six methods and 16/64/256/1,024 banks. The UI starts with power at influence 1; existing API clients default to linear. Both curves agree at 0 and 1. Vibe power is `quality^influence`; proportions raises the existing weighted quality factor to the influence. Explicit minimum-quality gates, zero-target exemptions, pixel membership and all stored measurements remain unchanged. Global ranking stays in OpenSearch, using native fast paths at 0/1 and a shared parameterized Painless quality function otherwise.

The inspector snapshots the executed curve, explains its component scores, supports live switching and displays tiny nonzero values in scientific notation. Final live reproduction: hard cutoff 0%, 16 bins, red, influence 3, minimum quality 0% returns 99 exact zero scores among the top 100 under linear, versus none under power.

Validation completed: 81 overlap integration checks, 34 cutoff integration checks and four scale-helper tests pass, with no integration skips. Browser checks cover all 48 method/bank/curve combinations plus saved-query replay after edits, rapid live switching, and desktop/mobile layouts. No browser errors or horizontal overflow; browser closed. Existing visual services remain active.

Feedback run `2026-09-21T19-57-25.162Z-4756a400` completed normally: 48 configurations, 31 supported cases each, six unsupported each, zero errors and 4,464 timed requests. Candidate p95 is 1.27–20.60 ms; maximum 56.25 ms on the 545-asset corpus. Power improves overall and real-image-only agreement in all 24 matched pairs at influence 3; gains are mainly in vibe queries and individual cases still regress. These are correlated, single-observer development judgments, not a held-out study or evidence that influence 3 beats influence 1. Main findings now contain 51 valid default methods and 260 sensitivity configurations, with zero warnings.

The separate scale run completed at 20:05:49 UTC on the retained 180-field, one-million-record synthetic projection: all 32 C1/C4 profiles passed, covering 512 timed requests and 16 warmups, with maximum 445.63 ms and no errors or ≥1-second responses. At C4, pooled mean latency rises from 36.34 to 62.10 ms for one-color queries and 280.91 to 416.18 ms for five-color queries. Only hard/feather membership, 256/1,024 bins, cutoff 0% and influence 3 were tested. There is no full-schema, sustained-load or C16 claim. Independent audit reproduces every profile statistic and raw-request classification. Short CPU-counter intervals prevent reliable CPU ratios.

The isolated scale node at port 19217 is stopped with its index retained. Real-corpus OpenSearch remains green; ports 8225/8226/8227 and the feedback report are available. No reindexing, source-image changes, commits or production selection occurred. Formulas and findings are in [QUALITY-CURVES.md](QUALITY-CURVES.md); scale protocol, raw accounting and scope are in [QUALITY-CURVE-SCALE.md](QUALITY-CURVE-SCALE.md).

Artifacts under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`:

- `runs/2026-09-21T19-57-25.162Z-4756a400/` — feedback, immutable sources, paired analysis and findings JSON.
- `exploration/quality-curves/2026-09-21/` — integration logs, browser script/matrix, screenshots and final live API comparison.
- `exploration/quality-curve-scale/2026-09-21T20-04-25.158Z/` — scale source snapshots, requests, resource observations, audits and shutdown receipts.

Final closure: implementation, evaluation, independent auditing and documentation are complete. The scale report agrees with the saved results and explicitly distinguishes this C1/C4 run from inherited C16 wording in the original projection's limitations. All agents are finished; no pending work remains.

## Completed follow-up: pixel cutoff and feathered variants — 2026-09-21

Four additional membership profiles are live at **http://zerotwo:8227/**: hard cutoff, feathered cutoff, full core with soft halo, and multiple-cutoff consensus. Each supports 16/64/256/1,024 buckets and cutoff levels 0%, 25%, 50%, 75%, 90%. The original methods, quality controls, live updates, saved-query diagnostics and separate matching-color modal remain available. Ranking stays global in native OpenSearch. The gallery searches 523 real wallpapers and excludes all 22 controlled fixtures in OpenSearch.

All four real indexes contain all 545 evaluation assets, with every stored scalar verified. Hard50 reproduces the original measurements and rankings exactly. The 1,024-bank contains 30,720 region numeric fields; its build required small-batch recovery after the existing 2 GiB heap hit a parent circuit breaker. No original index or heap configuration was changed. Formulas, physical versus effective area, index sizes and recovery commands are in [CUTOFF-PROTOTYPES.md](CUTOFF-PROTOTYPES.md).

Validation: original overlap integration 76/76; final cutoff integration 31/31; feedback-loop tests 46/46. All service integration tests ran without skips. An 88-configuration API check preserves native top-100 ordering and fixture exclusion. Browser QA covers 32 profile/count/axis combinations plus live updates, saved snapshots, consensus components, actual Escape behavior and mobile layouts.

The 168-configuration feedback sweep completed with 31 supported cases each, six unsupported cases each and no query errors. Its 26,040 timed requests have candidate p95 of 1.015–6.245 ms on the 545-document corpus. The initial oversized HTML export failed after measurements were saved; bounded inline diagnostics repaired rendering without rerunning queries. Raw results and renderer provenance are retained. Four canonical defaults completed separately; the main comparison now has 51 valid default methods and 212 sensitivity configurations.

[Evaluation analysis](CUTOFF-EVALUATION-REVIEW.md) records the relevance signal and its limits. For example, 256-bin consensus50 improves real-image agreement from 70.43% to 74.75%, but the judgments are correlated, single-observer development data. Only three cases cover picked hex colors, none explicitly judge selectable closeness, and the archive images are unjudged. No winner is selected.

The sequential 100k→1M mixed and dedicated five-color campaigns are complete. All 96 mixed profiles passed at 100k. At 1M, hard/feather/core-halo passed all 72 mixed profiles, but every consensus variant failed at some tested load. Dedicated unfiltered five-color requests exposed additional concurrency limits: all six non-consensus variants passed C1/C4, but only feather256 and core-halo1024 passed C16. Both consensus variants failed at C1. These tests index only 180 queried numeric fields, not the full schema, and use synthetic mixtures rather than one million photographs. [CUTOFF-SCALE.md](CUTOFF-SCALE.md) preserves all failures, omissions, timings, resource observations and interpretation limits.

External artifacts under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`:

- `exploration/cutoffs/b9e3ecc0d8381df0b460/` — extraction, frozen sources, indexing audit and recovery.
- `exploration/cutoff-inspector/2026-09-21T18-50-50.018Z/` — API/integration receipts.
- `exploration/cutoff-inspector-qa/2026-09-21/` — browser matrix, interaction receipts and screenshots.
- `runs/2026-09-21T18-52-54.244Z-1101fa3a/` — 168-configuration feedback, detailed analysis and render recovery.
- `runs/2026-09-21T19-14-00.182Z-d06fdb5a/` — four canonical default methods.
- `exploration/cutoff-scale/2026-09-21T19-18-49.670Z/` — mixed scale campaign and nested `heavy-2026-09-21T19-26-26.601Z/` follow-up.

Final checkpoint: both benchmark processes have completed. The isolated scale node at port 19217 was stopped at 19:30:24 UTC with its index retained. Real-corpus OpenSearch remains green and all visual services remain active. The prototype, old findings page and full sweep report return HTTP 200 through `zerotwo`. Final cutoff integration passes 31/31 with zero skips. An independent reviewer verified every raw request, all 198 profile summaries, warmup inclusion, the 18 skipped stages and the scale report without discrepancies. Final validation is recorded in the inspector artifact directory as `final-validation.json` and `integration-final.tap`. No pending implementation, evaluation, audit or agent work remains. Source wallpapers and generated artifacts stay outside Git; no commit or production choice was made.

## Completed follow-up: hide test swatches from wallpaper results — 2026-09-21

The overlap inspector now searches the 523 real wallpapers, always excluding controlled color examples within OpenSearch and removing their inclusion toggle. Shared fixtures and feedback evidence remain available for evaluation. Twenty-four live API checks across both methods and all bucket counts pass, including legacy requests that try to include fixtures. The earlier tiny nonmatching-color swatch request is also complete. Documentation and QA receipts are linked in [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md); all visual services remain active.

## Completed follow-up: visible nonmatches — 2026-09-21

Both color-modal tabs retain nonmatching colors as tiny 20%-width squares instead of hiding them. Reference HSL colors have exact membership recomputed from displayed RGB8; true matches retain their original quality and zero-quality colors are labeled **Does not count**. All four bucket counts work. Validation: 76 integration tests, zero skipped; 57 browser checks; desktop/mobile screenshots. [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md) records the semantics and external artifacts. The request is complete, with existing comparison services active.

## Completed follow-up: separate color modal and axis tabs — 2026-09-21

Port 8227 moves matching colors into a separate wide modal with **Hue × Lightness** and **Hue × Saturation** tabs. True HSL coordinates use 72 hue columns plus grayscale and 21 vertical positions; clicking an occupied cell exposes all its accepted color samples. Original OKLab membership and quality are preserved. The modal keeps the wallpaper inspector beneath it, restores bin focus on close, handles Escape independently, and supports mobile horizontal scrolling. Validation: 71 integration tests, zero skipped; 114 browser checks; desktop/mobile and actual keyboard Escape checks. Details/artifacts are in [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md). The request is complete; existing comparisons remain active.

## Completed follow-up: accepted-color view — 2026-09-21

Selecting a bin on port 8227 displays representative colors inside that bin, organized by hue/lightness with opaque square sizes proportional to raw match quality. Exact hex/quality/distance is available by hover, tap or keyboard. The view describes fixed geometry, separately from current-wallpaper measurements and aggregate quality controls. All four banks work; ranking, indexing and extraction are unchanged. Validation: 63 integration tests, zero skipped; 112 browser checks; desktop/mobile visual checks. External QA artifacts and implementation details are in [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md). The requested addition is complete, and all three visual services remain active.

## Completed follow-up: bucket-count selector — 2026-09-21

Port 8227 now offers 16/64/256/1,024 buckets with original 1,024 as default. Three new physical OpenSearch indexes store exact projections of nested subsets of the original measured anchors for all 545 assets. Radius, scoring, quality controls and live updates stay the same. Grid inspection uses the executed count and preserves original region IDs. Both dense and hybrid variants support all counts; named-only hybrid results are invariant.

Validation: 57 integration tests, zero skipped; 104 API comparisons; 53 browser checks. Eight explicit feedback configurations completed in `runs/2026-09-21T16-35-36.773Z-ddf75f70/`: the same 31 supported cases each, six unsupported each, zero errors and 1,240 timed samples. Findings, storage/accuracy/latency tables and artifact paths are in [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md). No new million-record claim or preferred count is selected. All three visual services remain active; the scale node remains stopped. This request is complete with no pending agents or campaigns.

## Completed follow-up: inspector controls — 2026-09-21

Port 8227 now groups grid colors by hue/lightness, shrinks noncontributing swatches, provides a 0×–3× quality-influence slider and a 0–100% minimum-quality cutoff, and supports optional debounced live queries. Scoring remains native OpenSearch, with original behavior at 1× influence and 0% cutoff. All controls and score diagnostics retain the executed parameters; canceled or superseded results cannot replace newer results. Validation and external artifact paths are in [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md). No pending work for these requests remains.

## Completed follow-up: overlapping coverage/quality — 2026-09-21

The user requested many overlapping regions with separate coverage and quality, then asked “can you make one?” The prototype is complete and live at **http://zerotwo:8227/**. Both new variants appear in the 47-method comparison at 8225; histogram inspection stays on 8226. All 545 assets are indexed. [OVERLAPPING-REGIONS.md](OVERLAPPING-REGIONS.md) contains the representation, formulas, support limits, measurements and reproduction commands.

Completed evidence:

- Feedback run `2026-09-21T14-18-17.584Z-526f791b`: both variants support 31/37 cases without errors. On 28 shared named cases, dense scores 65.65% versus 74.52% for hybrid and the existing native control. No overall relevance improvement is established.
- 150 integration tests pass, none skipped, plus five additional diversity-probe tests. The comparison passes 56 checks across 47 methods; the inspector passes 14 live checks and desktop/mobile QA.
- Independent extraction confirms 5,450 stored measurements exactly. Nearest-anchor boundary shifts nevertheless cause a worst-case 93.475-percentage-point coverage error relative to the actual picked color.
- Million-record mixed workload: C1/C4 pass, C16 fails for both variants, exclusively on five-color percentage queries. Raw timeout and ≥1-second observations are retained.
- Scheduled arrivals: both pass 20 and 50 requests/second across 4,200 timed requests. Different workload coverage is explicitly documented.
- Region diversity: 1,280 requests across 128 regions pass, including C16; maximum 213 ms. These are single-color queries, not proof for complex combinations.
- Final million-record index: 16.46 GB, source disabled; cumulative indexing 24.95 minutes. No 100-million-record capacity is claimed.

All campaigns are finished. The isolated scale node is stopped and retains `color-exploration-overlap-scale-v1`. All three visual services remain running. There are no pending agent jobs or required benchmark steps. Source images, descriptors, snapshots and measurements remain outside git; no commits or production choice were made.

External artifact roots under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`:

- `exploration/overlap/eb7da7a0e75d5a510930/` — original-pixel descriptors and extraction sources.
- `exploration/overlap/fidelity/2026-09-21T14-23-17.030Z/` — exact-pixel fidelity audit.
- `exploration/overlap-scale/2026-09-21T14-18-19.063Z/` — staged scale profiles, sources, final index snapshot and reproducible analysis.
- `exploration/arrival-load/2026-09-21T14-48-34.482Z/` — scheduled arrivals.
- `exploration/overlap-diversity/2026-09-21T14-51-44.595Z-3773950/` — broad region-selection probe.
- `exploration/overlap-inspector/2026-09-21T14-19-37.496Z/` and `exploration/overlap-inspector-qa/2026-09-21/` — API and browser receipts.

## Follow-up: histogram inspection — 2026-09-20

The user requested a separate visual inspection page for `histogram-intent-balanced`, keeping the original comparison alive. **Completed:** the inspector is running at **http://zerotwo:8226/** under `wallpaperdb-color-histogram-inspector.service`; the existing 8225 service and scoring methods are unchanged. It exposes all 4,096 bin values, query weights, service-computed score terms and nonadditive removal effects. Nine integration/HTTP checks, eight live old/new parity cases, desktop/mobile interaction checks and an independent formula/state audit pass. Both services remain active; no agent work remains pending. Exact operation, interpretation, evidence and follow-up leads are in [HISTOGRAM-INSPECTOR.md](HISTOGRAM-INSPECTOR.md).

## Authorization and objective — 2026-09-20

The user explicitly authorized broad prototypes, evaluation, and a second refinement round. This supersedes earlier discussion-only restrictions. No production method is selected. No learned ranking or image embeddings. Runtime filtering and ranking must happen in OpenSearch or another service, never by sorting wallpaper candidates in JavaScript. Query compilation and offline image feature extraction are allowed.

Use the original 100 wallpapers and every image in `/home/rafaeltab/wallpapermadness.zip`. The archive has 418 images (304 JPEG, 114 PNG), 1.73 GiB uncompressed. Keep originals, derivatives and generated large datasets outside the repository in the reusable color-evaluation store. Preserve all existing human judgments and old experiments.

Accuracy and speed are essential. A query exceeding one second fails the user's viability requirement for that tested workload. Measure concurrency and scale; a fast 545-document query is not evidence of million-document viability. Synthetic scale documents are performance data, never additional human relevance evidence.

## Work sequence

1. Import all images with source hashes and extraction metadata; retain all prior judgment IDs.
2. Implement broad families: HSV cosine/L2 controls, Hellinger histograms, RGB/perceptual distributions, palette and sparse-histogram coverage, indexed named-color/vibe features, composition area/quality/purity objectives, distribution distances, and exact pruning where valid.
3. Use the existing feedback loop for every implementation. Report support, missing judgments, uncertain preferences and per-category agreement. Preserve configurations, hashes and raw runs externally.
4. Measure service execution, native approximate retrieval against exact references, increasing document counts, varied queries and concurrency. Preserve timeout/error results and resource observations.
5. Refine promising accuracy/execution combinations, rerun the same loop, compare improvements and regressions. Keep unsupported controls explicit.
6. Serve every runnable prototype through a visual comparison browser at `http://zerotwo:8225/`; keep saved feedback reports at port 8224.

## Parallel ownership

- `expanded_corpus`: external corpus, feature extraction and provenance; `corpus*.mjs`.
- `method_families`: method registry, query compilation and server scoring; `methods*.mjs`, `query*.mjs`.
- `prototype_browser`: visual UI and HTTP shell; `browser*`, `web/`.
- Root: integration, index lifecycle, feedback runs, workload/resource benchmarks, refinements and durable findings.

## Interpretation safeguards

The 37 logical judgments come from one observer, include related/reused images and a hurried batch, and are development evidence. They are not held-out or population-wide accuracy estimates. Do not fabricate relevance labels for the new wallpapers. Partial queries must distinguish area from color quality and must not treat unspecified remainder as mandatory zero. Full palettes may penalize unwanted colors; exact scoring of stored features does not establish perfect human perception. Native ANN remains approximate, and fixed-size reranking cannot guarantee global ranking.

## Environment

Existing isolated OpenSearch 2.11.0 at `127.0.0.1:19216`, single node, 2 GiB Java heap / 4 GiB container limit. Machine: 32 logical CPUs, 28 GiB RAM, approximately 411 GiB free disk at start. Preserve old indexes and all unrelated application stacks. New index prefix: `color-exploration-`.

## Final checkpoint — 2026-09-20

The authorized exploration is complete. **45 implementations (44 OpenSearch and one ClickHouse)** are available in the visual browser and have valid feedback-loop runs. Another 36 parameter-sweep configurations are reported separately. Every implementation includes all 545 assets: 523 real wallpapers, including the original 100 and every one of the 418 archive images, plus 22 controlled fixtures. All images and large generated artifacts remain in the external shared store. No production search method has been selected and no commit was made.

### Results to retain

- Native named-color utility ranking passed 300 scheduled requests/second at one million documents, p95 81.80 ms; 500/second failed. Named intent with exact global bounds passed 50/second, p95 429.88 ms; 100/second failed. HSV cosine with k=500 passed 300/second, p95 28.79 ms, with weaker human agreement.
- The picked-color utility grid passed 50 scheduled requests/second, p95 181.93 ms, maximum 236.88 ms. At 100/second it failed 5,939 of 6,000 arrivals, including 2,126 client rejections. All 5,766 sustained requests passed; C16 p95 was 502.32 ms. Its idle million-document index is 3,147,507,350 bytes, with 18 segments and zero merges. Native named utilities occupy 13,105,519,265 bytes.
- Fine palette/histogram scans and broad flexible hybrid branches failed concurrent million-document requirements. Both ClickHouse thread settings passed serial precise-color queries and failed concurrent queries; reducing threads saved CPU without solving latency.
- Raw L2 did not improve HSV cosine on their common 20 judged cases: both scored 54%. On a separate common 17-case set, the named refinements scored approximately 73–75% versus HSV cosine's 58%. These are development preference-pair agreement numbers, not population accuracy.
- The grid scored 87.78% versus continuous palette precision's 79.44% on only three shared cases. It approximates the objective; mid-gray top-20 overlap was only 30%. Global native retrieval does not remove representation loss.
- All million-document indexes use deterministic mixtures of existing descriptors. They do not establish million-photo relevance, constant-time scaling, 100-million-document capacity, or arbitrary-range viability.

### Validation and saved evidence

- Final full prototype integration: **115 passed, zero skipped**; existing feedback loop: **45 passed**. Integration, loop, summary and browser-smoke logs are preserved under `exploration/validation/2026-09-20-final/` in the external store.
- Visual QA: **45 methods, 54 checks**, desktop/mobile and image loading verified. Final live receipt: `exploration/browser-qa/2026-09-20T03-30-14.904Z.json`. Browser, findings and report URLs returned HTTP 200 through `zerotwo` after scale shutdown. The findings generator reports 45 valid default methods, 36 sweep configurations, zero warnings. Local Markdown links and `git diff --check` passed; no unignored wallpaper images or archive files are present in the untracked changes.
- [Accuracy findings](ACCURACY-FINDINGS.md), [performance findings](PERFORMANCE-FINDINGS.md), [refinement decisions](DECISIONS.md), [grid results](PRECISION-GRID.md) and [arrival protocol](ARRIVAL-LOAD.md) summarize the evidence. Every failure and superseded run remains recorded.
- External root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`. Final grid feedback: `runs/2026-09-20T03-13-00.884Z-c2f20177`; grid scale: `exploration/precision-grid-scale/2026-09-20T03-18-52.319Z`; grid arrivals: `exploration/arrival-load/2026-09-20T03-25-57.457Z`. Across all arrival campaigns there are 127,200 scheduled requests in fourteen profiles.

### Operation and future work

The browser is **http://zerotwo:8225/**, consolidated findings are **http://zerotwo:8225/findings**, and individual feedback reports are **http://zerotwo:8224/**. Their user systemd units remain available. Real-corpus OpenSearch uses port 19216; ClickHouse uses port 19218. The separate scale node on port 19217 is now stopped to free memory, with all indexes preserved. Resume it with `make color-exploration-scale-up`; stop it again with `make color-exploration-scale-stop`. Run future heavy campaigns sequentially on this shared host.

No experiments or agent tasks remain pending. Future refinement should use the recorded failures and uncovered preferences; further independent human judgments would improve confidence. Broad custom ranges and joint composition purity still need a method that satisfies both accuracy and high concurrent throughput. This is an unresolved product-design result, not an unfinished promised prototype.

## Historical progress — checkpoint 03:20 UTC (superseded)

### Current state

- **45 implementations (44 OpenSearch + one ClickHouse)** have valid full-corpus feedback runs;36 sensitivity configurations are separate. Every method indexes all545 assets (523 real wallpapers,22 fixtures). All original100 and all418 archive photos are retained externally.
- Latest grid feedback: `2026-09-20T03-13-00.884Z-c2f20177`, same3 precision cases/17pairs,87.78% agreement vs79.44% continuous reference. Small p952.30ms. Real gridindexv2 containsall545; mean321 positiveutilities/doc,305mscreation,1.705MB.17-query grid/reference top20overlap81.47%, exact-cutoff85.88%; shared7swatches78.57%. Midgray overlap30% (top1unchanged,meanreferenceutilityloss.01185), maxscoreerror.422. Nativeindexed score parity1.18e-7. Approximationisexplicit.
- Final browser45methods/54checks passed; desktop/mobile QA andallimages pass. http://zerotwo:8225/ and `/findings`; reports8224. Findings45validmethods,zero warnings.
- **111 full prototype tests passed with all service flags,0skips, plus45 feedback-loop tests.** Subsequent focused adapter/summary checks passed16; newgridmethod+scaler suite10/10passed. Final fullsuite should run onceafterlastscaleraudit edits/loadfinish (expected115+tests). No scoring changes since frozen gridfeedback.
- Baseline, first refinement, rank-feature and final five-method million-document OS campaigns are complete. Native utility sustained89,213requests passed. OSarrival118,200requests/12profiles complete; nativeutility300rpspassed,p9582ms; featureintent50rpspassed,p95430ms; HSVk500300rpspassed,p9529ms. Higher testednative ratesfailed. Idle utilityindex13.11GB.
- Million ANNrecall216records/648trials complete; k500HSVrecoveredalltestedtop20sets, someRGBmissesremain. No global ANNguarantee.
- BothCHmillion campaignsfinished. C1p95332ms(8threads) and403ms(1thread); bothC16failed, all84unfilteredcallstimeout. One-thread69% lessserialCPU butno concurrentrescue. Default8threadsunchanged. See CLICKHOUSE.md.

### Active ownership and next actions

1. **OpenSearch scheduled-arrival campaign is complete.** Twelve60-second profiles,118,200 arrivals. Utilities passed100/300rps, failed500; native area and asymmetric quality passed50, failed200; bounded intent passed20/50, failed100; HSV k500 passed100/300 with no higher rate tested. Artifacts under `arrival-load/2026-09-20T02-38-31.904Z`, `02-41-54.257Z`, `02-46-44.724Z`, and `02-50-45.866Z` (full date prefix2026-09-20T). All search queues drained. Idle native utility storage is13,105,519,265bytes,45segments,zero merges; `rank-feature-scale/2026-09-20T01-58-20.990Z/idle-storage.json`. See [PERFORMANCE-FINDINGS.md](PERFORMANCE-FINDINGS.md).
2. **ClickHouse campaigns are complete and the heavy window is released.** `clickhouse-palette-precision` exactly matches the typed palette objective on all4,905 checked real scores/orders. Staged artifact `clickhouse-scale/2026-09-20T02-54-39.077Z`:1M C1 p95331.65ms passed, C4/C16failed. Runtime refinement `clickhouse-scale/2026-09-20T03-00-08.903Z`:one-thread C1 p95403.23ms,69% lower serialCPU, but C16still141/252errors. Every unfiltered C16request timed out in both settings. Default8threads unchanged. See [CLICKHOUSE.md](CLICKHOUSE.md). `method_families` now independently audits the newgrid code without service load.
3. **`prototype_browser` owns ClickHouse registry/adapter/summary/UI integration and feedback evaluation.** Add engine metadata, verify whole corpus, preserve service result order, correct report CPU/memory labels and timing compatibility. Feedback and44-method visual QA are complete. Ingest upcoming ClickHouse scale artifacts into findings with actual backend/resource metadata. Do not touch19217.
4. Root owns Make targets (four ClickHouse targets added), integration coordination, final benchmarking review, README/findings/checkpoints. OS scale driver excludes ClickHouse engine. Gridrealchecksandfeedback passed; rootauthorizedfinalmillioncampaign. Final integration waits for all45 methods.
5. **Final grid scale campaign is ACTIVE, owned exclusively by `expanded_corpus`.** Session3444; artifact `precision-grid-scale/2026-09-20T03-18-52.319Z/scale.json`; checkpoint `color-exploration-precision-grid-scale-v1.checkpoint.json` under external exploration store.1k/10k/100kstages passedC1/C4/C16;100kp95C16~30.69ms.1Mindexing underway~5kdocs/sec. Afterstrict1Mpass:60s C1/C4/C16, then scheduled100/300rps onall7swatches withstop-on-failure;captureidlefinalstorage/CPU/RSS. Nootherheavyqueries/indexing untilagentrelease.
   - Independentmethod_families auditfixed staleencoderreuse(realindexv2/computationhash), failed-querydrainbeforestageadvance, andshrinkingbatchduringpartialbulkresume.10offlinegridtests pass. Realutilityscorerusesactualrounded32palette, notblendedsourceutilities. Source/generator/seed/encoder/mapping fingerprints bindscaleidentity.
   - Browserintegration/evaluation complete andfilesreleased. Agentmethod_families auditcomplete/idle. Rootownsfinaldocs/consolidation. **No moremethods planned.**
6. Finish new-method loop/tests/visual checks, refresh findings and documentation, leave visual services running, and report measured tradeoffs without selecting a production winner or claiming100M capacity.

The proposed palette quality-mass bound was rejected before implementation because dark/neutral selectivity was weak and native clause cost high. See [PALETTE-MASS-BOUNDS.md](PALETTE-MASS-BOUNDS.md). Existing37 judgments remain single-observer development evidence; new archive wallpapers have no fabricated relevance labels. [ACCURACY-FINDINGS.md](ACCURACY-FINDINGS.md) compares identical supported case sets.

Older checkpoints below are history and superseded by this section.

### Completed

- Imported **545 unique assets: 105 prior wallpapers, all 418 ZIP wallpapers, and 22 fixtures**. No failures or duplicate assets. All 127 prior HSV descriptors remain bit-for-bit identical. Source images and generated artifacts are external; nothing has been committed.
- Registered and evaluated 35 implementations, spanning native cosine/L2/Hellinger vectors, exact vectors, perceptual histograms, palettes, transport, named-area features, native utility postings, relative highlights, and globally safe indexed bounds. Three typed-precision refinements are being integrated, bringing the expected total to 38. These are implementations/configurations across families, not 38 unrelated algorithms.
- Built real OpenSearch indexes containing every asset. Browser: http://zerotwo:8225/ . Consolidated findings: http://zerotwo:8225/findings . Saved feedback reports: http://zerotwo:8224/ . Both browser endpoints return HTTP 200 through the tailnet hostname.
- Ran the existing feedback loop without changing human judgments. Best broad development agreement so far is 75.48% across all 35 image cases; the remaining two records describe conceptual examples without image rankings. Different support coverage must remain visible.
- Completed 36 parameter sensitivity configurations, kept separate from default implementations. No held-out accuracy or population preference claim is justified by this small, related, single-observer dataset.
- Verified service score/order parity for typed histograms and precision refinements; independent numerical checks for palette membership, transport, rank utilities and relative highlights; and global bound proofs with unseeded-winner regression cases.
- Built separate **one-million-document feature and vector indexes** on OpenSearch 2.11.0 at port 19217, with eight CPU quota, 12 GiB container memory, and 4 GiB Java heap. These are deterministic mixtures of the 545 source descriptors, not one million independent real photos.

### Current work and exact resumption state

The original 16-method scale process is still running exhaustive profiles after completing the million-vector build. Its command session is 85995 and log is `/tmp/color-exploration-scale.log`. Artifact: `exploration/scale/2026-09-20T00-51-14.799Z/scale.json` under the shared store. **Do not overlap load or indexing jobs on port 19217.**

First million-document ANN profiles have p95 around 16–28 ms at concurrency 16, with no timed-request errors. These are short initial blocks, not sustained-load or recall guarantees. Some exhaustive methods already fail the one-second requirement. Finish the remaining profiles before drawing conclusions.

The current source of `scale.mjs` has evolved since that first process started: the process retains 16 queries and the earlier partition generator, while new profiles use 23 queries and `i % 100` partitions. Initial source snapshots were not captured. Do not pretend the first run has exact source replay provenance; later runs archive source snapshots. Do not compare different workloads silently.

Agent ownership:

- `method_families`: integrate typed picked-color precision, typed safe bounds, and a typed hybrid; run round 8 through the feedback loop. Then await a quiet window for million-document ANN recall checks.
- `expanded_corpus`: native rank-feature scale driver, sustained-load support and dashboard verification. Await a quiet window before indexing or loading port 19217.
- `prototype_browser`: UI controls, all-method visibility and visual walkthrough, including `/findings`.
- Root: finish baseline scale, then run refinement scale and sustained concurrency profiles sequentially; consolidate findings and final checks.

### Required before completion

1. Complete feedback evaluation for every newly registered implementation.
2. Measure refinements at one million documents, including typed histograms, native area methods, exact named bounds, direct palettes, precise-color bounds and relative-highlight hybrids. Preserve timeouts and unsupported cases.
3. Build and measure the native utility-postings index through one million documents.
4. Measure ANN recall against service-side exact references at one million documents; test wider retrieval separately.
5. Run sustained mixed-query profiles on promising methods with concurrency above the initial short blocks. Strict viability includes warmup failures and every request at or above one second.
6. Refresh the findings dashboard, record reproducible commands and resource limits, run focused tests and final browser checks. Keep services available to the user.

### Important findings and safeguards

- The original dynamic histogram scripts were far too expensive. Typed Painless preserved all measured scores/orders and reduced small-corpus p95 from roughly 480–540 ms to 7–8 ms; large-scale viability is still a separate question.
- A partial query must not charge unspecified colors as mandatory missing requested color. Refined objectives remove that penalty for free remainders while retaining unwanted-color penalties for closed palettes. Actual OpenSearch intent checks cover the user's grayscale/red and green-target examples.
- Quantized RGB cell centers can severely distort grayscale membership. Direct original palette centroids remove most observed loss, although palette compression itself remains lossy.
- Relative lightness distinguishes a dark scene with small visible highlights from absolute brightness alone. Most of the latest agreement gain comes from one such case; it is a useful diagnostic, not broad validation.
- Exact bounded methods use native indexes to remove only documents that cannot beat a measured threshold, followed by global OpenSearch scoring. ANN seed quality changes work, not the final answer, on a stable index. Production requires an explicit stable snapshot/index-generation strategy.
- Native ANN remains approximate. Increasing retrieval from 20 to 500 recovered exact small-corpus top results in the measured profiles but does not prove million-document recall.
- Images added from the archive remain unjudged; they enlarge the search corpus without inventing relevance labels.

### Durable artifacts

Shared root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/`.

- `expanded-corpus.json`, `features.jsonl`, `corpus-validation.json`; feature SHA-256 `4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078`.
- `refinement-features.jsonl`; SHA-256 `27dd963af85d3667711e9ca1fe3c26987261dc0b2c585ce0efc54827552d0638`.
- Immutable feedback runs in `runs/`; source snapshots in `exploration/source-snapshots/`; scale and recall evidence under `exploration/scale/` and `exploration/recall/`.
- Round 1: `2026-09-20T00-50-38.374Z-32d2dbb7`; round 2: `2026-09-20T01-00-54.214Z-9ee49dbd`; sensitivity sweep: `2026-09-20T01-03-08.336Z-08292a68`; valid direct-palette/rank-feature round: `2026-09-20T01-07-33.778Z-ba9d2951`; relative refinement: `2026-09-20T01-11-36.841Z-66d53e54`. Later runs are linked in consolidated findings.
- Historical integration attempts remain preserved and are marked invalid in the summary. No failed run is silently rewritten.
