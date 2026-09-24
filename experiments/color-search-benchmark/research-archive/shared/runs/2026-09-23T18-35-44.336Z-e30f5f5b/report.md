# Color evaluation: 2026-09-23T18-35-44.336Z-e30f5f5b

[Complete raw measurements and diagnostics](./run.json). Large diagnostic payloads are kept in that artifact instead of duplicated in this report.

## Evidence and interpretation

No combined score or automatic winner. Accuracy, coverage, latency and resource costs remain separate.

Agreement measures recorded preferences on assessed pairs. Missing comparisons remain unassessed; high agreement with low coverage is incomplete evidence. The sensitivity column excludes explicitly uncertain pairs; it does not invent confidence weights.

These development judgments are not independent population samples or a held-out benchmark. Repeated optimization against them can overfit.

Timing describes this harness, corpus, environment and execution path. Local-reference timing excludes search-backend execution. These measurements do not establish performance for 1 million or 100 million wallpapers. Do not compare speed across different execution classes or workloads.

```json
{
  "reviewerCount": 1,
  "logicalCaseCount": 37,
  "independentSampleCount": null,
  "quickPass": {
    "id": "batch-001-quick-review-caveat",
    "scope": "All24 judgments in this submission; earlier13 records retain their original qualifications.",
    "type": "single-reviewer-quick-pass",
    "rawUserMessage": "I have submitted the answers, I went quite quickly, so dont regard this as 100% accurate human perception preference, some of these will be ranked very differently by different people",
    "selfReportedPace": "quick",
    "accuracyQualification": "Provisional preference evidence; not definitive perceptual truth.",
    "interReviewerVariation": "User expects some substantial ranking differences between people; not measured by this submission.",
    "numericConfidence": null,
    "numericWeight": null,
    "groundTruthStatus": "not-universal-or-population-consensus",
    "evaluationUse": "Development examples and discussion; no scoring rule or hard pass/fail threshold selected."
  },
  "notes": [
    "Development evidence from one reviewer; related queries and repeated images are not independent samples.",
    "Twenty-four batch rankings retain the quick-review caveat. Earlier records retain their own qualifications.",
    "Five explicitly uncertain pairs are retained in the full score and omitted in a separate sensitivity score.",
    "No numerical relevance grades, confidence weights, score margins or absolute acceptability thresholds are inferred.",
    "Connected source-image and fixture-family groups are recorded for future split design; no held-out split is claimed."
  ]
}
```

## Run conditions

```json
{
  "id": "2026-09-23T18-35-44.336Z-e30f5f5b",
  "createdAt": "2026-09-23T18:35:44.337Z",
  "dataset": {
    "hash": "e7a45108ff77ffc8ae72e41b38d948778f191af12278e280fde9313fc150a1cc",
    "caseCount": 37,
    "sourceHashes": {
      "evaluation/cases.json": "6c223d0daf8fd624a7ca72663c12f92285fe33366d890114edadef8e8ffccb22",
      "evaluation/perceived-red-001.json": "27428365299cdc9a2121f4108cd7d5a05aba7bd07a10c6a67d40c862d6dd0cd8",
      "evaluation/vibe-grayscale-001.json": "5219b05d424e4fe97db7f188023e05cd9161dda74743545f5bf077b537303e16",
      "evaluation/vibe-dark-001.json": "8f5b87013eeac68e8d14d77c9c0bedc7ca605e6d256cff92e2b4989b544ba403",
      "evaluation/combination-gray-red-001.json": "4e891d27ae41d7576383a0a19421df06b50e686d30b3c8ce3aeb61c65a2cc021",
      "evaluation/combination-gray-red-002.json": "1be26bfc44de7c76838f9dc6639db3c3c59193d99faeb9813bc7d5e4e30d3522",
      "evaluation/precision-shade-001.json": "d2d73db4540a0e994618c8e8e154a0307315d66ca6abc71207358935d327f0b9",
      "evaluation/semantic-red-city-001.json": "03cabaa751655b56a178bd83511292281ba55780164227fc49df7beae2937f41",
      "evaluation/proportion-green-001.json": "cee9a143ec572e3794e9dfdffface59db51d3f74f54acecf29dbf7c43e4554cf",
      "evaluation/proportion-green-002.json": "5f29377c1bc7196d0931553b43089fbcf5e897011a2bb45f1da3854713bf5aad",
      "evaluation/composition-green-red-001.json": "b2db4c992da0642f83adda818b3e93c6b352997383684a43b13c7341248df696",
      "evaluation/composition-green-red-real-001.json": "c9206ec3f20407ddfdb9a1b326101d581551d3b4578845f512ef2f4e13e9869d",
      "evaluation/batch-001-results.json": "c7a2ddbe4c6741cc3aacc6ca35f27e595614c2cf1cdfb0fbbe17e8f8a49fe98a",
      "evaluation/responses/30b36a99-4c94-4f15-9e18-27373dea04c5.json": "36a41bccdff3313eccbbf612ccb0057944b44e2a8b9e40524310d552592a0b76"
    },
    "corpusHash": "36e11c2981053129404da54867a008d24e47b18d21ce669cf0836ef1362ecb26",
    "corpusSize": 127,
    "accuracyPolicy": {
      "version": 1,
      "id": "strict-pair-query-macro-v1",
      "higherScoresAreBetter": true,
      "modelTieCredit": 0.5,
      "humanTiePolicy": "no within-group ordering constraint",
      "missingHitPolicy": "unassessed; report coverage",
      "aggregation": "equal weight per query with at least one assessed strict pair; report coverage and complete-case score separately"
    }
  },
  "environment": {
    "node": "v22.22.3",
    "platform": "linux",
    "arch": "x64",
    "cpuCount": 32,
    "cpuModel": "AMD Ryzen 9 9955HX 16-Core Processor",
    "totalMemoryBytes": 30637961216,
    "hostname": "zerotwo"
  },
  "workload": {
    "warmup": 1,
    "repeats": 3,
    "concurrency": 1,
    "limit": 20,
    "accuracyLimit": 1000,
    "timeoutMs": 10000,
    "timingScope": "adapter-end-to-end",
    "cacheState": "uncontrolled; explicit warmup rounds",
    "schedule": "rotating case order per round; candidates sequential",
    "percentiles": "nearest-rank",
    "setupExcluded": true
  }
}
```

## Method scope and approximation warnings

A method can return rankings while approximating the requested query semantics. Read these declarations beside agreement and coverage; successful execution does not establish that the intended query is implemented.

| Candidate | Declared approximation | Declared limitations |
| --- | --- | --- |
| favorite-baseline256 | No approximation statement supplied | No limitation statement supplied |
| favorite-utility-numeric-docvalues | No approximation statement supplied | No limitation statement supplied |
| favorite-utility-bounded-pooled-delete | No approximation statement supplied | No limitation statement supplied |
| favorite-utility-maxima-bounded-pooled-delete | No approximation statement supplied | No limitation statement supplied |

## Per-query semantic warnings

| Candidate | Case | Warnings |
| --- | --- | --- |


No observations available.

## Large-window ranking diagnostic

These accuracy calls use a separate result limit (1000). They help inspect the scoring formula and coverage. Do not pair this agreement with latency measured at the timed result limit (20), especially for approximate retrieval.

| Candidate | Execution | OK / total | Unsupported | Errors | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | unknown | 0/37 | 0 | 37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-numeric-docvalues | unknown | 0/37 | 0 | 37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-bounded-pooled-delete | unknown | 0/37 | 0 | 37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-maxima-bounded-pooled-delete | unknown | 0/37 | 0 | 37 | n/a | n/a | 0.0% | 0.0% | 0 |

## Timed-search accuracy (first measured sample)

This quality view uses the first successful measured search per case at the same result limit (20) as the performance samples. It is not an average across repeated searches; approximate or nondeterministic methods may vary. Repeated raw trial results remain in diagnostics. Missing judged images are unassessed, so agreement must be read alongside pair and image coverage.

| Candidate | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | 0/37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-numeric-docvalues | 0/37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-bounded-pooled-delete | 0/37 | n/a | n/a | 0.0% | 0.0% | 0 |
| favorite-utility-maxima-bounded-pooled-delete | 0/37 | n/a | n/a | 0.0% | 0.0% | 0 |

## Measured performance

Setup is measured separately. Latency percentiles pool measured query samples in this workload; inspect case details for slow queries. Warmup, cache control, repetitions and execution metadata are recorded above and below. Small sample counts do not establish stable tail latency.

| Candidate | Execution | Samples | p50 | p95 | Maximum | Failures | Setup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | unknown | 0 | n/a | n/a | n/a | 0 | 0.41 ms |
| favorite-utility-numeric-docvalues | unknown | 0 | n/a | n/a | n/a | 0 | 0.16 ms |
| favorite-utility-bounded-pooled-delete | unknown | 0 | n/a | n/a | n/a | 0 | 0.15 ms |
| favorite-utility-maxima-bounded-pooled-delete | unknown | 0 | n/a | n/a | n/a | 0 | 0.09 ms |

## Resource observations

Harness CPU covers the measured block, including warmups. Memory values are process snapshots, not isolated candidate peaks; retained allocations from earlier candidates can affect them. Backend resources and index storage remain n/a when unmeasured. Scope and raw values are preserved in diagnostics.

| Candidate | Harness CPU | RSS before | RSS after | Heap used after | Backend CPU | Backend memory | Index store |
| --- | --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| favorite-utility-numeric-docvalues | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| favorite-utility-bounded-pooled-delete | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| favorite-utility-maxima-bounded-pooled-delete | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

## Changes since 2026-09-23T15-56-35.122Z-2025cd42

Agreement deltas are percentage points. Positive latency deltas mean slower. Configuration and implementation changes are intentional experiment inputs. Deltas require comparable evidence; latency also requires matching workload, measured coverage, hardware/runtime and backend environment.

Accuracy comparison unavailable: Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs.

| Candidate | Status | Changed inputs | Large-window agreement change | Timed first-sample agreement change | p95 change | Unavailable comparisons |
| --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | matched | implementation/source changed | n/a | n/a | n/a | Large-window accuracy: Dataset fingerprint differs; Large-window accuracy: Corpus fingerprint differs; Large-window accuracy: Judgment source fingerprints differs; Large-window accuracy: Assessed cases/pairs differ; compare coverage and individual cases; Timed-search accuracy: Dataset fingerprint differs; Timed-search accuracy: Corpus fingerprint differs; Timed-search accuracy: Judgment source fingerprints differs; Timed-search accuracy: Timed assessed cases/pairs differ; Timing: Dataset fingerprint differs; Timing: Corpus fingerprint differs; Timing: Judgment source fingerprints differs; Timing: Execution class/backend environment differs; Timing: OpenSearch version is missing; Timing: OpenSearch topology is missing; Timing: Timed case/sample coverage differs; Timing: Measured latency samples are unavailable |
| favorite-utility-numeric-docvalues | matched | implementation/source changed | n/a | n/a | n/a | Large-window accuracy: Dataset fingerprint differs; Large-window accuracy: Corpus fingerprint differs; Large-window accuracy: Judgment source fingerprints differs; Large-window accuracy: Assessed cases/pairs differ; compare coverage and individual cases; Timed-search accuracy: Dataset fingerprint differs; Timed-search accuracy: Corpus fingerprint differs; Timed-search accuracy: Judgment source fingerprints differs; Timed-search accuracy: Timed assessed cases/pairs differ; Timing: Dataset fingerprint differs; Timing: Corpus fingerprint differs; Timing: Judgment source fingerprints differs; Timing: Execution class/backend environment differs; Timing: OpenSearch version is missing; Timing: OpenSearch topology is missing; Timing: Timed case/sample coverage differs; Timing: Measured latency samples are unavailable |
| favorite-utility-bounded-pooled-delete | new | — | n/a | n/a | n/a | Large-window accuracy: No previous candidate with this ID; Timing: No previous candidate with this ID |
| favorite-utility-maxima-bounded-pooled-delete | new | — | n/a | n/a | n/a | Large-window accuracy: No previous candidate with this ID; Timing: No previous candidate with this ID |
| favorite-utility-bounded | removed | — | n/a | n/a | n/a | Large-window accuracy: Candidate absent from current run; Timing: Candidate absent from current run |
| favorite-utility-maxima-bounded | removed | — | n/a | n/a | n/a | Large-window accuracy: Candidate absent from current run; Timing: Candidate absent from current run |

## Case changes and regressions

| Candidate | Case | Status | Previous agreement | Current agreement | Change | Interpretation |
| --- | --- | --- | --- | --- | --- | --- |
| favorite-baseline256 | composition-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | composition-002 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | perceived-red-001 | ok → error | 86.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-grayscale-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-dark-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | combination-gray-red-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | combination-gray-red-002 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | precision-shade-001 | ok → error | 20.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | semantic-red-city-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | proportion-green-001 | ok → error | 86.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | proportion-green-002 | ok → error | 93.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | composition-green-red-001 | ok → error | 53.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | composition-green-red-real-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | composition-green-red-real-002 | ok → error | 0.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-red-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-orange-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-pink-batch-001 | ok → error | 33.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-green-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-blue-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | proportion-green-real-batch-001 | ok → error | 16.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | proportion-green-real-batch-002 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | proportion-red-real-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-dark-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-light-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-vivid-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-strict-grayscale-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-near-neutral-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-monochromatic-batch-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | combination-gray-red-batch-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | composition-gray-red-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | composition-gray-red-batch-002 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | vibe-dark-accents-batch-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-baseline256 | composition-blue-orange-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | composition-blue-orange-batch-002 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | precision-warm-red-batch-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | precision-muted-green-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | palette-rainbow-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-baseline256 | perceived-red-pagoda-001 | removed → removed | 100.0% | n/a | n/a | Removed case |
| favorite-utility-numeric-docvalues | composition-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | composition-002 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | perceived-red-001 | ok → error | 86.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-grayscale-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-dark-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | combination-gray-red-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | combination-gray-red-002 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | precision-shade-001 | ok → error | 20.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | semantic-red-city-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | proportion-green-001 | ok → error | 86.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | proportion-green-002 | ok → error | 93.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | composition-green-red-001 | ok → error | 53.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | composition-green-red-real-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | composition-green-red-real-002 | ok → error | 0.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-red-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-orange-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-pink-batch-001 | ok → error | 33.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-green-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-blue-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | proportion-green-real-batch-001 | ok → error | 16.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | proportion-green-real-batch-002 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | proportion-red-real-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-dark-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-light-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-vivid-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-strict-grayscale-batch-001 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-near-neutral-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-monochromatic-batch-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | combination-gray-red-batch-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | composition-gray-red-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | composition-gray-red-batch-002 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | vibe-dark-accents-batch-001 | unsupported → error | n/a | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: unsupported → error |
| favorite-utility-numeric-docvalues | composition-blue-orange-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | composition-blue-orange-batch-002 | ok → error | 83.3% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | precision-warm-red-batch-001 | ok → error | 100.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | precision-muted-green-batch-001 | ok → error | 50.0% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | palette-rainbow-batch-001 | ok → error | 66.7% | n/a | n/a | Dataset fingerprint differs; Corpus fingerprint differs; Judgment source fingerprints differs; Case status: ok → error; Assessed pairs differ |
| favorite-utility-numeric-docvalues | perceived-red-pagoda-001 | removed → removed | 100.0% | n/a | n/a | Removed case |

## favorite-baseline256: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 0/14 | n/a | n/a | 0.0% | 0.0% | 0 |
| Perceived color | 0/6 | n/a | n/a | 0.0% | 0.0% | 0 |
| Vibe | 0/9 | n/a | n/a | 0.0% | 0.0% | 0 |
| Precision | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Semantic filtering | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |
| Proportions | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Palette | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |

## favorite-baseline256: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| vibe-grayscale-001 | grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/12 | wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061 | 0 | n/a | 0.0% | n/a |
| vibe-dark-001 | dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-001 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/5 | precision-shade-001-a, precision-shade-001-b, precision-shade-001-c, precision-shade-001-d | 0 | n/a | 0.0% | n/a |
| semantic-red-city-001 | A city wallpaper with a red feel | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | wallpaper-022, wallpaper-027, wallpaper-029 | 0 | n/a | 0.0% | n/a |
| proportion-green-001 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f | 0 | n/a | 0.0% | n/a |
| proportion-green-002 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b | 0 | n/a | 0.0% | n/a |
| composition-green-red-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips | 0 | n/a | 0.0% | n/a |
| perceived-red-batch-001 | Red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044 | 0 | n/a | 0.0% | n/a |
| perceived-orange-batch-001 | Orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036 | 0 | n/a | 0.0% | n/a |
| perceived-pink-batch-001 | Pink | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039 | 0 | n/a | 0.0% | n/a |
| perceived-green-batch-001 | Green | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| perceived-blue-batch-001 | Blue | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| vibe-dark-batch-001 | Dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079 | 0 | n/a | 0.0% | n/a |
| vibe-light-batch-001 | Light | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088 | 0 | n/a | 0.0% | n/a |
| vibe-vivid-batch-001 | Bright, vivid colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098 | 0 | n/a | 0.0% | n/a |
| vibe-strict-grayscale-batch-001 | Grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007 | 0 | n/a | 0.0% | n/a |
| vibe-near-neutral-batch-001 | Almost grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071 | 0 | n/a | 0.0% | n/a |
| vibe-monochromatic-batch-001 | One hue overall | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-batch-001 | Grayscale with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002 | 0 | n/a | 0.0% | n/a |
| precision-warm-red-batch-001 | Close to #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-082, wallpaper-087, wallpaper-037 | 0 | n/a | 0.0% | n/a |
| precision-muted-green-batch-001 | Close to #4C8C72 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-086, wallpaper-052, wallpaper-093, wallpaper-013 | 0 | n/a | 0.0% | n/a |
| palette-rainbow-batch-001 | Rainbow-like colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004 | 0 | n/a | 0.0% | n/a |

## favorite-baseline256: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 15857,
  "keys": [
    "id",
    "configuration",
    "metadata",
    "execution",
    "sourceHashes",
    "setup",
    "resources",
    "summary"
  ]
}
```

### composition-001: error

```json
{
  "query": "80% grayscale 20% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-002: error

```json
{
  "query": "80% grayscale 10% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-001: error

```json
{
  "query": {
    "userText": "red",
    "intent": "A wallpaper whose overall color appearance feels red.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-grayscale-001: error

```json
{
  "query": {
    "userText": "grayscale",
    "intent": "An overall neutral gray, black, and white appearance. This request is distinct from merely having low color or a predominantly single colored hue. Whether a faint tint remains acceptable is for human judgment.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-001: error

```json
{
  "query": {
    "userText": "dark",
    "intent": "A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 8308,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### combination-gray-red-002: error

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-shade-001: error

```json
{
  "query": {
    "userText": "Color picker: #FF2200",
    "intent": "Prefer colors as close as possible to the selected shade. A picked color signals that shade closeness matters to the user; nearby colors remain candidates instead of requiring exact equality.",
    "specifiedPercentages": null,
    "preciseHex": "#FF2200",
    "colorSpace": "sRGB",
    "subjectConstraint": null,
    "initialIntent": "Find wallpapers matching the picked shade. How much shade variation remains acceptable and how the visible amount affects overall result preference are for the user to judge.",
    "clarificationSource": "user-response-001"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### semantic-red-city-001: error

```json
{
  "query": {
    "userText": "A city wallpaper with a red feel",
    "intent": "Explore which images belong in results for the combined subject and color request, then preferred ordering among them.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectRequest": "city",
    "subjectFilteringMode": "For the user's interpretation of this case, matching the city tag is required for eligibility. Rank by fit among eligible images. C is conditional on matching that tag.",
    "initialSubjectFilteringMode": "Unresolved. This intent review does not stipulate a hard selected tag or weighted natural-language search."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9336,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### proportion-green-002: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9443,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9682,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-real-001: error

```json
{
  "query": {
    "userText": "50% green, 50% red",
    "intent": "Find images close to both whole-image named-color proportion targets; natural-image validation after the user questioned transfer from pure bands.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 50
      },
      {
        "colorName": "red",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-green-red-real-002: error

```json
{
  "query": {
    "text": "40% green, 40% red; the remaining 20% is unspecified",
    "detail": "Aim close to 40% green and 40% red across the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      },
      {
        "colorName": "red",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-batch-001: error

```json
{
  "query": {
    "text": "Red",
    "detail": "A wallpaper that feels red."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-orange-batch-001: error

```json
{
  "query": {
    "text": "Orange",
    "detail": "A wallpaper that feels orange."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-pink-batch-001: error

```json
{
  "query": {
    "text": "Pink",
    "detail": "A wallpaper that feels pink."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-green-batch-001: error

```json
{
  "query": {
    "text": "Green",
    "detail": "A wallpaper that feels green."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-blue-batch-001: error

```json
{
  "query": {
    "text": "Blue",
    "detail": "A wallpaper that feels blue."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-001: error

```json
{
  "query": {
    "text": "40% green; the remaining 60% is unspecified",
    "detail": "Aim close to 40% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-002: error

```json
{
  "query": {
    "text": "70% green; the remaining 30% is unspecified",
    "detail": "Aim close to 70% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 70
      }
    ],
    "unspecifiedRemainderPercent": 30
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-red-real-batch-001: error

```json
{
  "query": {
    "text": "20% red; the remaining 80% is unspecified",
    "detail": "Aim close to 20% red across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 80
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-batch-001: error

```json
{
  "query": {
    "text": "Dark",
    "detail": "A wallpaper that feels dark."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-light-batch-001: error

```json
{
  "query": {
    "text": "Light",
    "detail": "A wallpaper that feels light."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-vivid-batch-001: error

```json
{
  "query": {
    "text": "Bright, vivid colors",
    "detail": "A colorful wallpaper with a bright, vivid feel."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-strict-grayscale-batch-001: error

```json
{
  "query": {
    "text": "Grayscale",
    "detail": "Specifically black, white and gray; colored tints are not the goal."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-near-neutral-batch-001: error

```json
{
  "query": {
    "text": "Almost grayscale",
    "detail": "Very little color overall; a subtle warm or cool tint is fine."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-monochromatic-batch-001: error

```json
{
  "query": {
    "text": "One hue overall",
    "detail": "A monochromatic feel: shades of one color. It does not have to be gray."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-batch-001: error

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-001: error

```json
{
  "query": {
    "text": "80% grayscale, 20% red",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-002: error

```json
{
  "query": {
    "text": "80% grayscale, 10% red; the remaining 10% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 10% can be any color.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 10
      }
    ],
    "unspecifiedRemainderPercent": 10
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-accents-batch-001: error

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-001: error

```json
{
  "query": {
    "text": "50% blue, 50% orange",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 50
      },
      {
        "colorName": "orange",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-002: error

```json
{
  "query": {
    "text": "40% blue, 40% orange; the remaining 20% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 40
      },
      {
        "colorName": "orange",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-warm-red-batch-001: error

```json
{
  "query": {
    "text": "Close to #FF2200",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#FF2200"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-muted-green-batch-001: error

```json
{
  "query": {
    "text": "Close to #4C8C72",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#4C8C72"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### palette-rainbow-batch-001: error

```json
{
  "query": {
    "text": "Rainbow-like colors",
    "detail": "Bright colors across many hues. It does not need to contain a literal rainbow."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

## favorite-utility-numeric-docvalues: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 0/14 | n/a | n/a | 0.0% | 0.0% | 0 |
| Perceived color | 0/6 | n/a | n/a | 0.0% | 0.0% | 0 |
| Vibe | 0/9 | n/a | n/a | 0.0% | 0.0% | 0 |
| Precision | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Semantic filtering | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |
| Proportions | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Palette | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |

## favorite-utility-numeric-docvalues: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| vibe-grayscale-001 | grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/12 | wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061 | 0 | n/a | 0.0% | n/a |
| vibe-dark-001 | dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-001 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/5 | precision-shade-001-a, precision-shade-001-b, precision-shade-001-c, precision-shade-001-d | 0 | n/a | 0.0% | n/a |
| semantic-red-city-001 | A city wallpaper with a red feel | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | wallpaper-022, wallpaper-027, wallpaper-029 | 0 | n/a | 0.0% | n/a |
| proportion-green-001 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f | 0 | n/a | 0.0% | n/a |
| proportion-green-002 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b | 0 | n/a | 0.0% | n/a |
| composition-green-red-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips | 0 | n/a | 0.0% | n/a |
| perceived-red-batch-001 | Red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044 | 0 | n/a | 0.0% | n/a |
| perceived-orange-batch-001 | Orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036 | 0 | n/a | 0.0% | n/a |
| perceived-pink-batch-001 | Pink | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039 | 0 | n/a | 0.0% | n/a |
| perceived-green-batch-001 | Green | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| perceived-blue-batch-001 | Blue | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| vibe-dark-batch-001 | Dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079 | 0 | n/a | 0.0% | n/a |
| vibe-light-batch-001 | Light | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088 | 0 | n/a | 0.0% | n/a |
| vibe-vivid-batch-001 | Bright, vivid colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098 | 0 | n/a | 0.0% | n/a |
| vibe-strict-grayscale-batch-001 | Grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007 | 0 | n/a | 0.0% | n/a |
| vibe-near-neutral-batch-001 | Almost grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071 | 0 | n/a | 0.0% | n/a |
| vibe-monochromatic-batch-001 | One hue overall | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-batch-001 | Grayscale with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002 | 0 | n/a | 0.0% | n/a |
| precision-warm-red-batch-001 | Close to #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-082, wallpaper-087, wallpaper-037 | 0 | n/a | 0.0% | n/a |
| precision-muted-green-batch-001 | Close to #4C8C72 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-086, wallpaper-052, wallpaper-093, wallpaper-013 | 0 | n/a | 0.0% | n/a |
| palette-rainbow-batch-001 | Rainbow-like colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004 | 0 | n/a | 0.0% | n/a |

## favorite-utility-numeric-docvalues: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 15930,
  "keys": [
    "id",
    "configuration",
    "metadata",
    "execution",
    "sourceHashes",
    "setup",
    "resources",
    "summary"
  ]
}
```

### composition-001: error

```json
{
  "query": "80% grayscale 20% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-002: error

```json
{
  "query": "80% grayscale 10% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-001: error

```json
{
  "query": {
    "userText": "red",
    "intent": "A wallpaper whose overall color appearance feels red.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-grayscale-001: error

```json
{
  "query": {
    "userText": "grayscale",
    "intent": "An overall neutral gray, black, and white appearance. This request is distinct from merely having low color or a predominantly single colored hue. Whether a faint tint remains acceptable is for human judgment.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-001: error

```json
{
  "query": {
    "userText": "dark",
    "intent": "A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 8326,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### combination-gray-red-002: error

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-shade-001: error

```json
{
  "query": {
    "userText": "Color picker: #FF2200",
    "intent": "Prefer colors as close as possible to the selected shade. A picked color signals that shade closeness matters to the user; nearby colors remain candidates instead of requiring exact equality.",
    "specifiedPercentages": null,
    "preciseHex": "#FF2200",
    "colorSpace": "sRGB",
    "subjectConstraint": null,
    "initialIntent": "Find wallpapers matching the picked shade. How much shade variation remains acceptable and how the visible amount affects overall result preference are for the user to judge.",
    "clarificationSource": "user-response-001"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### semantic-red-city-001: error

```json
{
  "query": {
    "userText": "A city wallpaper with a red feel",
    "intent": "Explore which images belong in results for the combined subject and color request, then preferred ordering among them.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectRequest": "city",
    "subjectFilteringMode": "For the user's interpretation of this case, matching the city tag is required for eligibility. Rank by fit among eligible images. C is conditional on matching that tag.",
    "initialSubjectFilteringMode": "Unresolved. This intent review does not stipulate a hard selected tag or weighted natural-language search."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9354,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### proportion-green-002: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9461,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9700,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-real-001: error

```json
{
  "query": {
    "userText": "50% green, 50% red",
    "intent": "Find images close to both whole-image named-color proportion targets; natural-image validation after the user questioned transfer from pure bands.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 50
      },
      {
        "colorName": "red",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-green-red-real-002: error

```json
{
  "query": {
    "text": "40% green, 40% red; the remaining 20% is unspecified",
    "detail": "Aim close to 40% green and 40% red across the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      },
      {
        "colorName": "red",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-batch-001: error

```json
{
  "query": {
    "text": "Red",
    "detail": "A wallpaper that feels red."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-orange-batch-001: error

```json
{
  "query": {
    "text": "Orange",
    "detail": "A wallpaper that feels orange."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-pink-batch-001: error

```json
{
  "query": {
    "text": "Pink",
    "detail": "A wallpaper that feels pink."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-green-batch-001: error

```json
{
  "query": {
    "text": "Green",
    "detail": "A wallpaper that feels green."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-blue-batch-001: error

```json
{
  "query": {
    "text": "Blue",
    "detail": "A wallpaper that feels blue."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-001: error

```json
{
  "query": {
    "text": "40% green; the remaining 60% is unspecified",
    "detail": "Aim close to 40% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-002: error

```json
{
  "query": {
    "text": "70% green; the remaining 30% is unspecified",
    "detail": "Aim close to 70% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 70
      }
    ],
    "unspecifiedRemainderPercent": 30
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-red-real-batch-001: error

```json
{
  "query": {
    "text": "20% red; the remaining 80% is unspecified",
    "detail": "Aim close to 20% red across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 80
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-batch-001: error

```json
{
  "query": {
    "text": "Dark",
    "detail": "A wallpaper that feels dark."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-light-batch-001: error

```json
{
  "query": {
    "text": "Light",
    "detail": "A wallpaper that feels light."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-vivid-batch-001: error

```json
{
  "query": {
    "text": "Bright, vivid colors",
    "detail": "A colorful wallpaper with a bright, vivid feel."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-strict-grayscale-batch-001: error

```json
{
  "query": {
    "text": "Grayscale",
    "detail": "Specifically black, white and gray; colored tints are not the goal."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-near-neutral-batch-001: error

```json
{
  "query": {
    "text": "Almost grayscale",
    "detail": "Very little color overall; a subtle warm or cool tint is fine."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-monochromatic-batch-001: error

```json
{
  "query": {
    "text": "One hue overall",
    "detail": "A monochromatic feel: shades of one color. It does not have to be gray."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-batch-001: error

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-001: error

```json
{
  "query": {
    "text": "80% grayscale, 20% red",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-002: error

```json
{
  "query": {
    "text": "80% grayscale, 10% red; the remaining 10% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 10% can be any color.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 10
      }
    ],
    "unspecifiedRemainderPercent": 10
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-accents-batch-001: error

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-001: error

```json
{
  "query": {
    "text": "50% blue, 50% orange",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 50
      },
      {
        "colorName": "orange",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-002: error

```json
{
  "query": {
    "text": "40% blue, 40% orange; the remaining 20% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 40
      },
      {
        "colorName": "orange",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-warm-red-batch-001: error

```json
{
  "query": {
    "text": "Close to #FF2200",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#FF2200"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-muted-green-batch-001: error

```json
{
  "query": {
    "text": "Close to #4C8C72",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#4C8C72"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### palette-rainbow-batch-001: error

```json
{
  "query": {
    "text": "Rainbow-like colors",
    "detail": "Bright colors across many hues. It does not need to contain a literal rainbow."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-docvalue-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

## favorite-utility-bounded-pooled-delete: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 0/14 | n/a | n/a | 0.0% | 0.0% | 0 |
| Perceived color | 0/6 | n/a | n/a | 0.0% | 0.0% | 0 |
| Vibe | 0/9 | n/a | n/a | 0.0% | 0.0% | 0 |
| Precision | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Semantic filtering | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |
| Proportions | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Palette | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |

## favorite-utility-bounded-pooled-delete: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| vibe-grayscale-001 | grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/12 | wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061 | 0 | n/a | 0.0% | n/a |
| vibe-dark-001 | dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-001 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/5 | precision-shade-001-a, precision-shade-001-b, precision-shade-001-c, precision-shade-001-d | 0 | n/a | 0.0% | n/a |
| semantic-red-city-001 | A city wallpaper with a red feel | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | wallpaper-022, wallpaper-027, wallpaper-029 | 0 | n/a | 0.0% | n/a |
| proportion-green-001 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f | 0 | n/a | 0.0% | n/a |
| proportion-green-002 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b | 0 | n/a | 0.0% | n/a |
| composition-green-red-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips | 0 | n/a | 0.0% | n/a |
| perceived-red-batch-001 | Red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044 | 0 | n/a | 0.0% | n/a |
| perceived-orange-batch-001 | Orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036 | 0 | n/a | 0.0% | n/a |
| perceived-pink-batch-001 | Pink | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039 | 0 | n/a | 0.0% | n/a |
| perceived-green-batch-001 | Green | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| perceived-blue-batch-001 | Blue | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| vibe-dark-batch-001 | Dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079 | 0 | n/a | 0.0% | n/a |
| vibe-light-batch-001 | Light | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088 | 0 | n/a | 0.0% | n/a |
| vibe-vivid-batch-001 | Bright, vivid colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098 | 0 | n/a | 0.0% | n/a |
| vibe-strict-grayscale-batch-001 | Grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007 | 0 | n/a | 0.0% | n/a |
| vibe-near-neutral-batch-001 | Almost grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071 | 0 | n/a | 0.0% | n/a |
| vibe-monochromatic-batch-001 | One hue overall | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-batch-001 | Grayscale with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002 | 0 | n/a | 0.0% | n/a |
| precision-warm-red-batch-001 | Close to #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-082, wallpaper-087, wallpaper-037 | 0 | n/a | 0.0% | n/a |
| precision-muted-green-batch-001 | Close to #4C8C72 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-086, wallpaper-052, wallpaper-093, wallpaper-013 | 0 | n/a | 0.0% | n/a |
| palette-rainbow-batch-001 | Rainbow-like colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004 | 0 | n/a | 0.0% | n/a |

## favorite-utility-bounded-pooled-delete: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 15938,
  "keys": [
    "id",
    "configuration",
    "metadata",
    "execution",
    "sourceHashes",
    "setup",
    "resources",
    "summary"
  ]
}
```

### composition-001: error

```json
{
  "query": "80% grayscale 20% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-002: error

```json
{
  "query": "80% grayscale 10% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-001: error

```json
{
  "query": {
    "userText": "red",
    "intent": "A wallpaper whose overall color appearance feels red.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-grayscale-001: error

```json
{
  "query": {
    "userText": "grayscale",
    "intent": "An overall neutral gray, black, and white appearance. This request is distinct from merely having low color or a predominantly single colored hue. Whether a faint tint remains acceptable is for human judgment.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-001: error

```json
{
  "query": {
    "userText": "dark",
    "intent": "A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 8324,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### combination-gray-red-002: error

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-shade-001: error

```json
{
  "query": {
    "userText": "Color picker: #FF2200",
    "intent": "Prefer colors as close as possible to the selected shade. A picked color signals that shade closeness matters to the user; nearby colors remain candidates instead of requiring exact equality.",
    "specifiedPercentages": null,
    "preciseHex": "#FF2200",
    "colorSpace": "sRGB",
    "subjectConstraint": null,
    "initialIntent": "Find wallpapers matching the picked shade. How much shade variation remains acceptable and how the visible amount affects overall result preference are for the user to judge.",
    "clarificationSource": "user-response-001"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### semantic-red-city-001: error

```json
{
  "query": {
    "userText": "A city wallpaper with a red feel",
    "intent": "Explore which images belong in results for the combined subject and color request, then preferred ordering among them.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectRequest": "city",
    "subjectFilteringMode": "For the user's interpretation of this case, matching the city tag is required for eligibility. Rank by fit among eligible images. C is conditional on matching that tag.",
    "initialSubjectFilteringMode": "Unresolved. This intent review does not stipulate a hard selected tag or weighted natural-language search."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9352,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### proportion-green-002: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9459,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9698,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-real-001: error

```json
{
  "query": {
    "userText": "50% green, 50% red",
    "intent": "Find images close to both whole-image named-color proportion targets; natural-image validation after the user questioned transfer from pure bands.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 50
      },
      {
        "colorName": "red",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-green-red-real-002: error

```json
{
  "query": {
    "text": "40% green, 40% red; the remaining 20% is unspecified",
    "detail": "Aim close to 40% green and 40% red across the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      },
      {
        "colorName": "red",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-batch-001: error

```json
{
  "query": {
    "text": "Red",
    "detail": "A wallpaper that feels red."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-orange-batch-001: error

```json
{
  "query": {
    "text": "Orange",
    "detail": "A wallpaper that feels orange."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-pink-batch-001: error

```json
{
  "query": {
    "text": "Pink",
    "detail": "A wallpaper that feels pink."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-green-batch-001: error

```json
{
  "query": {
    "text": "Green",
    "detail": "A wallpaper that feels green."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-blue-batch-001: error

```json
{
  "query": {
    "text": "Blue",
    "detail": "A wallpaper that feels blue."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-001: error

```json
{
  "query": {
    "text": "40% green; the remaining 60% is unspecified",
    "detail": "Aim close to 40% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-002: error

```json
{
  "query": {
    "text": "70% green; the remaining 30% is unspecified",
    "detail": "Aim close to 70% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 70
      }
    ],
    "unspecifiedRemainderPercent": 30
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-red-real-batch-001: error

```json
{
  "query": {
    "text": "20% red; the remaining 80% is unspecified",
    "detail": "Aim close to 20% red across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 80
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-batch-001: error

```json
{
  "query": {
    "text": "Dark",
    "detail": "A wallpaper that feels dark."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-light-batch-001: error

```json
{
  "query": {
    "text": "Light",
    "detail": "A wallpaper that feels light."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-vivid-batch-001: error

```json
{
  "query": {
    "text": "Bright, vivid colors",
    "detail": "A colorful wallpaper with a bright, vivid feel."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-strict-grayscale-batch-001: error

```json
{
  "query": {
    "text": "Grayscale",
    "detail": "Specifically black, white and gray; colored tints are not the goal."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-near-neutral-batch-001: error

```json
{
  "query": {
    "text": "Almost grayscale",
    "detail": "Very little color overall; a subtle warm or cool tint is fine."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-monochromatic-batch-001: error

```json
{
  "query": {
    "text": "One hue overall",
    "detail": "A monochromatic feel: shades of one color. It does not have to be gray."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-batch-001: error

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-001: error

```json
{
  "query": {
    "text": "80% grayscale, 20% red",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-002: error

```json
{
  "query": {
    "text": "80% grayscale, 10% red; the remaining 10% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 10% can be any color.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 10
      }
    ],
    "unspecifiedRemainderPercent": 10
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-accents-batch-001: error

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-001: error

```json
{
  "query": {
    "text": "50% blue, 50% orange",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 50
      },
      {
        "colorName": "orange",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-002: error

```json
{
  "query": {
    "text": "40% blue, 40% orange; the remaining 20% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 40
      },
      {
        "colorName": "orange",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-warm-red-batch-001: error

```json
{
  "query": {
    "text": "Close to #FF2200",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#FF2200"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-muted-green-batch-001: error

```json
{
  "query": {
    "text": "Close to #4C8C72",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#4C8C72"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### palette-rainbow-batch-001: error

```json
{
  "query": {
    "text": "Rainbow-like colors",
    "detail": "Bright colors across many hues. It does not need to contain a literal rainbow."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

## favorite-utility-maxima-bounded-pooled-delete: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 0/14 | n/a | n/a | 0.0% | 0.0% | 0 |
| Perceived color | 0/6 | n/a | n/a | 0.0% | 0.0% | 0 |
| Vibe | 0/9 | n/a | n/a | 0.0% | 0.0% | 0 |
| Precision | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Semantic filtering | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |
| Proportions | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Palette | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |

## favorite-utility-maxima-bounded-pooled-delete: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| vibe-grayscale-001 | grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/12 | wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061 | 0 | n/a | 0.0% | n/a |
| vibe-dark-001 | dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-001 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/5 | precision-shade-001-a, precision-shade-001-b, precision-shade-001-c, precision-shade-001-d | 0 | n/a | 0.0% | n/a |
| semantic-red-city-001 | A city wallpaper with a red feel | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/3 | wallpaper-022, wallpaper-027, wallpaper-029 | 0 | n/a | 0.0% | n/a |
| proportion-green-001 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f | 0 | n/a | 0.0% | n/a |
| proportion-green-002 | 40% green; the rest doesn’t matter | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b | 0 | n/a | 0.0% | n/a |
| composition-green-red-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/15 | composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-001 | 50% green, 50% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips | 0 | n/a | 0.0% | n/a |
| perceived-red-batch-001 | Red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044 | 0 | n/a | 0.0% | n/a |
| perceived-orange-batch-001 | Orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036 | 0 | n/a | 0.0% | n/a |
| perceived-pink-batch-001 | Pink | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039 | 0 | n/a | 0.0% | n/a |
| perceived-green-batch-001 | Green | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| perceived-blue-batch-001 | Blue | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| vibe-dark-batch-001 | Dark | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079 | 0 | n/a | 0.0% | n/a |
| vibe-light-batch-001 | Light | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088 | 0 | n/a | 0.0% | n/a |
| vibe-vivid-batch-001 | Bright, vivid colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098 | 0 | n/a | 0.0% | n/a |
| vibe-strict-grayscale-batch-001 | Grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007 | 0 | n/a | 0.0% | n/a |
| vibe-near-neutral-batch-001 | Almost grayscale | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071 | 0 | n/a | 0.0% | n/a |
| vibe-monochromatic-batch-001 | One hue overall | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-batch-001 | Grayscale with red accents | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002 | 0 | n/a | 0.0% | n/a |
| precision-warm-red-batch-001 | Close to #FF2200 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-046, wallpaper-082, wallpaper-087, wallpaper-037 | 0 | n/a | 0.0% | n/a |
| precision-muted-green-batch-001 | Close to #4C8C72 | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-086, wallpaper-052, wallpaper-093, wallpaper-013 | 0 | n/a | 0.0% | n/a |
| palette-rainbow-batch-001 | Rainbow-like colors | error: Setup: Cannot find module &#39;/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs&#39; imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs | n/a | n/a | 0/6 | wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004 | 0 | n/a | 0.0% | n/a |

## favorite-utility-maxima-bounded-pooled-delete: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 15959,
  "keys": [
    "id",
    "configuration",
    "metadata",
    "execution",
    "sourceHashes",
    "setup",
    "resources",
    "summary"
  ]
}
```

### composition-001: error

```json
{
  "query": "80% grayscale 20% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 1,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-001/A",
        "composition-001/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-001/A",
        "other": "composition-001/B",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-002: error

```json
{
  "query": "80% grayscale 10% red",
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-64f8a5227722",
    "status": "unscored",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 0,
      "coverage": null,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-002/A",
        "composition-002/B"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-001: error

```json
{
  "query": {
    "userText": "red",
    "intent": "A wallpaper whose overall color appearance feels red.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-027",
        "wallpaper-077",
        "wallpaper-060",
        "wallpaper-082",
        "wallpaper-037",
        "wallpaper-048"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-027",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-077",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-grayscale-001: error

```json
{
  "query": {
    "userText": "grayscale",
    "intent": "An overall neutral gray, black, and white appearance. This request is distinct from merely having low color or a predominantly single colored hue. Whether a faint tint remains acceptable is for human judgment.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-grayscale-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 12,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-092",
        "wallpaper-066",
        "wallpaper-096",
        "wallpaper-070",
        "wallpaper-007",
        "wallpaper-061"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-066",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-061",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-092",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-092",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-001: error

```json
{
  "query": {
    "userText": "dark",
    "intent": "A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 15,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-054",
        "wallpaper-022",
        "wallpaper-010",
        "wallpaper-067",
        "wallpaper-091",
        "wallpaper-068"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-068",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-054",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-054",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 8324,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### combination-gray-red-002: error

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-telephone",
        "wallpaper-048",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "evaluation-gray-red-002-umbrella",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-shade-001: error

```json
{
  "query": {
    "userText": "Color picker: #FF2200",
    "intent": "Prefer colors as close as possible to the selected shade. A picked color signals that shade closeness matters to the user; nearby colors remain candidates instead of requiring exact equality.",
    "specifiedPercentages": null,
    "preciseHex": "#FF2200",
    "colorSpace": "sRGB",
    "subjectConstraint": null,
    "initialIntent": "Find wallpapers matching the picked shade. How much shade variation remains acceptable and how the visible amount affects overall result preference are for the user to judge.",
    "clarificationSource": "user-response-001"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [],
      "missingIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-b",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-d",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### semantic-red-city-001: error

```json
{
  "query": {
    "userText": "A city wallpaper with a red feel",
    "intent": "Explore which images belong in results for the combined subject and color request, then preferred ordering among them.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectRequest": "city",
    "subjectFilteringMode": "For the user's interpretation of this case, matching the city tag is required for eligibility. Rank by fit among eligible images. C is conditional on matching that tag.",
    "initialSubjectFilteringMode": "Unresolved. This intent review does not stipulate a hard selected tag or weighted natural-language search."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "semantic-red-city-001",
    "category": "Semantic filtering",
    "categories": [
      "Semantic filtering",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 3,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-022",
        "wallpaper-027",
        "wallpaper-029"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-029",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-027",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9352,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### proportion-green-002: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9459,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-001: error

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 9698,
  "keys": [
    "query",
    "status",
    "reason",
    "rankingCondition",
    "orderGroups",
    "notes",
    "evidenceContext",
    "searchEvidence",
    "accuracy",
    "timedAccuracy",
    "hits",
    "performance"
  ]
}
```

### composition-green-red-real-001: error

```json
{
  "query": {
    "userText": "50% green, 50% red",
    "intent": "Find images close to both whole-image named-color proportion targets; natural-image validation after the user questioned transfer from pure bands.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 50
      },
      {
        "colorName": "red",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-tulips",
        "evaluation-green-red-leaves",
        "evaluation-green-red-tulip-field",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-leaves",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-green-red-real-002: error

```json
{
  "query": {
    "text": "40% green, 40% red; the remaining 20% is unspecified",
    "detail": "Aim close to 40% green and 40% red across the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      },
      {
        "colorName": "red",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-real-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-green-red-leaves",
        "wallpaper-082",
        "evaluation-green-red-tulip-field",
        "evaluation-green-red-tulips"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-leaves",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulips",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-green-red-tulips",
        "other": "evaluation-green-red-tulip-field",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-red-batch-001: error

```json
{
  "query": {
    "text": "Red",
    "detail": "A wallpaper that feels red."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-red-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-084",
        "wallpaper-095",
        "wallpaper-037",
        "wallpaper-044"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-095",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-044",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-orange-batch-001: error

```json
{
  "query": {
    "text": "Orange",
    "detail": "A wallpaper that feels orange."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-orange-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-031",
        "wallpaper-087",
        "wallpaper-036"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-031",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-036",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-046",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-036",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-pink-batch-001: error

```json
{
  "query": {
    "text": "Pink",
    "detail": "A wallpaper that feels pink."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-pink-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-033",
        "wallpaper-044",
        "wallpaper-048",
        "wallpaper-039"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-039",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-044",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-033",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-039",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-033",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-green-batch-001: error

```json
{
  "query": {
    "text": "Green",
    "detail": "A wallpaper that feels green."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-green-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-083",
        "wallpaper-093",
        "wallpaper-050",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-093",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### perceived-blue-batch-001: error

```json
{
  "query": {
    "text": "Blue",
    "detail": "A wallpaper that feels blue."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "perceived-blue-batch-001",
    "category": "Perceived color",
    "categories": [
      "Perceived color"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-091",
        "wallpaper-010",
        "wallpaper-030",
        "wallpaper-047"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-030",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-047",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-030",
        "other": "wallpaper-010",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-047",
        "other": "wallpaper-010",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-001: error

```json
{
  "query": {
    "text": "40% green; the remaining 60% is unspecified",
    "detail": "Aim close to 40% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-093",
        "wallpaper-083",
        "wallpaper-081",
        "wallpaper-050"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-081",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-083",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-081",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-083",
        "other": "wallpaper-050",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-green-real-batch-002: error

```json
{
  "query": {
    "text": "70% green; the remaining 30% is unspecified",
    "detail": "Aim close to 70% green across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "green",
        "targetImagePercent": 70
      }
    ],
    "unspecifiedRemainderPercent": 30
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-real-batch-002",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-090",
        "wallpaper-050",
        "wallpaper-012",
        "wallpaper-086"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-050",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-086",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-012",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-050",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-012",
        "other": "wallpaper-090",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### proportion-red-real-batch-001: error

```json
{
  "query": {
    "text": "20% red; the remaining 80% is unspecified",
    "detail": "Aim close to 20% red across the whole image. The rest can be any color.",
    "colorTargets": [
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 80
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-red-real-batch-001",
    "category": "Proportions",
    "categories": [
      "Proportions"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-060",
        "wallpaper-029",
        "wallpaper-084",
        "wallpaper-082"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-084",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-084",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-batch-001: error

```json
{
  "query": {
    "text": "Dark",
    "detail": "A wallpaper that feels dark."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-067",
        "wallpaper-011",
        "wallpaper-075",
        "wallpaper-079"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-011",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-067",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-079",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-011",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-079",
        "other": "wallpaper-075",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-light-batch-001: error

```json
{
  "query": {
    "text": "Light",
    "detail": "A wallpaper that feels light."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-light-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-073",
        "wallpaper-051",
        "wallpaper-096",
        "wallpaper-088"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-051",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-088",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-073",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-051",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-073",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-vivid-batch-001: error

```json
{
  "query": {
    "text": "Bright, vivid colors",
    "detail": "A colorful wallpaper with a bright, vivid feel."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-vivid-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-032",
        "wallpaper-094",
        "wallpaper-052",
        "wallpaper-098"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-052",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-098",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-strict-grayscale-batch-001: error

```json
{
  "query": {
    "text": "Grayscale",
    "detail": "Specifically black, white and gray; colored tints are not the goal."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-strict-grayscale-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-071",
        "wallpaper-068",
        "wallpaper-070",
        "wallpaper-007"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-070",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-068",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-070",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-007",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-near-neutral-batch-001: error

```json
{
  "query": {
    "text": "Almost grayscale",
    "detail": "Very little color overall; a subtle warm or cool tint is fine."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-near-neutral-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-062",
        "wallpaper-096",
        "wallpaper-007",
        "wallpaper-071"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-071",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-007",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-062",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-071",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-062",
        "other": "wallpaper-096",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-monochromatic-batch-001: error

```json
{
  "query": {
    "text": "One hue overall",
    "detail": "A monochromatic feel: shades of one color. It does not have to be gray."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-monochromatic-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-008",
        "wallpaper-091",
        "wallpaper-009",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-091",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-009",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-008",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-091",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-008",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### combination-gray-red-batch-001: error

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-095",
        "wallpaper-060",
        "evaluation-gray-red-002-telephone",
        "wallpaper-063"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-telephone",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-063",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-063",
        "other": "wallpaper-095",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-001: error

```json
{
  "query": {
    "text": "80% grayscale, 20% red",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 20
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "returnedIds": [],
      "missingIds": [
        "evaluation-gray-red-002-umbrella",
        "wallpaper-042",
        "wallpaper-048",
        "wallpaper-060"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-gray-red-batch-002: error

```json
{
  "query": {
    "text": "80% grayscale, 10% red; the remaining 10% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 10% can be any color.",
    "colorTargets": [
      {
        "colorName": "grayscale",
        "targetImagePercent": 80
      },
      {
        "colorName": "red",
        "targetImagePercent": 10
      }
    ],
    "unspecifiedRemainderPercent": 10
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-gray-red-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-048",
        "wallpaper-042",
        "wallpaper-060",
        "evaluation-gray-red-002-umbrella"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "evaluation-gray-red-002-umbrella",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-048",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### vibe-dark-accents-batch-001: error

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "vibe-dark-accents-batch-001",
    "category": "Vibe",
    "categories": [
      "Vibe"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-005",
        "wallpaper-032",
        "wallpaper-022",
        "wallpaper-015"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-022",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-005",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-032",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-022",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-032",
        "other": "wallpaper-015",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-001: error

```json
{
  "query": {
    "text": "50% blue, 50% orange",
    "detail": "Aim close to these shares of the whole image.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 50
      },
      {
        "colorName": "orange",
        "targetImagePercent": 50
      }
    ],
    "unspecifiedRemainderPercent": 0
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-057",
        "wallpaper-002",
        "wallpaper-058",
        "wallpaper-040"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### composition-blue-orange-batch-002: error

```json
{
  "query": {
    "text": "40% blue, 40% orange; the remaining 20% is unspecified",
    "detail": "Aim close to these shares of the whole image. The remaining 20% can be any color.",
    "colorTargets": [
      {
        "colorName": "blue",
        "targetImagePercent": 40
      },
      {
        "colorName": "orange",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 20
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-blue-orange-batch-002",
    "category": "Combinations",
    "categories": [
      "Combinations"
    ],
    "groupId": "source-group-3a681d02449c",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-040",
        "wallpaper-058",
        "wallpaper-057",
        "wallpaper-002"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-040",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-058",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-002",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-040",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-002",
        "other": "wallpaper-057",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-warm-red-batch-001: error

```json
{
  "query": {
    "text": "Close to #FF2200",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#FF2200"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-082",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-037",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-087",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-082",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-087",
        "other": "wallpaper-046",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### precision-muted-green-batch-001: error

```json
{
  "query": {
    "text": "Close to #4C8C72",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#4C8C72"
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-013",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-052",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-093",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-013",
        "other": "wallpaper-086",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

### palette-rainbow-batch-001: error

```json
{
  "query": {
    "text": "Rainbow-like colors",
    "detail": "Bright colors across many hues. It does not need to contain a literal rainbow."
  },
  "status": "error",
  "reason": "Setup: Cannot find module '/home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/exploration/configs/favorite-pooled-adapter.mjs' imported from /home/rafaeltab/.t3/worktrees/wallpaperdb/t3code-28be15f7/experiments/color-search-benchmark/evaluation/loop/runner.mjs",
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "palette-rainbow-batch-001",
    "category": "Palette",
    "categories": [
      "Palette"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 6,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": null,
      "assessedPairs": 0,
      "totalPairs": 5,
      "coverage": 0,
      "concordant": 0,
      "discordant": 0,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-094",
        "wallpaper-034",
        "wallpaper-003",
        "wallpaper-004"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-003",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-094",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-034",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-003",
        "other": "wallpaper-004",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-034",
        "other": "wallpaper-004",
        "uncertain": true,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "hits": [],
  "performance": {
    "samplesMs": [],
    "sampleCount": 0,
    "p50Ms": null,
    "p95Ms": null,
    "maxMs": null,
    "failures": 0
  }
}
```

