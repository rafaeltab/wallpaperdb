# Evaluation loop: initial validation

Recorded **2026-09-20**. This validates the common feedback loop using existing formulas; it does not select methods or establish production capacity.

## Executed runs

Both runs used **37 logical cases** and **127 image assets: 105 source wallpapers plus 22 controlled fixtures**. Each existing HSV adapter supported 19 cases, reported 18 unsupported, and completed with zero search/setup failures. Each executed 95 measured searches, following the separate ranking checks and warmups. Unsupported cases remain in coverage denominators.

| Run | Execution | Saved report |
| --- | --- | --- |
| `2026-09-20T00-02-45.056Z-bbcaf7e0` | Local exhaustive references | [Local report](http://zerotwo:8224/2026-09-20T00-02-45.056Z-bbcaf7e0/report.html) |
| `2026-09-20T00-04-40.946Z-4f7c77ee` | Real OpenSearch **2.11.0**, exact `knn_score` | [OpenSearch report](http://zerotwo:8224/2026-09-20T00-04-40.946Z-4f7c77ee/report.html) |

Artifacts are under `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/`. Dataset/corpus fingerprints match between these runs. Their latency deltas are deliberately unavailable because local and OpenSearch execution classes differ. Raw run JSON remains unchanged when reports are regenerated.

Three fresh indexes were created on the existing isolated experiment endpoint `127.0.0.1:19216`, retained with the run evidence:

- `color-eval-hsv64-cosine-cfc0033e-2ca8-4739-a94d-f2f22599e97f`
- `color-eval-hsv64-l2-raw-dd492906-d959-47e0-be1e-50079bf4403f`
- `color-eval-hsv64-l2-unit-sum-4741e0bd-be08-49c0-bd8a-f8ab5d70ffdb`

No application index or older experiment index was changed. These controls preserve known weaknesses in amount/remainder interpretation and named-color matching; those limitations are visible in the reports.

## Correctness checks

- **44 focused tests pass** through `make color-eval-test`: source normalization/provenance, ties and uncertainty, missing coverage, adapter validation, error/deadline handling, parameter sweeps, concurrency phase ordering, run preservation, report comparisons and serving.
- New histogram extraction agrees exactly, bin by bin, with the archived production extraction for all **100 original same-hash wallpapers**. This checks the descriptor port against existing production evidence; it is not a new NATS pipeline run.
- For each of the three formulas, all **19 complete ranked orders** agree between local and real OpenSearch execution. Maximum score differences were approximately `2.80e-7`, `1.11e-7`, and `1.63e-7`, respectively. Finite-precision scores are preserved rather than rewritten to agree.
- Warmup and measured requests are separated. Concurrency tests verify all warmups finish before measurement, and timed accuracy chooses the earliest successful scheduled trial rather than whichever concurrent result finishes fastest.
- The report explicitly distinguishes the large-window ranking diagnostic from accuracy at the actual timed result limit.

The first timed top-20 results assess only roughly **4.2–6.8% of all recorded strict preference pairs**, depending on the control. This is incomplete judgment coverage, not a low relevance label for the other returned images. It demonstrates why coverage must accompany accuracy and why future result pools may need additional batch judgments. It does not justify selecting one of the controls.

## Viewer and operations

The report viewer runs as transient user service `wallpaperdb-color-eval.service`, executing `make color-eval-serve`, with restart-on-failure. It binds `0.0.0.0:8224`; localhost and the local tailnet hostname both returned HTTP 200. Like the annotation service, this transient unit needs relaunch after reboot.

```sh
systemctl --user status wallpaperdb-color-eval.service
systemctl --user restart wallpaperdb-color-eval.service
systemctl --user stop wallpaperdb-color-eval.service
```

Browser checks passed for desktop/mobile, separate accuracy tables, unsupported cases, uncertainty sensitivity and a judged-image comparison. The initial mobile overflow and raw JSON query labels were fixed, and reports regenerated without altering run JSON. Final document widths matched the 1440px desktop and 390px mobile viewports; tables scroll independently on mobile. Images load and there are no console/page errors. Browser verification artifacts live under `/tmp/color-eval-*-fixed-*.png`.

## Repository CI limitation

`make ci` was attempted. Type/helper/storage checks passed, and Turbo reported 60 successful tasks before `@wallpaperdb/user:test:integration` failed with an unhandled PostgreSQL `57P01` error: `terminating connection due to administrator command`. Its 29 tests had passed, but the unhandled error makes the CI run unsuccessful. The new loop does not modify the user service or PostgreSQL handling. This unrelated failure was not silently waived or repaired as part of color evaluation.

The run generated a new `.tanstack/tmp` artifact under `apps/web`; only that generated artifact was removed. Original workspace modifications were preserved. No production code changes or commits were made.

## Scope of the result

The feedback loop is usable for adding candidates, combinations and parameter sweeps, preserving runs and inspecting regressions. Initial metrics are explicit development policies, not population-level perceptual accuracy. Automated population labeling, production-scale workloads, resource collectors, arbitrary-method retrieval proofs and an automatic method-generating optimizer remain extensions of this loop; they are not claimed by these small integration runs.
