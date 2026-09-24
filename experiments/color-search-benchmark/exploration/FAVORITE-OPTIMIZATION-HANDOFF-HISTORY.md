# Archived optimization handoff

The following is the exact pre-cleanup handoff captured on 2026-09-23. It contains
historical, superseded directions and is retained only for provenance. Use
[FAVORITE-OPTIMIZATION-CURRENT.md](FAVORITE-OPTIMIZATION-CURRENT.md) for active work.

---

# Current optimization work

Updated: 2026-09-23T19:10:41.261195+00:00

**The requested work is still in progress.** Continue through the full-million concurrency and changing-query tests. Do not call the campaign complete while indexing is running. The user authorized long work, many prototypes and subagents.

## Resume here: active capacity campaign

The index is complete and verified. The pooled transport fix passed2,504exact service comparisons and unchanged human feedback. The19-method UI is live and browser QA is closed. **The full capacity rerun is now active:** `wallpaperdb-favorite-opt-full1m-pooled-v1.service`, started18:47:29UTC. Read `full-million-pooled-pipeline-v1/status.json` under the externalroot below. Do not start another run or alter its44pinned runtimefiles. Source/config pinmanifest is `full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json` (SHA`d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f`).

Eight serial phases: full1Mclosedloop+audit, fixedarrivals+audit, variedarrivals+audit, widearrivals+audit. Root's silentwaiter session65011 reportsphasecompletion andexitsafterpipeline. Toplog `/tmp/favorite-opt-full1m-pooled-v1.log`; individualphaselogs inpipelinefolder. Light progress reads of the smallphase log are okay; avoidlargeartifactaudits or newservice/browser traffic whiletiming. Allcompletedprofiles observedsofarpassed; these preliminaryprofilesarenotafinishedcapacityclaim.

Latestpublicsummary is correctedv10 (publicationcheckpointmustbeabasename), at8228/performance.html. It includescompleted1Mindex56.049GB andall7,491errorsfromthepreservedfailed firstattempt. Seeappendsectionsforfullproofs,QAandtheknown2.32sfile-audit overlapnearstart. Laterhistoricalsectionsbelowdescribeolderstoppedattemptsandarepreservedascontext.

Afterpipeline: independentlysummarizeresources andwarmupscoreparity, assessfullbankcoverage/strictfailures, considerfurtherexactbounds ifneeded, finishreport/publicsnapshot, stopONLYscale19217andobserver, keeplab8228/old8225+8227/real19216alive. Tasknotcompleteyet. New `favorite-cardinality-bounds.mjs/.test.mjs` isunimported/unrun futurework, notpartofcurrenttests.

## Preserved behavior

The saved favorite is `strict-hue-favorite-001`: 256 bins, all cutoffs with shade-aware strict hue, cutoff exponent 1, linear quality influence 0.5. Original snapshot, extraction and query sources remain unchanged. All optimized filtering and final ranking happen in OpenSearch. The client only compiles queries and, for bounded variants, derives safe thresholds from server scores.

Real corpus: 545 indexed assets, of which 523 are wallpapers; 22 fixtures are excluded from the visual comparison. The million-record corpus consists of deterministic mixtures of these real measurements, not a million independent photographs.

## Full index complete; pooled capacity retry RUNNING

External root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23`.

The build pipeline `full-million-build-v1` completed both phases with exit 0 at **17:58:20 UTC**. Receipt: `points-full-1m-v1/index.json`; numeric audit: `points-full-1m-v1-audit/audit.json`.

- Index `color-exploration-favorite-points-full-1m-v1` on port 19217, UUID `LHjoEvSiR8KNe5WZv_a7iA`.
- Exactly 1,000,000 records, all 6,138 utility fields for the favorite preset, numeric float points/doc values, source disabled.
- Primary store **56,048,738,808 bytes**, 66 segments, zero active merges and zero translog operations at final capture.
- Indexing 7,170.076 seconds; total including finalization 7,336.453 seconds. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- Sample audit checked all 6,138 values on ordinals 0 / 499,999 / 999,999: all **18,414** values matched the original encoder. This is a sample audit, not every stored document.
- Query performance is now being measured; the completed index is not yet a capacity claim.

The automatic capacity gate started the four-method screen at **17:58:46 UTC**, then **stopped at 18:01:17 UTC** after a transport failure. It will not run arrivals automatically now. Unit: `wallpaperdb-favorite-opt-auto-capacity-v2.service`. State: `automatic-capacity-continuation-v2/status.json`; top-level log `/tmp/favorite-opt-auto-capacity-v2.log`. Screen pipeline: `full-million-comparison-v2-auto-pipeline-v2/`, log `full-1m-four-methods.log`. Do not launch another campaign. The stopped gate and archived sources remain immutable. Root authorized only new diagnostic files/Make targets; original scorer/API sources remain unchanged. A retry needs a newly reviewed plan and fresh output names.

Sixteen inactive scale indexes remain closed to release readers/mappings; nothing was deleted. Inventory/receipt: `pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`. Do not reopen them while timing. Real port 19216 and the old comparison pages remain available. This is a separate environment cohort from earlier screens.

The old count-printing monitor was stopped at the user's suggestion. A silent completion waiter exited successfully after the complete build and audit. Use phase-completion waits and meaningful result updates; avoid repeating record counts.

## Interrupted capacity campaign

Use **`full-million-comparison-v2-proposal/screen-plan.json`**, not the older three-method plan. It compares these four methods on the same full-million index:

1. Numeric utilities with ID doc-value fetching.
2. Direct numeric sort with ID doc-value fetching.
3. Original exact global bound.
4. Stronger bound using global per-field maxima.

Configuration: `full-million-comparison-v2-proposal/favorite-full-million-four-methods.json`. Output: `full-million-four-methods-v2/`. Dry run passed: up to 144 profiles, concurrency 1/4/16, unfiltered and synthetic 10%/1% metadata filters.

The build/audit prerequisites passed and automated UI/correctness traffic is stopped. The gate independently audits raw screen evidence, then runs fixed, varied and wide arrivals adaptively. The wide workload has 8,184 queries covering 6,138 utilities; 16 requests/second for 600 seconds can exercise a complete cycle, provided it actually completes successfully. Record measured coverage, errors and every request at or above one second.

## Automatic continuation stopped after first stage

Root reviewed and launched `wallpaperdb-favorite-opt-auto-capacity-v2.service` at 16:42 UTC. Its state is `automatic-capacity-continuation-v2/status.json` under the external root; top-level log `/tmp/favorite-opt-auto-capacity-v2.log`.

It verified the completed build and numeric audit, but the four-method screen aborted; the following stages are planned but did not run: independently audits it, runs fixed and varied arrivals (8/32/64/128 requests/s, 30 seconds each), and runs the broad 8,184-query cycle (16 requests/s for 600 seconds per eligible candidate), auditing every stage. All stages are serialized; failed performance evidence remains visible and higher-rate skipping follows the existing harness. The six-hour deadline includes waiting.

Reviewed plan: `automatic-capacity-continuation-v1-proposal/continuation-plan-v2.json`, SHA `3c0f2808d09d2547fd62eec41fd50ead97f6f24ccfe5d94d576a020293b90b2f`. All 54 pins, including Makefile and recursive harness sources, must remain unchanged. Do not start a duplicate manual capacity campaign. Version 1 of this gate was rejected for incomplete process-group cleanup and never launched; version 2 passed 19 offline tests and independent review.

## Current failure investigation

The saved screen `full-million-four-methods-v2/` is incomplete and failed. Its independent raw audit `audit-independent-auto-v2.json` found internally consistent evidence, but **accepted:false** because the campaign stopped. Eleven complete profiles passed (all single-color); the next maxima C16 profile has 12,285 pending timed rows including **7,491 `fetch failed` errors**. Include those failures; the stale completed-profile summary's zero failures is not the campaign total.

The terminal exception was an `ECONNRESET` during the final resource sample. Per-trial catches saved only `fetch failed`, losing transport causes/stage evidence. Successful requests continued among errors. No arrivals ran. Root live checks found the same JVM/container running, green cluster, no OOM/restarts, no service error logs, no search queue/rejections and all PITs eventually closed. Saved resources also rule against onset memory pressure. Connection handling is under investigation, not a confirmed scorer failure.

- Root: live service ownership, reproduce and fix, retain old failed evidence.
- `optimization_completion`: new standalone transport diagnostic + Make target, preserves nested causes/stages, no retries; root launches live runs.
- `optimization_typed_verify`: saved resource/transport diagnosis and independent diagnostic review. No live traffic.
- `optimization_ui_finish`: update RESULTS/CAPACITY with completed build and failed/incomplete capacity attempt.

Do not restart or reindex OpenSearch. The controlled pooled transport A/B now passed; repeat capacity after actual pooled fidelity and feedback validation. The one-million data and verified receipt remain intact. Full ingestion file audit `full-million-ingestion-complete-audit-v2.json` passed all 47,620 batch/ID/digest/source bindings. Final indexing resource audit `resources-indexing-completed-independent-audit-v1.json` passed (mean 2.347 cores; sampled charge peak 12GiB; no OOM). These are build evidence, separate from failed query capacity.

## Completed evidence

All four recent screening runs passed independent audits with no strict failures. These are serial, repeated-query measurements:

| Scope / method | One color p95 | Two colors p95 | Five colors p95 |
| --- | ---: | ---: | ---: |
| 1M narrow projection, numeric doc values | 29.03 ms | 60.99 ms | 115.03 ms |
| 1M narrow projection, direct sort | 1.88 ms | 61.10 ms | 115.13 ms |
| 1M narrow projection, exact bound | 4.91 ms | 9.26 ms | 67.47 ms |
| Full 100k, numeric doc values | 4.93 ms | 8.63 ms | 13.56 ms |
| Full 100k, direct sort | 1.39 ms | 7.95 ms | 13.91 ms |
| Full 100k, exact bound | 4.30 ms | 7.02 ms | 18.79 ms |

The finer rank18/rank27 representations were slower in the projection and gave no human-feedback advantage. Full-million precision indexing is deferred. Full 100k numeric index used about 13.045 GB. The completed full-million index uses 56.049 GB; full capacity qualification remains pending after the interrupted first attempt.

Fetch fidelity: 432 all-preset comparisons and 24 same-index A/B pairs passed. Original execution fidelity: all 1,878 executor comparisons passed, but separate duplicate-target arithmetic diagnostics failed in both the original favorite and numeric reference. Maxima fidelity: all 626 comparisons passed; the independent audit retained every winner and tie. All completed optimized feedback runs preserve the same 234 judged pair outcomes. These judgments come from one observer and include uncertainty.

## Current agents and UI work

- `optimization_ui_finish`: 17-method and performance-page QA passed; browser closed. Multiplicity suite passed 135 corrections plus 27 controls, 144 ordinary-query comparisons, and accuracy-only feedback.
- `optimization_typed_verify`: independent multiplicity audit passed; results page and prospective dispatch notes complete.
- `optimization_completion`: three-shard correctness and independent audit passed (1,920 executions, 342,940 scores, 188/186/171 documents across three primaries on one physical node). Available for full-million audits.

The multiplicity correction changes only repeated resolved utility weights. It does not add together requested percentages. Keep it separate from the saved favorite. Existing feedback has no duplicate-target cases. A future combined executor can use the corrected scalar path for duplicate utilities without assuming the old uniform bound applies.

The lab is at `http://zerotwo:8228/`; keep older 8225/8227 pages alive. Live `/performance.html` uses a fixed external `favorite-performance-public-summary.json`, now published from `results-checkpoint-20260923-v9.json` (17:26 UTC; 755,580 accepted at snapshot; completed evidence unchanged). Publication contract: preserve the generated summary and add `publication: {sourceCheckpoint, publishedAt, sourceSha256}`, then atomically replace the fixed file. Counts are a snapshot, not live. Refresh after meaningful new evidence.

## Final obligations

- Finish full-million concurrency and arrival tests; the build and stored-value audit are complete.
- Run the new methods through feedback and retain clear labels for corrections/approximations.
- Finish visual QA; keep prototypes accessible.
- Update results, capacity, accuracy and work-log documents with measured outcomes and limitations.
- Preserve failures and immutable raw artifacts outside Git. No wallpaper/archive files in the repo.
- Stop only scale port 19217 and its observer after the campaign finishes; keep real OpenSearch and comparison UIs available.
- Report actual results and remaining limits. Do not claim 100M or production capacity from this single-host synthetic test.

## File-only resource attribution helper

The external `resource-summary-v1-proposal/resource_summary.py` is ready for the completed full-million phases. Independent review passed; all 13 offline tests pass. Read its adjacent `README.md` for the complete invocation. From the external experiment root:

```sh
python3 resource-summary-v1-proposal/resource_summary.py \
  --observer resources-v3 \
  --build-status full-million-build-v1/status.json \
  --campaign full-million-four-methods-v2/benchmark.json \
  --campaign full-million-arrival-fixed-v2/arrival.json \
  --campaign full-million-arrival-varied-v2/arrival.json \
  --campaign full-million-arrival-wide-cycle-v2/arrival.json \
  --directory resources-full-million-completed-v1
```

Only include artifacts that exist; choose a fresh output directory. Run after or between timed campaigns, since reading and archiving their files also consumes host resources. The helper reads saved files only and makes no OpenSearch or live cgroup requests. It archives the exact observer prefix and source/input hashes. `resource-summary-readiness-v1.json` records the review; `resources-parser-validation-v2/` verifies the final parser against 12 saved full-100k profiles.

`resources-indexing-progress-v1/` remains an **incomplete indexing-only observation**, covering 15:55:52–16:56:06 UTC: mean 2.374 container CPU cores against an 8-core quota, sampled memory charge near 12.00 GiB, anonymous pages peaking at 4.61 GiB and file cache at 7.33 GiB, with no OOM-kill counter increment. These maxima need not coincide. They do not measure query cost or completed million-record capacity.

The helper separates cgroup anonymous memory/file cache/swap, JVM heap/process CPU, load-generator CPU/RSS, container entrypoint RSS and host pressure. JVM resident memory was not captured and remains unavailable. Layered IO device counters are not added together. Interrupted campaign intervals end at their recorded interruption time; failed samples and counter resets remain visible. Actual observer invocation was verified as `--max-seconds 43200` (12 hours from 13:27 UTC), not its shorter source default.

## Actual v2 continuation outputs

The approved v2 plan uses `full-million-four-methods-v2/benchmark.json`, then `full-million-arrival-fixed-v2/arrival.json`, `full-million-arrival-varied-v2/arrival.json`, and `full-million-arrival-wide-cycle-v2/arrival.json`. Each independent audit is named `audit-independent-auto-v2.json`. Earlier v1 paths are superseded. Read the pinned v2 plan when in doubt.


## Transport hypothesis and next step

The installed Node22.22.3 / bundled Undici6.24.1 HTTP/1 implementation marks body-bearing DELETE requests for socket reset. Every PIT cleanup sends DELETE with a JSON body, explaining the observed roughly one new HTTP connection per PIT. This is a confirmed client behavior, **not yet proof of the ECONNRESET cause**. Runtime/source evidence is saved in `failure-screen-v2-file-review-v1/runtime-transport-evidence.json`.

Completion is building `favorite-transport-diagnostic.mjs` with a Make target: compare original fetch with native pooled HTTP only for PIT DELETE, same body/deadline/scorer, no retries. Root will run baseline and pooled modes serially on the full index, with causes, stages, HTTP connection counters and host TCP state. Diagnostic sources may change during preparation; original scorer/API/index sources must remain intact.

A separate unimplemented improvement to benchmark error recording is in `failure-screen-v2-file-review-v1/failure-evidence-proposal.md`: preserve nested causes and executor evidence, and checkpoint finished trials before the final resource read. UI agent is fixing summary/page reporting of hash-bound raw audit pending failures, so the interrupted campaign cannot appear to have zero errors.


## Pooled transport A/B passed — integration underway

The baseline `transport-maxima-fetch-v1` reproduced the connection failure: 28,269 queries in 38.927 seconds, 46 failed queries / 52 failed HTTP requests, and 28,227 new HTTP connections. The first saved failure is a PIT-cleanup `ECONNRESET`; errors then appeared at other stages. A silent cooldown verified zero PIT contexts and only 13 host endpoint TIME_WAIT rows before the pooled run.

`transport-maxima-pooled-v1` completed 52,001 queries in 60.003 seconds, all 260,005 service requests successful, zero requests >=1 second, and only 32 new HTTP connections. Exact ordered ID/score hash matched the baseline (`d475baf86a0a6c42a781560547c6b2be74c462a6a023c18e6777332ee5e5c94d`). Every query used the original 1,500ms deadline, original scoring/PIT algorithm, and no retries. Only DELETE cleanup used a native keep-alive HTTP agent. The transport diagnostic is instrumented fixed-query evidence, **not full capacity qualification**.

Independent file-only audit `transport-ab-independent-audit-v1.json` passed trial/stage/counter/identity/ranking/cooldown reconciliation. Node22.22.3's Undici DELETE-body reset explains connection churn. The failure onset near the 28,232-port ephemeral range supports port-pressure inference, but the exact host/Docker allocation failure is not proven. Do not overstate that narrower mechanism.

Next work (root owns all live runs):

- Completion: new reusable pooled DELETE transport and separate bounded/maxima variants; original API/scorers remain untouched. Own actual-transport fidelity runner with native-DELETE witnesses and meaningful protocol/deadline/reuse tests.
- Typed: feedback adapter/config, arrival integration/auditor, and minimal benchmark failure-evidence fix. A failed final resource read must retain completed trials and remain unqualified. Prepare a new serial plan using the existing pipeline (index is complete; no waiting gate needed).
- UI: raw-audit pending failures in dashboard, completed-build/failed-screen reports, and options18/19 after fidelity passes. No live UI traffic during performance.
- Retry all required full-million concurrency/arrivals only after new fidelity/feedback passes, using fresh artifacts and the existing verified index. Preserve the first failed run. Freeze new sources for measurements.


## Pooled integration readiness

Separate variants are `favorite-utility-bounded-pooled-delete` and `favorite-utility-maxima-bounded-pooled-delete`. Root repeated14 offline tests (6transport/executor,4fidelity-runner,4adapter), all passed. Original scorer/API sources remain untouched. Completion owns the actual native-transport fidelity suite:2,504executions over545assets on the existing one-primary and three-primary indexes, exact IDs/scores and actual DELETE witnesses. Root launches after review.

UI/report updates passed16results,11performance-page and19labtests. New options18/19 remain inactive until root restarts after fidelity. Dashboard includes all7,491failures from the interrupted raw stream and binds that stream by SHA; it must be regenerated/published with all six earlier external feedback inputs, not the agent's partial validation summary. Typed owns updated failure recording/arrival integration and a fresh serial retry plan. All live traffic remains root-owned and serialized.

Pooled fidelity completed successfully: `pooled-fidelity-v1/fidelity.json`,2,504exact comparisons/acknowledged pooled cleanups,2,503socket reuses. Completion independently auditing traces. Feedback is running via the required exploration wrapper:

```sh
COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216 make color-exploration-evaluate COLOR_EXP_ARGS='--config experiments/color-search-benchmark/exploration/configs/favorite-pooled-feedback.json'
```

Root first invoked generic `color-eval-run` incorrectly; it resolves adapter paths relative to `configs/` and cannot load these exploration adapters. The resulting run `2026-09-23T18-35-44.336Z-e30f5f5b` remains preserved with148setup errors and zero service calls. It also lacks the exploration wrapper's extra pagoda case. This is a command/setup failure, not scoring or capacity evidence; do not silently include it in a same-dataset accuracy comparison.

## Pooled feedback and public v10

Correct exploration feedback `2026-09-23T18-36-10.447Z-84f622c2` passed for baseline, numeric-docvalues, pooledbounded and pooledmaxima: each32supported/6unsupported/0errors,234assessed pair outcomes unchanged at69.4792%,96timed requests each and zero timed failures. This remains single-observer development regression evidence.

Root published `results-checkpoint-20260923-v10.json` at18:37:56UTC (SHA`fa6c46e0cbbb9d7e1815dd9bd5fb9496582dc212099a8213d36eb4e7a0ea7256`) to the fixed public summary. It includes9performance/8fidelity/8feedback/13index receipts,0warnings, completedfull1M56.049GB and all7,491errors from the interrupted screen. Previouspublicsnapshot preserved as `favorite-performance-public-summary-before-v10.json`. Lab restarted;19methods now active. UIagent owns coordinated browser QA; close browser before capacity. Completion independently audits pooled fidelity/feedback. Typed finishes source-frozen retryplan.

Publication correction: `publication.sourceCheckpoint` **must be a basename**, not an absolute path. The initial18:37v10 publication violated this and correctly yielded503; root corrected it at18:41:44UTC to `results-checkpoint-20260923-v10.json`. Invalidpublicpayload retained externally as `favorite-performance-public-summary-v10-invalid-publication.json`; generated v10/checksums remain unchanged. No reader code change. Futurepublicationmustusebasename.

Before capacity launch, typed is extending the same trial-retention fix to the arrival harness: completed rate trials must survive a failed final resource read and incomplete resources must never qualify. Current44-pinmanifest is superseded until that reviewed patch and regenerated manifest finish. No capacity run has launched.

UI19 QA passed and browserclosed beforecapacity.10pooled-parent top20 comparisons matched across red/two/five/grayscale+red and alternatecontrols;523real images/19methods, native cleanup+reuse witnesses verified. Mobile390px detail loaded/no overflow; old8227 cutoffmodal combined/90%layer/saturationtab works. Correctedperformancepage200 and all7,491errors visible even when filtered to the unfinished maximaC16 profile (zero completed rows). Evidence `ui-19-complete/`. Agent nowfile-onlydocs.

## Active full-million pooled retry — started18:47UTC

**DO NOT LAUNCH A DUPLICATE.** Unit `wallpaperdb-favorite-opt-full1m-pooled-v1.service`; top log `/tmp/favorite-opt-full1m-pooled-v1.log`; state `full-million-pooled-pipeline-v1/status.json`. Existing pipeline executes8phases serially: screen+audit, fixedarrivals+audit, variedarrivals+audit, widearrivals+audit. Plan `full-million-pooled-retry-v1-proposal/retry-plan.json`. Six-hour systemd deadline; cgroupcleanup. Correct NodePATH explicitlyset.

Root validated44pins in `source-config-plan-pins-v2.json`, manifestSHA`d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f`. V1pins superseded; runtimegraphfrozen. Both benchmark and arrival trial-retention fixes independentlyreviewed. No indexing or browsertraffic; agentsarefile-onlyandmustavoidbigfileauditsduringtiming. Rootownsallliveoperations.

Prerequisitesallpassed: independentpooledfidelity2,504executions/333,544scores/13,256HTTPstages,2,504nativecleanups/2,503reuses; one+threeprimaries,unchangedgenerations/34sources. Independentfeedback234pairoutcomesunchanged,32supported/6unsupported×4methods,0errors/384timedfailures0. Bothpooledaccuracy paths32nativecleanupswitnessedeach; timedrowsomitstageevidencebutfrozenadapterbindssamepath. Evidence `pooled-fidelity-v1/audit-independent-v1.json`, `pooled-feedback-independent-audit-v1.json`, `pooled-feedback-execution-path-audit-v1.json`. UI19browserclosed.

Outputs: `full-million-four-methods-pooled-v1/benchmark.json`, `full-million-pooled-arrival-{fixed,varied,wide}-v1/arrival.json`. Fullscreenup144profiles(C1/4/16,all/10%/1%filters). Fixed+varied8/32/64/128rps×30s. Wide16rps×600sperqualifiedmethod,8,184querycycle/6,138utilities; establishactualsuccessfulcoverage,notplannedcoverage. Noqualifiedcandidate isvalidfailureoutcome. Anyerror/request>=1s failsload,warmupsincluded.

Use silent completion/phasewait, not repeating recordcountpolls. Pipeline started onlyafterallcorrectnessfeedback/browser checks. Aftercomplete: independentlysummarizeresources/rawparity,refinefromactualresults ifneeded,publishfreshcheckpoint,updatereports,stopONLYscale19217andobserverwhilekeepingreal19216andUI8225/8227/8228alive.

Knownearlyoverlap: completionagent'salready-startedfile-onlyproofreplay ran18:47:38.419–18:47:40.739UTC(2.32s),aftercapacitylaunch. No servicecalls/runtimechanges. Recorded `full-million-pooled-pipeline-v1/known-overlap.json`; identifyaffectedprofilefromtimestampsandretainthiscaveat. V2proofreports passedidentically; nofurtheragent scansduringtiming.

Duringcapacity, completion prepared text-only follow-up design `FAVORITE-POST-CAPACITY-OPTIONS.md` and NEWunimported `favorite-cardinality-bounds.mjs/.test.mjs`: necessary k-of-n range filters with outward Float32 certificates. Six tests written but **not run**; noexecutor/network/Makeintegration. This is unvalidatedfuturework,notavailableUIorcapacitycandidate. Considerafteractualcomplex-queryresults. Frozenruntimegraphunchanged.


---

## Handoff before arrival-milestone consolidation

Captured during the wide stage on 2026-09-23. Superseded instructions remain
historical; follow CURRENT for active work. Exact prior text follows.

# Current optimization handoff

State as of **2026-09-23 19:10 UTC**; reorganized without new measurements.
**Work is still in progress.** The user authorized sustained work and subagents.

## Resume here: active capacity campaign

The full-million index is complete. Pooled transport fidelity, feedback and the
19-method browser checks passed. The capacity retry is **running**; do not launch
another run, query its services, open a browser, or scan large artifacts while it
is timing. Root owns live operations. Small phase-log reads are sufficient.

| Active item | Identifier |
| --- | --- |
| Service; start | `wallpaperdb-favorite-opt-full1m-pooled-v1.service`; 18:47:29 UTC |
| State | `full-million-pooled-pipeline-v1/status.json` |
| Top log | `/tmp/favorite-opt-full1m-pooled-v1.log` |
| Plan | `full-million-pooled-retry-v1-proposal/retry-plan.json` |
| Frozen source/config pins | `full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json` |
| Pin manifest SHA-256 | `d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f` |
| Silent phase/completion waiter | Root session `65011` |

All **44 runtime pins are frozen**; v1 pins are superseded. Both trial-retention
fixes were independently reviewed: finished trials survive a failed final
resource read, but incomplete resources never qualify. The service has a six-hour
deadline, process-group cleanup and an explicit Node PATH.

Eight serial phases: closed-loop screen + audit, fixed arrivals + audit, varied
arrivals + audit, wide arrivals + audit. Outputs are
`full-million-four-methods-pooled-v1/benchmark.json` and
`full-million-pooled-arrival-{fixed,varied,wide}-v1/arrival.json`.

- Four methods on the same index: numeric lean fetch, direct-sort lean fetch,
  pooled global bounds, and pooled global-maxima bounds.
- Screen: up to 144 profiles; four query shapes; all/10%/1% metadata eligibility;
  concurrency 1/4/16. Fixed and varied arrivals: 8/32/64/128 requests/s, 30 s each.
- Wide: 16 requests/s for 600 s per eligible method; 8,184 queries spanning 6,138
  utilities. Prove actual **successful** coverage, not planned coverage.
- Any error or request **>=1,000 ms**, including warmups, fails that load. No
  qualifying candidate is a valid outcome. Early passing profiles are not a
  completed capacity result.
- Known overlap: an already-started file-only proof replay ran
  **18:47:38.419–18:47:40.739 UTC (2.32 s)** after launch. No service calls or runtime
  changes occurred. Bind the affected profile by timestamps and retain this
  caveat: `full-million-pooled-pipeline-v1/known-overlap.json`.

## Paths, behavior and environment

External artifact root (all relative artifact paths below use this directory):
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`.

Saved favorite `strict-hue-favorite-001`: 256 bins, all shade-aware/strict-hue
cutoffs, cutoff exponent 1, linear quality influence 0.5, minimum quality 0.
Original extraction/snapshot/query sources remain preserved. OpenSearch performs
all filtering and final ordering; the client compiles queries and safe bounds.

Correctness corpus: 545 assets = 523 wallpapers + 22 fixtures. Visual comparisons
exclude fixtures. Scale records are deterministic mixtures of the 523 real-image
measurements, not one million independent wallpapers. One physical scale node:
8 CPU quota, 4 GiB heap, 12 GiB memory limit, one primary, zero replicas.

Keep real OpenSearch **19216**, lab **8228**, and older pages **8225/8227** alive.
Scale OpenSearch is **19217**. Sixteen inactive scale indexes remain closed;
do not reopen them during timing. Receipts: `pre-full-1m-scale-index-inventory.json`
and `pre-full-1m-scale-index-close.json`.

## Completed index and correctness evidence

- Index `color-exploration-favorite-points-full-1m-v1`, UUID
  `LHjoEvSiR8KNe5WZv_a7iA`: exactly 1,000,000 records, all 6,138 favorite-preset
  float utilities, numeric points/doc values, source disabled.
- Final build: **56,048,738,808 primary-store bytes**, 66 segments, no active merges
  or translog operations at capture. Indexing 7,170.076 s; with finalization
  7,336.453 s. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- `full-million-build-v1/status.json` completed build and audit at 17:58:20 UTC.
  Receipt `points-full-1m-v1/index.json`; value audit `points-full-1m-v1-audit/audit.json`.
- `full-million-ingestion-complete-audit-v2.json` reconciles all creates, batches,
  IDs, digests and 29 source bindings. `full-million-bindings-independent-v1.json`
  independently replays 82 responses and **18,414 float values** on ordinals
  0/499,999/999,999. This is three complete document samples, not all stored values.
- Pooled fidelity: **2,504 executions / 333,544 scores / 13,256 HTTP stages**,
  2,504 acknowledged native cleanups, 2,503 connection reuses; exact IDs/scores on
  one- and three-primary real indexes, unchanged generations and 34 sources.
  Evidence: `pooled-fidelity-v1/fidelity.json`, its `audit-independent-v1.json`.
- Correct feedback run `2026-09-23T18-36-10.447Z-84f622c2`: four methods each have
  32 supported/6 unsupported cases, no errors, 234 unchanged judged pair outcomes
  (69.4792% agreement), 384 combined timed requests with zero failures. Audits:
  `pooled-feedback-independent-audit-v1.json`, `pooled-feedback-execution-path-audit-v1.json`.
  These are one observer's development judgments, not population accuracy.
- Earlier fetch fidelity (432 comparisons + 24 A/B pairs), execution fidelity
  (1,878), maxima fidelity (626) and three-shard fidelity (1,920 executions /
  342,940 scores) passed execution parity. Detailed results remain in the reports.
- **Separate semantic correction:** repeated resolved utility fields lost weight
  in the original and numeric scorers. Option 17 restores multiplicity without
  adding requested percentages. Its 135 corrections + 27 controls and 144 ordinary
  comparisons passed; human feedback has no duplicate cases. This correction is
  **not** silently included in the four capacity methods.

## Preserved failed attempt and transport repair

The first full-bank screen `full-million-four-methods-v2/` is **failed/incomplete**:
11 finished profiles had 85,293 timed requests and zero errors, while 12,285
unfinished timed rows include **7,491 errors**. Total: 97,578 timed requests,
7,491 strict failures, four error-free warmups. Its `audit-independent-auto-v2.json`
passes integrity but not completion/acceptance. No arrival stage ran.

The stopped service `wallpaperdb-favorite-opt-auto-capacity-v2.service` and state
`automatic-capacity-continuation-v2/status.json` are historical; their 54-pin plan
is superseded by the active 44-pin retry. Do not resume or overwrite that run.

The terminal resource read failed with `ECONNRESET`; old trial rows lost nested
causes. Node 22.22.3 / Undici 6.24.1 resets sockets after body-bearing DELETE,
causing roughly one new connection per PIT cleanup. Controlled A/B evidence:
`transport-maxima-fetch-v1` had 28,269 queries / 46 errors / 28,227 connections;
`transport-maxima-pooled-v1` had 52,001 queries over 60 s / zero errors or >=1 s /
32 connections, with identical ID/score hashes. Audit:
`transport-ab-independent-audit-v1.json`. Port pressure is supported; the exact
host/Docker allocation failure is not proven. This diagnostic is not capacity.

Incorrect generic feedback invocation `2026-09-23T18-35-44.336Z-e30f5f5b` is preserved
with 148 setup errors and zero service calls; exclude it from same-dataset accuracy
comparisons. Exploration adapters require `make color-exploration-evaluate`, with
`COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216` and the appropriate config.

## Live UI and publication contract

[Lab](http://zerotwo:8228/) has 19 active methods; options 18/19 change only pooled
cleanup transport. [Performance](http://zerotwo:8228/performance.html) reads the fixed
external `favorite-performance-public-summary.json`, not live service statistics.

Latest checkpoint: `results-checkpoint-20260923-v10.json`, SHA-256
`fa6c46e0cbbb9d7e1815dd9bd5fb9496582dc212099a8213d36eb4e7a0ea7256`;
9 performance / 8 fidelity / 8 feedback / 13 index receipts, zero warnings.
It includes the completed 56.049 GB build and all 7,491 historical errors.

Preserve generated summary bytes and add `publication: {sourceCheckpoint,
publishedAt, sourceSha256}`. **`sourceCheckpoint` must be a basename**, never an
absolute path. Hash exact checkpoint bytes and atomically replace only the public
snapshot. Initial v10 metadata yielded 503; corrected at 18:41:44 UTC without a
reader change. Prior/invalid snapshots are retained. Regeneration must retain all
six earlier outside-root feedback inputs plus in-root and pooled feedback.

`ui-19-complete/` records ten pooled/parent top-20 comparisons, fixture exclusion,
native cleanup/reuse, mobile details, the original cutoff modal, and all 7,491
errors visible even when filters leave no completed rows. Browser is **closed**.

## Resource analysis and remaining work

Completed indexing resources and independent replay:
`resources-indexing-completed-v1/`, `resources-indexing-completed-independent-audit-v1.json`.
Mean container CPU 2.347 cores; sampled charge peak 12 GiB; no OOM. Keep anonymous,
file-cache, swap, JVM heap and client memory distinct; layered I/O is not additive.
These indexing observations do not establish query resource cost.

After timing, use file-only `resource-summary-v1-proposal/resource_summary.py` and
its README with observer `resources-v3`, build status and **actual pooled campaign
paths** above, writing a new directory. It archives inputs/observer prefix; 13 tests
and independent review passed (`resource-summary-readiness-v1.json`). Missing/reset
counters remain unavailable. Observer duration is 43,200 s from 13:27 UTC (12 h).

1. Await all eight phases; independently audit resource scope, warmup score parity,
   source/index bindings, strict failures and actual successful full-bank coverage.
2. Assess per-shape/load results before choosing or refining a query path. Follow
   [reporting checklist](FAVORITE-FULL-MILLION-REPORTING.md); retain partial failures
   and the known 2.32 s overlap. Do not claim 100M, user counts or production capacity.
3. Future proposal only: [post-capacity options](FAVORITE-POST-CAPACITY-OPTIONS.md),
   `favorite-cardinality-bounds.mjs/.test.mjs`: six tests written **but not run**;
   no executor/network/Make integration, no runtime imports. Validate after current
   results if justified; do not present this as a measured or available method.
4. Update results/capacity/accuracy/worklog and publish a fresh immutable checkpoint.
   Keep originals and raw artifacts outside Git; never commit wallpapers/ZIP files.
5. After all scale work, stop **only 19217 and its observer**; preserve 19216 and
   comparison UIs. Report measured outcomes and limits. The task is not complete yet.

History: [prior handoff](FAVORITE-OPTIMIZATION-HANDOFF-HISTORY.md),
[long worklog](../GLOBAL-WORKLOG.md), [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity](FAVORITE-OPTIMIZATION-CAPACITY.md), [accuracy](FAVORITE-OPTIMIZATION-ACCURACY.md).

## Closed-loop milestone: 19:20:49 UTC

The full four-method screen and independent audit passed. All 144 profiles completed: 1,007,172 timed requests plus 48 warmups, zero errors, zero requests at or above one second, no pending rows. Maximum timed latency was 491.544 ms. Audit: `full-million-four-methods-pooled-v1/audit-independent-pooled-v1.json`, accepted/integrity/complete all true. Fixed arrivals started automatically at 19:20:49 UTC; subsequent varied/wide stages still pending. This is not yet sustained arrival qualification.

Unfiltered C1 p95 (single / green40 / two / five): numeric 33.015 / 30.603 / 64.411 / 118.264 ms; sorted 2.036 / 2.069 / 63.541 / 118.021 ms; bounded pooled 5.499 / 5.234 / 12.261 / 77.182 ms; maxima pooled 5.290 / 5.168 / 13.681 / 82.110 ms. Full tables can be reconstructed from the small pipeline phase log without reading the large benchmark during timing. UI agent owns report updates from only those small artifacts.

## Arrival limit observed (campaign still running)

Fixed workload: numeric doc-values passed 8/32/64 requests per second. At 128 requests per second, its 3,840 scheduled trials had 3,723 strict failures, with p95 about 1,502 ms and maximum 1,511 ms. This is a failed load level, not a failed experiment recorder; the campaign is continuing to the remaining methods as designed. Preserve all failures. No sustained-rate recommendation until the remaining fixed/varied/wide evidence is complete.

## Fixed arrivals completed and audited: 19:29:31 UTC

All 16 rate profiles were recorded and independently audited; evidence integrity/completeness passed. Performance did **not** pass every rate. Numeric and sorted variants passed through64 requests/s, then failed128 (3,723 and939 strict failures respectively). Pooled ordinary bound passed all rates through128 requests/s: p95 79.812 ms, max176.921 ms, zero failures at128. Pooled maxima failed128 with2,371 strict failures and end-to-end max11,141.870 ms (scheduler delay included). Preserve the overloaded rates; they are not viable loads.

The pipeline advanced automatically to varied arrivals at19:29:31. Audit `full-million-pooled-arrival-fixed-v1/audit-independent-v1.json`. Broader query-bank tests and resources are still pending. Ordinary bound currently has the strongest sustained-load result, but final selection must consider changing queries.

## Varied arrivals audited; broad-bank phase active

Varied arrivals and independent audit completed at19:38:07UTC. All four methods passed through128 requests/s. At128, p95 was77.049 ms numeric,69.676 ms sorted,13.720 ms ordinary bound,65.475 ms maxima bound. The75-query cycle has65single-target,9two-target and1five-target query, whereas fixed has2single/1two/1five; do not attribute their differences solely to cache behavior.

The pipeline is now running `wide-arrival`:16requests/s×600seconds per candidate, with64sampled warmups and8,184different queries covering6,138utilities. This takes about40minutes for all four methods. Whole-bank success must be verified from actual records. Root is preparing an optional existing-runner follow-up for ordinary bound only: wide64/128requests/s×180seconds (each rate can complete a full cycle), to test broad-query capacity if wide16passes. No follow-up launched.


---

## Handoff before completed-wide and stress-launch update

Captured on 2026-09-23 after the eight-phase campaign completed. Superseded
directions remain historical. Exact prior text follows.

# Current optimization handoff

State as of **2026-09-23, after three wide profiles**; the final maxima profile is running.
**Work is still in progress.** The user authorized sustained work and subagents.

## Resume here: active capacity campaign

The full-million index is complete. Pooled transport fidelity, feedback and the 19-method browser checks
passed. Closed-loop, fixed and varied stages are complete and audited; **wide arrivals are running**. Do
not launch another run, query its services, open a browser, or scan large artifacts while it is timing.
Root owns live operations. Small phase-log reads are sufficient.

| Active item | Identifier |
| --- | --- |
| Service; start | `wallpaperdb-favorite-opt-full1m-pooled-v1.service`; 18:47:29 UTC |
| State | `full-million-pooled-pipeline-v1/status.json` |
| Top log | `/tmp/favorite-opt-full1m-pooled-v1.log` |
| Plan | `full-million-pooled-retry-v1-proposal/retry-plan.json` |
| Frozen source/config pins | `full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json` |
| Pin manifest SHA-256 | `d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f` |
| Silent phase/completion waiter | Root session `65011` |

All **44 runtime pins are frozen**; v1 pins are superseded. Both trial-retention fixes were
independently reviewed: finished trials survive a failed final resource read, but incomplete resources
never qualify. The service has a six-hour deadline, process-group cleanup and an explicit Node PATH.

Eight serial phases: closed-loop screen + audit, fixed arrivals + audit, varied arrivals + audit, wide
arrivals + audit. Outputs are `full-million-four-methods-pooled-v1/benchmark.json` and
`full-million-pooled-arrival-{fixed,varied,wide}-v1/arrival.json`.

- Four methods on the same index: numeric lean fetch, direct-sort lean fetch,
  pooled global bounds, and pooled global-maxima bounds.
- Screen: all 144 profiles completed; four query shapes; all/10%/1% metadata eligibility;
  concurrency 1/4/16. Fixed and varied arrivals: 8/32/64/128 requests/s, 30 s each.
- Wide: 16 requests/s for 600 s per eligible method; 8,184 queries spanning 6,138
  utilities. Prove actual **successful** coverage, not planned coverage.
- Any error or request **>=1,000 ms**, including warmups, fails that load. No
  qualifying candidate is a valid outcome. Early passing profiles are not a
  completed whole-bank result.
- Known overlap: an already-started file-only proof replay ran
  **18:47:38.419–18:47:40.739 UTC (2.32 s)** after launch. No service calls or runtime
  changes occurred. Bind the affected profile by timestamps and retain this
  caveat: `full-million-pooled-pipeline-v1/known-overlap.json`.

## Completed timing milestones; wide still pending

- Closed-loop audit at 19:20:49 UTC: 144 profiles, 1,007,172 timed + 48 warmup
  requests, zero strict failures; maximum timed 491.544 ms.
- Fixed audit at 19:29:31 UTC: 16 profiles, all methods pass through 64/s.
  At 128/s, ordinary pooled bounds pass (p95 79.812 ms, max 176.921 ms);
  numeric/sorted/maxima fail with 3,723/939/2,371 strict failures. Maxima max
  11,141.870 ms includes scheduler delay. Preserve these failed load levels.
- Varied audit at 19:38:07 UTC: all four pass through 128/s. Its 75-query cycle
  has 65 singles / 9 pairs / 1 five-target query; fixed has 2 / 1 / 1 in four.
  Do not interpret their different outcomes as an isolated cache comparison.
- Wide numeric: 9,600 requests at 16/s, zero strict failures, p95 166.693 ms,
  max 496.421 ms. Sorted wide: 9,600 requests, **107 strict failures**, p95
  168.535 ms, max 5,797.602 ms. Cause unknown; repeated single-query results remain
  separate. Ordinary bounds also completed 9,600 with zero strict failures:
  p95 210.876 ms, max 463.575 ms. Maxima is active; final audit/key coverage remain pending.
- Root is preparing wide 64/128/s follow-up for **both numeric and ordinary bounds**
  after the audit, since numeric's wide p95 is lower. No cause is established.
  It has **not launched**. Do not duplicate the active campaign or follow-up plan.

## Paths, behavior and environment

External artifact root (all relative artifact paths below use this directory):
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`.

Saved favorite `strict-hue-favorite-001`: 256 bins, all shade-aware/strict-hue cutoffs, cutoff exponent
1, linear quality influence 0.5, minimum quality 0. Original extraction/snapshot/query sources remain
preserved. OpenSearch performs all filtering and final ordering; the client compiles queries and safe
bounds.

Correctness corpus: 545 assets = 523 wallpapers + 22 fixtures. Visual comparisons exclude fixtures.
Scale records are deterministic mixtures of the 523 real-image measurements, not one million independent
wallpapers. One physical scale node: 8 CPU quota, 4 GiB heap, 12 GiB memory limit, one primary, zero
replicas.

Keep real OpenSearch **19216**, lab **8228**, and older pages **8225/8227** alive. Scale OpenSearch is
**19217**. Sixteen inactive scale indexes remain closed; do not reopen them during timing. Receipts:
`pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`.

## Completed index and correctness evidence

- Index `color-exploration-favorite-points-full-1m-v1`, UUID
  `LHjoEvSiR8KNe5WZv_a7iA`: exactly 1,000,000 records, all 6,138 favorite-preset
  float utilities, numeric points/doc values, source disabled.
- Final build: **56,048,738,808 primary-store bytes**, 66 segments, no active merges
  or translog operations at capture. Indexing 7,170.076 s; with finalization
  7,336.453 s. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- `full-million-build-v1/status.json` completed build and audit at 17:58:20 UTC.
  Receipt `points-full-1m-v1/index.json`; value audit `points-full-1m-v1-audit/audit.json`.
- `full-million-ingestion-complete-audit-v2.json` reconciles all creates, batches,
  IDs, digests and 29 source bindings. `full-million-bindings-independent-v1.json`
  independently replays 82 responses and **18,414 float values** on ordinals
  0/499,999/999,999. This is three complete document samples, not all stored values.
- Pooled fidelity: **2,504 executions / 333,544 scores / 13,256 HTTP stages**,
  2,504 acknowledged native cleanups, 2,503 connection reuses; exact IDs/scores on
  one- and three-primary real indexes, unchanged generations and 34 sources.
  Evidence: `pooled-fidelity-v1/fidelity.json`, its `audit-independent-v2.json`.
- Correct feedback run `2026-09-23T18-36-10.447Z-84f622c2`: four methods each have
  32 supported/6 unsupported cases, no errors, 234 unchanged judged pair outcomes
  (69.4792% agreement), 384 combined timed requests with zero failures. Audits:
  `pooled-feedback-independent-audit-v1.json`, `pooled-feedback-execution-path-audit-v2.json`.
  These are one observer's development judgments, not population accuracy.
- Earlier fetch fidelity (432 comparisons + 24 A/B pairs), execution fidelity
  (1,878), maxima fidelity (626) and three-shard fidelity (1,920 executions /
  342,940 scores) passed execution parity. Detailed results remain in the reports.
- **Separate semantic correction:** repeated resolved utility fields lost weight
  in the original and numeric scorers. Option 17 restores multiplicity without
  adding requested percentages. Its 135 corrections + 27 controls and 144 ordinary
  comparisons passed; human feedback has no duplicate cases. This correction is
  **not** silently included in the four capacity methods.

## Preserved failed attempt and transport repair

The first full-bank screen `full-million-four-methods-v2/` is **failed/incomplete**: 11 finished
profiles had 85,293 timed requests and zero errors, while 12,285 unfinished timed rows include **7,491
errors**. Total: 97,578 timed requests, 7,491 strict failures, four error-free warmups. Its
`audit-independent-auto-v2.json` passes integrity but not completion/acceptance. No arrival stage ran.

The stopped service `wallpaperdb-favorite-opt-auto-capacity-v2.service` and state
`automatic-capacity-continuation-v2/status.json` are historical; their 54-pin plan is superseded by the
active 44-pin retry. Do not resume or overwrite that run.

The terminal resource read failed with `ECONNRESET`; old trial rows lost nested causes. Node 22.22.3 /
Undici 6.24.1 resets sockets after body-bearing DELETE, causing roughly one new connection per PIT
cleanup. Controlled A/B evidence: `transport-maxima-fetch-v1` had 28,269 queries / 46 errors / 28,227
connections; `transport-maxima-pooled-v1` had 52,001 queries over 60 s / zero errors or >=1 s / 32
connections, with identical ID/score hashes. Audit: `transport-ab-independent-audit-v1.json`. Port
pressure is supported; the exact host/Docker allocation failure is not proven. This diagnostic is not
capacity.

Incorrect generic feedback invocation `2026-09-23T18-35-44.336Z-e30f5f5b` is preserved with 148 setup
errors and zero service calls; exclude it from same-dataset accuracy comparisons. Exploration adapters
require `make color-exploration-evaluate`, with `COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216`
and the appropriate config.

## Live UI and publication contract

[Lab](http://zerotwo:8228/) has 19 active methods; options 18/19 change only pooled cleanup transport.
[Performance](http://zerotwo:8228/performance.html) reads the fixed external
`favorite-performance-public-summary.json`, not live service statistics.

Latest checkpoint: `results-checkpoint-20260923-v10.json`, SHA-256
`fa6c46e0cbbb9d7e1815dd9bd5fb9496582dc212099a8213d36eb4e7a0ea7256`; 9 performance / 8 fidelity / 8
feedback / 13 index receipts, zero warnings. It includes the completed 56.049 GB build and all 7,491
historical errors.

Preserve generated summary bytes and add `publication: {sourceCheckpoint, publishedAt, sourceSha256}`.
**`sourceCheckpoint` must be a basename**, never an absolute path. Hash exact checkpoint bytes and
atomically replace only the public snapshot. Initial v10 metadata yielded 503; corrected at 18:41:44 UTC
without a reader change. Prior/invalid snapshots are retained. Regeneration must retain all six earlier
outside-root feedback inputs plus in-root and pooled feedback.

`ui-19-complete/` records ten pooled/parent top-20 comparisons, fixture exclusion, native cleanup/reuse,
mobile details, the original cutoff modal, and all 7,491 errors visible even when filters leave no
completed rows. Browser is **closed**.

## Resource analysis and remaining work

Completed indexing resources and independent replay: `resources-indexing-completed-v1/`,
`resources-indexing-completed-independent-audit-v1.json`. Mean container CPU 2.347 cores; sampled charge
peak 12 GiB; no OOM. Keep anonymous, file-cache, swap, JVM heap and client memory distinct; layered I/O
is not additive. These indexing observations do not establish query resource cost.

After timing, use file-only `resource-summary-v1-proposal/resource_summary.py` and its README with
observer `resources-v3`, build status and **actual pooled campaign paths** above, writing a new
directory. It archives inputs/observer prefix; 13 tests and independent review passed
(`resource-summary-readiness-v1.json`). Missing/reset counters remain unavailable. Observer duration is
43,200 s from 13:27 UTC (12 h).

1. Finish wide timing and its audit; independently check resource scope, warmup score parity,
   source/index bindings, strict failures and actual successful full-bank coverage.
2. Assess per-shape/load results before choosing or refining a query path. Follow
   [reporting checklist](FAVORITE-FULL-MILLION-REPORTING.md); retain partial failures
   and the known 2.32 s overlap. Do not claim 100M, user counts or production capacity.
3. Future proposal only: [post-capacity options](FAVORITE-POST-CAPACITY-OPTIONS.md),
   `favorite-cardinality-bounds.mjs/.test.mjs`: nine tests written **but not run**;
   no executor/network/Make integration, no runtime imports. Validate after current
   results if justified; do not present this as a measured or available method.
4. Update results/capacity/accuracy/worklog and publish a fresh immutable checkpoint.
   Keep originals and raw artifacts outside Git; never commit wallpapers/ZIP files.
5. After all scale work, stop **only 19217 and its observer**; preserve 19216 and
   comparison UIs. Report measured outcomes and limits. The task is not complete yet.

History: [prior handoff](FAVORITE-OPTIMIZATION-HANDOFF-HISTORY.md), [long
worklog](../GLOBAL-WORKLOG.md), [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity](FAVORITE-OPTIMIZATION-CAPACITY.md), [accuracy](FAVORITE-OPTIMIZATION-ACCURACY.md).


---

## Handoff before final timing/publication completion

Captured on 2026-09-23. Prior active-state directions are historical.
Exact prior text follows.

# Current optimization handoff

Checkpoint **2026-09-23, after numeric wide64/128**: the original eight-phase campaign is
complete; the two-method higher-rate stress is running. **The task is not complete.**

## Resume here: active two-method wide stress

The full-million index, pooled fidelity/feedback, 19-method UI checks and original
closed-loop/fixed/varied/wide campaign are complete and audited. Root launched a
fresh **numeric-versus-ordinary-bound wide 64/128 requests/s** comparison. Do not
start another run, open a browser, query services or scan large artifacts while
it is timing. Root owns live operations; read only small phase logs for progress.

| Active item | Identifier |
| --- | --- |
| Service; start | `wallpaperdb-favorite-opt-wide-stress-v1.service`; 20:19:30.422 UTC |
| State | `full-million-pooled-wide-two-methods-stress-pipeline-v1/status.json` |
| Small phase log | `wide-two-methods-64-128.log` in that pipeline directory |
| New plan | `full-million-pooled-wide-two-methods-stress-v1-proposal/stress-plan.json` |
| New plan SHA-256 | `7266bfda14c4163d3d558426f41b107cffd9bb22522df1d923207433eb2c15f2` |
| Launch gate | `full-million-pooled-wide-two-methods-stress-v1-proposal/launch-gate-v1.json`; all 44 runtime pins verified |
| Silent phase/completion waiter | Root session `86886`; old `65011` completed |

The same proposal folder holds `proposal-manifest.json` and
`favorite-numeric-and-bounded-pooled.json`. Numeric wide64 completed 11,520 trials:
p95 154.361 ms, maximum 316.415 ms, zero strict failures. Numeric wide128 failed:
23,040 trials, p95 1,500.247 ms, maximum 1,773.903 ms, **9,465 strict failures**.
Ordinary-bound64 is active; its profiles and the independent stress audit are pending.

The original runtime graph remains frozen: `full-million-pooled-retry-v1-proposal/source-config-plan-pins-v2.json`,
SHA `d620d618f1f4ff9efba5188c79ce2a6c0a81ca9bea0c10c67fa290480fd7dc5f`.
No new scorer or index is involved. Numeric was chosen for the lowest wide16 p95;
ordinary bounds alone passed fixed128. This does not make maxima universally worse:
maxima's wide16 p95 and maximum were lower than ordinary bounds. Stress results
are pending; allow up to about 12 minutes for the planned stages.

## Completed campaign and retained failures

Original service `wallpaperdb-favorite-opt-full1m-pooled-v1.service` started at
18:47:29 UTC and completed all eight serial phases with the wide audit at
20:18:51 UTC. Preserve `full-million-pooled-pipeline-v1/status.json`,
`/tmp/favorite-opt-full1m-pooled-v1.log`, and plan
`full-million-pooled-retry-v1-proposal/retry-plan.json`. Do not resume that finished run.
Outputs: `full-million-four-methods-pooled-v1/benchmark.json` and
`full-million-pooled-arrival-{fixed,varied,wide}-v1/arrival.json`.

- Closed-loop: all 144 profiles passed (four methods × four shapes × all/10%/1%
  metadata eligibility × C1/4/16); 1,007,172 timed + 48 warmups; zero strict failures;
  maximum timed 491.544 ms. Audit completed 19:20:49 UTC.
- Fixed: all four passed through 64/s; at 128/s ordinary bounds passed (p95 79.812 ms,
  max 176.921 ms), while numeric/sorted/maxima had 3,723/939/2,371 strict failures.
  Maxima max 11,141.870 ms includes scheduler delay. Audit completed 19:29:31 UTC.
- Varied: all four passed through 128/s; audit completed 19:38:07 UTC. Its 75-query
  cycle has 65 single / 9 pair / 1 five-target, versus fixed 2/1/1 in four. Different
  mixes prevent interpreting the improvement as an isolated cache effect.
- Wide16: each method completed 9,600 trials over 600s. Numeric p95/max 166.693/496.421 ms;
  ordinary bounds 210.876/463.575 ms; maxima 204.753/364.696 ms. All three passed and
  successfully queried 8,184 distinct queries/all 6,138 keys; actual target counts
  were 6,889 single / 1,515 pair / 1,196 five-target requests each.
- Sorted wide16 failed: p95 168.535 ms/max 5,797.602 ms; 104 errors/107 strict failures;
  9,496 successful requests, 8,080 distinct successful queries, 6,088 keys. No full
  successful key coverage. Cause remains unestablished; repeated single-query
  performance stays a separate observation.
- Wide audit `full-million-pooled-arrival-wide-v1/audit-independent-v1.json` accepted
  complete evidence, one failed profile, no pending rows/incomplete resources.
  Result hash `78b30857b2b4a1c295a2ef9a4ddaf4a7fd9463ec7e96e8be73b6dace5946074b`.

Any error or request **>=1,000 ms**, warmups included, fails that load. Accepted
evidence is not a performance pass. Both trial-retention fixes preserve finished
trials on a failed final resource read, without qualifying incomplete resources.
The initial campaign's known file-only overlap at 18:47:38.419–18:47:40.739 UTC
(**2.32 s**) is retained in `full-million-pooled-pipeline-v1/known-overlap.json`;
attribute affected profiles after timing. No service calls/runtime changes occurred.

## Paths, behavior and environment

External artifact root (all relative artifact paths below use this directory):
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/`.

Saved favorite `strict-hue-favorite-001`: 256 bins, all shade-aware/strict-hue cutoffs, cutoff exponent
1, linear quality influence 0.5, minimum quality 0. Original extraction/snapshot/query sources remain
preserved. OpenSearch performs all filtering and final ordering; the client compiles queries and safe
bounds.

Correctness corpus: 545 assets = 523 wallpapers + 22 fixtures. Visual comparisons exclude fixtures.
Scale records are deterministic mixtures of the 523 real-image measurements, not one million independent
wallpapers. One physical scale node: 8 CPU quota, 4 GiB heap, 12 GiB memory limit, one primary, zero
replicas.

Keep real OpenSearch **19216**, lab **8228**, and older pages **8225/8227** alive. Scale OpenSearch is
**19217**. Sixteen inactive scale indexes remain closed; do not reopen them during timing. Receipts:
`pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`.

## Completed index and correctness evidence

- Index `color-exploration-favorite-points-full-1m-v1`, UUID
  `LHjoEvSiR8KNe5WZv_a7iA`: exactly 1,000,000 records, all 6,138 favorite-preset
  float utilities, numeric points/doc values, source disabled.
- Final build: **56,048,738,808 primary-store bytes**, 66 segments, no active merges
  or translog operations at capture. Indexing 7,170.076 s; with finalization
  7,336.453 s. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- `full-million-build-v1/status.json` completed build and audit at 17:58:20 UTC.
  Receipt `points-full-1m-v1/index.json`; value audit `points-full-1m-v1-audit/audit.json`.
- `full-million-ingestion-complete-audit-v2.json` reconciles all creates, batches,
  IDs, digests and 29 source bindings. `full-million-bindings-independent-v1.json`
  independently replays 82 responses and **18,414 float values** on ordinals
  0/499,999/999,999. This is three complete document samples, not all stored values.
- Pooled fidelity: **2,504 executions / 333,544 scores / 13,256 HTTP stages**,
  2,504 acknowledged native cleanups, 2,503 connection reuses; exact IDs/scores on
  one- and three-primary real indexes, unchanged generations and 34 sources.
  Evidence: `pooled-fidelity-v1/fidelity.json`, its `audit-independent-v2.json`.
- Correct feedback run `2026-09-23T18-36-10.447Z-84f622c2`: four methods each have
  32 supported/6 unsupported cases, no errors, 234 unchanged judged pair outcomes
  (69.4792% agreement), 384 combined timed requests with zero failures. Audits:
  `pooled-feedback-independent-audit-v1.json`, `pooled-feedback-execution-path-audit-v2.json`.
  These are one observer's development judgments, not population accuracy.
- Earlier fetch fidelity (432 comparisons + 24 A/B pairs), execution fidelity
  (1,878), maxima fidelity (626) and three-shard fidelity (1,920 executions /
  342,940 scores) passed execution parity. Detailed results remain in the reports.
- **Separate semantic correction:** repeated resolved utility fields lost weight
  in the original and numeric scorers. Option 17 restores multiplicity without
  adding requested percentages. Its 135 corrections + 27 controls and 144 ordinary
  comparisons passed; human feedback has no duplicate cases. This correction is
  **not** silently included in the four capacity methods.

## Preserved failed attempt and transport repair

The first full-bank screen `full-million-four-methods-v2/` is **failed/incomplete**: 11 finished
profiles had 85,293 timed requests and zero errors, while 12,285 unfinished timed rows include **7,491
errors**. Total: 97,578 timed requests, 7,491 strict failures, four error-free warmups. Its
`audit-independent-auto-v2.json` passes integrity but not completion/acceptance. No arrival stage ran.

The stopped service `wallpaperdb-favorite-opt-auto-capacity-v2.service` and state
`automatic-capacity-continuation-v2/status.json` are historical; their 54-pin plan is superseded by the
unchanged 44-pin runtime graph. Do not resume or overwrite that run.

The terminal resource read failed with `ECONNRESET`; old trial rows lost nested causes. Node 22.22.3 /
Undici 6.24.1 resets sockets after body-bearing DELETE, causing roughly one new connection per PIT
cleanup. Controlled A/B evidence: `transport-maxima-fetch-v1` had 28,269 queries / 46 errors / 28,227
connections; `transport-maxima-pooled-v1` had 52,001 queries over 60 s / zero errors or >=1 s / 32
connections, with identical ID/score hashes. Audit: `transport-ab-independent-audit-v1.json`. Port
pressure is supported; the exact host/Docker allocation failure is not proven. This diagnostic is not
capacity.

Incorrect generic feedback invocation `2026-09-23T18-35-44.336Z-e30f5f5b` is preserved with 148 setup
errors and zero service calls; exclude it from same-dataset accuracy comparisons. Exploration adapters
require `make color-exploration-evaluate`, with `COLOR_EXPLORATION_OPENSEARCH=http://127.0.0.1:19216`
and the appropriate config.

## Live UI and publication contract

[Lab](http://zerotwo:8228/) has 19 active methods; options 18/19 change only pooled cleanup transport.
[Performance](http://zerotwo:8228/performance.html) reads the fixed external
`favorite-performance-public-summary.json`, not live service statistics.

Latest checkpoint: `results-checkpoint-20260923-v10.json`, SHA-256
`fa6c46e0cbbb9d7e1815dd9bd5fb9496582dc212099a8213d36eb4e7a0ea7256`; 9 performance / 8 fidelity / 8
feedback / 13 index receipts, zero warnings. It includes the completed 56.049 GB build and all 7,491
historical errors.

Preserve generated summary bytes and add `publication: {sourceCheckpoint, publishedAt, sourceSha256}`.
**`sourceCheckpoint` must be a basename**, never an absolute path. Hash exact checkpoint bytes and
atomically replace only the public snapshot. Initial v10 metadata yielded 503; corrected at 18:41:44 UTC
without a reader change. Prior/invalid snapshots are retained. Regeneration must retain all six earlier
outside-root feedback inputs plus in-root and pooled feedback.

`ui-19-complete/` records ten pooled/parent top-20 comparisons, fixture exclusion, native cleanup/reuse,
mobile details, the original cutoff modal, and all 7,491 errors visible even when filters leave no
completed rows. Browser is **closed**.

## Resource analysis and remaining work

Completed indexing resources and independent replay: `resources-indexing-completed-v1/`,
`resources-indexing-completed-independent-audit-v1.json`. Mean container CPU 2.347 cores; sampled charge
peak 12 GiB; no OOM. Keep anonymous, file-cache, swap, JVM heap and client memory distinct; layered I/O
is not additive. These indexing observations do not establish query resource cost.

After timing, use file-only `resource-summary-v1-proposal/resource_summary.py` and its README with
observer `resources-v3`, build status and **actual pooled campaign paths** above, writing a new
directory. It archives inputs/observer prefix; 13 tests and independent review passed
(`resource-summary-readiness-v1.json`). Missing/reset counters remain unavailable. Observer duration is
43,200 s from 13:27 UTC (12 h).

1. Finish the two-method higher-rate wide stress and audit; then check resource scope, warmup score parity,
   source/index bindings, strict failures and actual successful full-bank coverage.
2. Assess per-shape/load results before choosing or refining a query path. Follow
   [reporting checklist](FAVORITE-FULL-MILLION-REPORTING.md); retain partial failures
   and the known 2.32 s overlap. Do not claim 100M, user counts or production capacity.
3. Future proposal only: [post-capacity options](FAVORITE-POST-CAPACITY-OPTIONS.md),
   `favorite-cardinality-bounds.mjs/.test.mjs`: nine tests written **but not run**;
   no executor/network/Make integration, no runtime imports. Validate after current
   results if justified; do not present this as a measured or available method.
4. Update results/capacity/accuracy/worklog and publish a fresh immutable checkpoint.
   Keep originals and raw artifacts outside Git; never commit wallpapers/ZIP files.
5. After all scale work, stop **only 19217 and its observer**; preserve 19216 and
   comparison UIs. Report measured outcomes and limits. The task is not complete yet.

History: [prior handoff](FAVORITE-OPTIMIZATION-HANDOFF-HISTORY.md), [long
worklog](../GLOBAL-WORKLOG.md), [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity](FAVORITE-OPTIMIZATION-CAPACITY.md), [accuracy](FAVORITE-OPTIMIZATION-ACCURACY.md).
