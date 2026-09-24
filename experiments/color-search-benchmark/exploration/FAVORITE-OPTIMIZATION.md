# Optimizing the preserved favorite

## Active campaign — September 23, 2026

The user authorized new optimization prototypes after the original favorite missed the one-second requirement at one million synthetic wallpapers. Preserve `strict-hue-favorite-001` and all original evidence. The user accepts 256 bins, discrete quality/cutoff-weight controls, and increased index storage. Preserve the scoring mechanism where possible; clearly label any altered formula or approximation.

### Initial candidates

| Candidate | What changes | Fidelity to verify |
| --- | --- | --- |
| Fused script | One OpenSearch scoring script combines the original coverage, quality and cutoff operations | Original formula and native float rounding |
| Numeric utilities | Precompute combined per-color utilities at selected controls and percentage targets | Same mathematical formula at supported presets; float association may differ |
| Rank8 utilities | Native OpenSearch feature postings hold 8-bit utility values | Explicit quantization |
| Rank16 utilities | Two feature limbs reconstruct 16-bit utilities | Smaller explicit quantization |
| Float feature utilities | Native floating feature values | OpenSearch feature precision |
| Typed fused script | Typed, unrolled specialization of the same operations | Native float parity |
| Rank18 / rank27 refinements | Two / three exact base512 feature digits | Smaller quantization plus native query arithmetic |

These utilities encode the endorsed shade-aware, strict-hue, five-cutoff scorer. They do not reuse the earlier named-color utility scorer that the user preferred less. All filtering and final global ranking remain in OpenSearch. No capped application-side reranking.

### Protocol and sequence

1. Implement separately versioned scorers and verify against the saved favorite on real OpenSearch.
2. Index the same 545 assets, including the existing 105 real wallpapers and all 418 archive wallpapers. Keep the 22 controlled fixtures out of the visual gallery. Images remain outside Git.
3. Run the existing human-feedback evaluation and report support, ranking fidelity and measurement limitations. Existing judgments are from one observer, with acknowledged uncertainty.
4. Screen performance at 100k and 1M synthetic records using the original coherent mixture generator and seed. Synthesize original measurements before calculating nonlinear utilities.
5. Refine promising candidates, then measure concurrency, metadata selectivity, resources, storage, and changing-query or arrival behavior. A workload projection is not a full-schema storage/capacity claim. Any request at or above one second or error fails that profile.
6. Provide a separate visual comparison while keeping the favorite inspector and prior comparisons available.

### Work ownership / continuation

- Root: indexing, registry, visual lab, service operations, benchmark orchestration, feedback runs, reports.
- `favorite_fused`: new fused scorer and equivalence tests only.
- `favorite_utilities`: new precomputed-utility scorer, mapping and document functions only.
- `favorite_perf_schema`: new benchmark driver, tests and audit helpers only.

Root serializes all indexing and benchmark traffic on the shared host. No old favorite extraction/scoring source, manifest or benchmark artifact is overwritten. Real OpenSearch 19216 and UI 8225/8226/8227 remain live. Scale OpenSearch 19217 starts only for this campaign and retains prior indexes.

## Checkpoint — 01:05 UTC

Initial modules and focused tests are being implemented in parallel. Make targets are available. No new indexes or performance results yet. The first real-service operation will be a read-only all-document equivalence check for the fused scorer. Next: index runner, real-corpus utility index, integration and performance screening. No production choice has been made.

## Checkpoint — 01:22 UTC

Five prototypes implemented with focused tests. Fused scorer exactly matches all545 native IDs/scores across10 query/settings combinations. Utility/index modules passed13 tests; benchmark8. Registry and feedback config are integrated. A real/full/all-controls dry run produces55,242 utility profiles and about8.5MB JSON per asset across all four encodings; no wallpapers are copied into the repo.

The first fused screening and resource observer were terminated by the session harness around01:14UTC. Partial evidence is retained under `favorite-optimization/2026-09-23/fused-screen/` and `resources/`; neither is a completed campaign. Four finished serial profiles showed the generic fused script slower than native (single-vibe p95~424ms vs216ms; green40~427ms vs322ms). Treat as preliminary. A new complete run `fused-screen-v2/` and observer `resources-v2/` run in persistent user-systemd units to survive conversation interruptions.

Current agents: `optimization_ui` finishes a separate8228 visual lab; `optimization_audit` independently reviews/audits; `optimization_refinements` researches the next candidates. Root owns all service traffic. Real utility index is not built yet. Next: finish screening, index real545 full/presets, fidelity and feedback, utility projection100k/1M, refine and test promising encodings at scale.

## Checkpoint — first screen and index layout correction

`fused-screen-v2` completed and passed independent audit:8 profiles,265 timed requests+8 warmups. Both five-color profiles fail(32 timeouts each plus warmups); generic fused C1 p95 is426ms/427ms/829ms for single-vibe/green40/two-colors versus249ms/325ms/647ms native. Separate complete profiles confirm one million root score calls; native five-color query invokes25 million layer scorers. This is measured execution evidence, not merely inferred cost.

First real full/all-controls utility indexing failed on its first document: Lucene rejected `utility_rank16` with an encoded-term-frequency integer overflow. About107k positive high/low feature values shared one field. No documents were acknowledged. Preserve `real-index/index.json` and the empty `color-exploration-favorite-opt-real-v1` index(closed to release mapping resources). The correction partitions feature fields by control preset, keeping the scoring formula unchanged. The next index is `color-exploration-favorite-opt-real-v2`, with a new receipt directory. Numeric utility fields and originalfavorite remain unchanged. A typed script refinement is also in progress.

## Checkpoint — 13:29 UTC

The persistent build finished all545 documents at01:39UTC, then its strict mapping comparison rejected OpenSearch's omission of explicit default properties. No data loss: v2 contains545. Read-only completion at13:25 verified all mapping fields, corpus/source identities, stable UUID and three fully recomputed source documents. [FAVORITE-UTILITY-COMPLETION.md](FAVORITE-UTILITY-COMPLETION.md) documents the precise default normalization. Original failure receipt remains unchanged; separate `real-index-v2-completion/completion.json` passes. Future runner uses the tested normalizer; no scorer/extractor changed.

UI http://zerotwo:8228/ is running in `wallpaperdb-color-favorite-lab.service`, real-only523 wallpapers, with six initial methods; verified typed script is being added as seventh. Typed native parity passes all545 scores/order across15 settings. Root registry and feedback configuration include it. Existing8227 is unchanged.

The first all-preset fidelity driver was stopped because it recompiled query descriptors for every image. Its partial rankings are retained under `fidelity/`. `fidelity-v2` compiles once per query and retains complete545-document native comparisons plus encoding oracles. Persistent `wallpaperdb-favorite-opt-first-continuation.service` runs this, feedback, projection100k/index+screen, then projection1M/index+screen sequentially. Plan/output directories are `first-round-continuation-plan.json` and `first-round-continuation/`; scale observer is `resources-v3/`. No million-record utility results yet. Subsequent work: analyze screenings, refine promising indexed utilities, test concurrency/changing queries/full schema, finish visualQA and reports. All active data under external `.../favorite-optimization/2026-09-23/`.

## Checkpoint — 13:45 UTC

Completed `fidelity-v3`: 144 query/preset combinations, all545 documents each, four utility encodings =576 native comparisons. Generic fused scores/order match the baseline exactly. Numeric utilities and rank16 retain the same top20 in every comparison; numeric maximum absolute score error1.4e-7, rank16 7.66e-6. Across all144, full ordering is identical in130 numeric and14 rank16 cases. Rank8 and native feature-float each reach a minimum top20 overlap of14/20, with mean19.438/19.625. These are fidelity measurements, not population relevance judgments.

The slow fidelity-v2 fetch was traced to stored-ID retrieval decompressing very large debug source blocks. Validation-v3 retrieves the already-indexed ID doc value instead, while retaining every returned native score and ordering. Its complete comparisons finish in about6seconds after initialization. Original sources/scorers and partial evidence are preserved. The current human-feedback run deliberately retains its original service boundary, so the large real utility debug index makes full-corpus fetches expensive; those timings do not represent the source-disabled scale layout.

Active persistent unit is now `wallpaperdb-favorite-opt-continuation-v3.service`, plan `first-round-continuation-v3-plan.json`, state `first-round-continuation-v3/`. Fidelity passed; feedback is running its seventh method. It will then build and screen source-disabled utility projections at100k and1M sequentially. All seven first-round methods are in the configs. Resource observer remains `resources-v3/`.

The seven-method lab at http://zerotwo:8228/ passed desktop/mobile checks and all nine control combinations. Per-query metadata checks now cache the mapping only while UUID/document/indexing counters remain unchanged. Original8227 remains untouched. New rank18/rank27 modules and create-only source-disabled index runner pass10 offline tests; real indexing, service parity, feedback and scale measurement are next. See [FAVORITE-PRECISION-REFINEMENT.md](FAVORITE-PRECISION-REFINEMENT.md). No production selection or million-record utility performance claim yet.

## Checkpoint — 13:54 UTC

Feedback saved run `2026-09-23T13-31-35.757Z-b1e3873d` and exited2: rank8 had eight accuracy-stage10-second timeouts while fetching diagnostic source blocks. Other six methods complete32 supported cases,6 unsupported,0 errors. Baseline/fused/typed/numeric/rank16 pair agreement69.4792%; native feature-float69.7396%, solely because quantization turns one disfavored pair into a tie. Rank8's24-case aggregate is incomparable. [FAVORITE-OPTIMIZATION-ACCURACY.md](FAVORITE-OPTIMIZATION-ACCURACY.md) independently audits raw results. Next real feedback will use a source-disabled utility index to remove that physical fetch bottleneck; original failure remains evidence.

Continuation-v3 stopped before scale work as intended. `first-round-scale-v1` also stopped before any index write because user-systemd lacked the Node PATH. Reissued the same immutable scale plan with an explicit PATH as `wallpaperdb-favorite-opt-scale-v2.service`, external state `first-round-scale-v2/`, log `/tmp/favorite-opt-scale-v2.log`. Utility projection100k completed in about12seconds; all four encodings share63.4MB,9 utility profiles. Screening is running, followed automatically by1M indexing/screening. Do not describe this narrow projection as full-bank capacity.

Rank18/rank27 backend/feedback/UI integration is prepared, including disabled UI columns until the new real index validates. Precision fidelity runner tests6pass; adapter3pass. Full indexing may require a compiled encoder to remove repeated per-document plan/field-name work; that is being built separately with exact document parity. A separate scheduled-arrival harness now validates primary source/query identity and required index representation, includes scheduler delay/errors and changing colors, and passes7 tests. It will run only after a passing million-record screen.

## Checkpoint — 14:12 UTC

Both first-round screenings completed and passed independent raw-evidence audits (`screen-100k/audit-capacity-review.json`, `screen-1m/audit-capacity-review.json`).100k:28 profiles,67,911 timed requests,28 warmups,zero failures.1M:28 profiles,27,620 timed+28 warmups; original/generic/typed five-color profiles each fail32 timed requests plus warmup. All16 utility profiles pass atC1. Numeric p95 at1M is25.89ms one color,56.58ms two,109.23ms five; rank16 is44.42/68.19/150.33ms. No concurrency or full-bank result yet. [Capacity report](FAVORITE-OPTIMIZATION-CAPACITY.md) records tables and profile counters: feature pruning helps coarse single-color queries, but all utility five-color roots still score every document.

Compiled indexing encoder preserves byte-identical documents, speeding offline favorite-bank generation2.22× for rank16,3.53× for rank18 and2.38× for all four initial encodings. Evidence `compiled-encoder/benchmark.json`. New numeric-point sort (fast and score-tracking control) and exact global-bound/PIT prototypes are implemented with tests; service fidelity remains pending. Executor-aware benchmark and arrival harnesses retain total deadlines and archive actual warmup execution evidence; single-body profiling is explicitly skipped for multistage executors.

`refinement-real-v1` stopped building source-disabled utility indexv3 after21 acknowledged documents: real-node parent circuit breaker exceeded the2GB heap limit. Preserve `real-index-v3/index.json`; it is incomplete. The original real container has27.17GB of index data in its writable layer and no volume, so recreation for more heap must first preserve that data. Active unit `wallpaperdb-favorite-real-node-migration.service` copies the stopped container data to external `.../color-evaluation/opensearch-real-data`, independently hashes every source/destination file, then recreates only after a verified receipt with a durable bind mount and4GB heap/8GB limit. Original compose/scorers remain unchanged; override is `favorite-real-memory.yml`. Pipeline plan/state `real-node-migration-plan.json` / `real-node-migration/`; verification receipt `real-node-preservation/preservation.json`. On copy failure the original container restarts. After successful restoration, verify all index UUIDs/counts before resuming builds using a NEWv4 utility index/directory.

Next: realv4 lean utilities, precision-real and points-real indexes; all-document precision/executor fidelity and complete feedback; precision/points projection screens; full numeric-points bank100k/1M and concurrency/changing-arrival tests. Numeric currently leads accuracy/speed among fine encodings; rank18/rank27 remain comparisons, not selected winners. All earlier8225–8228 UI processes remain; OpenSearch-backed searches briefly pause during data preservation/restart. Sources for compiled encoders/indexers are frozen. No wallpapers or benchmark artifacts enter Git.

## Checkpoint — 14:27 UTC

Migration finished successfully. Verified2,017 files /27,028,717,000 bytes and all51 restored indexes: UUIDs, status and document counts unchanged. Real service19216 now has4GB heap/8GB container; scale19217 remains4GB/12GB/8CPU. External `opensearch-real-data.verified` marker makes subsequent ordinary `make color-global-up` retain the durable data mount and expanded heap. Receipts: `real-node-preservation/preservation.json` and `restored.json`.

Active persistent pipeline is `wallpaperdb-favorite-opt-real-refinements-v2.service`, log `/tmp/favorite-opt-real-refinements-v2.log`, plan `refinement-real-v2-plan.json`, state `refinement-real-v2/`. Lean utility realv4 completed all545, source disabled, all9 presets/all4 encodings: indexing350.57s, total354.06s, current primary storage2,952,257,465bytes. Precision real index is currently building. Then points-real, precision fidelity, complete lean/precision feedback, execution fidelity and execution feedback follow sequentially. All source files those indexers import are frozen. The lab source has12 methods and12 tests, but its process is deliberately not restarted until the new indexes validate; running8228 still uses oldv2.

`favorite-execution-fidelity` has10 passing tests and will compare sorted/scored/bounded paths against numeric service rankings at all545 and limits20/3/1, including metadata and zero ties. It separately records duplicate-anchor arithmetic diagnostics: Lucene may rewrite identical clauses; do not hide an oracle failure behind matching executor order. A broad8184-query workload covers all6138 stored utilities and is being integrated as an optional arrival workload with64 explicit warmups, actual exercised-field coverage and per-item parameter merging. A separate source-disabled numeric-index audit is being added to reconstruct and check every stored numeric value for three synthetic ordinals. Full-bank/concurrency results are still pending; no production choice is final.

## Checkpoint — 14:39 UTC

Lean realv4 and precision realv1 completed. First points-realv1 stopped after200 acknowledged documents on a whole HTTP429 parent `<http_request>` admission rejection; its receipt/index remain preserved. The compiled index runner now retries only that confirmed pre-handler rejection, at most6 identical create requests with1/2/4/8/10s backoff. Partial bulk errors,409,timeouts and unknown outcomes never retry.9tests pass and independent review confirmed the admission boundary. No encoder/scorer changed.

Fresh `color-exploration-favorite-points-real-v2` builds in `points-real-v2/`. Active persistent unit `wallpaperdb-favorite-opt-real-refinements-v3.service`, plan `refinement-real-v3-plan.json`, state `refinement-real-v3/`, log `/tmp/favorite-opt-real-refinements-v3.log`. Then precision fidelity, lean and precision feedback, execution fidelity and execution feedback follow. Source graph frozen for measurement. Lab8228 restarted with12methods and lean/precisionindexes; pointsmethods remain guarded until complete. Registry/config defaults updated to pointsv2.

Wide-arrival source completed16tests and independent review.8184queries cover6138utilitykeys;64warmups. Scheduled/dispatched/successful coverage reported separately; default30s×8/32/64/128rps yields6960requests if allratespass, so does not establish fullquerycycle coverage. Numeric index audit4tests checks allscalarvalues onthree syntheticordinals against independentoriginalencoder. Refined projection/fullbank/concurrency runs remain pending.

## Checkpoint — 14:46 UTC

Points-realv2 completed545 in112.58s indexing /115.75s total,1.205GB serialized JSON,0bulk retries; complete precision fidelity is running (46/144query-presets at14:45). All12lab methods nowhavecompleteindexes; browsersearchQA waitsuntilcorrectnesspipelinefinishes. Lightdesktop/mobilechecks pass withnohorizontaloverfloworJSerrors.

Newscaleprojectionbuilds runserially in `wallpaperdb-favorite-opt-projection-builds-v1.service`, state `refinement-scale-builds-v1/`, log `/tmp/favorite-opt-projection-builds-v1.log`, immutableplan `refinement-scale-pilot-v2-proposal/build-only-plan.json`. Points1Mprojectioncompleted; precision1Mprojectionbuilding. These are indexing-only alongside smallrealcorrectnesschecks; noqueryperformanceistimedconcurrently. Proposal contains `pilot-index-only-plan.json` forfull100knumericpointsonly/favoritepreset and `measurement-only-plan.json` forlaterserialaudits/screens. Rootmaystartpilotindexafterprojections, whileholdingalltiminguntilrealvalidationandUIQAfinish. Full1M remainsgatedbyactualpilotstorage/runtime. Sources/previousfavoriteunchanged.

## Checkpoint — 15:07 UTC

Precision fidelity completed144 query/preset combinations /288comparisons, independentrawauditpassed(`precision-fidelity/audit-independent-v1.json`). Both18/27retainalltop20. Rank27all16favoriteordersidentical; acrossallcontrols129/144identical,maxscoreerror1.5e-7. Rank18allcontrols40/144identical,maxerror2e-6. Leanfeedbackactiveinrealpipelinev3; futureprecisionfeedback/executionfidelity/executionfeedbackstillpending.

Bothrefined1Mprojectionscompleted: points26.62sindexing/28.71stotal; precision44.31s/46.42stotal. Projectionnumericvalueauditcompleted27scalarcomparisons(3ordinals×9)andallmetadataat `points-projection-1m-v1-audit/`. Fullnumericpoints100k/favorite6138-utilityindexbuildactiveunit `wallpaperdb-favorite-opt-full-pilot-index-v1.service`,state `refinement-scale-pilot-index-v1/`,plan `refinement-scale-pilot-v2-proposal/pilot-index-only-plan.json`,log `/tmp/favorite-opt-full-pilot-index-v1.log`.~75kacknowledgedat15:07,~65docs/s. Noquerycapacitymeasurementoverlap.

Newfinding: source-disabledOpenSearchstoreshidden_recovery_sourceuntileligiblemergepruning; storedIDfetchcanstilldecompresslargeblocks, especiallyall545hits. Officialmechanismcitedin `FAVORITE-STORED-FIELDS.md`; actualattributionawaitssameindexA/B. NEWfrozen `favorite-docvalue-fetch.mjs` addsnumeric/rank27/sorted variants fetchingfields.idwithstored_fields:none, unchangedquery/filter/sort.5tests(all9presetsincluded). New standalone`favorite-docvalue-adapter.mjs`3tests;labsource15methods/14tests,butrunningprocessstill12pendingrootfidelity/restart. Oldregistry/adapterremainunchangedwhilefeedbackruns. Newrootrunner`favorite-docvalue-fetch-fidelity.mjs` willcompare432allpresetserviceordersagainstverifiedarchivesand24sameindexA/Bpairs20/1000hits; provenanceguardsreviewed. Notrunyet. Newconfigs `favorite-docvalue-feedback.json`, `favorite-fetch-points-projection-1m.json`, `favorite-fetch-precision-projection-1m.json`, `favorite-fetch-full-100k.json`, `favorite-fetch-full-1m.json`, `favorite-fetch-full-100k-controls.json`; all5benchmarkconfigsdry-runpass. Neednewimmutablemeasurementplan; oldproposalmeasurementplansomitnewfetchmethods and includealreadyauditedprojectionstep, DONOTlaunchunchanged.

12-methodfullUIQApassed: single/five/grayscale+red,all9presetsrepresentativefine/sorted/bounded;1848hitoccurrencesnofixtures,detail/source/mobile/livecancel/errorrecoverypassed;browserclosed. Evidence `ui-12-complete/`.

Parallelbulkproposalready(UNAPPLIED):new`favorite-bulk-scheduler.mjs`8tests,external `parallel-bulk-proposal-v1/compiled-index-integration.patch` andproposedsources. Concurrency1default,optin4;generationhashorderunchanged,bounded4batches,serializedreceiptwrites,drainafterfailureandrecordall201acks. Root/agentUIreviewing. MUSTfinishANDAUDITfull100kwhilecompiled-indexsourceunchanged; MUSTfinishactivefeedbackarchivesbeforeapplyingpatch. Projectionnumeric audit alreadydone. Thennew1Mbuildcanuse4batcheswithnewsourcearchive. No1Mfullclaimyet.

Newfile-onlyarrivalauditor9tests independentlychecksrawrequestfailureunions/percentiles/coverage/body/source/indexidentities; `favorite-optimization-arrival-audit.mjs`. Wide-arrivalintegrationfrozen16tests. Noarrivalcampaignrunyet.

## Checkpoint — 15:22 UTC

Full100kpilotcompleted15:15:16:100,000documents,6,138utilities/favoritepreset/numericpoints/sourcefalse.1,598.55sindexing,1,726.50stotal(includes126.51ssettling),24,785,253,530JSONbytes,13,044,690,824primarystorebytes,30segments. Numericvalueauditpassed18,414values(3ordinals×6138)plusmetadata in `points-full-100k-v1-audit/`. Projectionauditpreviouslypassed27values. BothauditsperformedBEFOREanycompiledindexerchange. Full1Mstorage/runtimeprojectionsremainestimates;~290GBdiskfree.

Realpipelinev3precisionfeedbackpassed at15:20:49; nowexecutionfidelity(5/144corecasesat15:21,morefilter/duplicatecasesfollow). Leanfeedbackrun `2026-09-23T14-58-25.115Z-10d80e62`:7methods×32supported/6unsupported/0errors. Precisionfeedbackrun `2026-09-23T15-12-26.942Z-799bcaac`:baseline/rank16/18/27all32/6/0,all234preferencepairsunchanged. Independentfile-onlyaudits `lean-feedback-independent-audit-v1.json` and `precision-feedback-independent-audit-v1.json`. Macroagreement69.4792%forfavorite/numeric/finerencodings. Coarsepair-to-tiechangesarequantizationeffects,notprovenrelevancegains.

NEWimmutableplans/configcopies `fetch-refinement-v1-proposal/`: `real-plan.json`(432fetchfidelity+24sameindexA/B,thennew4candidatefeedback), `screen-plan.json`(pointsprojection6methodsC1,precisionprojection3C1,full100k3controlsC1,3leadersC1;unfiltered4shapes), `full-1m-build-plan.json`(favorite-onlynumericpoints4parallelbulks+valueaudit), `full-1m-screen-plan.json`(3leadersallfiltersC1/4/16). Noneoftheseplanslaunchedyet. Keepoldrealpipelinecompletebeforelaunchingreal-plan;completeUI15methodQA beforetiming. Full100kconcurrencydeferredinfavorofreal1Mconcurrency;doNOTrunoldpilotproposalmeasurementplan. Newlabsource15methodsready14tests,butliveprocessstill12untilfetchfidelitypasses.

Parallelindexerproposalv1hadknown201ackaccountinggapwheninneraccepted-eventdiskwritefailed. Fixedandre-reviewedv2at `parallel-bulk-proposal-v2/compiled-index-integration.patch`,scheduler10testsincludingactualretryhelper201→innerwritefailure. Boundedactiveackmap,definiteackcounterssynchronous/idempotent,afterfailureallinflightdrained;best-effortFSfailureevidenceexplicit. Oldcompiledindexermodule/testSTILLUNMODIFIED. Applyv2andruncompiled-index/schedulertestsonlyAFTERoldrealpipelinefinishes(itsfeedbackarchivesincludecompiledsource). Thennewfeedbackarchivesuseupdatedrunner.

Arrivalharnessnow17testsplusindependentauditor10:explicitlyunwraps3registeredfetchvariantsforparentencoding/pointschecksandrequiresIDdocvalues. Optional `--duration-seconds 1..600`default30;enables9600widequeriesat16rps×600sforfull8184cyclewithoutrequiringoverload. Actualsuccessfulkeycoveragealwaysreported. Frozenagain;noarrivalcampaignyet. Agentscompletion/typedindependentlyauditrealoutcomes;UIreviewpassedparallelv2and15methodmodules. Allactualperformance/full1Mworkstillpending.

## Checkpoint — 15:35 UTC

Execution fidelity completed1,878 comparisons; all three execution paths exactly match numeric service IDs and scores. Independent evidence audit passed at `execution-fidelity/audit-independent-v1.json`. Overall arithmetic flag is false: both duplicate-target diagnostics yield half the intended score when two targets resolve to one utility. The preserved original favorite has the same defect. Distinct-target capacity tests remain valid; original runtime sources stay unchanged. UI agent investigating a separate corrected-wrapper proposal externally. Execution-feedback is now active in oldrealpipelinev3; wait for it before applying reviewed parallelbulkpatchv2. Newfetchfidelity/screens/full1Mplans remain unlaunched.

## Checkpoint — 15:39 UTC

Oldrealpipelinev3 completed execution-feedback; independent audit confirms all234pair outcomes unchanged for baseline/numeric/sorted/sorted-scored/bounded. Actualbounded PIT executor confirmed in accuracy evidence; timedtrials retain elapsed/hits and share same source-verified path. Applied reviewedparallelbulkpatchv2 after all prior source-frozen work finished;10compiled-index+10scheduler tests passed. These modules are frozen again for upcoming1Mbuild+audit.

Newfetch-real-v1 pipeline completed: fetch-fidelity-v1 passed432allpreset rankings plus24same-index A/B pairs; fetch feedbackrun `2026-09-23T15-36-43.348Z-5fdd65e8` all32supported/6unsupported/0errors per method and all234pair outcomes unchanged. Independentfeedback audits passed. Docvaluefetch full545 diagnostic takes milliseconds where storedfetch takes seconds;20hitdiagnostics vary, so capacityscreen remains necessary. Lab8228 restarted with15methods; UIagent performing QA before capacitytiming.

Next: launch savedfetch-refinement-v1-proposal/screen-plan.json in NEWstate after UItraffic stops. Then full1Mbuildplan (4parallelbulks) after reviewing pilot capacity. Agenttyped preparing separate seed-maxima bound prototype; frozen bounded/scoring modules stay unchanged. Offline replay predicts benefit mainly two-target queries, not five; see FAVORITE-SEED-MAXIMA.md. Duplicate-wrapper proposal external and unintegrated.

## Checkpoint — 15:47 UTC

15-methodbrowserQApassed30exactparentcomparisons/61capturedresponses/1464hits/nofixtures. Browserclosedandliveupdatedisabled. Fetchscreenpipeline started15:40:54 unit `wallpaperdb-favorite-opt-fetch-screen-v1.service`,state `fetch-screen-v1/`,log `/tmp/favorite-opt-fetch-screen-v1.log`. Firstpoints1Mprojection completedandindependentauditaccepted24profiles/41743timed+24warmups/0strictfailures. Sorted-docvaluesp95single1.88ms/green40 1.83ms; boundedtwo9.26ms/five67.47ms. Numeric-docvalues29.03/29.86/60.99/115.03ms. This is9utilityprojectionC1only. Precisionprojectionthenfull100kcontrols/leadersfollowserially;noquerytrafficoutsidepipeline.

Maxima refinement implemented separately `favorite-maxima-bounded-utilities.mjs`,11tests/proofreviewpass; noservicecalls. AgentUIpreparingnewservicefidelityrunner; agenttyped standalonefeedbackadapter/config/lab16preparation. Keepallrunningmeasurementgraphsfrozen. Existingduplicate-wrapper proposal external onlyat `duplicate-utility-proposal-v1/`;6tests and byte-identicaldistinct-query bodies across144presetsandall8184widequeries,whichhavenoduplicateresolvedutilities. No corrected service test yet.

## Checkpoint — 15:57 UTC

All4fetchscreenscompletedandindependentlyaudited:0strictfailures. Full100kleadersp95 [single,green40,two,five]ms numericdocvalues4.93/5.05/8.63/13.56; sortdocvalues1.39/1.53/7.95/13.91; bounded4.30/4.23/7.02/18.79. Precisionrank18/27were slower thannumeric/boundedinthe1Mprojection,sodeferfullprecisionbankindexing.

Full1MbuildACTIVE since15:55:51: `wallpaperdb-favorite-opt-full-million-build-v1.service`,log `/tmp/favorite-opt-full-million-build-v1.log`,state `full-million-build-v1/`,plan `fetch-refinement-v1-proposal/full-1m-build-plan.json`. Build `color-exploration-favorite-points-full-1m-v1`,receipt `points-full-1m-v1/index.json`,followedautomaticallybynumericvalueaudit. Fourparallelbulks;~11.5kacceptedfirstminute,0retries. Sourcegraphcompiledindexer/encoder/schedulerMUSTremainfrozenuntilauditcompletes.

Closed16INACTIVEscale19217experimentindexesBEFOREbuildtoreleasereaders/mappings. All data/UUIDs retained; no deletes. Receipt `pre-full-1m-scale-index-close.json`,inventoryadjacent. Real19216 andold8225/8227/8228UIsunchanged. Full1Mismemory-environmentcohortdistinctfromearlierpilot/projections;allnewcandidatescompareonthesamenewindex. To reuseoldscaleindex,explicitPOST itsname/_open. DoNOTopenoldscalesduringcurrentcapacitycampaign.

Maxima realpipelinecompleted14-secondfidelity+10-secondfeedbackwhilescaleindexing: `maxima-real-v1/`,plan `maxima-real-v1-proposal/real-plan.json`,log `/tmp/favorite-opt-maxima-real-v1.log`.626comparisonsreportedpass; independentfidelityauditpendingcompletionagent. Feedbackrun `2026-09-23T15-56-35.122Z-2025cd42` all234pairs unchanged,32complete/6unsupported/0errors;independentauditpassed. Timingsintegrationonlyduetoconcurrentindexing. Arrivalharnessexplicitmaximabindingadded18tests+11auditor;standaloneadapter4tests;lab16prepared15tests. UIagentwillrestart+QA16nowandthenvalidate separate duplicateweightcorrectionwithoutalteringoriginals.

NEWreplacementfullcapacityplan `full-million-comparison-v2-proposal/screen-plan.json`,config `favorite-full-million-four-methods.json`:old3fullleadersUNCHANGED plusmaxima. Dryrunpassed48cases/max144profiles(all/partition10/tag1,C1/4/16). OutputNEW `full-million-four-methods-v2/`. LaunchAFTERbuild+numericvalueaudit+maximarealproof+UItrafficstops. DoNOTrunold3methodfullscreenplan(unlaunched). Adaptivefixed/varied/widearrivalsstillpending.

## Checkpoint — 16:10 UTC

Full1Mbuildpassed100kacknowledged(~140docs/s),0retries/errors;continuingagainstfreshfullindex. Maximaindependentfidelityauditpassed626executions/83386scores/160cases and keptall4543winners/tiesaboveseedthreshold.105casesprunedextradocuments,102two-target/3five-target. Lab16QApassed30parentcomparisons/31responses/744hits/nofixtures;browserclosed. Newcombined4methodfullcapacityplan remainsunlauncheduntilbuild+auditfinish.

Whilewaiting,indexergraphstaysfrozen. UIagentvalidated separate multiplicitycorrection onreal19216:162duplicateexecutions+144ordinarypresetrankingspassed,artifact `multiplicity-fidelity-v1/`;feedback+17thlabintegrationpending. Thisrestoresrepeatedtermweights,doesNOTmergepercentagequeries. Completionagentpreparingnewsmall3-shardrealprojectioncorrectnesscheck(189utilities/all9presets,545records),noperformanceclaims. Typedagentpreparingread-only `/performance.html` on8228 usingFIXEDexternal `favorite-performance-public-summary.json`,seededfromcheckpointv5. Refreshcontract: addpublication{sourceCheckpoint,publishedAt,sourceSha256}toauditedgeneratedsummaryandatomicallyreplacefixedfile. Summarysnapshottimeexplicit;full1Mcountsarenotlive. Coordinate lab/MakechangeswithUIagent. Allrealcorrectnesscanoverlapscaleindexing;allcapacitytimingmustwaituntilindexing+UItrafficfinish.


## 2026-09-23T16:42:37.170880+00:00 — Persistent capacity continuation armed

Root reviewed and launched `wallpaperdb-favorite-opt-auto-capacity-v2.service` at 16:42 UTC. Its state is `automatic-capacity-continuation-v2/status.json` under the external root; top-level log `/tmp/favorite-opt-auto-capacity-v2.log`.

It waits for the completed build and verified numeric audit, then runs the four-method screen above, independently audits it, runs fixed and varied arrivals (8/32/64/128 requests/s, 30 seconds each), and runs the broad 8,184-query cycle (16 requests/s for 600 seconds per eligible candidate), auditing every stage. All stages are serialized; failed performance evidence remains visible and higher-rate skipping follows the existing harness. The six-hour deadline includes waiting.

Reviewed plan: `automatic-capacity-continuation-v1-proposal/continuation-plan-v2.json`, SHA `3c0f2808d09d2547fd62eec41fd50ead97f6f24ccfe5d94d576a020293b90b2f`. All 54 pins, including Makefile and recursive harness sources, must remain unchanged. Do not start a duplicate manual capacity campaign. Version 1 of this gate was rejected for incomplete process-group cleanup and never launched; version 2 passed 19 offline tests and independent review.


Reports now lead with the current numeric plan; the earlier rank18 pilot proposal is explicitly historical. A 17-option method map distinguishes preserved scores, quantization and the separate duplicate correction. No frozen scorer/indexing sources or Make targets changed.


## Halfway build checkpoint

Checkpoint v8 was published at 2026-09-23T16:55:45.468356+00:00 from `results-checkpoint-20260923-v8.json` (SHA `ec5ac2b3a31286f414a004e27d20e7a526a674233abe674c496015022a329eac`). Its full-million build records 501,984 accepted documents, remains incomplete, and has no final count or capacity result. A file-only comparison verified all eight performance campaigns, seven fidelity campaigns, seven feedback runs, completions and audits are unchanged from v7; only the running index receipt changed. The previous public v7 is preserved externally.


## Three-quarter build checkpoint

Published v9 at 2026-09-23T17:26:09.263882+00:00, SHA `866b5c000f66d10c357b6081c3681f6b3482d8e5f11bc6424fbddff5f2210730`. Full-million receipt remains incomplete at 755,580 accepted records, with no final count. All completed performance, fidelity, feedback, completion and audit summaries remain byte-equivalent to their parsed v8 values; only build progress changed. Public v8 is preserved externally.


## 2026-09-23T18:01:26.229929+00:00 — Full million verified; capacity started

External root: `/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23`.

The build pipeline `full-million-build-v1` completed both phases with exit 0 at **17:58:20 UTC**. Receipt: `points-full-1m-v1/index.json`; numeric audit: `points-full-1m-v1-audit/audit.json`.

- Index `color-exploration-favorite-points-full-1m-v1` on port 19217, UUID `LHjoEvSiR8KNe5WZv_a7iA`.
- Exactly 1,000,000 records, all 6,138 utility fields for the favorite preset, numeric float points/doc values, source disabled.
- Primary store **56,048,738,808 bytes**, 66 segments, zero active merges and zero translog operations at final capture.
- Indexing 7,170.076 seconds; total including finalization 7,336.453 seconds. Four parallel bulks, 47,620 accepted batches, zero failed batches.
- Sample audit checked all 6,138 values on ordinals 0 / 499,999 / 999,999: all **18,414** values matched the original encoder. This is a sample audit, not every stored document.
- Query performance is now being measured; the completed index is not yet a capacity claim.

The automatic capacity gate started the four-method screen at **17:58:46 UTC**. Unit: `wallpaperdb-favorite-opt-auto-capacity-v2.service`. State: `automatic-capacity-continuation-v2/status.json`; top-level log `/tmp/favorite-opt-auto-capacity-v2.log`. Screen pipeline: `full-million-comparison-v2-auto-pipeline-v2/`, log `full-1m-four-methods.log`. Do not launch another campaign. All 54 pinned source/config files, including Makefile, remain frozen through the entire gate.

Sixteen inactive scale indexes remain closed to release readers/mappings; nothing was deleted. Inventory/receipt: `pre-full-1m-scale-index-inventory.json` and `pre-full-1m-scale-index-close.json`. Do not reopen them while timing. Real port 19216 and the old comparison pages remain available. This is a separate environment cohort from earlier screens.

The old count-printing monitor was stopped at the user's suggestion. A silent completion waiter exited successfully after the complete build and audit. Use phase-completion waits and meaningful result updates; avoid repeating record counts.




## 2026-09-23T18:06:45.389531+00:00 — First full-million capacity attempt stopped

The saved screen `full-million-four-methods-v2/` is incomplete and failed. Its independent raw audit `audit-independent-auto-v2.json` found internally consistent evidence, but **accepted:false** because the campaign stopped. Eleven complete profiles passed (all single-color); the next maxima C16 profile has 12,285 pending timed rows including **7,491 `fetch failed` errors**. Include those failures; the stale completed-profile summary's zero failures is not the campaign total.

The terminal exception was an `ECONNRESET` during the final resource sample. Per-trial catches saved only `fetch failed`, losing transport causes/stage evidence. Successful requests continued among errors. No arrivals ran. Root live checks found the same JVM/container running, green cluster, no OOM/restarts, no service error logs, no search queue/rejections and all PITs eventually closed. Saved resources also rule against onset memory pressure. Connection handling is under investigation, not a confirmed scorer failure.

- Root: live service ownership, reproduce and fix, retain old failed evidence.
- `optimization_completion`: new standalone transport diagnostic + Make target, preserves nested causes/stages, no retries; root launches live runs.
- `optimization_typed_verify`: saved resource/transport diagnosis and independent diagnostic review. No live traffic.
- `optimization_ui_finish`: update RESULTS/CAPACITY with completed build and failed/incomplete capacity attempt.

Do not restart/reindex OpenSearch or rerun capacity until the transport cause is understood. The one-million data and verified receipt remain intact. Full ingestion file audit `full-million-ingestion-complete-audit-v2.json` passed all 47,620 batch/ID/digest/source bindings. Final indexing resource audit `resources-indexing-completed-independent-audit-v1.json` passed (mean 2.347 cores; sampled charge peak 12GiB; no OOM). These are build evidence, separate from failed query capacity.



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

## Completed capacity campaign — 2026-09-23, 20:32 UTC

The pooled variants passed real-service fidelity and the unchanged human-feedback
suite, and are available as options 18/19 in the 19-method lab. The full index
contains 1,000,000 deterministic mixtures of 523 real-image measurements, all
6,138 utilities for the favorite preset, and 56.049 GB of primary storage.
The saved favorite snapshot and all 44 frozen runtime/configuration pins were
verified unchanged after timing.

- Closed loop: all 144 profiles passed, covering 1,007,172 timed requests plus
  48 warmups. Maximum timed latency was 491.544 ms.
- Fixed arrivals: ordinary pooled bounds alone passed 128 requests/s. Numeric,
  sorted and maxima variants failed that rate; all passed through 64/s.
- Varied arrivals: all four passed through 128/s. This workload has fewer
  five-target queries than the fixed workload, so it is a separate result.
- Wide arrivals at 16/s: numeric and both bounds successfully covered every
  utility field. Direct sort failed with 107 strict failures and successfully
  covered only 6,088 of 6,138 fields.
- Wide follow-up: numeric and ordinary bounds both passed 64/s for 180 seconds,
  with 11,520 requests and complete successful field coverage each. Numeric
  p95/max were 154.361/316.415 ms; bounds were 277.111/740.410 ms.
  Both failed at 128/s: 9,465 and 6,368 strict failures respectively. No failed
  load is qualified by its average, percentile or a different passing workload.

All five completed campaign artifacts passed independent raw-evidence audits.
The earlier interrupted run and its 7,491 errors remain preserved. An additional
warmup audit matched all 48 lists, 36 comparisons and 720 scores exactly. It bound
the known 2.32-second file-only overlap to 78 numeric one-color C1 requests;
those samples remain included, with no adjustment or causal claim.

Thirteen final offline tests passed: four audit-helper tests and nine tests for
the future cardinality-bound compiler. That compiler remains unintegrated and
has no performance or UI claim.

The v11 dashboard was published at 20:34 UTC with 14 performance campaigns,
eight fidelity campaigns, eight feedback runs, 13 index receipts and no summary
warnings. Its checkpoint SHA-256 is
`101c9d7733a489db9afc020d3c7c4ade5d373db7da1e358a6bae4b3afc49d12e`.
Targeted desktop/mobile browser checks passed, including historical and new
failed loads. The scale node and observer are stopped; real OpenSearch and the
visual labs remain available.

The [final resource review](FAVORITE-FINAL-RESOURCES.md) is complete. Independent
replay passed 2,490 checks across six focused profiles. At passing wide64,
numeric used 3.087 mean JVM cores and bounds used 1.774; the numeric path had
better response-time margin. At wide128, substantial disk/page-cache pressure
appeared in both methods, and numeric also reached its CPU quota. Separate
shared-host memory/I/O stalls contributed evidence relevant to the sorted and
maxima failures; those failed profiles remain failed. The report distinguishes
observed correlation from unproven per-request causality and benchmark-driver
memory from production gateway requirements. This optimization round is complete.

Use [results](FAVORITE-OPTIMIZATION-RESULTS.md),
[capacity](FAVORITE-OPTIMIZATION-CAPACITY.md),
[accuracy](FAVORITE-OPTIMIZATION-ACCURACY.md), and
[current handoff](FAVORITE-OPTIMIZATION-CURRENT.md) for the final interpretation.
