# Color evaluation: 2026-09-20T03-13-00.884Z-c2f20177

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
  "id": "2026-09-20T03-13-00.884Z-c2f20177",
  "createdAt": "2026-09-20T03:13:00.889Z",
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
    "corpusHash": "ebb1a5d73662ba011ad04ddbc65335866d13a218e0475237df7399743f185c7b",
    "corpusSize": 545,
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
    "repeats": 10,
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
| Native indexed picked-color grid | No approximation statement supplied | Only one picked color with default radius0.12, edge quality0.5 and5% minimum support; proportions and explicit range controls are unsupported. Trilinear interpolation and integer utility quantization approximate the continuous palette objective. Global retrieval remains exact for that indexed formula. Palette32 is already a lossy summary of the image. Hard support boundaries can increase interpolation error. No model is trained; utilities are calculated deterministically from the stored palette. Development judgments are from one observer; new ZIP wallpapers are unjudged. |

## Per-query semantic warnings

| Candidate | Case | Warnings |
| --- | --- | --- |


No observations available.

## Large-window ranking diagnostic

These accuracy calls use a separate result limit (1000). They help inspect the scoring formula and coverage. Do not pair this agreement with latency measured at the timed result limit (20), especially for approximate retrieval.

| Candidate | Execution | OK / total | Unsupported | Errors | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Native indexed picked-color grid | opensearch | 3/37 | 34 | 0 | 87.8% | 93.3% | 6.4% | 7.7% | 0 |

## Timed-search accuracy (first measured sample)

This quality view uses the first successful measured search per case at the same result limit (20) as the performance samples. It is not an average across repeated searches; approximate or nondeterministic methods may vary. Repeated raw trial results remain in diagnostics. Missing judged images are unassessed, so agreement must be read alongside pair and image coverage.

| Candidate | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Native indexed picked-color grid | 1/37 | 80.0% | 80.0% | 1.9% | 3.8% | 0 |

## Measured performance

Setup is measured separately. Latency percentiles pool measured query samples in this workload; inspect case details for slow queries. Warmup, cache control, repetitions and execution metadata are recorded above and below. Small sample counts do not establish stable tail latency.

| Candidate | Execution | Samples | p50 | p95 | Maximum | Failures | Setup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native indexed picked-color grid | opensearch | 30 | 1.53 ms | 2.30 ms | 2.76 ms | 0 | 51.68 ms |

## Resource observations

Harness CPU covers the measured block, including warmups. Memory values are process snapshots, not isolated candidate peaks; retained allocations from earlier candidates can affect them. Backend resources and index storage remain n/a when unmeasured. Scope and raw values are preserved in diagnostics.

| Candidate | Harness CPU | RSS before | RSS after | Heap used after | Backend CPU | Backend memory | Index store |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native indexed picked-color grid | 49.21 ms | 97.49 MiB | 89.63 MiB | 17.76 MiB | n/a | n/a | n/a |

## Native indexed picked-color grid: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 0/14 | n/a | n/a | 0.0% | 0.0% | 0 |
| Perceived color | 0/6 | n/a | n/a | 0.0% | 0.0% | 0 |
| Vibe | 0/9 | n/a | n/a | 0.0% | 0.0% | 0 |
| Precision | 3/3 | 87.8% | 93.3% | 100.0% | 100.0% | 0 |
| Semantic filtering | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |
| Proportions | 0/3 | n/a | n/a | 0.0% | 0.0% | 0 |
| Palette | 0/1 | n/a | n/a | 0.0% | 0.0% | 0 |

## Native indexed picked-color grid: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| vibe-grayscale-001 | grayscale | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/12 | wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061 | 0 | n/a | 0.0% | n/a |
| vibe-dark-001 | dark | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-001 | mostly grayscale, with red accents | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | ok | 80.0% | 80.0% | 5/5 | — | 0 | 80.0% | 100.0% | 2.76 ms |
| semantic-red-city-001 | A city wallpaper with a red feel (Condition: Assuming C matches the city tag.) | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/3 | wallpaper-022, wallpaper-027, wallpaper-029 | 0 | n/a | 0.0% | n/a |
| proportion-green-001 | 40% green; the rest doesn’t matter | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f | 0 | n/a | 0.0% | n/a |
| proportion-green-002 | 40% green; the rest doesn’t matter | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b | 0 | n/a | 0.0% | n/a |
| composition-green-red-001 | 50% green, 50% red | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/15 | composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-001 | 50% green, 50% red | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips | 0 | n/a | 0.0% | n/a |
| perceived-red-batch-001 | Red | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044 | 0 | n/a | 0.0% | n/a |
| perceived-orange-batch-001 | Orange | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036 | 0 | n/a | 0.0% | n/a |
| perceived-pink-batch-001 | Pink | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039 | 0 | n/a | 0.0% | n/a |
| perceived-green-batch-001 | Green | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| perceived-blue-batch-001 | Blue | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050 | 0 | n/a | 0.0% | n/a |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086 | 0 | n/a | 0.0% | n/a |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082 | 0 | n/a | 0.0% | n/a |
| vibe-dark-batch-001 | Dark | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079 | 0 | n/a | 0.0% | n/a |
| vibe-light-batch-001 | Light | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088 | 0 | n/a | 0.0% | n/a |
| vibe-vivid-batch-001 | Bright, vivid colors | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098 | 0 | n/a | 0.0% | n/a |
| vibe-strict-grayscale-batch-001 | Grayscale | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007 | 0 | n/a | 0.0% | n/a |
| vibe-near-neutral-batch-001 | Almost grayscale | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071 | 0 | n/a | 0.0% | n/a |
| vibe-monochromatic-batch-001 | One hue overall | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-batch-001 | Grayscale with red accents | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002 | 0 | n/a | 0.0% | n/a |
| precision-warm-red-batch-001 | Close to #FF2200 | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 2.11 ms |
| precision-muted-green-batch-001 | Close to #4C8C72 | ok | 83.3% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 2.30 ms |
| palette-rainbow-batch-001 | Rainbow-like colors | unsupported: The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported. | n/a | n/a | 0/6 | wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004 | 0 | n/a | 0.0% | n/a |

## Native indexed picked-color grid: visual comparisons

This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.

### perceived-red-001

red

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-048 &gt; wallpaper-060 &gt; wallpaper-077

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-027, wallpaper-077, wallpaper-060, wallpaper-082, wallpaper-037, wallpaper-048

Unjudged retrieved IDs among the first 20 results: —

### vibe-grayscale-001

grayscale

Submitted preference groups: wallpaper-066 = wallpaper-070 = wallpaper-061 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-092, wallpaper-066, wallpaper-096, wallpaper-070, wallpaper-007, wallpaper-061

Unjudged retrieved IDs among the first 20 results: —

### vibe-dark-001

dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-054, wallpaper-022, wallpaper-010, wallpaper-067, wallpaper-091, wallpaper-068

Unjudged retrieved IDs among the first 20 results: —

### combination-gray-red-001

mostly grayscale, with red accents

Submitted preference groups: wallpaper-048 &gt; wallpaper-029 &gt; wallpaper-042 &gt; wallpaper-060 &gt; wallpaper-065 &gt; wallpaper-037

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048

Unjudged retrieved IDs among the first 20 results: —

### combination-gray-red-002

mostly grayscale, with red accents

Submitted preference groups: evaluation-gray-red-002-telephone &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-048

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella

Unjudged retrieved IDs among the first 20 results: —

### precision-shade-001

Color picker: #FF2200

Submitted preference groups: precision-shade-001-b = precision-shade-001-d &gt; precision-shade-001-a &gt; precision-shade-001-c

Method score groups: precision-shade-001-b &gt; precision-shade-001-d &gt; precision-shade-001-c &gt; precision-shade-001-a

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-a, composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-d, composition-green-red-001-c, composition-green-red-001-f, madness-wallhaven-w55xgp, evaluation-green-red-tulips, madness-wallhaven-rqqjrj, madness-wallhaven-e88v9o, wallpaper-037, madness-wallhaven-9mrgk1, madness-wallhaven-xeewg3, madness-wallhaven-j5eqpw, madness-wallhaven-d88evl, madness-wallhaven-lyyv8r

### semantic-red-city-001

A city wallpaper with a red feel (Condition: Assuming C matches the city tag.)

Submitted preference groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-022, wallpaper-027, wallpaper-029

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-001

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-d &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-e

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: proportion-green-001-a, proportion-green-001-b, proportion-green-001-c, proportion-green-001-d, proportion-green-001-e, proportion-green-001-f

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-002

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-a &gt; proportion-green-002-b &gt; proportion-green-002-e

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: proportion-green-002-f, proportion-green-002-a, proportion-green-002-d, proportion-green-002-e, proportion-green-002-c, proportion-green-002-b

Unjudged retrieved IDs among the first 20 results: —

### composition-green-red-001

50% green, 50% red

Submitted preference groups: composition-green-red-001-b &gt; composition-green-red-001-d &gt; composition-green-red-001-e &gt; composition-green-red-001-f &gt; composition-green-red-001-a &gt; composition-green-red-001-c

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-e, composition-green-red-001-f

Unjudged retrieved IDs among the first 20 results: —

### composition-green-red-real-001

50% green, 50% red

Submitted preference groups: wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-leaves &gt; evaluation-green-red-tulip-field

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: evaluation-green-red-tulips, evaluation-green-red-leaves, evaluation-green-red-tulip-field, wallpaper-082

Unjudged retrieved IDs among the first 20 results: —

### composition-green-red-real-002

40% green, 40% red; the remaining 20% is unspecified

Submitted preference groups: evaluation-green-red-leaves &gt; wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: evaluation-green-red-leaves, wallpaper-082, evaluation-green-red-tulip-field, evaluation-green-red-tulips

Unjudged retrieved IDs among the first 20 results: —

### perceived-red-batch-001

Red

Submitted preference groups: wallpaper-037 &gt; wallpaper-095 &gt; wallpaper-084 &gt; wallpaper-044

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-084, wallpaper-095, wallpaper-037, wallpaper-044

Unjudged retrieved IDs among the first 20 results: —

### perceived-orange-batch-001

Orange

Submitted preference groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-036 &gt; wallpaper-087

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-046, wallpaper-031, wallpaper-087, wallpaper-036

Unjudged retrieved IDs among the first 20 results: —

### perceived-pink-batch-001

Pink

Submitted preference groups: wallpaper-044 &gt; wallpaper-039 &gt; wallpaper-033 &gt; wallpaper-048

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-033, wallpaper-044, wallpaper-048, wallpaper-039

Unjudged retrieved IDs among the first 20 results: —

### perceived-green-batch-001

Green

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-083, wallpaper-093, wallpaper-050, wallpaper-086

Unjudged retrieved IDs among the first 20 results: —

### perceived-blue-batch-001

Blue

Submitted preference groups: wallpaper-091 &gt; wallpaper-030 &gt; wallpaper-047 &gt; wallpaper-010

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-091, wallpaper-010, wallpaper-030, wallpaper-047

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-real-batch-001

40% green; the remaining 60% is unspecified

Submitted preference groups: wallpaper-093 &gt; wallpaper-081 &gt; wallpaper-083 &gt; wallpaper-050

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-093, wallpaper-083, wallpaper-081, wallpaper-050

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-real-batch-002

70% green; the remaining 30% is unspecified

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-012 &gt; wallpaper-090

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-090, wallpaper-050, wallpaper-012, wallpaper-086

Unjudged retrieved IDs among the first 20 results: —

### proportion-red-real-batch-001

20% red; the remaining 80% is unspecified

Submitted preference groups: wallpaper-029 &gt; wallpaper-060 &gt; wallpaper-084 &gt; wallpaper-082

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-060, wallpaper-029, wallpaper-084, wallpaper-082

Unjudged retrieved IDs among the first 20 results: —

### vibe-dark-batch-001

Dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-011 &gt; wallpaper-079 &gt; wallpaper-075

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-067, wallpaper-011, wallpaper-075, wallpaper-079

Unjudged retrieved IDs among the first 20 results: —

### vibe-light-batch-001

Light

Submitted preference groups: wallpaper-088 &gt; wallpaper-051 &gt; wallpaper-073 &gt; wallpaper-096

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-073, wallpaper-051, wallpaper-096, wallpaper-088

Unjudged retrieved IDs among the first 20 results: —

### vibe-vivid-batch-001

Bright, vivid colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-032 &gt; wallpaper-052 &gt; wallpaper-098

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-032, wallpaper-094, wallpaper-052, wallpaper-098

Unjudged retrieved IDs among the first 20 results: —

### vibe-strict-grayscale-batch-001

Grayscale

Submitted preference groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-071 &gt; wallpaper-007

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-071, wallpaper-068, wallpaper-070, wallpaper-007

Unjudged retrieved IDs among the first 20 results: —

### vibe-near-neutral-batch-001

Almost grayscale

Submitted preference groups: wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-062 &gt; wallpaper-096

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-062, wallpaper-096, wallpaper-007, wallpaper-071

Unjudged retrieved IDs among the first 20 results: —

### vibe-monochromatic-batch-001

One hue overall

Submitted preference groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-008, wallpaper-091, wallpaper-009, wallpaper-004

Unjudged retrieved IDs among the first 20 results: —

### combination-gray-red-batch-001

Grayscale with red accents

Submitted preference groups: evaluation-gray-red-002-telephone &gt; wallpaper-060 &gt; wallpaper-063 &gt; wallpaper-095

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063

Unjudged retrieved IDs among the first 20 results: —

### composition-gray-red-batch-001

80% grayscale, 20% red

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-048 &gt; wallpaper-042 &gt; wallpaper-060

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: evaluation-gray-red-002-umbrella, wallpaper-042, wallpaper-048, wallpaper-060

Unjudged retrieved IDs among the first 20 results: —

### composition-gray-red-batch-002

80% grayscale, 10% red; the remaining 10% is unspecified

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-042 &gt; wallpaper-048 &gt; wallpaper-060

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-048, wallpaper-042, wallpaper-060, evaluation-gray-red-002-umbrella

Unjudged retrieved IDs among the first 20 results: —

### vibe-dark-accents-batch-001

Mostly dark, with small bright areas

Submitted preference groups: wallpaper-005 &gt; wallpaper-022 &gt; wallpaper-032 &gt; wallpaper-015

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015

Unjudged retrieved IDs among the first 20 results: —

### composition-blue-orange-batch-001

50% blue, 50% orange

Submitted preference groups: wallpaper-058 &gt; wallpaper-002 &gt; wallpaper-040 &gt; wallpaper-057

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-057, wallpaper-002, wallpaper-058, wallpaper-040

Unjudged retrieved IDs among the first 20 results: —

### composition-blue-orange-batch-002

40% blue, 40% orange; the remaining 20% is unspecified

Submitted preference groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-002 &gt; wallpaper-057

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-040, wallpaper-058, wallpaper-057, wallpaper-002

Unjudged retrieved IDs among the first 20 results: —

### precision-warm-red-batch-001

Close to #FF2200

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: precision-shade-001-b, composition-green-red-001-a, composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-d, precision-shade-001-c, precision-shade-001-a, madness-wallhaven-w55xgp, evaluation-green-red-tulips, madness-wallhaven-rqqjrj, madness-wallhaven-e88v9o, madness-wallhaven-9mrgk1, madness-wallhaven-xeewg3, madness-wallhaven-j5eqpw, madness-wallhaven-d88evl, madness-wallhaven-lyyv8r

### precision-muted-green-batch-001

Close to #4C8C72

Submitted preference groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-093 &gt; wallpaper-086

Method score groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-086 &gt; wallpaper-093

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-d, madness-wallhaven-w55mqx, madness-wallhaven-9oozpx, madness-wallhaven-qrrkor, madness-wallhaven-zppjyg, wallpaper-029, madness-wallhaven-k88291, proportion-green-001-b, madness-wallhaven-7jj7ey, madness-wallhaven-rqqwgj, madness-wallhaven-xeejzz, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, wallpaper-083, madness-wallhaven-gwwq27, madness-wallhaven-lyyx7l, madness-wallhaven-xee7dd, wallpaper-050, wallpaper-012

### palette-rainbow-batch-001

Rainbow-like colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-003 &gt; wallpaper-034 &gt; wallpaper-004

Method score groups: No judged images returned

No submitted ordering for: —

Not returned by this method: wallpaper-094, wallpaper-034, wallpaper-003, wallpaper-004

Unjudged retrieved IDs among the first 20 results: —

## Native indexed picked-color grid: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "id": "rank-features-precision-grid",
  "configuration": {
    "id": "rank-features-precision-grid",
    "method": "rank-features-precision-grid",
    "label": "Native indexed picked-color grid",
    "module": "./adapter.mjs",
    "index": "color-exploration-precision-grid-real-v2",
    "parameters": {}
  },
  "metadata": {
    "id": "rank-features-precision-grid",
    "label": "Native indexed picked-color grid",
    "engine": "opensearch",
    "searchKind": "precision-grid",
    "family": "native-precision-grid",
    "representation": "palette32-oklab-grid17-u8",
    "approximate": false,
    "objectiveApproximation": true,
    "limitations": [
      "Only one picked color with default radius0.12, edge quality0.5 and5% minimum support; proportions and explicit range controls are unsupported.",
      "Trilinear interpolation and integer utility quantization approximate the continuous palette objective. Global retrieval remains exact for that indexed formula.",
      "Palette32 is already a lossy summary of the image. Hard support boundaries can increase interpolation error.",
      "No model is trained; utilities are calculated deterministically from the stored palette.",
      "Development judgments are from one observer; new ZIP wallpapers are unjudged."
    ],
    "sourceFiles": [
      "exploration/adapter.mjs",
      "exploration/registry.mjs",
      "exploration/methods.mjs",
      "exploration/methods-fast.mjs",
      "exploration/methods-bounded.mjs",
      "exploration/methods-transport.mjs",
      "exploration/methods-direct-palette.mjs",
      "exploration/methods-palette-bounded.mjs",
      "exploration/methods-precision-typed.mjs",
      "exploration/methods-precision-precomputed.mjs",
      "exploration/precision-precomputed-index.mjs",
      "exploration/methods-native-refined.mjs",
      "exploration/methods-rank-features.mjs",
      "exploration/rank-features-index.mjs",
      "exploration/methods-relative.mjs",
      "exploration/refinement-features.mjs",
      "exploration/query.mjs",
      "exploration/corpus-colors.mjs",
      "exploration/service.mjs",
      "exploration/clickhouse-service.mjs",
      "exploration/methods-clickhouse.mjs",
      "exploration/clickhouse-index.mjs",
      "exploration/clickhouse-scale.mjs",
      "exploration/clickhouse-compose.yml",
      "exploration/methods-precision-grid.mjs",
      "exploration/precision-grid-index.mjs"
    ],
    "execution": {
      "kind": "opensearch",
      "retrieval": "exact-stored-objective"
    }
  },
  "execution": {
    "kind": "opensearch",
    "index": "color-exploration-precision-grid-real-v2",
    "version": "2.11.0",
    "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
    "retrieval": "exact-stored-objective",
    "objectiveApproximation": true,
    "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
  },
  "sourceHashes": {
    "exploration/adapter.mjs": "24575d4a33fa561d028e15683d94b49aa0a31431ef34d75f7a4be6985042391a",
    "exploration/registry.mjs": "4abd95f40371ac3778a92b60ec545a144b7fbe4dccd03b444181fef3f39060d2",
    "exploration/methods.mjs": "c6e45cf4f181be72269cd93a9baa060d89301191068069c8c8afe6c89fbf627e",
    "exploration/methods-fast.mjs": "38272d41ab6c86d8f99a0368ecbe44809a1df2a8774b21f91d3869e39d2321b5",
    "exploration/methods-bounded.mjs": "b4316a61a26c093ebc0441030a698cb6c525f8d0d4bc22a0df2f7170a60d7444",
    "exploration/methods-transport.mjs": "84f7257da0d76aee16d22d0ce6129503378e8f6cf9f3bfdc9b4b5b8e6e0b8879",
    "exploration/methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
    "exploration/methods-palette-bounded.mjs": "aacb39fd6dc4cdc7c8be52f0a5fd60218dafca4167f8b96bb67cf7b5b870a390",
    "exploration/methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
    "exploration/methods-precision-precomputed.mjs": "420c963b4a30b638e45a6d55bef556d05af86d019338b730a6c594025eb2bfa8",
    "exploration/precision-precomputed-index.mjs": "c33b737a6acf3502cca5af5180cc1a71d08820a44ade3f74b45de8a162bd87a4",
    "exploration/methods-native-refined.mjs": "c2e5689b8ae929e662ea94fc28ff7235cc239cf8f25f0aad47c234a61ff22e32",
    "exploration/methods-rank-features.mjs": "949bf542f9169353b6112d703fc021d953335b124b89a4867309b45aff46e3ba",
    "exploration/rank-features-index.mjs": "19c577003c07f8f71a47453b1c7b7dba8ddf04d2c61443fa5c36591c119c3008",
    "exploration/methods-relative.mjs": "95aac8d49339f85660ee9b5a510028648539c46fdac02edcf8cb524fe91e7173",
    "exploration/refinement-features.mjs": "62f629525fc8adff1e1350e4f845ad4384514930888d1e6fb17f8b4979f82627",
    "exploration/query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
    "exploration/corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
    "exploration/service.mjs": "df3a1e84ea30a5b87ef9dc61965184211ce4f8c120e46b7e498123edc0e16793",
    "exploration/clickhouse-service.mjs": "4fcc5d49cabbf7f2f0ffe7273bfee1119ba869e920f70d6ad94af5c4b6763083",
    "exploration/methods-clickhouse.mjs": "ef75425cdfd8d33375dc40f3d010249ca415e8648e1552c18c52e7c1054213ef",
    "exploration/clickhouse-index.mjs": "89e434e4339b97da3e2793fc92936f42980f74b5f0e007b7a575235a8786368e",
    "exploration/clickhouse-scale.mjs": "3fdac6c2bc0e7d40fcbe87094bfd3b1dd1a5776e43fc147cb2dc86b3ae55e7b4",
    "exploration/clickhouse-compose.yml": "7197f0ada93d698718e59c9fcdc3e8068356a88967bd47682c6ce842a0ae0cee",
    "exploration/methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
    "exploration/precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78"
  },
  "setup": {
    "index": "color-exploration-precision-grid-real-v2",
    "count": 545,
    "completeIdsVerified": true,
    "descriptorHash": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
    "definitionHash": "f531402cfe706819a6655897065a78d8778cccadd57e1cdd8a3ae54ebbde6d5d",
    "computationHash": "b917afefbbce344ef7738a34493a18671e05513d23eb9902100c8f8d5b03f244",
    "sourceHashes": {
      "methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0",
      "precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
      "corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
      "query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
      "methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
      "methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e"
    },
    "indexMetadata": {
      "sourceHashes": {
        "precision-grid-index.mjs": "1a321c3315d53f5ae8befea1a22ef61b894ec19994586c4a3d1d2b13b481db78",
        "methods-precision-typed.mjs": "d0fa14848e38619271f58f0214ee94049c881daa5c3c41a56b7843fc3d655feb",
        "corpus-colors.mjs": "2a1648308da0e0cf395146c8d2fd9ffc3d36437c6f764c8bb35c8c00c8e61fad",
        "methods-direct-palette.mjs": "65ca9f670a34f47cb5398756ab9f684bddb1af225d8e50a63c93947f4e94258e",
        "query.mjs": "4fa49dd04c07e255ed097ad99699799c9ec361fc24ff2407e16d6fe02a63c02e",
        "methods-precision-grid.mjs": "e0ca0f9203cadb74b1bcd77153d66a25ea1c5e78e35626a4ec5220a86a5d7af0"
      },
      "experiment": "precision-grid",
      "computationHash": "b917afefbbce344ef7738a34493a18671e05513d23eb9902100c8f8d5b03f244",
      "definition": {
        "indexedObjective": "Each anchor evaluates the exact RGB24 palette objective, then rounds255*score to an integer. Query linearly combines up to8 neighboring anchor utilities.",
        "side": 17,
        "cache": "Original RGB entries can be pinned; other RGB contributions use a bounded FIFO cache.",
        "minimumSupport": 0.05,
        "baseScore": 0.000001,
        "edgeWeight": 0.5,
        "version": 1,
        "encoder": "Sparse per-RGB anchor contribution accumulation over actual RGB24 palette counts; exact anchor objective before u8 rounding.",
        "objective": "qualityMass / max(matchingArea, 0.05), using radius0.12 OKLab and edge quality0.5",
        "anchorCount": 4913,
        "retrieval": "Exact global OpenSearch ranking for the quantized/interpolated indexed formula; the continuous palette objective and image pixels are approximated.",
        "maximum": [
          1,
          0.4,
          0.4
        ],
        "step": [
          0.0625,
          0.05,
          0.05
        ],
        "radius": 0.12,
        "minimum": [
          0,
          -0.4,
          -0.4
        ],
        "quantization": 255
      },
      "definitionHash": "f531402cfe706819a6655897065a78d8778cccadd57e1cdd8a3ae54ebbde6d5d",
      "descriptorHash": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078"
    },
    "definition": {
      "version": 1,
      "side": 17,
      "anchorCount": 4913,
      "minimum": [
        0,
        -0.4,
        -0.4
      ],
      "maximum": [
        1,
        0.4,
        0.4
      ],
      "step": [
        0.0625,
        0.05,
        0.05
      ],
      "radius": 0.12,
      "edgeWeight": 0.5,
      "minimumSupport": 0.05,
      "quantization": 255,
      "baseScore": 0.000001,
      "objective": "qualityMass / max(matchingArea, 0.05), using radius0.12 OKLab and edge quality0.5",
      "indexedObjective": "Each anchor evaluates the exact RGB24 palette objective, then rounds255*score to an integer. Query linearly combines up to8 neighboring anchor utilities.",
      "retrieval": "Exact global OpenSearch ranking for the quantized/interpolated indexed formula; the continuous palette objective and image pixels are approximated.",
      "encoder": "Sparse per-RGB anchor contribution accumulation over actual RGB24 palette counts; exact anchor objective before u8 rounding.",
      "cache": "Original RGB entries can be pinned; other RGB contributions use a bounded FIFO cache."
    },
    "descriptorHashes": {
      "features": "4043dd61b2bdf950c53bba0b5df1016077e8b46bf9a6e5e947468f659072a078",
      "gridDefinition": "f531402cfe706819a6655897065a78d8778cccadd57e1cdd8a3ae54ebbde6d5d",
      "gridComputation": "b917afefbbce344ef7738a34493a18671e05513d23eb9902100c8f8d5b03f244"
    },
    "execution": {
      "kind": "opensearch",
      "index": "color-exploration-precision-grid-real-v2",
      "version": "2.11.0",
      "topology": "single node; one shard; 2 GiB heap; 4 GiB container limit",
      "retrieval": "exact-stored-objective",
      "objectiveApproximation": true,
      "boundary": "query compilation + HTTP + OpenSearch filtering/ranking + response decoding"
    },
    "elapsedMs": 51.681151
  },
  "resources": {
    "serviceCpuMs": 49.206,
    "measurementBlockMs": 60.629086,
    "memoryBefore": {
      "rss": 102227968,
      "heapTotal": 20029440,
      "heapUsed": 13767960,
      "external": 15410175,
      "arrayBuffers": 11896663
    },
    "memoryAfter": {
      "rss": 93986816,
      "heapTotal": 30777344,
      "heapUsed": 18620656,
      "external": 15784872,
      "arrayBuffers": 12271320
    },
    "scope": "Current harness process, warmups and measured searches; process memory snapshots, not isolated candidate peak",
    "openSearchCpu": null,
    "openSearchMemory": null
  },
  "summary": {
    "accuracy": {
      "totalCases": 37,
      "statusCounts": {
        "unsupported": 34,
        "complete": 3
      },
      "allPairs": {
        "queryMacroAgreement": 0.8777777777777778,
        "completeCaseMacroAgreement": 0.8777777777777778,
        "assessedCases": 3,
        "completeCases": 3,
        "totalCases": 37,
        "assessedPairs": 17,
        "totalPairs": 264,
        "pairCoverage": 0.06439393939393939
      },
      "withoutUncertain": {
        "queryMacroAgreement": 0.9333333333333332,
        "completeCaseMacroAgreement": 0.9333333333333332,
        "assessedCases": 3,
        "completeCases": 3,
        "totalCases": 37,
        "assessedPairs": 16,
        "totalPairs": 259,
        "pairCoverage": 0.06177606177606178
      },
      "imageCoverage": {
        "expected": 156,
        "returned": 12,
        "fraction": 0.07692307692307693
      },
      "eligibilityViolations": 0,
      "categories": {
        "Combinations": {
          "totalCases": 14,
          "statusCounts": {
            "unsupported": 14
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 14,
            "assessedPairs": 0,
            "totalPairs": 106,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 14,
            "assessedPairs": 0,
            "totalPairs": 106,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 59,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Perceived color": {
          "totalCases": 6,
          "statusCounts": {
            "unsupported": 6
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 6,
            "assessedPairs": 0,
            "totalPairs": 45,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 6,
            "assessedPairs": 0,
            "totalPairs": 43,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 26,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Vibe": {
          "totalCases": 9,
          "statusCounts": {
            "unsupported": 9
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 9,
            "assessedPairs": 0,
            "totalPairs": 69,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 9,
            "assessedPairs": 0,
            "totalPairs": 69,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 40,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Precision": {
          "totalCases": 3,
          "statusCounts": {
            "complete": 3
          },
          "allPairs": {
            "queryMacroAgreement": 0.8777777777777778,
            "completeCaseMacroAgreement": 0.8777777777777778,
            "assessedCases": 3,
            "completeCases": 3,
            "totalCases": 3,
            "assessedPairs": 17,
            "totalPairs": 17,
            "pairCoverage": 1
          },
          "withoutUncertain": {
            "queryMacroAgreement": 0.9333333333333332,
            "completeCaseMacroAgreement": 0.9333333333333332,
            "assessedCases": 3,
            "completeCases": 3,
            "totalCases": 3,
            "assessedPairs": 16,
            "totalPairs": 16,
            "pairCoverage": 1
          },
          "imageCoverage": {
            "expected": 12,
            "returned": 12,
            "fraction": 1
          },
          "eligibilityViolations": 0
        },
        "Semantic filtering": {
          "totalCases": 1,
          "statusCounts": {
            "unsupported": 1
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 3,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 3,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 3,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Proportions": {
          "totalCases": 3,
          "statusCounts": {
            "unsupported": 3
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 3,
            "assessedPairs": 0,
            "totalPairs": 18,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 3,
            "assessedPairs": 0,
            "totalPairs": 17,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 12,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Palette": {
          "totalCases": 1,
          "statusCounts": {
            "unsupported": 1
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 6,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 5,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 4,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        }
      }
    },
    "timedAccuracy": {
      "totalCases": 37,
      "statusCounts": {
        "unsupported": 34,
        "complete": 1,
        "partial": 2
      },
      "allPairs": {
        "queryMacroAgreement": 0.8,
        "completeCaseMacroAgreement": 0.8,
        "assessedCases": 1,
        "completeCases": 1,
        "totalCases": 37,
        "assessedPairs": 5,
        "totalPairs": 264,
        "pairCoverage": 0.01893939393939394
      },
      "withoutUncertain": {
        "queryMacroAgreement": 0.8,
        "completeCaseMacroAgreement": 0.8,
        "assessedCases": 1,
        "completeCases": 1,
        "totalCases": 37,
        "assessedPairs": 5,
        "totalPairs": 259,
        "pairCoverage": 0.019305019305019305
      },
      "imageCoverage": {
        "expected": 156,
        "returned": 6,
        "fraction": 0.038461538461538464
      },
      "eligibilityViolations": 0,
      "categories": {
        "Combinations": {
          "totalCases": 14,
          "statusCounts": {
            "unsupported": 14
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 14,
            "assessedPairs": 0,
            "totalPairs": 106,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 14,
            "assessedPairs": 0,
            "totalPairs": 106,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 59,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Perceived color": {
          "totalCases": 6,
          "statusCounts": {
            "unsupported": 6
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 6,
            "assessedPairs": 0,
            "totalPairs": 45,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 6,
            "assessedPairs": 0,
            "totalPairs": 43,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 26,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Vibe": {
          "totalCases": 9,
          "statusCounts": {
            "unsupported": 9
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 9,
            "assessedPairs": 0,
            "totalPairs": 69,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 9,
            "assessedPairs": 0,
            "totalPairs": 69,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 40,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Precision": {
          "totalCases": 3,
          "statusCounts": {
            "complete": 1,
            "partial": 2
          },
          "allPairs": {
            "queryMacroAgreement": 0.8,
            "completeCaseMacroAgreement": 0.8,
            "assessedCases": 1,
            "completeCases": 1,
            "totalCases": 3,
            "assessedPairs": 5,
            "totalPairs": 17,
            "pairCoverage": 0.29411764705882354
          },
          "withoutUncertain": {
            "queryMacroAgreement": 0.8,
            "completeCaseMacroAgreement": 0.8,
            "assessedCases": 1,
            "completeCases": 1,
            "totalCases": 3,
            "assessedPairs": 5,
            "totalPairs": 16,
            "pairCoverage": 0.3125
          },
          "imageCoverage": {
            "expected": 12,
            "returned": 6,
            "fraction": 0.5
          },
          "eligibilityViolations": 0
        },
        "Semantic filtering": {
          "totalCases": 1,
          "statusCounts": {
            "unsupported": 1
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 3,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 3,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 3,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Proportions": {
          "totalCases": 3,
          "statusCounts": {
            "unsupported": 3
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 3,
            "assessedPairs": 0,
            "totalPairs": 18,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 3,
            "assessedPairs": 0,
            "totalPairs": 17,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 12,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        },
        "Palette": {
          "totalCases": 1,
          "statusCounts": {
            "unsupported": 1
          },
          "allPairs": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 6,
            "pairCoverage": 0
          },
          "withoutUncertain": {
            "queryMacroAgreement": null,
            "completeCaseMacroAgreement": null,
            "assessedCases": 0,
            "completeCases": 0,
            "totalCases": 1,
            "assessedPairs": 0,
            "totalPairs": 5,
            "pairCoverage": 0
          },
          "imageCoverage": {
            "expected": 4,
            "returned": 0,
            "fraction": 0
          },
          "eligibilityViolations": 0
        }
      },
      "policy": "First successful measured request per case, at workload.limit; all repeated trial results preserved separately"
    },
    "coverage": {
      "total": 37,
      "ok": 3,
      "unsupported": 34,
      "error": 0
    },
    "performance": {
      "samplesMs": [
        2.757798000000008,
        1.3588860000000125,
        1.4352509999999938,
        1.4390870000000007,
        1.821437000000003,
        1.5271529999999984,
        1.462602000000004,
        1.5190880000000107,
        1.982529999999997,
        1.411535999999984,
        2.114719000000008,
        1.5393160000000137,
        1.5062839999999937,
        1.405163999999985,
        1.4560999999999922,
        1.7765729999999849,
        1.4272959999999841,
        1.4658880000000067,
        1.8625650000000178,
        1.36584000000002,
        1.9333369999999945,
        1.53878499999999,
        2.14131900000001,
        2.117874999999998,
        1.5928569999999809,
        1.6188860000000034,
        1.483520999999996,
        2.253448999999989,
        2.2971519999999828,
        1.5095900000000029
      ],
      "sampleCount": 30,
      "p50Ms": 1.5271529999999984,
      "p95Ms": 2.2971519999999828,
      "maxMs": 2.757798000000008,
      "failures": 0
    }
  }
}
```

### composition-001: unsupported

```json
{
  "query": "80% grayscale 20% red",
  "status": "unsupported",
  "reason": "Conceptual compositions have no image source; image-backed candidates must report this case unsupported.",
  "orderGroups": [
    [
      "composition-001/A"
    ],
    [
      "composition-001/B"
    ]
  ],
  "notes": [
    "Find wallpapers matching the requested grayscale and red composition; the requested proportions total 100%.",
    "This particular ordering does not establish a universal priority for palette purity or a hard exclusion of blue."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": {
      "preferred": "A",
      "over": "B",
      "absolute_relevance": "not supplied"
    },
    "origin": {
      "judge": "user",
      "source": "Explicit comparison in this conversation",
      "statement": "The wallpaper with 10% red and 90% grayscale should score higher than the wallpaper with 80% grayscale, 18% red, and 2% blue."
    }
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-002: unsupported

```json
{
  "query": "80% grayscale 10% red",
  "status": "unsupported",
  "reason": "Conceptual compositions have no image source; image-backed candidates must report this case unsupported.",
  "orderGroups": [],
  "notes": [
    "Find wallpapers matching the requested grayscale and red composition; the remaining 10% is unspecified.",
    "Leaving 10% unspecified does not establish that arbitrary amounts of outside colors are acceptable."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": {
      "absolute_relevance": {
        "A": "good",
        "B": "good"
      },
      "order": "unconstrained",
      "interpretation": "Both should score highly. Either order is acceptable; equal numerical scores are not required."
    },
    "origin": {
      "judge": "user",
      "source": "Explicit comparison and subsequent correction in this conversation",
      "statement": "Both wallpapers should score highly, with no required winner.",
      "correction": "The user corrected B from 1% red to 18% red. Both cases compare the same complete wallpaper compositions.",
      "tentative_comment": "The user thought B might win from a technical standpoint but accepted either ordering. This is not a mandatory preference."
    }
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-red-001: unsupported

```json
{
  "query": {
    "userText": "red",
    "intent": "A wallpaper whose overall color appearance feels red.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-037"
    ],
    [
      "wallpaper-082"
    ],
    [
      "wallpaper-027"
    ],
    [
      "wallpaper-048"
    ],
    [
      "wallpaper-060"
    ],
    [
      "wallpaper-077"
    ]
  ],
  "notes": [
    "Regional quality labels describe perceived red areas, not whole-image match ratings.",
    "Percentages are the user's visual estimates, not measured pixel coverage or exact extraction targets. No numerical tolerance has been agreed.",
    "Unmentioned image areas remain unannotated; they are not automatically non-red, irrelevant, or poor red.",
    "The overall ranking is recorded independently of the regional descriptions; no formula is inferred from those descriptions.",
    "No numerical score distances, whole-image acceptability thresholds, or confidence scores have been supplied.",
    "The five adjacent pairwise relations derive from one six-image ranking; they do not constitute five independent user cases.",
    "Source filenames/titles and sampling labels do not define user relevance.",
    "A and F retain red color identity for the user, while A has the stronger red vibe. Original area estimates and ranking are unchanged.",
    "The user's perceived brightness/dullness explanation is not automatically a measurement of saturation, HSV value, luminance, or any single color-space coordinate; no monotonic brightness rule is inferred.",
    "The user explicitly clarified that A's red match quality is higher than F's within the same acceptable bucket. Equal categorical labels must not be treated as equal continuous qualities.",
    "This clarification does not by itself establish that an additional spatial/context scoring component is required: coarse annotations lost part of the user's quality judgment. No method is selected."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "red-order-001",
        "source": "user-response-001",
        "type": "overall-perceived-redness-order",
        "orderedLabels": [
          "E",
          "D",
          "A",
          "F",
          "C",
          "B"
        ],
        "orderedWallpaperIds": [
          "wallpaper-037",
          "wallpaper-082",
          "wallpaper-027",
          "wallpaper-048",
          "wallpaper-060",
          "wallpaper-077"
        ],
        "basis": "Purely based on feeling",
        "tiesReported": false,
        "scope": "Relative order of these six wallpapers for the general red query; no score distances or whole-image acceptability thresholds supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A the lit part feels very red - 30% acceptable red\nB the sky feels somewhat red - 50% poor red\nC the leaf feels very red - 10% great red\nD the flowers or leaves feel very red - 40% great red\nE The sky feels extremely red - 30% great red 60% acceptable red 10% poor red\nF the roses feel red - 50% acceptable red\n\nI would order these from most to least red:\nE, D, A, F, C, B\n\nPurely based on feeling"
      },
      {
        "id": "user-response-002",
        "author": "user",
        "text": "F feels like the roses are red, but it is explicitly dulled, so it feels like dulled red whereas A feels like it is shining bright red onto the street, so to me the red from A feels brighter than the red in F. I definitely see both as red, and if you ask me 'what colors are these roses' I say red. But the roses don't give a strong 'red vibe', because they're dulled.\n\nRed is a very powerful strong color, dulling it makes it feel much less red."
      },
      {
        "id": "user-response-003",
        "author": "user",
        "text": "This is also because we only have 4 buckets to put the red in, if I had to score the reds, the red from A scores higher than the red from F, but I cant represent that with so few buckets."
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-grayscale-001: unsupported

```json
{
  "query": {
    "userText": "grayscale",
    "intent": "An overall neutral gray, black, and white appearance. This request is distinct from merely having low color or a predominantly single colored hue. Whether a faint tint remains acceptable is for human judgment.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-066",
      "wallpaper-070",
      "wallpaper-061"
    ],
    [
      "wallpaper-007"
    ],
    [
      "wallpaper-092"
    ],
    [
      "wallpaper-096"
    ]
  ],
  "notes": [
    "Per-image assessments and corrected order are confirmed: B/D/F together first, then E, A, C. The initial repeated A was a typo for B, confirmed by user-response-002. The raw response is preserved.",
    "The query distinguishes neutral grayscale appearance from low color and monochromatic colored tints; it does not impose a measured saturation cutoff.",
    "The user describes monochromatic A as technically not grayscale but more grayscale than not grayscale, and E as very close to grayscale with uncertainty in darker areas. Preserve these nuanced judgments.",
    "Finer comparisons within a coarse quality label are supported; sharing a label does not imply equal quality. No scores or scale are inferred.",
    "User judgments should describe appearance; they are not a pixel-membership oracle or extraction target.",
    "Source filenames, titles, directory names, and earlier sampling labels do not define relevance.",
    "No originals or thumbnails were altered for this case. Existing previews can differ from originals because of display size and JPEG encoding.",
    "Any future area estimates are to be recorded separately from whole-image match ratings and ordering.",
    "The user's percentages are subjective grayscale descriptions. Their meaning is not calibrated as area coverage versus strength of appearance; preserve the original expressions and E's range without inventing numeric targets.",
    "The top group expresses the user's tied preference; it does not require exactly equal model scores. Derived pairwise relations belong to this single ordering judgment."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "source": "user-response-001",
        "kind": "whole-image-order",
        "status": "confirmed",
        "rawOrder": "A + D + F, E, A, C",
        "confirmedOrder": [
          [
            "B",
            "D",
            "F"
          ],
          [
            "E"
          ],
          [
            "A"
          ],
          [
            "C"
          ]
        ],
        "ambiguity": "Resolved by user-response-002: the first A was a typo for B.",
        "proposedClarification": {
          "status": "confirmed",
          "description": "B, D and F together first, then E, A, C.",
          "groups": [
            [
              "B",
              "D",
              "F"
            ],
            [
              "E"
            ],
            [
              "A"
            ],
            [
              "C"
            ]
          ]
        },
        "id": "grayscale-order-001",
        "confirmationSource": "user-response-002",
        "confirmedWallpaperGroups": [
          [
            "wallpaper-066",
            "wallpaper-070",
            "wallpaper-061"
          ],
          [
            "wallpaper-007"
          ],
          [
            "wallpaper-092"
          ],
          [
            "wallpaper-096"
          ]
        ],
        "scope": "B, D and F share the top group; no required order within that group or equal numeric model scores. Other groups are strictly ordered. No numeric score distances inferred."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "text": "A this is monochromatic, so technically not grayscale, yet more grayscale than not grayscale\nB this is pretty much the definition of grayscale 100% grayscale\nC this is not grayscale 0% grayscale\nD this is pretty much the definition of grayscale 100% grayscale\nE this is very close to grayscale, bit hard to see in the darker parts but about 50-80% grayscale\nF this is pretty much the definition of grayscale 100% grayscale\n\nOrder\n\nA + D + F, E, A, C"
      },
      {
        "id": "user-response-002",
        "author": "user",
        "text": "yep, mistyped sorry",
        "inReplyTo": "Did you mean B, D and F together first, then E, A, C? Your written order lists A twice and omits B."
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-dark-001: unsupported

```json
{
  "query": {
    "userText": "dark",
    "intent": "A wallpaper that feels dark overall. Whether bright highlights or colored areas affect that judgment is for the user to decide.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-067"
    ],
    [
      "wallpaper-022"
    ],
    [
      "wallpaper-091"
    ],
    [
      "wallpaper-068"
    ],
    [
      "wallpaper-054"
    ],
    [
      "wallpaper-010"
    ]
  ],
  "notes": [
    "User regional estimates and overall order are recorded. Confirmed order: D > B > E > F > A > C.",
    "The query concerns overall appearance. It does not specify a numerical darkness threshold, percentage, shade, or subject.",
    "These A–F labels belong only to this case; the red and grayscale cases have different image mappings.",
    "User judgments should describe appearance; they are not a pixel-membership oracle or extraction target.",
    "Colorfulness, grayscale appearance, and darkness are not assumed to be equivalent. Their effect on this query is for the user to judge.",
    "Source filenames, titles, directory names, and earlier sampling labels do not define relevance.",
    "No originals or thumbnails were altered for this case. Existing previews can differ from originals because of display size and JPEG encoding.",
    "Image-area estimates and perceived darkness strength are separate subjective annotations, not measured pixel coverage, a luminance definition, or whole-image numeric relevance scores.",
    "Preserve finer comparisons, uncertainty, and acceptable alternative orders without inventing numeric scores or exact ties.",
    "A's 10–20% foreground description is retained as an approximate range without inventing a darkness-strength value. C's 'Not dark' remains qualitative; no exact numeric 0% coverage is assigned.",
    "Unmentioned image areas remain unannotated; do not treat them as having zero darkness.",
    "D's 90% at 100% darkness explicitly generalizes a gradient. Preserve that approximation rather than treating 100% as exact RGB black.",
    "B ranks above E despite B's region being described as less dark and larger. Treat that ordering as direct evidence; approximate regional estimates and unannotated remainders do not establish or refute a general scoring formula."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "dark-order-001",
        "source": "user-response-001",
        "type": "overall-dark-appearance-order",
        "orderedLabels": [
          "D",
          "B",
          "E",
          "F",
          "A",
          "C"
        ],
        "orderedWallpaperIds": [
          "wallpaper-067",
          "wallpaper-022",
          "wallpaper-091",
          "wallpaper-068",
          "wallpaper-054",
          "wallpaper-010"
        ],
        "tiesReported": false,
        "scope": "Relative order for the general dark query. Regional amount and darkness-strength estimates are separate from whole-image ranking; no numeric whole-image scores or score distances supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A Not really dark, more light, but not 0% I would say 10-20% dark from the foreground\nB Interesting, definitely dark, but I wouldn't say maximum dark 80% area at a 70% dark\nC Not dark\nD Nice and dark, I'd say 90% area at 100% dark to generalize (it's a gradient)\nE 60% area at 100% dark\nF 50% area at 90% dark\n\nOrder\n\nD, B, E, F, A, C"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### combination-gray-red-001: unsupported

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-048"
    ],
    [
      "wallpaper-029"
    ],
    [
      "wallpaper-042"
    ],
    [
      "wallpaper-060"
    ],
    [
      "wallpaper-065"
    ],
    [
      "wallpaper-037"
    ]
  ],
  "notes": [
    "User descriptions, approximate regional annotation for E, review difficulty and explicit overall order are recorded. Confirmed order: F > E > A > B > D > C.",
    "The query concerns a combination of mostly neutral appearance and red accents. It does not specify exact percentages, shade, a numerical neutrality cutoff, or a subject.",
    "These A–F labels belong only to this case; earlier cases have different image mappings.",
    "Some images were seen in the perceived-red case. Only the user's explicit reference to the roses not being bright red is carried into the descriptive explanation; no prior percentages, scores or ranking are transferred.",
    "User judgments should describe appearance; they are not a pixel-membership oracle or extraction target.",
    "No ideal reference has been confirmed. The user calls F the best match among these, with a limitation that the red roses are not bright red. This does not establish that F is perfect or that all six are unacceptable.",
    "Tinted backgrounds, additional colors, and the amount of red are considerations for discussion, not predetermined penalties or relevance labels.",
    "Source filenames, titles, directory names, and earlier sampling labels do not define relevance.",
    "No originals or thumbnails were altered for this case. Existing previews can differ from originals because of display size and JPEG encoding.",
    "Any future area estimates are to be recorded separately from whole-image match ratings and ordering.",
    "Preserve finer comparisons, uncertainty, and acceptable alternative orders without inventing numeric scores or exact ties.",
    "B's distinction between white-with-red and grayscale-with-red concerns the perceived combination in this image. It does not exclude white from grayscale, require a specific background tone or establish a universal tonal-distribution rule.",
    "E's 30% grayscale estimate applies to the buildings, with decent local grayscale quality; preserve this separately from the whole image's relevance. Unmentioned regions and red amounts remain unannotated.",
    "D > C compares these particular examples missing different requested components; it does not establish that grayscale always outweighs red.",
    "The user's difficulty grading A and this case does not invalidate the supplied ranking or establish numerical confidence or score gaps."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "gray-red-order-001",
        "source": "user-response-001",
        "type": "overall-grayscale-with-red-accents-order",
        "orderedLabels": [
          "F",
          "E",
          "A",
          "B",
          "D",
          "C"
        ],
        "orderedWallpaperIds": [
          "wallpaper-048",
          "wallpaper-029",
          "wallpaper-042",
          "wallpaper-060",
          "wallpaper-065",
          "wallpaper-037"
        ],
        "tiesReported": false,
        "scope": "Explicit relative order for this query, retained alongside the user's reported grading difficulty. No numeric score distances, absolute whole-image grades or general component weights supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A I don't know how to grade this tbh. The red doesnt pop out, and the grayscale isnt very grayscale. I'd grade this above C but I feel angry while doing so.\nB Good red, I guess the white is grayscale, but it doesn't feel like grayscale with red, it feels like white with red\nC no grayscale, but good red\nD Perfect grayscale, but no red so uh...\nE This has red, but not really grayscale so I'd say like 30% grayscale area with decent quality on the buildings? The red is really good though.\nF This is the best match, it has grayscale background, with red roses, but as we established earlier they're not bright red\n\nF, E, A, B, D, C\n\nthis one was hard for me"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
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
        "wallpaper-042",
        "wallpaper-060",
        "wallpaper-037",
        "wallpaper-065",
        "wallpaper-029",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-042",
        "wallpaper-060",
        "wallpaper-037",
        "wallpaper-065",
        "wallpaper-029",
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
        "preferred": "wallpaper-048",
        "other": "wallpaper-029",
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
        "preferred": "wallpaper-048",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-037",
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
        "preferred": "wallpaper-042",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-065",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "combination-gray-red-001",
    "category": "Combinations",
    "categories": [
      "Combinations"
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
        "wallpaper-042",
        "wallpaper-060",
        "wallpaper-037",
        "wallpaper-065",
        "wallpaper-029",
        "wallpaper-048"
      ],
      "returnedIds": [],
      "missingIds": [
        "wallpaper-042",
        "wallpaper-060",
        "wallpaper-037",
        "wallpaper-065",
        "wallpaper-029",
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
        "preferred": "wallpaper-048",
        "other": "wallpaper-029",
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
        "preferred": "wallpaper-048",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-048",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-042",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-060",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-029",
        "other": "wallpaper-037",
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
        "preferred": "wallpaper-042",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-042",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-065",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-060",
        "other": "wallpaper-037",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "wallpaper-065",
        "other": "wallpaper-037",
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### combination-gray-red-002: unsupported

```json
{
  "query": {
    "userText": "mostly grayscale, with red accents",
    "intent": "A mostly neutral gray, black and white wallpaper with red as the colored accent. How much tint or other color remains acceptable, and how much red feels like an accent, is for the user to judge.",
    "specifiedPercentages": null,
    "preciseHex": null,
    "subjectConstraint": null
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "evaluation-gray-red-002-telephone"
    ],
    [
      "evaluation-gray-red-002-umbrella"
    ],
    [
      "wallpaper-048"
    ]
  ],
  "notes": [
    "User descriptions and order are recorded: A > C > B. A is explicitly called a textbook example and serves as the first confirmed positive reference for this query.",
    "This follows the same query with a smaller, deliberately selected set. It is not a new independent query or held-out evaluation; keep related cases and images in the same evaluation split.",
    "Only two additional source images were acquired. The original 100-image manifest, extraction data, OpenSearch indexes and historical benchmarks are unchanged.",
    "Published source photographs may use selective coloring; no local image generation, recoloring, masking, cropping or resizing was performed. Browser display scaling is presentation only.",
    "These are different scenes, not controlled variants. Any ranking does not by itself isolate the causal effect of red amount, brightness, background tone or spatial arrangement.",
    "The roses were preferred in the previous set; that ranking does not determine their position or absolute acceptability in this set.",
    "Source files replace JPEG previews for this review, and frames are larger than the previous page. The roses' presentation therefore changes; preserve fresh responses without assuming a perfect repeatability test.",
    "New source files are hash-pinned under the existing ignored corpus directory. Source/license metadata is included here and linked from the review page.",
    "Regional descriptions or amounts, if supplied, remain distinct from whole-image judgments; unmentioned parts remain unannotated.",
    "C's darker red is still described as vibrant. Do not conflate darkness with dullness or infer that only the brightest red can fit this query.",
    "B's slightly blue-ish grayscale and reduced red are fresh observations in this presentation. Preserve earlier descriptions rather than rewriting them; no causal explanation for the newly noticed tint has been established.",
    "The user's positive component descriptions and relative order do not assign a calibrated whole-image grade to B or C. B is not marked unacceptable merely because it ranks last here.",
    "No image-area percentages, exact grayscale pixel fractions, color coordinates or new general scoring rule follow from 'perfect grayscale', 'bright', 'reduced', or 'vibrant'.",
    "The raw spelling 'bibrant' is retained; descriptive summaries read it as the evident word 'vibrant'."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "gray-red-followup-order-001",
        "source": "user-response-001",
        "type": "overall-grayscale-with-red-accents-order",
        "orderedLabels": [
          "A",
          "C",
          "B"
        ],
        "orderedWallpaperIds": [
          "evaluation-gray-red-002-telephone",
          "evaluation-gray-red-002-umbrella",
          "wallpaper-048"
        ],
        "tiesReported": false,
        "scope": "Relative order within this three-image follow-up. A also has an explicit qualitative 'textbook example' assessment. No numeric scores, distances or percentage estimates supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A Beautiful bright red with perfect grayscale, textbook example\nB Beautiful but slightly blue-ish grayscale with reduced red\nC Beautiful grayscale with a slightly darker but still bibrant red\n\nA, C, B"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor follow-up"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### precision-shade-001: ok

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
  "status": "ok",
  "rankingCondition": null,
  "orderGroups": [
    [
      "precision-shade-001-b",
      "precision-shade-001-d"
    ],
    [
      "precision-shade-001-a"
    ],
    [
      "precision-shade-001-c"
    ]
  ],
  "notes": [
    "User shade descriptions, semantic clarification and ordering are recorded: B/D together first, then A, then C. No numeric grades or score distances supplied.",
    "The picked-shade query has no percentage target. The user clarified that the goal is proximity to the chosen color rather than exact-equality filtering; no cutoff or distance formula is specified.",
    "Exact color codes and geometric area fractions are fixture construction facts. They are not perceived quality scores or preferred ranking ground truth.",
    "Keep shade acceptability distinct from overall result preference. Do not infer one from the other when the user supplies only one.",
    "A/C/D compare shades at40% source area; B/D compare10% and40% of the same shade. The user places B/D together above A/C in this case.",
    "Equal steps in a single RGB channel do not establish equal perceived differences, lightness, hue changes or symmetry of user preference.",
    "Browser scaling may antialias band edges. Source geometry and solid interior colors are pinned; perceived differences depend on display and viewing conditions. 'Indistinguishable' is a valid judgment.",
    "These abstract fixtures isolate a design question; any observations need later real-wallpaper validation. They are not a representative production image sample.",
    "The four closely related fixtures belong to one development evaluation group, not four independent held-out cases.",
    "Existing photos, source manifests, descriptors and OpenSearch indexes are unchanged; no search method, harness or benchmark was implemented.",
    "Preserve the user's 'pretty sure' for B and D. Fixture equality does not replace the user's expressed confidence.",
    "'A bit light' and 'noticeably darker' are perceived differences, not measured lightness coordinates.",
    "B's10% of the target shade outranks A/C's40% nearby shades here. B/D's shared top group does not establish that any tiny exact-color speck always wins or that amount never matters.",
    "A and C's lower ranking does not establish rejection or a universal tolerance threshold.",
    "The top group need not receive identical numerical model scores. Derived pairwise preferences belong to one ordering judgment."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "precision-order-001",
        "source": "user-response-001",
        "type": "picked-shade-result-preference",
        "orderedGroups": [
          [
            "B",
            "D"
          ],
          [
            "A"
          ],
          [
            "C"
          ]
        ],
        "orderedWallpaperGroups": [
          [
            "precision-shade-001-b",
            "precision-shade-001-d"
          ],
          [
            "precision-shade-001-a"
          ],
          [
            "precision-shade-001-c"
          ]
        ],
        "tiesReported": true,
        "scope": "B and D together first, then A, then C. No required internal ordering or equal numerical model scores for the top group; no numeric score distances or hard rejection labels supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A is a bit light\nB is less wide, but pretty sure it matches the target precisely\nC is noticeably darker\nD pretty sure it matches the target precisely\n\nNow the goal for us is not to filter by exactly this color and only this color, but by colors that are as close to it as possible, it means the color is important to the user.\n\nB + D, A, C"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
  "searchEvidence": {
    "evidence": {
      "index": "color-exploration-precision-grid-real-v2",
      "serviceTookMs": 4,
      "httpMs": 7.4699640000000045,
      "engine": "opensearch",
      "method": "rank-features-precision-grid",
      "approximate": false
    }
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-shade-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-553e4282f980",
    "status": "complete",
    "allPairs": {
      "agreement": 0.8,
      "assessedPairs": 5,
      "totalPairs": 5,
      "coverage": 1,
      "concordant": 4,
      "discordant": 1,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": 0.8,
      "assessedPairs": 5,
      "totalPairs": 5,
      "coverage": 1,
      "concordant": 4,
      "discordant": 1,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "missingIds": [],
      "fraction": 1
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "discordant",
        "credit": 0
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
    "status": "complete",
    "allPairs": {
      "agreement": 0.8,
      "assessedPairs": 5,
      "totalPairs": 5,
      "coverage": 1,
      "concordant": 4,
      "discordant": 1,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": 0.8,
      "assessedPairs": 5,
      "totalPairs": 5,
      "coverage": 1,
      "concordant": 4,
      "discordant": 1,
      "tied": 0
    },
    "coverage": {
      "expectedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "returnedIds": [
        "precision-shade-001-a",
        "precision-shade-001-b",
        "precision-shade-001-c",
        "precision-shade-001-d"
      ],
      "missingIds": [],
      "fraction": 1
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "precision-shade-001-a",
        "other": "precision-shade-001-c",
        "uncertain": false,
        "outcome": "discordant",
        "credit": 0
      }
    ]
  },
  "hits": [
    {
      "id": "precision-shade-001-b",
      "score": 0.8344189
    },
    {
      "id": "composition-green-red-001-a",
      "score": 0.8339259
    },
    {
      "id": "composition-green-red-001-e",
      "score": 0.83267224
    },
    {
      "id": "composition-green-red-001-b",
      "score": 0.83197796
    },
    {
      "id": "composition-green-red-001-d",
      "score": 0.83197796
    },
    {
      "id": "composition-green-red-001-c",
      "score": 0.8306283
    },
    {
      "id": "composition-green-red-001-f",
      "score": 0.82831466
    },
    {
      "id": "precision-shade-001-d",
      "score": 0.82707345
    },
    {
      "id": "precision-shade-001-c",
      "score": 0.82307684
    },
    {
      "id": "precision-shade-001-a",
      "score": 0.77685237
    },
    {
      "id": "madness-wallhaven-w55xgp",
      "score": 0.73739314
    },
    {
      "id": "evaluation-green-red-tulips",
      "score": 0.73117733
    },
    {
      "id": "madness-wallhaven-rqqjrj",
      "score": 0.70609415
    },
    {
      "id": "madness-wallhaven-e88v9o",
      "score": 0.6912917
    },
    {
      "id": "wallpaper-037",
      "score": 0.6883593
    },
    {
      "id": "madness-wallhaven-9mrgk1",
      "score": 0.68671143
    },
    {
      "id": "madness-wallhaven-xeewg3",
      "score": 0.6790705
    },
    {
      "id": "madness-wallhaven-j5eqpw",
      "score": 0.6443206
    },
    {
      "id": "madness-wallhaven-d88evl",
      "score": 0.6438763
    },
    {
      "id": "madness-wallhaven-lyyv8r",
      "score": 0.6408969
    },
    {
      "id": "madness-wallhaven-gwwvqe",
      "score": 0.6253978
    },
    {
      "id": "madness-wallhaven-gwwkql",
      "score": 0.6153828
    },
    {
      "id": "madness-wallhaven-9oozpx",
      "score": 0.6000527
    },
    {
      "id": "madness-wallhaven-rqq1ww",
      "score": 0.5612288
    },
    {
      "id": "evaluation-green-red-tulip-field",
      "score": 0.54662246
    },
    {
      "id": "madness-wallhaven-9639xx",
      "score": 0.54615355
    },
    {
      "id": "madness-wallhaven-k9m277",
      "score": 0.54439867
    },
    {
      "id": "madness-wallhaven-gww27e",
      "score": 0.5430187
    },
    {
      "id": "madness-wallhaven-vmwlmm",
      "score": 0.536436
    },
    {
      "id": "madness-wallhaven-gwwxpl",
      "score": 0.53439415
    },
    {
      "id": "wallpaper-040",
      "score": 0.5281988
    },
    {
      "id": "madness-wallhaven-1qqlew",
      "score": 0.5250165
    },
    {
      "id": "madness-wallhaven-6llzk6",
      "score": 0.52265435
    },
    {
      "id": "madness-wallhaven-poo7gj",
      "score": 0.5118483
    },
    {
      "id": "madness-wallhaven-ox2ool",
      "score": 0.50885314
    },
    {
      "id": "madness-wallhaven-mdoqxy",
      "score": 0.50611496
    },
    {
      "id": "madness-wallhaven-poowxp",
      "score": 0.49013716
    },
    {
      "id": "madness-wallhaven-7j3lve",
      "score": 0.4894179
    },
    {
      "id": "madness-wallhaven-9oov2d",
      "score": 0.48266864
    },
    {
      "id": "madness-wallhaven-lyydwl",
      "score": 0.44178432
    },
    {
      "id": "wallpaper-031",
      "score": 0.43409607
    },
    {
      "id": "madness-wallhaven-vppd75",
      "score": 0.4234938
    },
    {
      "id": "madness-wallhaven-xl57go",
      "score": 0.4230847
    },
    {
      "id": "wallpaper-082",
      "score": 0.41825414
    },
    {
      "id": "wallpaper-094",
      "score": 0.4124681
    },
    {
      "id": "madness-wallhaven-8368k1",
      "score": 0.39226356
    },
    {
      "id": "madness-wallhaven-v9qkgm",
      "score": 0.39106032
    },
    {
      "id": "wallpaper-058",
      "score": 0.3900519
    },
    {
      "id": "madness-wallhaven-xe6qdv",
      "score": 0.36212882
    },
    {
      "id": "madness-wallhaven-xeejzz",
      "score": 0.35969663
    },
    {
      "id": "wallpaper-036",
      "score": 0.35392615
    },
    {
      "id": "wallpaper-004",
      "score": 0.33996806
    },
    {
      "id": "madness-wallhaven-gwwlm3",
      "score": 0.33593625
    },
    {
      "id": "madness-wallhaven-rqqjl7",
      "score": 0.33481783
    },
    {
      "id": "madness-wallhaven-13qmlw",
      "score": 0.32371166
    },
    {
      "id": "madness-wallhaven-jeel8q",
      "score": 0.32004797
    },
    {
      "id": "madness-wallhaven-3qqgrv",
      "score": 0.3115374
    },
    {
      "id": "madness-wallhaven-3qq5lv",
      "score": 0.30939937
    },
    {
      "id": "madness-wallhaven-gwwmxq",
      "score": 0.30810845
    },
    {
      "id": "madness-wallhaven-yqqrp7",
      "score": 0.30639803
    },
    {
      "id": "wallpaper-084",
      "score": 0.29436946
    },
    {
      "id": "wallpaper-052",
      "score": 0.293888
    },
    {
      "id": "madness-wallhaven-w55m8x",
      "score": 0.2910643
    },
    {
      "id": "madness-wallhaven-e88qdr",
      "score": 0.26972857
    },
    {
      "id": "madness-wallhaven-95jgkk",
      "score": 0.25467086
    },
    {
      "id": "madness-wallhaven-oggv5m",
      "score": 0.247421
    },
    {
      "id": "wallpaper-035",
      "score": 0.24420536
    },
    {
      "id": "wallpaper-027",
      "score": 0.24275942
    },
    {
      "id": "madness-wallhaven-qrre8l",
      "score": 0.23998803
    },
    {
      "id": "madness-wallhaven-q625eq",
      "score": 0.2251354
    },
    {
      "id": "madness-wallhaven-jeed6q",
      "score": 0.21636556
    },
    {
      "id": "wallpaper-029",
      "score": 0.2107518
    },
    {
      "id": "madness-wallhaven-qrrq67",
      "score": 0.21070443
    },
    {
      "id": "wallpaper-025",
      "score": 0.20244046
    },
    {
      "id": "madness-wallhaven-lyyko2",
      "score": 0.1851381
    },
    {
      "id": "madness-wallhaven-rqqygw",
      "score": 0.17327482
    },
    {
      "id": "madness-wallhaven-yq8k2d",
      "score": 0.165595
    },
    {
      "id": "madness-wallhaven-poov9e",
      "score": 0.16470216
    },
    {
      "id": "madness-wallhaven-ymg9kx",
      "score": 0.15629472
    },
    {
      "id": "madness-wallhaven-k881gm",
      "score": 0.13911656
    },
    {
      "id": "madness-wallhaven-jeev6q",
      "score": 0.13759905
    },
    {
      "id": "madness-wallhaven-9ooez8",
      "score": 0.13302411
    },
    {
      "id": "wallpaper-087",
      "score": 0.13261469
    },
    {
      "id": "wallpaper-048",
      "score": 0.122633316
    },
    {
      "id": "madness-wallhaven-jeerzw",
      "score": 0.11413845
    },
    {
      "id": "wallpaper-060",
      "score": 0.10875498
    },
    {
      "id": "madness-wallhaven-lmk37p",
      "score": 0.095576875
    },
    {
      "id": "madness-wallhaven-yqqww7",
      "score": 0.09451801
    },
    {
      "id": "madness-wallhaven-p8jqem",
      "score": 0.09425559
    },
    {
      "id": "madness-wallhaven-xeeomd",
      "score": 0.09425559
    },
    {
      "id": "madness-wallhaven-vpp2g5",
      "score": 0.08715207
    },
    {
      "id": "madness-wallhaven-jeejqm",
      "score": 0.08712314
    },
    {
      "id": "wallpaper-044",
      "score": 0.08513418
    },
    {
      "id": "madness-wallhaven-eojxrr",
      "score": 0.082502216
    },
    {
      "id": "madness-wallhaven-yqqoek",
      "score": 0.08175319
    },
    {
      "id": "wallpaper-038",
      "score": 0.078803934
    },
    {
      "id": "madness-wallhaven-vppry3",
      "score": 0.07705506
    },
    {
      "id": "madness-wallhaven-2112dx",
      "score": 0.074388824
    },
    {
      "id": "madness-wallhaven-3qqgo3",
      "score": 0.07355336
    },
    {
      "id": "madness-wallhaven-k88ld6",
      "score": 0.06902481
    },
    {
      "id": "madness-wallhaven-gwwq8e",
      "score": 0.067904845
    },
    {
      "id": "madness-wallhaven-lyy22q",
      "score": 0.066872224
    },
    {
      "id": "madness-wallhaven-j3511m",
      "score": 0.06642582
    },
    {
      "id": "madness-wallhaven-w553y6",
      "score": 0.0647708
    },
    {
      "id": "madness-wallhaven-rqqw2q",
      "score": 0.06320129
    },
    {
      "id": "madness-wallhaven-9oo8k1",
      "score": 0.058735546
    },
    {
      "id": "wallpaper-042",
      "score": 0.058559556
    },
    {
      "id": "madness-wallhaven-gww23l",
      "score": 0.055243857
    },
    {
      "id": "madness-wallhaven-d88253",
      "score": 0.05359076
    },
    {
      "id": "madness-wallhaven-1qqdgw",
      "score": 0.04763504
    },
    {
      "id": "wallpaper-057",
      "score": 0.04459457
    },
    {
      "id": "madness-wallhaven-ogg23p",
      "score": 0.04350925
    },
    {
      "id": "madness-wallhaven-1qqok3",
      "score": 0.042438
    },
    {
      "id": "madness-wallhaven-ml91l9",
      "score": 0.041904844
    },
    {
      "id": "madness-wallhaven-yqqe27",
      "score": 0.04158668
    },
    {
      "id": "madness-wallhaven-vmwp58",
      "score": 0.04054061
    },
    {
      "id": "madness-wallhaven-1j9v7w",
      "score": 0.038513627
    },
    {
      "id": "madness-wallhaven-qrrox7",
      "score": 0.036486648
    },
    {
      "id": "madness-wallhaven-rqq1mm",
      "score": 0.036486648
    },
    {
      "id": "madness-wallhaven-3qq6m3",
      "score": 0.035004772
    },
    {
      "id": "madness-wallhaven-e8865l",
      "score": 0.032432687
    },
    {
      "id": "madness-wallhaven-jeej1q",
      "score": 0.03163542
    },
    {
      "id": "madness-wallhaven-rqqxew",
      "score": 0.030742379
    },
    {
      "id": "wallpaper-097",
      "score": 0.029392218
    },
    {
      "id": "madness-wallhaven-wqvoxr",
      "score": 0.029118052
    },
    {
      "id": "madness-wallhaven-d882g3",
      "score": 0.026374416
    },
    {
      "id": "madness-wallhaven-lmmxol",
      "score": 0.025689393
    },
    {
      "id": "madness-wallhaven-5gk313",
      "score": 0.020059174
    },
    {
      "id": "madness-wallhaven-6ll5z7",
      "score": 0.019694695
    },
    {
      "id": "madness-wallhaven-qrrlq7",
      "score": 0.018368533
    },
    {
      "id": "madness-wallhaven-d88mmj",
      "score": 0.018325524
    },
    {
      "id": "madness-wallhaven-yqq3wd",
      "score": 0.018278154
    },
    {
      "id": "wallpaper-100",
      "score": 0.017071867
    },
    {
      "id": "madness-wallhaven-jeekxm",
      "score": 0.017003579
    },
    {
      "id": "madness-wallhaven-1qqxlv",
      "score": 0.016298544
    },
    {
      "id": "madness-wallhaven-ml3ke9",
      "score": 0.016216844
    },
    {
      "id": "madness-wallhaven-2119jg",
      "score": 0.015203354
    },
    {
      "id": "madness-wallhaven-6o2qd7",
      "score": 0.012162883
    },
    {
      "id": "madness-wallhaven-9oog5d",
      "score": 0.011918603
    },
    {
      "id": "madness-wallhaven-xee33d",
      "score": 0.011149393
    },
    {
      "id": "madness-wallhaven-lyyk7y",
      "score": 0.009122413
    },
    {
      "id": "madness-wallhaven-jeek5p",
      "score": 0.007842035
    },
    {
      "id": "madness-wallhaven-6lly96",
      "score": 0.00759904
    },
    {
      "id": "madness-wallhaven-k88kzd",
      "score": 0.005455457
    },
    {
      "id": "madness-wallhaven-zppd8y",
      "score": 0.0044430997
    },
    {
      "id": "madness-wallhaven-211xrg",
      "score": 0.0043240064
    },
    {
      "id": "wallpaper-077",
      "score": 0.0043240064
    },
    {
      "id": "madness-wallhaven-6lle1w",
      "score": 0.004054961
    },
    {
      "id": "madness-wallhaven-6llp5q",
      "score": 0.0028830043
    },
    {
      "id": "madness-wallhaven-6ll7dx",
      "score": 0.0025253224
    },
    {
      "id": "wallpaper-002",
      "score": 0.0014420021
    },
    {
      "id": "wallpaper-016",
      "score": 0.0010144903
    },
    {
      "id": "evaluation-gray-red-002-telephone",
      "score": 0.000001
    },
    {
      "id": "evaluation-gray-red-002-umbrella",
      "score": 0.000001
    },
    {
      "id": "evaluation-green-red-leaves",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqe13",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqer1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqlq1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqmk3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqrev",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqwq3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqx1g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-21127y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211519",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2115ky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2116k9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211986",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2119yx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211d1x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211dyx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211er6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211jgy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211lky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211wjx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-21yp59",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qlxjy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq589",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq5j3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq7j9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq8jd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqem9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqrp3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqv1d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqvk9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqygv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5ygeg7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy3d3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy6r9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy8v1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyj69",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yymd3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyme5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yymk9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yypm9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyq53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyrx5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyy85",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll2dq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll2zw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll57w",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll7pq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6lle7l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llemx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llg7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llgd6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llm17",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llmg7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llpwq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llrk7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llrl7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llwv6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llzrw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llzxw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-73og6v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj1p3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj1qo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj7ey",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jje13",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjkde",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjm3v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjo5e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjom3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjwp3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jp81o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8g5qr2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg1do",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg1g2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg61j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg6eo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggdxo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gge6y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggez2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggm6k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggrqy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwl1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwro",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwyj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo2dk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo2k1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo7od",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9ooe6d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9ooe9k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oolmx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oop2d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oopek",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oor8k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oow11",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oow31",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d882yl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88d53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88jym",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88k3m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88q5g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88qeo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88v3o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88v53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88vyl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88w2l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88z63",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d8gygl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d8pk8m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e873x8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e881lw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e882dk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e8891l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88pr8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88pxk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88q7k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88r8o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88rok",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88vyk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwpo6e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww16q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww69l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww9kd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww9yl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdeq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdm3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdpe",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdrd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwweme",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwkoq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwm6d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwq27",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwqvq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwv23",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwv9e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwvpe",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwxwl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-j52vqm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee15p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee1rw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee8ry",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeedjw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeek6q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeekjy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeelj5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeokp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeoxq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeoym",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeozw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeep8w",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeepkq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeq3q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeqxq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeer9q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeerxp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeevkm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeew7y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeewoy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeey2y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeey9q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeypy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jexkwm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k881zd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88291",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k883md",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k885z7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88g21",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88jld",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88jv6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88z5m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88zgm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-kwxod1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lql7vp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyy7kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyg8p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyj52",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyjvy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyker",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyykvy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyp9y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyypwr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyr9r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyywml",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyx5q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyx7l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyxjp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyxqy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-m9vqy9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mdvo1y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ml3jm8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mll1mm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mll1ry",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllelk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllg19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllm61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllr38",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllr61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllrdk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllv3k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllvky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllvr9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllw19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllw39",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mlly98",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllykm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg1kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg1wl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg6q7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg6zm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg7ql",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogge85",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggl19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggvw9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggw5p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-po9eop",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo1kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo5pj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo99j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poog2e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poojxm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poomw3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poopke",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qr27rq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrr3m5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrre3d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrejd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrey5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrkor",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrldr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrlzr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrmp5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrroml",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrv3r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-r7kpmm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-r7kqj1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqe7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqgkq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqj61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqoem",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqop1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqw7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqwgj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqwpw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqy5m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp19p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp1vl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp6d5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppd8p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppdjm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppedl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpplmp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppo6p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpprr8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppv3l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppy93",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppyjp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpqk88",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w5531x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w556l7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w557rr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55dp6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55gjr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55kvr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55lqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55lz6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mgq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mzq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55re6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55rr7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55vwr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55w3r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w5eq57",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-x8359z",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee36v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee3kz",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee3wz",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee72o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee7dd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee7jd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xeejw3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xeezqv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-y89mld",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq21g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq3px",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq5rg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq68g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqemd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqewx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqkdg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqqrg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqrgl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqv3x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqvv7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqw7g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqwvd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqxzqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp3mg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp5ww",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp5yy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp6mw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppjyg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppq2j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppqdv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpproy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppv8g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppz3w",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-a",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-b",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-c",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-d",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-e",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-f",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-a",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-b",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-c",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-d",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-e",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-f",
      "score": 0.000001
    },
    {
      "id": "wallpaper-001",
      "score": 0.000001
    },
    {
      "id": "wallpaper-003",
      "score": 0.000001
    },
    {
      "id": "wallpaper-005",
      "score": 0.000001
    },
    {
      "id": "wallpaper-006",
      "score": 0.000001
    },
    {
      "id": "wallpaper-007",
      "score": 0.000001
    },
    {
      "id": "wallpaper-008",
      "score": 0.000001
    },
    {
      "id": "wallpaper-009",
      "score": 0.000001
    },
    {
      "id": "wallpaper-010",
      "score": 0.000001
    },
    {
      "id": "wallpaper-011",
      "score": 0.000001
    },
    {
      "id": "wallpaper-012",
      "score": 0.000001
    },
    {
      "id": "wallpaper-013",
      "score": 0.000001
    },
    {
      "id": "wallpaper-014",
      "score": 0.000001
    },
    {
      "id": "wallpaper-015",
      "score": 0.000001
    },
    {
      "id": "wallpaper-017",
      "score": 0.000001
    },
    {
      "id": "wallpaper-018",
      "score": 0.000001
    },
    {
      "id": "wallpaper-019",
      "score": 0.000001
    },
    {
      "id": "wallpaper-020",
      "score": 0.000001
    },
    {
      "id": "wallpaper-021",
      "score": 0.000001
    },
    {
      "id": "wallpaper-022",
      "score": 0.000001
    },
    {
      "id": "wallpaper-023",
      "score": 0.000001
    },
    {
      "id": "wallpaper-024",
      "score": 0.000001
    },
    {
      "id": "wallpaper-026",
      "score": 0.000001
    },
    {
      "id": "wallpaper-028",
      "score": 0.000001
    },
    {
      "id": "wallpaper-030",
      "score": 0.000001
    },
    {
      "id": "wallpaper-032",
      "score": 0.000001
    },
    {
      "id": "wallpaper-033",
      "score": 0.000001
    },
    {
      "id": "wallpaper-034",
      "score": 0.000001
    },
    {
      "id": "wallpaper-039",
      "score": 0.000001
    },
    {
      "id": "wallpaper-041",
      "score": 0.000001
    },
    {
      "id": "wallpaper-043",
      "score": 0.000001
    },
    {
      "id": "wallpaper-045",
      "score": 0.000001
    },
    {
      "id": "wallpaper-046",
      "score": 0.000001
    },
    {
      "id": "wallpaper-047",
      "score": 0.000001
    },
    {
      "id": "wallpaper-049",
      "score": 0.000001
    },
    {
      "id": "wallpaper-050",
      "score": 0.000001
    },
    {
      "id": "wallpaper-051",
      "score": 0.000001
    },
    {
      "id": "wallpaper-053",
      "score": 0.000001
    },
    {
      "id": "wallpaper-054",
      "score": 0.000001
    },
    {
      "id": "wallpaper-055",
      "score": 0.000001
    },
    {
      "id": "wallpaper-056",
      "score": 0.000001
    },
    {
      "id": "wallpaper-059",
      "score": 0.000001
    },
    {
      "id": "wallpaper-061",
      "score": 0.000001
    },
    {
      "id": "wallpaper-062",
      "score": 0.000001
    },
    {
      "id": "wallpaper-063",
      "score": 0.000001
    },
    {
      "id": "wallpaper-064",
      "score": 0.000001
    },
    {
      "id": "wallpaper-065",
      "score": 0.000001
    },
    {
      "id": "wallpaper-066",
      "score": 0.000001
    },
    {
      "id": "wallpaper-067",
      "score": 0.000001
    },
    {
      "id": "wallpaper-068",
      "score": 0.000001
    },
    {
      "id": "wallpaper-069",
      "score": 0.000001
    },
    {
      "id": "wallpaper-070",
      "score": 0.000001
    },
    {
      "id": "wallpaper-071",
      "score": 0.000001
    },
    {
      "id": "wallpaper-072",
      "score": 0.000001
    },
    {
      "id": "wallpaper-073",
      "score": 0.000001
    },
    {
      "id": "wallpaper-074",
      "score": 0.000001
    },
    {
      "id": "wallpaper-075",
      "score": 0.000001
    },
    {
      "id": "wallpaper-076",
      "score": 0.000001
    },
    {
      "id": "wallpaper-078",
      "score": 0.000001
    },
    {
      "id": "wallpaper-079",
      "score": 0.000001
    },
    {
      "id": "wallpaper-080",
      "score": 0.000001
    },
    {
      "id": "wallpaper-081",
      "score": 0.000001
    },
    {
      "id": "wallpaper-083",
      "score": 0.000001
    },
    {
      "id": "wallpaper-085",
      "score": 0.000001
    },
    {
      "id": "wallpaper-086",
      "score": 0.000001
    },
    {
      "id": "wallpaper-088",
      "score": 0.000001
    },
    {
      "id": "wallpaper-089",
      "score": 0.000001
    },
    {
      "id": "wallpaper-090",
      "score": 0.000001
    },
    {
      "id": "wallpaper-091",
      "score": 0.000001
    },
    {
      "id": "wallpaper-092",
      "score": 0.000001
    },
    {
      "id": "wallpaper-093",
      "score": 0.000001
    },
    {
      "id": "wallpaper-095",
      "score": 0.000001
    },
    {
      "id": "wallpaper-096",
      "score": 0.000001
    },
    {
      "id": "wallpaper-098",
      "score": 0.000001
    },
    {
      "id": "wallpaper-099",
      "score": 0.000001
    }
  ],
  "performance": {
    "samplesMs": [
      2.757798000000008,
      1.3588860000000125,
      1.4352509999999938,
      1.4390870000000007,
      1.821437000000003,
      1.5271529999999984,
      1.462602000000004,
      1.5190880000000107,
      1.982529999999997,
      1.411535999999984
    ],
    "sampleCount": 10,
    "p50Ms": 1.462602000000004,
    "p95Ms": 2.757798000000008,
    "maxMs": 2.757798000000008,
    "failures": 0,
    "trials": [
      {
        "round": 0,
        "elapsedMs": 2.757798000000008,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 1,
        "elapsedMs": 1.3588860000000125,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 2,
        "elapsedMs": 1.4352509999999938,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 3,
        "elapsedMs": 1.4390870000000007,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 4,
        "elapsedMs": 1.821437000000003,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 5,
        "elapsedMs": 1.5271529999999984,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 6,
        "elapsedMs": 1.462602000000004,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 7,
        "elapsedMs": 1.5190880000000107,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 8,
        "elapsedMs": 1.982529999999997,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      },
      {
        "round": 9,
        "elapsedMs": 1.411535999999984,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
        "accuracy": {
          "metricPolicy": "strict-pair-query-macro-v1",
          "caseId": "precision-shade-001",
          "category": "Precision",
          "categories": [
            "Precision"
          ],
          "groupId": "source-group-553e4282f980",
          "status": "complete",
          "allPairs": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "withoutUncertain": {
            "agreement": 0.8,
            "assessedPairs": 5,
            "totalPairs": 5,
            "coverage": 1,
            "concordant": 4,
            "discordant": 1,
            "tied": 0
          },
          "coverage": {
            "expectedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "returnedIds": [
              "precision-shade-001-a",
              "precision-shade-001-b",
              "precision-shade-001-c",
              "precision-shade-001-d"
            ],
            "missingIds": [],
            "fraction": 1
          },
          "eligibility": {
            "excludedReturned": [],
            "violations": 0
          },
          "discrepancies": [
            {
              "preferred": "precision-shade-001-a",
              "other": "precision-shade-001-c",
              "uncertain": false,
              "outcome": "discordant",
              "credit": 0
            }
          ]
        },
        "backendTookMs": null
      }
    ],
    "firstSuccessfulRound": 0,
    "requestedSamples": 10
  }
}
```

### semantic-red-city-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": "Assuming C matches the city tag.",
  "orderGroups": [
    [
      "wallpaper-027"
    ],
    [
      "wallpaper-029"
    ],
    [
      "wallpaper-022"
    ]
  ],
  "notes": [
    "User judgments recorded: C > D > A if C matches the city tag; B is excluded for subject mismatch.",
    "Subject eligibility is separate from color ranking in this case. B's red match does not compensate for not being a city. A and D remain eligible despite weak red matches.",
    "This is an intent-elicitation case, not a test of existing subject tags. No City metadata has been assigned or verified; source filenames and folders do not establish eligibility.",
    "Earlier red/dark/combination judgments on these images remain in their original cases; they are not transferred to the combined query.",
    "All four images have appeared in earlier development reviews. Keep related image/query evidence together when establishing later held-out evaluation groups.",
    "No originals or previews were altered, and no search method or scoring formula was used to generate this presentation.",
    "The user judged A an unequivocal city match ('city 100%'); do not treat this as image-area coverage or a calibrated confidence number.",
    "C's possible village identity is a conditional observation, not verified metadata. The comment about the author does not establish a universal metadata-authority policy.",
    "No red-only ordering involving B was supplied. Earlier red-query rankings are not transferred.",
    "The required city-tag interpretation is specific to this case; it does not define all natural-language subject requests as hard filters.",
    "No numeric relevance grades, minimum red amount, cutoff or scoring formula was supplied."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "semantic-red-city-order-001",
        "source": "user-response-001",
        "type": "relative-order-among-eligible-images",
        "condition": "Assuming C matches the city tag.",
        "orderedLabels": [
          "C",
          "D",
          "A"
        ],
        "orderedWallpaperIds": [
          "wallpaper-027",
          "wallpaper-029",
          "wallpaper-022"
        ],
        "excludedLabels": [
          "B"
        ],
        "tiesReported": false,
        "scope": "The user explicitly excludes B for subject mismatch. B has no position in this ranking. C's eligibility is unresolved; its actual tag was not checked. No numeric scores or score distances supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A city 100%, and there is some car lights that are red - city matches, red matches weakly\nB that's not a city, but it is red - city doesn't match so would be excluded, red matches\nC thats either a village or a less tall part of a city, and it has a red vibe for sure - city might match (if the author says its a village, then its a village), red matches\nD this is a city, and it has a red sign - city matches red matches less weakly, but still weakly\n\nAssuming C matches 'city' tag ranking would be:\n\nC, D, A with B excluded"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### proportion-green-001: unsupported

```json
{
  "query": {
    "userText": "40% green; the rest doesn’t matter",
    "intent": "Aim close to 40% total green; green is a named color with no specified hex. Explore how amount and shade quality affect result preference.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60,
    "preciseHex": null,
    "subjectConstraint": null,
    "priorClarification": "The user confirmed that 40% is a target rather than a minimum: for otherwise comparable results, 40% green should rank above 80% green."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "proportion-green-001-f"
    ],
    [
      "proportion-green-001-c"
    ],
    [
      "proportion-green-001-d"
    ],
    [
      "proportion-green-001-a"
    ],
    [
      "proportion-green-001-b"
    ],
    [
      "proportion-green-001-e"
    ]
  ],
  "notes": [
    "User judged F > C > D > A > B > E. F is described as the right amount and very green; no numeric grade or maximum score supplied.",
    "Prior target-versus-minimum clarification preserved. The latest response adds an explicit less-than-half interpretation for this 40% target.",
    "Band percentages and hex values are construction facts. Do not convert geometric band area automatically into perceived green area or quality.",
    "The query names green without selecting a reference swatch. F's shade is positively judged in this example, not declared the unique ideal for all named-green requests.",
    "Alternate shades change multiple visual properties; this is not an isolated hue-only or saturation-only comparison.",
    "C20% and A60% have equal geometric absolute error from40% using the same source shade; the user prefers C. Preserve this asymmetry for the comparison without inventing a universal under/over-target formula.",
    "Do not treat lower-quality green as a fractional amount of an ideal green without a separate user clarification.",
    "The rest is unspecified in the query but held gray in this case. These examples cannot establish treatment of arbitrary colorful remainders or extra green elsewhere.",
    "User descriptions of green quality, estimated perceived amount, and whole-result preferences should be recorded separately.",
    "All six variants belong to one related development group. Abstract fixture judgments need later real-wallpaper validation.",
    "Browser scaling may antialias band edges. Source colors and geometry are pinned; display calibration and perceived color are not verified.",
    "No corpus photos, original manifest, search method, descriptor, OpenSearch index, harness or benchmark was changed.",
    "Preserve the raw typo 'grean' in A and uppercase emphasis 'WAY TOO MUCH GREEN' in E; normalized summaries may use green.",
    "B and D are described as the right amount of green, alongside more-gray and more-yellow shade observations. Preserve both statements; do not reduce their subjective green amounts by an invented membership factor.",
    "No numeric perceived-green area, strength, relevance score, tolerance threshold or outright exclusion supplied for any example.",
    "The less-than-half explanation does not establish exclusion above50%, a discontinuous step at50%, or behavior exactly at50%. None of those nearby values were presented.",
    "C20% outranks D40%, and A60% outranks B40%. These are concrete amount/quality tradeoffs, not proof of a universal area-versus-shade weighting.",
    "F's positive assessment applies to this controlled comparison; real-wallpaper amount/quality behavior still needs validation."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "green-proportion-order-001",
        "source": "user-response-001",
        "type": "named-color-proportion-result-preference",
        "orderedLabels": [
          "F",
          "C",
          "D",
          "A",
          "B",
          "E"
        ],
        "orderedWallpaperIds": [
          "proportion-green-001-f",
          "proportion-green-001-c",
          "proportion-green-001-d",
          "proportion-green-001-a",
          "proportion-green-001-b",
          "proportion-green-001-e"
        ],
        "tiesReported": false,
        "scope": "One explicit overall order for the 40% named-green query. No numeric score distances or rejection labels supplied. Source band areas and subjective amount/color-quality observations remain separate."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A Too much grean\nB Right amount of green, but it doesnt feel very green its more gray than anything\nC Too little green\nD Right amount of green, but its more yellow than green\nE WAY TOO MUCH GREEN\nF Right amount of green and it is very green\n\nF, C, D, A, B, E\n\n40% feels like 'less than half', so if you have more than half green that makes it feel off"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development anchor"
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-a3e4a0d9003a",
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
        "proportion-green-001-a",
        "proportion-green-001-b",
        "proportion-green-001-c",
        "proportion-green-001-d",
        "proportion-green-001-e",
        "proportion-green-001-f"
      ],
      "returnedIds": [],
      "missingIds": [
        "proportion-green-001-a",
        "proportion-green-001-b",
        "proportion-green-001-c",
        "proportion-green-001-d",
        "proportion-green-001-e",
        "proportion-green-001-f"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-a",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-a",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-b",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-001",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-a3e4a0d9003a",
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
        "proportion-green-001-a",
        "proportion-green-001-b",
        "proportion-green-001-c",
        "proportion-green-001-d",
        "proportion-green-001-e",
        "proportion-green-001-f"
      ],
      "returnedIds": [],
      "missingIds": [
        "proportion-green-001-a",
        "proportion-green-001-b",
        "proportion-green-001-c",
        "proportion-green-001-d",
        "proportion-green-001-e",
        "proportion-green-001-f"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-f",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-c",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-d",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-a",
        "other": "proportion-green-001-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-a",
        "other": "proportion-green-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-001-b",
        "other": "proportion-green-001-e",
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### proportion-green-002: unsupported

```json
{
  "query": {
    "userText": "40% green; the rest doesn’t matter",
    "intent": "Aim close to 40% total green. Gather amount preferences and their perceived strength, holding source shades and background fixed.",
    "specifiedPercentages": [
      {
        "colorName": "green",
        "targetImagePercent": 40
      }
    ],
    "unspecifiedRemainderPercent": 60,
    "preciseHex": null,
    "subjectConstraint": null,
    "priorEvidence": {
      "case": "proportion-green-001",
      "source": "user-response-001",
      "summary": "The user preferred20% over60% of the same green for this40% query and explained that40% feels like less than half. This does not set expected outcomes here."
    }
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "proportion-green-002-f"
    ],
    [
      "proportion-green-002-c"
    ],
    [
      "proportion-green-002-d"
    ],
    [
      "proportion-green-002-a"
    ],
    [
      "proportion-green-002-b"
    ],
    [
      "proportion-green-002-e"
    ]
  ],
  "notes": [
    "User judged the shuffled presentation2. Tentative order A > E > C > B > F > D, qualified by 'something like that?'. Preserve uncertainty without inventing ties or numerical confidence.",
    "Ranking alone cannot establish how strong a preference is or whether a penalty changes smoothly or abruptly.",
    "Do not infer a50% hard cutoff, discontinuity or universal undershoot preference from this single informed follow-up.",
    "Exactly50% is not shown; no behavior at that value may be filled in.",
    "All six source bands share the same green as the previous vivid-green fixtures; no new color-quality ranking is presumed.",
    "There is no new40% candidate. Do not invent cross-case ordering against the earlier40% reference.",
    "Same-band-source-shade geometry isolates amount changes but does not prove perceived color quality is independent of area or context.",
    "Version2 hides candidate areas and relabels a persisted shuffle at the user's request. Prior exposure to version1 and the hypothesis remains; do not describe this as an independent blind review.",
    "Practically interchangeable results need not receive equal model scores; preserve user confidence and preference strength without numerical invention.",
    "Gray remainder is a controlled case condition, not an additional query requirement. No claims about other remainders or targets follow.",
    "All variants belong to green-target-amount development group, including the previous case. Natural-image validation remains needed.",
    "Right/almost right, slightly too little, a bit too much and too much/little remain the user's qualitative amount observations. No measured perceived-area values supplied.",
    "No explicit interchangeable groups or substantial pairwise gaps were identified; differenceStrengthJudgments remains empty.",
    "All three equal-geometric-error comparisons favor the under-target example in this tentative order, including pairs below half. This is suggestive case evidence, not a universal undershoot rule.",
    "B ranks above F, so an under-target result is not always preferred to an over-target result.",
    "B49% versus D51% differs in absolute target error as well as being below/above half; order alone cannot establish a50% discontinuity or a large score gap.",
    "Do not expose hidden source percentages or remapping in the user-facing response unless requested. Presentation2 remains unchanged for possible revisions."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "green-closer-amount-order-001",
        "source": "user-response-001",
        "presentationVersion": 2,
        "type": "named-color-proportion-result-preference",
        "status": "tentative",
        "certaintyDescription": "something like that?",
        "orderedLabels": [
          "A",
          "E",
          "C",
          "B",
          "F",
          "D"
        ],
        "orderedWallpaperIds": [
          "proportion-green-002-f",
          "proportion-green-002-c",
          "proportion-green-002-d",
          "proportion-green-002-a",
          "proportion-green-002-b",
          "proportion-green-002-e"
        ],
        "tiesReported": false,
        "scope": "The user supplies a complete order but explicitly qualifies it. Preserve as a tentative overall ordering, not firm pairwise ground truth. No numeric confidence, score gaps, interchangeability groups or rejection labels supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "presentationVersion": 2,
        "text": "A right amount of green\nB a bit too much green\nC Slightly too little green\nD too much green\nE almost right amount of green\nF too little green\n\nA, E, C, B, F, D\n\nsomething like that?"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "related development follow-up"
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-002",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-a3e4a0d9003a",
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
        "proportion-green-002-f",
        "proportion-green-002-a",
        "proportion-green-002-d",
        "proportion-green-002-e",
        "proportion-green-002-c",
        "proportion-green-002-b"
      ],
      "returnedIds": [],
      "missingIds": [
        "proportion-green-002-f",
        "proportion-green-002-a",
        "proportion-green-002-d",
        "proportion-green-002-e",
        "proportion-green-002-c",
        "proportion-green-002-b"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-a",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-a",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-b",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "proportion-green-002",
    "category": "Combinations",
    "categories": [
      "Combinations",
      "Perceived color"
    ],
    "groupId": "source-group-a3e4a0d9003a",
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
        "proportion-green-002-f",
        "proportion-green-002-a",
        "proportion-green-002-d",
        "proportion-green-002-e",
        "proportion-green-002-c",
        "proportion-green-002-b"
      ],
      "returnedIds": [],
      "missingIds": [
        "proportion-green-002-f",
        "proportion-green-002-a",
        "proportion-green-002-d",
        "proportion-green-002-e",
        "proportion-green-002-c",
        "proportion-green-002-b"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-f",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-c",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-d",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-a",
        "other": "proportion-green-002-b",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-a",
        "other": "proportion-green-002-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "proportion-green-002-b",
        "other": "proportion-green-002-e",
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-green-red-001: unsupported

```json
{
  "query": {
    "userText": "50% green, 50% red",
    "intent": "Find close matches to two named-color amount targets. Gather preferences across proportions, shade quality and another color without a predetermined tradeoff.",
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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "composition-green-red-001-b"
    ],
    [
      "composition-green-red-001-d"
    ],
    [
      "composition-green-red-001-e"
    ],
    [
      "composition-green-red-001-f"
    ],
    [
      "composition-green-red-001-a"
    ],
    [
      "composition-green-red-001-c"
    ]
  ],
  "notes": [
    "User supplied B > D > E > F > A > C for these fixtures, plus a strong caveat about real-image validity. No numeric ratings or rejection labels.",
    "Candidate percentages are hidden at the user's request; query target percentages stay visible. Do not reveal candidate facts in user-facing replies before judgment unless requested.",
    "The variant names and geometric fractions are authoring facts, not human perceived membership or quality.",
    "Only the green fill changes in the shade variant; do not transfer earlier single-green judgments automatically to this composition.",
    "Base red is a source choice, not a user-confirmed ideal named red. Perceived balance may depend on both colors.",
    "Reciprocal ratio errors need not imply equal relevance.",
    "The user's earlier conceptual grayscale/red preference does not establish a universal rejection of blue in all fully specified requests.",
    "Blue's fixed edge position, width and contrast may affect prominence. This cannot establish preferences over all spatial layouts.",
    "All images and the planned follow-up belong to one green-red-specified-remainder development group; do not count repeated-image results as independent held-out evidence.",
    "The partial-query stripe follow-up remains authorized but is deferred while prioritizing natural-image validation after the user's realism caveat. This is an assistant workflow adjustment, not a user cancellation.",
    "Keep subjective amount, shade quality, relevance, exclusions and uncertainty distinct. Do not turn rank differences into numeric gaps.",
    "No search method, harness, descriptor, index, benchmark or production behavior changed.",
    "A/C's 'right ratio' observations concern the relative green:red balance. Extra blue means neither has50% of the whole image in each requested color. Do not convert ratio fit into exact full-image amount fit.",
    "B is an explicit perfect reference within this constructed set, not a confirmed ideal natural wallpaper.",
    "D's weaker green observation has no calibrated quality or effective-area number.",
    "The supplied order is retained; the user did not retract it or give ties. Uncertainty concerns realism and especially transferring A-versus-E to photos.",
    "Do not infer a universal extra-color veto, purity weighting, shade weighting or preferred under/overshoot from this case.",
    "Pause the second stripe request and gather natural-image judgments; preserve its previous authorization and planned query for possible later use."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "green-red-composition-order-001",
        "source": "user-response-001",
        "type": "two-color-composition-result-preference",
        "orderedLabels": [
          "B",
          "D",
          "E",
          "F",
          "A",
          "C"
        ],
        "orderedWallpaperIds": [
          "composition-green-red-001-b",
          "composition-green-red-001-d",
          "composition-green-red-001-e",
          "composition-green-red-001-f",
          "composition-green-red-001-a",
          "composition-green-red-001-c"
        ],
        "tiesReported": false,
        "status": "reported-with-real-image-transfer-caveat",
        "scope": "Order supplied for the constructed set. The user finds pure colors hard to judge as a proxy for real preference and specifically doubts whether A would rank below E in a real example. Do not use the order as universal real-wallpaper ground truth."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "text": "A This is very close to the right ratio, but it has an extra color\nB This is the perfect example\nC This has a lot of blue, red and green are in the right ratio\nD Its green, but not very green\nE Too little green\nF Too much green\n\nB, D, E, F, A, C\n\nTBH, with these pure colors it is hard to tell what my real preference is. No body is searching for pure colors so I dont know if I would actually score A below E in a real example."
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": [
      {
        "source": "user-response-001",
        "description": "With pure colors it is hard for the user to tell their real preference; people are not searching for pure-color blocks.",
        "specificComparison": {
          "labels": [
            "A",
            "E"
          ],
          "reportedFixturePreference": "E over A",
          "realImagePreference": "Uncertain; the user does not know whether A should rank below E in a real example."
        },
        "consequence": "Preserve the fixture order as contextual evidence. Validate the tradeoff with real wallpapers before defining general scoring rules."
      }
    ],
    "use": "development anchor"
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-001",
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
        "composition-green-red-001-a",
        "composition-green-red-001-b",
        "composition-green-red-001-c",
        "composition-green-red-001-d",
        "composition-green-red-001-e",
        "composition-green-red-001-f"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-green-red-001-a",
        "composition-green-red-001-b",
        "composition-green-red-001-c",
        "composition-green-red-001-d",
        "composition-green-red-001-e",
        "composition-green-red-001-f"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-f",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-f",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-a",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      }
    ]
  },
  "timedAccuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "composition-green-red-001",
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
        "composition-green-red-001-a",
        "composition-green-red-001-b",
        "composition-green-red-001-c",
        "composition-green-red-001-d",
        "composition-green-red-001-e",
        "composition-green-red-001-f"
      ],
      "returnedIds": [],
      "missingIds": [
        "composition-green-red-001-a",
        "composition-green-red-001-b",
        "composition-green-red-001-c",
        "composition-green-red-001-d",
        "composition-green-red-001-e",
        "composition-green-red-001-f"
      ],
      "fraction": 0
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-d",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-b",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-e",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-d",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-f",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-e",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-f",
        "other": "composition-green-red-001-a",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-f",
        "other": "composition-green-red-001-c",
        "uncertain": false,
        "outcome": "missing",
        "credit": null
      },
      {
        "preferred": "composition-green-red-001-a",
        "other": "composition-green-red-001-c",
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-green-red-real-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-082"
    ],
    [
      "evaluation-green-red-tulips"
    ],
    [
      "evaluation-green-red-leaves"
    ],
    [
      "evaluation-green-red-tulip-field"
    ]
  ],
  "notes": [
    "This case follows an explicit realism caveat on composition-green-red-001. The constructed B>D>E>F>A>C order remains recorded, with uncertain transfer, especially A vs E.",
    "Different scenes cannot isolate a causal effect of additional blue, shade quality, proportion, subject, contrast or spatial arrangement. This does not exactly recreate the stripe A/E contrast.",
    "Do not treat visual selection notes, source titles, old sampling metadata or past single-red judgments as relevance labels for this query.",
    "The user supplied D>A>B>C and qualitative whole-image assessments. No measured color percentages, calibrated numeric scores, score gaps or exact50/50 composition were supplied.",
    "Keep related composition cases and overlapping images together in any later evaluation split. This is development evidence, not held-out validation.",
    "The four images are original source bytes. Browser display scales the complete image; no local image generation, recoloring, cropping or resampling was performed.",
    "Shared storage is /home/rafaeltab/.local/share/wallpaperdb/color-evaluation; corpus URLs expose hard links. The original100-image manifest and historical indexes remain unchanged.",
    "The previously authorized partial-composition stripe query is deferred by assistant workflow after the user questioned realism, not cancelled by the user.",
    "No algorithm prototypes, benchmarks or OpenSearch changes are part of this review.",
    "A's insufficient-red amount observation is distinct from B's insufficient-red strength observation and D's wish for brighter red and green. Do not collapse them into one numeric membership value.",
    "C is explicitly not what the user seeks for this query, beyond merely ranking last. The user did not state why, impose a general blue veto, require exclusion from all results or supply a hard relevance threshold.",
    "D's brightness limitation does not imply that making every color brighter always improves relevance. These scenes do not isolate saturation, luminance, hue, proportion or context.",
    "The new natural-photo preference does not settle or overturn the constructed A/E tradeoff; labels refer to different images in the two cases."
  ],
  "evidenceContext": {
    "quickPass": false,
    "originalJudgments": [
      {
        "id": "natural-green-red-order-001",
        "source": "user-response-001",
        "type": "whole-image-composition-order",
        "orderedLabels": [
          "D",
          "A",
          "B",
          "C"
        ],
        "orderedWallpaperIds": [
          "wallpaper-082",
          "evaluation-green-red-tulips",
          "evaluation-green-red-leaves",
          "evaluation-green-red-tulip-field"
        ],
        "tiesReported": false,
        "scope": "Relative preference in this four-photo presentation for50%green50%red. D is explicitly really good with a brightness limitation; C explicitly mismatches the query. No numerical grades, score gaps or hard exclusion rule supplied."
      }
    ],
    "rawAnswer": null,
    "rawUserResponses": [
      {
        "id": "user-response-001",
        "author": "user",
        "recordedDate": "2026-09-17",
        "text": "A Feels nicely 'red and green', but there is not enough red\nB The red isn't strong enough\nC This is not what I am looking for with this search\nD Really good, would need brighter red and green to feel perfect\n\nD, A, B, C"
      }
    ],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "related development follow-up"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-green-red-real-002: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "evaluation-green-red-leaves"
    ],
    [
      "wallpaper-082"
    ],
    [
      "evaluation-green-red-tulips"
    ],
    [
      "evaluation-green-red-tulip-field"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "composition-green-red-real-002",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "C"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:29:00.066Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Red",
    "detail": "A wallpaper that feels red."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-037"
    ],
    [
      "wallpaper-095"
    ],
    [
      "wallpaper-084"
    ],
    [
      "wallpaper-044"
    ]
  ],
  "notes": [
    "pink doesnt feel red at all"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "perceived-red-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "D"
        ]
      ],
      "notes": "pink doesnt feel red at all",
      "updatedAt": "2026-09-19T22:29:25.297Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-orange-batch-001: unsupported

```json
{
  "query": {
    "text": "Orange",
    "detail": "A wallpaper that feels orange."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-031"
    ],
    [
      "wallpaper-046"
    ],
    [
      "wallpaper-036"
    ],
    [
      "wallpaper-087"
    ]
  ],
  "notes": [
    "Rock doesnt feel orange"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "perceived-orange-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "D"
        ],
        [
          "C"
        ]
      ],
      "notes": "Rock doesnt feel orange",
      "updatedAt": "2026-09-19T22:29:44.160Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-pink-batch-001: unsupported

```json
{
  "query": {
    "text": "Pink",
    "detail": "A wallpaper that feels pink."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-044"
    ],
    [
      "wallpaper-039"
    ],
    [
      "wallpaper-033"
    ],
    [
      "wallpaper-048"
    ]
  ],
  "notes": [
    "The roses  don't feel pink"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "perceived-pink-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "A"
        ],
        [
          "C"
        ]
      ],
      "notes": "The roses  don't feel pink",
      "updatedAt": "2026-09-19T22:30:13.765Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-green-batch-001: unsupported

```json
{
  "query": {
    "text": "Green",
    "detail": "A wallpaper that feels green."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-086"
    ],
    [
      "wallpaper-050"
    ],
    [
      "wallpaper-083"
    ],
    [
      "wallpaper-093"
    ]
  ],
  "notes": [
    "Not sure about A and B order"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "perceived-green-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "D"
        ],
        [
          "C"
        ],
        [
          "A"
        ],
        [
          "B"
        ]
      ],
      "notes": "Not sure about A and B order",
      "updatedAt": "2026-09-19T22:30:41.964Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [
      {
        "labels": [
          "A",
          "B"
        ],
        "wallpaperIds": [
          "wallpaper-083",
          "wallpaper-093"
        ],
        "source": "rawAnswer.notes",
        "treatment": "Keep the submitted order and this uncertainty; do not replace it with a tie or numeric confidence."
      }
    ],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### perceived-blue-batch-001: unsupported

```json
{
  "query": {
    "text": "Blue",
    "detail": "A wallpaper that feels blue."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-091"
    ],
    [
      "wallpaper-030"
    ],
    [
      "wallpaper-047"
    ],
    [
      "wallpaper-010"
    ]
  ],
  "notes": [
    "Not sure about B and D order. \n\nA feels very brightly blue, C has a lot of less bright blue, B doesnt feel as convincingly blue as D, maybe because D has the blue as the focus point?"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "perceived-blue-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "D"
        ],
        [
          "B"
        ]
      ],
      "notes": "Not sure about B and D order. \n\nA feels very brightly blue, C has a lot of less bright blue, B doesnt feel as convincingly blue as D, maybe because D has the blue as the focus point?",
      "updatedAt": "2026-09-19T22:31:49.693Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [
      {
        "labels": [
          "B",
          "D"
        ],
        "wallpaperIds": [
          "wallpaper-010",
          "wallpaper-047"
        ],
        "source": "rawAnswer.notes",
        "treatment": "Keep the submitted order and this uncertainty; do not replace it with a tie or numeric confidence."
      }
    ],
    "interpretationFlags": [
      {
        "type": "user-hypothesis-not-established-cause",
        "explanation": "The user tentatively suggests blue focal prominence; do not treat this as a demonstrated spatial ranking rule."
      }
    ],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### proportion-green-real-batch-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-093"
    ],
    [
      "wallpaper-081"
    ],
    [
      "wallpaper-083"
    ],
    [
      "wallpaper-050"
    ]
  ],
  "notes": [
    "not sure about B and D order"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "proportion-green-real-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ]
      ],
      "notes": "not sure about B and D order",
      "updatedAt": "2026-09-19T22:32:15.440Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [
      {
        "labels": [
          "B",
          "D"
        ],
        "wallpaperIds": [
          "wallpaper-083",
          "wallpaper-050"
        ],
        "source": "rawAnswer.notes",
        "treatment": "Keep the submitted order and this uncertainty; do not replace it with a tie or numeric confidence."
      }
    ],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### proportion-green-real-batch-002: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-086"
    ],
    [
      "wallpaper-050"
    ],
    [
      "wallpaper-012"
    ],
    [
      "wallpaper-090"
    ]
  ],
  "notes": [
    "A isn't very green. C doesnt have enough green"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "proportion-green-real-batch-002",
      "status": "ranked",
      "ranking": [
        [
          "D"
        ],
        [
          "B"
        ],
        [
          "C"
        ],
        [
          "A"
        ]
      ],
      "notes": "A isn't very green. C doesnt have enough green",
      "updatedAt": "2026-09-19T22:32:54.041Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### proportion-red-real-batch-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-029"
    ],
    [
      "wallpaper-060"
    ],
    [
      "wallpaper-084"
    ],
    [
      "wallpaper-082"
    ]
  ],
  "notes": [
    "B feels more red than A. C feels like it has too much red. D definitely has too much red."
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "proportion-red-real-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "D"
        ]
      ],
      "notes": "B feels more red than A. C feels like it has too much red. D definitely has too much red.",
      "updatedAt": "2026-09-19T22:33:32.444Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-dark-batch-001: unsupported

```json
{
  "query": {
    "text": "Dark",
    "detail": "A wallpaper that feels dark."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-067"
    ],
    [
      "wallpaper-011"
    ],
    [
      "wallpaper-079"
    ],
    [
      "wallpaper-075"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-dark-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "C"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:33:41.790Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-light-batch-001: unsupported

```json
{
  "query": {
    "text": "Light",
    "detail": "A wallpaper that feels light."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-088"
    ],
    [
      "wallpaper-051"
    ],
    [
      "wallpaper-073"
    ],
    [
      "wallpaper-096"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-light-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "D"
        ],
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "C"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:33:58.603Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-vivid-batch-001: unsupported

```json
{
  "query": {
    "text": "Bright, vivid colors",
    "detail": "A colorful wallpaper with a bright, vivid feel."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-094"
    ],
    [
      "wallpaper-032"
    ],
    [
      "wallpaper-052"
    ],
    [
      "wallpaper-098"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-vivid-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "D"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:34:09.469Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-strict-grayscale-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale",
    "detail": "Specifically black, white and gray; colored tints are not the goal."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-068"
    ],
    [
      "wallpaper-070"
    ],
    [
      "wallpaper-071"
    ],
    [
      "wallpaper-007"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-strict-grayscale-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "C"
        ],
        [
          "A"
        ],
        [
          "D"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:34:24.822Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-near-neutral-batch-001: unsupported

```json
{
  "query": {
    "text": "Almost grayscale",
    "detail": "Very little color overall; a subtle warm or cool tint is fine."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-007"
    ],
    [
      "wallpaper-071"
    ],
    [
      "wallpaper-062"
    ],
    [
      "wallpaper-096"
    ]
  ],
  "notes": [
    "those flowers dont feel close to grayscale"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-near-neutral-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "C"
        ],
        [
          "D"
        ],
        [
          "A"
        ],
        [
          "B"
        ]
      ],
      "notes": "those flowers dont feel close to grayscale",
      "updatedAt": "2026-09-19T22:34:43.636Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-monochromatic-batch-001: unsupported

```json
{
  "query": {
    "text": "One hue overall",
    "detail": "A monochromatic feel: shades of one color. It does not have to be gray."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-009"
    ],
    [
      "wallpaper-091"
    ],
    [
      "wallpaper-008"
    ],
    [
      "wallpaper-004"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-monochromatic-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "D"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:34:58.628Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### combination-gray-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "evaluation-gray-red-002-telephone"
    ],
    [
      "wallpaper-060"
    ],
    [
      "wallpaper-063"
    ],
    [
      "wallpaper-095"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "combination-gray-red-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "A"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:35:12.781Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-gray-red-batch-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "evaluation-gray-red-002-umbrella"
    ],
    [
      "wallpaper-048"
    ],
    [
      "wallpaper-042"
    ],
    [
      "wallpaper-060"
    ]
  ],
  "notes": [
    "white just isn't grayscale, its just white. I mean technically it isnt, but when you search for grayscale you're not looking for white, you're looking for grayscale. I dont know why I put C above B, but it definitely feels better."
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "composition-gray-red-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ]
      ],
      "notes": "white just isn't grayscale, its just white. I mean technically it isnt, but when you search for grayscale you're not looking for white, you're looking for grayscale. I dont know why I put C above B, but it definitely feels better.",
      "updatedAt": "2026-09-19T22:37:47.946Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [
      {
        "type": "unexplained-reason-not-uncertain-order",
        "labels": [
          "C",
          "B"
        ],
        "explanation": "The user does not know why C is above B but explicitly says it definitely feels better. Preserve the reported order; this is not an additional uncertain pair."
      }
    ],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-gray-red-batch-002: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "evaluation-gray-red-002-umbrella"
    ],
    [
      "wallpaper-042"
    ],
    [
      "wallpaper-048"
    ],
    [
      "wallpaper-060"
    ]
  ],
  "notes": [
    "with this percentage, the roses just have too much red to justify. "
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "composition-gray-red-batch-002",
      "status": "ranked",
      "ranking": [
        [
          "D"
        ],
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "C"
        ]
      ],
      "notes": "with this percentage, the roses just have too much red to justify. ",
      "updatedAt": "2026-09-19T22:38:18.865Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### vibe-dark-accents-batch-001: unsupported

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-005"
    ],
    [
      "wallpaper-022"
    ],
    [
      "wallpaper-032"
    ],
    [
      "wallpaper-015"
    ]
  ],
  "notes": [
    "B has a dark vibe. I wouldn't necessarily describe black as dark, so maybe it should be lower ranked?"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "vibe-dark-accents-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ]
      ],
      "notes": "B has a dark vibe. I wouldn't necessarily describe black as dark, so maybe it should be lower ranked?",
      "updatedAt": "2026-09-19T22:39:07.758Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [
      {
        "type": "ambiguous-placement-question",
        "explanation": "The dark/black note questions a placement, but its referent and intended pair are unclear. Preserve the note and order without assigning a specific pair or excluding black from dark."
      }
    ],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-blue-orange-batch-001: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-058"
    ],
    [
      "wallpaper-002"
    ],
    [
      "wallpaper-040"
    ],
    [
      "wallpaper-057"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "composition-blue-orange-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "A"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:39:54.264Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### composition-blue-orange-batch-002: unsupported

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
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-058"
    ],
    [
      "wallpaper-040"
    ],
    [
      "wallpaper-002"
    ],
    [
      "wallpaper-057"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "composition-blue-orange-batch-002",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "A"
        ],
        [
          "D"
        ],
        [
          "C"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:40:03.336Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

### precision-warm-red-batch-001: ok

```json
{
  "query": {
    "text": "Close to #FF2200",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#FF2200"
  },
  "status": "ok",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-037"
    ],
    [
      "wallpaper-082"
    ],
    [
      "wallpaper-087"
    ],
    [
      "wallpaper-046"
    ]
  ],
  "notes": [],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "precision-warm-red-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "D"
        ],
        [
          "B"
        ],
        [
          "C"
        ],
        [
          "A"
        ]
      ],
      "notes": "",
      "updatedAt": "2026-09-19T22:40:27.908Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
  "searchEvidence": {
    "evidence": {
      "index": "color-exploration-precision-grid-real-v2",
      "serviceTookMs": 4,
      "httpMs": 7.888271000000003,
      "engine": "opensearch",
      "method": "rank-features-precision-grid",
      "approximate": false
    }
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-warm-red-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "complete",
    "allPairs": {
      "agreement": 1,
      "assessedPairs": 6,
      "totalPairs": 6,
      "coverage": 1,
      "concordant": 6,
      "discordant": 0,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": 1,
      "assessedPairs": 6,
      "totalPairs": 6,
      "coverage": 1,
      "concordant": 6,
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
      "returnedIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087",
        "wallpaper-037"
      ],
      "missingIds": [],
      "fraction": 1
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": []
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
      "returnedIds": [
        "wallpaper-037"
      ],
      "missingIds": [
        "wallpaper-046",
        "wallpaper-082",
        "wallpaper-087"
      ],
      "fraction": 0.25
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
  "hits": [
    {
      "id": "precision-shade-001-b",
      "score": 0.8344189
    },
    {
      "id": "composition-green-red-001-a",
      "score": 0.8339259
    },
    {
      "id": "composition-green-red-001-e",
      "score": 0.83267224
    },
    {
      "id": "composition-green-red-001-b",
      "score": 0.83197796
    },
    {
      "id": "composition-green-red-001-d",
      "score": 0.83197796
    },
    {
      "id": "composition-green-red-001-c",
      "score": 0.8306283
    },
    {
      "id": "composition-green-red-001-f",
      "score": 0.82831466
    },
    {
      "id": "precision-shade-001-d",
      "score": 0.82707345
    },
    {
      "id": "precision-shade-001-c",
      "score": 0.82307684
    },
    {
      "id": "precision-shade-001-a",
      "score": 0.77685237
    },
    {
      "id": "madness-wallhaven-w55xgp",
      "score": 0.73739314
    },
    {
      "id": "evaluation-green-red-tulips",
      "score": 0.73117733
    },
    {
      "id": "madness-wallhaven-rqqjrj",
      "score": 0.70609415
    },
    {
      "id": "madness-wallhaven-e88v9o",
      "score": 0.6912917
    },
    {
      "id": "wallpaper-037",
      "score": 0.6883593
    },
    {
      "id": "madness-wallhaven-9mrgk1",
      "score": 0.68671143
    },
    {
      "id": "madness-wallhaven-xeewg3",
      "score": 0.6790705
    },
    {
      "id": "madness-wallhaven-j5eqpw",
      "score": 0.6443206
    },
    {
      "id": "madness-wallhaven-d88evl",
      "score": 0.6438763
    },
    {
      "id": "madness-wallhaven-lyyv8r",
      "score": 0.6408969
    },
    {
      "id": "madness-wallhaven-gwwvqe",
      "score": 0.6253978
    },
    {
      "id": "madness-wallhaven-gwwkql",
      "score": 0.6153828
    },
    {
      "id": "madness-wallhaven-9oozpx",
      "score": 0.6000527
    },
    {
      "id": "madness-wallhaven-rqq1ww",
      "score": 0.5612288
    },
    {
      "id": "evaluation-green-red-tulip-field",
      "score": 0.54662246
    },
    {
      "id": "madness-wallhaven-9639xx",
      "score": 0.54615355
    },
    {
      "id": "madness-wallhaven-k9m277",
      "score": 0.54439867
    },
    {
      "id": "madness-wallhaven-gww27e",
      "score": 0.5430187
    },
    {
      "id": "madness-wallhaven-vmwlmm",
      "score": 0.536436
    },
    {
      "id": "madness-wallhaven-gwwxpl",
      "score": 0.53439415
    },
    {
      "id": "wallpaper-040",
      "score": 0.5281988
    },
    {
      "id": "madness-wallhaven-1qqlew",
      "score": 0.5250165
    },
    {
      "id": "madness-wallhaven-6llzk6",
      "score": 0.52265435
    },
    {
      "id": "madness-wallhaven-poo7gj",
      "score": 0.5118483
    },
    {
      "id": "madness-wallhaven-ox2ool",
      "score": 0.50885314
    },
    {
      "id": "madness-wallhaven-mdoqxy",
      "score": 0.50611496
    },
    {
      "id": "madness-wallhaven-poowxp",
      "score": 0.49013716
    },
    {
      "id": "madness-wallhaven-7j3lve",
      "score": 0.4894179
    },
    {
      "id": "madness-wallhaven-9oov2d",
      "score": 0.48266864
    },
    {
      "id": "madness-wallhaven-lyydwl",
      "score": 0.44178432
    },
    {
      "id": "wallpaper-031",
      "score": 0.43409607
    },
    {
      "id": "madness-wallhaven-vppd75",
      "score": 0.4234938
    },
    {
      "id": "madness-wallhaven-xl57go",
      "score": 0.4230847
    },
    {
      "id": "wallpaper-082",
      "score": 0.41825414
    },
    {
      "id": "wallpaper-094",
      "score": 0.4124681
    },
    {
      "id": "madness-wallhaven-8368k1",
      "score": 0.39226356
    },
    {
      "id": "madness-wallhaven-v9qkgm",
      "score": 0.39106032
    },
    {
      "id": "wallpaper-058",
      "score": 0.3900519
    },
    {
      "id": "madness-wallhaven-xe6qdv",
      "score": 0.36212882
    },
    {
      "id": "madness-wallhaven-xeejzz",
      "score": 0.35969663
    },
    {
      "id": "wallpaper-036",
      "score": 0.35392615
    },
    {
      "id": "wallpaper-004",
      "score": 0.33996806
    },
    {
      "id": "madness-wallhaven-gwwlm3",
      "score": 0.33593625
    },
    {
      "id": "madness-wallhaven-rqqjl7",
      "score": 0.33481783
    },
    {
      "id": "madness-wallhaven-13qmlw",
      "score": 0.32371166
    },
    {
      "id": "madness-wallhaven-jeel8q",
      "score": 0.32004797
    },
    {
      "id": "madness-wallhaven-3qqgrv",
      "score": 0.3115374
    },
    {
      "id": "madness-wallhaven-3qq5lv",
      "score": 0.30939937
    },
    {
      "id": "madness-wallhaven-gwwmxq",
      "score": 0.30810845
    },
    {
      "id": "madness-wallhaven-yqqrp7",
      "score": 0.30639803
    },
    {
      "id": "wallpaper-084",
      "score": 0.29436946
    },
    {
      "id": "wallpaper-052",
      "score": 0.293888
    },
    {
      "id": "madness-wallhaven-w55m8x",
      "score": 0.2910643
    },
    {
      "id": "madness-wallhaven-e88qdr",
      "score": 0.26972857
    },
    {
      "id": "madness-wallhaven-95jgkk",
      "score": 0.25467086
    },
    {
      "id": "madness-wallhaven-oggv5m",
      "score": 0.247421
    },
    {
      "id": "wallpaper-035",
      "score": 0.24420536
    },
    {
      "id": "wallpaper-027",
      "score": 0.24275942
    },
    {
      "id": "madness-wallhaven-qrre8l",
      "score": 0.23998803
    },
    {
      "id": "madness-wallhaven-q625eq",
      "score": 0.2251354
    },
    {
      "id": "madness-wallhaven-jeed6q",
      "score": 0.21636556
    },
    {
      "id": "wallpaper-029",
      "score": 0.2107518
    },
    {
      "id": "madness-wallhaven-qrrq67",
      "score": 0.21070443
    },
    {
      "id": "wallpaper-025",
      "score": 0.20244046
    },
    {
      "id": "madness-wallhaven-lyyko2",
      "score": 0.1851381
    },
    {
      "id": "madness-wallhaven-rqqygw",
      "score": 0.17327482
    },
    {
      "id": "madness-wallhaven-yq8k2d",
      "score": 0.165595
    },
    {
      "id": "madness-wallhaven-poov9e",
      "score": 0.16470216
    },
    {
      "id": "madness-wallhaven-ymg9kx",
      "score": 0.15629472
    },
    {
      "id": "madness-wallhaven-k881gm",
      "score": 0.13911656
    },
    {
      "id": "madness-wallhaven-jeev6q",
      "score": 0.13759905
    },
    {
      "id": "madness-wallhaven-9ooez8",
      "score": 0.13302411
    },
    {
      "id": "wallpaper-087",
      "score": 0.13261469
    },
    {
      "id": "wallpaper-048",
      "score": 0.122633316
    },
    {
      "id": "madness-wallhaven-jeerzw",
      "score": 0.11413845
    },
    {
      "id": "wallpaper-060",
      "score": 0.10875498
    },
    {
      "id": "madness-wallhaven-lmk37p",
      "score": 0.095576875
    },
    {
      "id": "madness-wallhaven-yqqww7",
      "score": 0.09451801
    },
    {
      "id": "madness-wallhaven-p8jqem",
      "score": 0.09425559
    },
    {
      "id": "madness-wallhaven-xeeomd",
      "score": 0.09425559
    },
    {
      "id": "madness-wallhaven-vpp2g5",
      "score": 0.08715207
    },
    {
      "id": "madness-wallhaven-jeejqm",
      "score": 0.08712314
    },
    {
      "id": "wallpaper-044",
      "score": 0.08513418
    },
    {
      "id": "madness-wallhaven-eojxrr",
      "score": 0.082502216
    },
    {
      "id": "madness-wallhaven-yqqoek",
      "score": 0.08175319
    },
    {
      "id": "wallpaper-038",
      "score": 0.078803934
    },
    {
      "id": "madness-wallhaven-vppry3",
      "score": 0.07705506
    },
    {
      "id": "madness-wallhaven-2112dx",
      "score": 0.074388824
    },
    {
      "id": "madness-wallhaven-3qqgo3",
      "score": 0.07355336
    },
    {
      "id": "madness-wallhaven-k88ld6",
      "score": 0.06902481
    },
    {
      "id": "madness-wallhaven-gwwq8e",
      "score": 0.067904845
    },
    {
      "id": "madness-wallhaven-lyy22q",
      "score": 0.066872224
    },
    {
      "id": "madness-wallhaven-j3511m",
      "score": 0.06642582
    },
    {
      "id": "madness-wallhaven-w553y6",
      "score": 0.0647708
    },
    {
      "id": "madness-wallhaven-rqqw2q",
      "score": 0.06320129
    },
    {
      "id": "madness-wallhaven-9oo8k1",
      "score": 0.058735546
    },
    {
      "id": "wallpaper-042",
      "score": 0.058559556
    },
    {
      "id": "madness-wallhaven-gww23l",
      "score": 0.055243857
    },
    {
      "id": "madness-wallhaven-d88253",
      "score": 0.05359076
    },
    {
      "id": "madness-wallhaven-1qqdgw",
      "score": 0.04763504
    },
    {
      "id": "wallpaper-057",
      "score": 0.04459457
    },
    {
      "id": "madness-wallhaven-ogg23p",
      "score": 0.04350925
    },
    {
      "id": "madness-wallhaven-1qqok3",
      "score": 0.042438
    },
    {
      "id": "madness-wallhaven-ml91l9",
      "score": 0.041904844
    },
    {
      "id": "madness-wallhaven-yqqe27",
      "score": 0.04158668
    },
    {
      "id": "madness-wallhaven-vmwp58",
      "score": 0.04054061
    },
    {
      "id": "madness-wallhaven-1j9v7w",
      "score": 0.038513627
    },
    {
      "id": "madness-wallhaven-qrrox7",
      "score": 0.036486648
    },
    {
      "id": "madness-wallhaven-rqq1mm",
      "score": 0.036486648
    },
    {
      "id": "madness-wallhaven-3qq6m3",
      "score": 0.035004772
    },
    {
      "id": "madness-wallhaven-e8865l",
      "score": 0.032432687
    },
    {
      "id": "madness-wallhaven-jeej1q",
      "score": 0.03163542
    },
    {
      "id": "madness-wallhaven-rqqxew",
      "score": 0.030742379
    },
    {
      "id": "wallpaper-097",
      "score": 0.029392218
    },
    {
      "id": "madness-wallhaven-wqvoxr",
      "score": 0.029118052
    },
    {
      "id": "madness-wallhaven-d882g3",
      "score": 0.026374416
    },
    {
      "id": "madness-wallhaven-lmmxol",
      "score": 0.025689393
    },
    {
      "id": "madness-wallhaven-5gk313",
      "score": 0.020059174
    },
    {
      "id": "madness-wallhaven-6ll5z7",
      "score": 0.019694695
    },
    {
      "id": "madness-wallhaven-qrrlq7",
      "score": 0.018368533
    },
    {
      "id": "madness-wallhaven-d88mmj",
      "score": 0.018325524
    },
    {
      "id": "madness-wallhaven-yqq3wd",
      "score": 0.018278154
    },
    {
      "id": "wallpaper-100",
      "score": 0.017071867
    },
    {
      "id": "madness-wallhaven-jeekxm",
      "score": 0.017003579
    },
    {
      "id": "madness-wallhaven-1qqxlv",
      "score": 0.016298544
    },
    {
      "id": "madness-wallhaven-ml3ke9",
      "score": 0.016216844
    },
    {
      "id": "madness-wallhaven-2119jg",
      "score": 0.015203354
    },
    {
      "id": "madness-wallhaven-6o2qd7",
      "score": 0.012162883
    },
    {
      "id": "madness-wallhaven-9oog5d",
      "score": 0.011918603
    },
    {
      "id": "madness-wallhaven-xee33d",
      "score": 0.011149393
    },
    {
      "id": "madness-wallhaven-lyyk7y",
      "score": 0.009122413
    },
    {
      "id": "madness-wallhaven-jeek5p",
      "score": 0.007842035
    },
    {
      "id": "madness-wallhaven-6lly96",
      "score": 0.00759904
    },
    {
      "id": "madness-wallhaven-k88kzd",
      "score": 0.005455457
    },
    {
      "id": "madness-wallhaven-zppd8y",
      "score": 0.0044430997
    },
    {
      "id": "madness-wallhaven-211xrg",
      "score": 0.0043240064
    },
    {
      "id": "wallpaper-077",
      "score": 0.0043240064
    },
    {
      "id": "madness-wallhaven-6lle1w",
      "score": 0.004054961
    },
    {
      "id": "madness-wallhaven-6llp5q",
      "score": 0.0028830043
    },
    {
      "id": "madness-wallhaven-6ll7dx",
      "score": 0.0025253224
    },
    {
      "id": "wallpaper-002",
      "score": 0.0014420021
    },
    {
      "id": "wallpaper-016",
      "score": 0.0010144903
    },
    {
      "id": "evaluation-gray-red-002-telephone",
      "score": 0.000001
    },
    {
      "id": "evaluation-gray-red-002-umbrella",
      "score": 0.000001
    },
    {
      "id": "evaluation-green-red-leaves",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqe13",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqer1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqlq1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqmk3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqrev",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqwq3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-1qqx1g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-21127y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211519",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2115ky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2116k9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211986",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-2119yx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211d1x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211dyx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211er6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211jgy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211lky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211wjx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-21yp59",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qlxjy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq589",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq5j3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq7j9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qq8jd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqem9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqrp3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqv1d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqvk9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-3qqygv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5ygeg7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy3d3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy6r9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yy8v1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyj69",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yymd3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyme5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yymk9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yypm9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyq53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyrx5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyy85",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll2dq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll2zw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll57w",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll7pq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6lle7l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llemx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llg7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llgd6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llm17",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llmg7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llpwq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llrk7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llrl7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llwv6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llzrw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6llzxw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-73og6v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj1p3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj1qo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jj7ey",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jje13",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjkde",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjm3v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjo5e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjom3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jjwp3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-7jp81o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8g5qr2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg1do",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg1g2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg61j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gg6eo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggdxo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8gge6y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggez2",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggm6k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggrqy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwl1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwro",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-8ggwyj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo2dk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo2k1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oo7od",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9ooe6d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9ooe9k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oolmx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oop2d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oopek",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oor8k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oow11",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9oow31",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d882yl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88d53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88jym",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88k3m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88q5g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88qeo",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88v3o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88v53",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88vyl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88w2l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88z63",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d8gygl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d8pk8m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e873x8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e881lw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e882dk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e8891l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88pr8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88pxk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88q7k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88r8o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88rok",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88vyk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwpo6e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww16q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww69l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww9kd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gww9yl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdeq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdm3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdpe",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwdrd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwweme",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwkoq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwm6d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwq27",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwqvq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwv23",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwv9e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwvpe",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwxwl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-j52vqm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee15p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee1rw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jee8ry",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeedjw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeek6q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeekjy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeelj5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeokp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeoxq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeoym",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeozw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeep8w",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeepkq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeq3q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeqxq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeer9q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeerxp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeevkm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeew7y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeewoy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeey2y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeey9q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeypy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jexkwm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k881zd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88291",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k883md",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k885z7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88g21",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88jld",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88jv6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88z5m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88zgm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-kwxod1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lql7vp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyy7kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyg8p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyj52",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyjvy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyker",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyykvy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyp9y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyypwr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyr9r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyywml",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyx5q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyx7l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyxjp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-lyyxqy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-m9vqy9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mdvo1y",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ml3jm8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mll1mm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mll1ry",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllelk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllg19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllm61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllr38",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllr61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllrdk",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllv3k",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllvky",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllvr9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllw19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllw39",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mlly98",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-mllykm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg1kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg1wl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg6q7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg6zm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogg7ql",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-ogge85",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggl19",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggvw9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggw5p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-po9eop",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo1kp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo5pj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo99j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poog2e",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poojxm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poomw3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poopke",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qr27rq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrr3m5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrre3d",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrejd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrey5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrkor",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrldr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrlzr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrmp5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrroml",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-qrrv3r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-r7kpmm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-r7kqj1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqe7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqgkq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqj61",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqoem",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqop1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqw7q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqwgj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqwpw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-rqqy5m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp19p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp1vl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpp6d5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppd8p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppdjm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppedl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpplmp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppo6p",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpprr8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppv3l",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppy93",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppyjp",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vpqk88",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w5531x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w556l7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w557rr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55dp6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55gjr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55kvr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55lqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55lz6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mgq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mzq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55re6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55rr7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55vwr",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55w3r",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w5eq57",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-x8359z",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee36v",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee3kz",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee3wz",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee72o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee7dd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xee7jd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xeejw3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-xeezqv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-y89mld",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq21g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq3px",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq5rg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq68g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqemd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqewx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqkdg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqqrg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqrgl",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqv3x",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqvv7",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqw7g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqqwvd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqxzqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp3mg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp5ww",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp5yy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp6mw",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppjyg",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppq2j",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppqdv",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpproy",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppv8g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zppz3w",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-a",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-b",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-c",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-d",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-e",
      "score": 0.000001
    },
    {
      "id": "proportion-green-001-f",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-a",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-b",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-c",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-d",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-e",
      "score": 0.000001
    },
    {
      "id": "proportion-green-002-f",
      "score": 0.000001
    },
    {
      "id": "wallpaper-001",
      "score": 0.000001
    },
    {
      "id": "wallpaper-003",
      "score": 0.000001
    },
    {
      "id": "wallpaper-005",
      "score": 0.000001
    },
    {
      "id": "wallpaper-006",
      "score": 0.000001
    },
    {
      "id": "wallpaper-007",
      "score": 0.000001
    },
    {
      "id": "wallpaper-008",
      "score": 0.000001
    },
    {
      "id": "wallpaper-009",
      "score": 0.000001
    },
    {
      "id": "wallpaper-010",
      "score": 0.000001
    },
    {
      "id": "wallpaper-011",
      "score": 0.000001
    },
    {
      "id": "wallpaper-012",
      "score": 0.000001
    },
    {
      "id": "wallpaper-013",
      "score": 0.000001
    },
    {
      "id": "wallpaper-014",
      "score": 0.000001
    },
    {
      "id": "wallpaper-015",
      "score": 0.000001
    },
    {
      "id": "wallpaper-017",
      "score": 0.000001
    },
    {
      "id": "wallpaper-018",
      "score": 0.000001
    },
    {
      "id": "wallpaper-019",
      "score": 0.000001
    },
    {
      "id": "wallpaper-020",
      "score": 0.000001
    },
    {
      "id": "wallpaper-021",
      "score": 0.000001
    },
    {
      "id": "wallpaper-022",
      "score": 0.000001
    },
    {
      "id": "wallpaper-023",
      "score": 0.000001
    },
    {
      "id": "wallpaper-024",
      "score": 0.000001
    },
    {
      "id": "wallpaper-026",
      "score": 0.000001
    },
    {
      "id": "wallpaper-028",
      "score": 0.000001
    },
    {
      "id": "wallpaper-030",
      "score": 0.000001
    },
    {
      "id": "wallpaper-032",
      "score": 0.000001
    },
    {
      "id": "wallpaper-033",
      "score": 0.000001
    },
    {
      "id": "wallpaper-034",
      "score": 0.000001
    },
    {
      "id": "wallpaper-039",
      "score": 0.000001
    },
    {
      "id": "wallpaper-041",
      "score": 0.000001
    },
    {
      "id": "wallpaper-043",
      "score": 0.000001
    },
    {
      "id": "wallpaper-045",
      "score": 0.000001
    },
    {
      "id": "wallpaper-046",
      "score": 0.000001
    },
    {
      "id": "wallpaper-047",
      "score": 0.000001
    },
    {
      "id": "wallpaper-049",
      "score": 0.000001
    },
    {
      "id": "wallpaper-050",
      "score": 0.000001
    },
    {
      "id": "wallpaper-051",
      "score": 0.000001
    },
    {
      "id": "wallpaper-053",
      "score": 0.000001
    },
    {
      "id": "wallpaper-054",
      "score": 0.000001
    },
    {
      "id": "wallpaper-055",
      "score": 0.000001
    },
    {
      "id": "wallpaper-056",
      "score": 0.000001
    },
    {
      "id": "wallpaper-059",
      "score": 0.000001
    },
    {
      "id": "wallpaper-061",
      "score": 0.000001
    },
    {
      "id": "wallpaper-062",
      "score": 0.000001
    },
    {
      "id": "wallpaper-063",
      "score": 0.000001
    },
    {
      "id": "wallpaper-064",
      "score": 0.000001
    },
    {
      "id": "wallpaper-065",
      "score": 0.000001
    },
    {
      "id": "wallpaper-066",
      "score": 0.000001
    },
    {
      "id": "wallpaper-067",
      "score": 0.000001
    },
    {
      "id": "wallpaper-068",
      "score": 0.000001
    },
    {
      "id": "wallpaper-069",
      "score": 0.000001
    },
    {
      "id": "wallpaper-070",
      "score": 0.000001
    },
    {
      "id": "wallpaper-071",
      "score": 0.000001
    },
    {
      "id": "wallpaper-072",
      "score": 0.000001
    },
    {
      "id": "wallpaper-073",
      "score": 0.000001
    },
    {
      "id": "wallpaper-074",
      "score": 0.000001
    },
    {
      "id": "wallpaper-075",
      "score": 0.000001
    },
    {
      "id": "wallpaper-076",
      "score": 0.000001
    },
    {
      "id": "wallpaper-078",
      "score": 0.000001
    },
    {
      "id": "wallpaper-079",
      "score": 0.000001
    },
    {
      "id": "wallpaper-080",
      "score": 0.000001
    },
    {
      "id": "wallpaper-081",
      "score": 0.000001
    },
    {
      "id": "wallpaper-083",
      "score": 0.000001
    },
    {
      "id": "wallpaper-085",
      "score": 0.000001
    },
    {
      "id": "wallpaper-086",
      "score": 0.000001
    },
    {
      "id": "wallpaper-088",
      "score": 0.000001
    },
    {
      "id": "wallpaper-089",
      "score": 0.000001
    },
    {
      "id": "wallpaper-090",
      "score": 0.000001
    },
    {
      "id": "wallpaper-091",
      "score": 0.000001
    },
    {
      "id": "wallpaper-092",
      "score": 0.000001
    },
    {
      "id": "wallpaper-093",
      "score": 0.000001
    },
    {
      "id": "wallpaper-095",
      "score": 0.000001
    },
    {
      "id": "wallpaper-096",
      "score": 0.000001
    },
    {
      "id": "wallpaper-098",
      "score": 0.000001
    },
    {
      "id": "wallpaper-099",
      "score": 0.000001
    }
  ],
  "performance": {
    "samplesMs": [
      2.114719000000008,
      1.5393160000000137,
      1.5062839999999937,
      1.405163999999985,
      1.4560999999999922,
      1.7765729999999849,
      1.4272959999999841,
      1.4658880000000067,
      1.8625650000000178,
      1.36584000000002
    ],
    "sampleCount": 10,
    "p50Ms": 1.4658880000000067,
    "p95Ms": 2.114719000000008,
    "maxMs": 2.114719000000008,
    "failures": 0,
    "trials": [
      {
        "round": 0,
        "elapsedMs": 2.114719000000008,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 1,
        "elapsedMs": 1.5393160000000137,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 2,
        "elapsedMs": 1.5062839999999937,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 3,
        "elapsedMs": 1.405163999999985,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 4,
        "elapsedMs": 1.4560999999999922,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 5,
        "elapsedMs": 1.7765729999999849,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 6,
        "elapsedMs": 1.4272959999999841,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 7,
        "elapsedMs": 1.4658880000000067,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 8,
        "elapsedMs": 1.8625650000000178,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 9,
        "elapsedMs": 1.36584000000002,
        "hits": [
          {
            "id": "precision-shade-001-b",
            "score": 0.8344189
          },
          {
            "id": "composition-green-red-001-a",
            "score": 0.8339259
          },
          {
            "id": "composition-green-red-001-e",
            "score": 0.83267224
          },
          {
            "id": "composition-green-red-001-b",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-d",
            "score": 0.83197796
          },
          {
            "id": "composition-green-red-001-c",
            "score": 0.8306283
          },
          {
            "id": "composition-green-red-001-f",
            "score": 0.82831466
          },
          {
            "id": "precision-shade-001-d",
            "score": 0.82707345
          },
          {
            "id": "precision-shade-001-c",
            "score": 0.82307684
          },
          {
            "id": "precision-shade-001-a",
            "score": 0.77685237
          },
          {
            "id": "madness-wallhaven-w55xgp",
            "score": 0.73739314
          },
          {
            "id": "evaluation-green-red-tulips",
            "score": 0.73117733
          },
          {
            "id": "madness-wallhaven-rqqjrj",
            "score": 0.70609415
          },
          {
            "id": "madness-wallhaven-e88v9o",
            "score": 0.6912917
          },
          {
            "id": "wallpaper-037",
            "score": 0.6883593
          },
          {
            "id": "madness-wallhaven-9mrgk1",
            "score": 0.68671143
          },
          {
            "id": "madness-wallhaven-xeewg3",
            "score": 0.6790705
          },
          {
            "id": "madness-wallhaven-j5eqpw",
            "score": 0.6443206
          },
          {
            "id": "madness-wallhaven-d88evl",
            "score": 0.6438763
          },
          {
            "id": "madness-wallhaven-lyyv8r",
            "score": 0.6408969
          }
        ],
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
            "returnedIds": [
              "wallpaper-037"
            ],
            "missingIds": [
              "wallpaper-046",
              "wallpaper-082",
              "wallpaper-087"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      }
    ],
    "firstSuccessfulRound": 0,
    "requestedSamples": 10
  }
}
```

### precision-muted-green-batch-001: ok

```json
{
  "query": {
    "text": "Close to #4C8C72",
    "detail": "Find a wallpaper whose colors feel close to this selected shade. Exact equality is not required.",
    "swatchHex": "#4C8C72"
  },
  "status": "ok",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-052"
    ],
    [
      "wallpaper-013"
    ],
    [
      "wallpaper-093"
    ],
    [
      "wallpaper-086"
    ]
  ],
  "notes": [
    "not sure about the last two"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "precision-muted-green-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "B"
        ],
        [
          "D"
        ],
        [
          "C"
        ],
        [
          "A"
        ]
      ],
      "notes": "not sure about the last two",
      "updatedAt": "2026-09-19T22:40:53.462Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [
      {
        "labels": [
          "C",
          "A"
        ],
        "wallpaperIds": [
          "wallpaper-093",
          "wallpaper-086"
        ],
        "source": "rawAnswer.notes",
        "treatment": "Keep the submitted order and this uncertainty; do not replace it with a tie or numeric confidence."
      }
    ],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
  "searchEvidence": {
    "evidence": {
      "index": "color-exploration-precision-grid-real-v2",
      "serviceTookMs": 4,
      "httpMs": 8.490544,
      "engine": "opensearch",
      "method": "rank-features-precision-grid",
      "approximate": false
    }
  },
  "accuracy": {
    "metricPolicy": "strict-pair-query-macro-v1",
    "caseId": "precision-muted-green-batch-001",
    "category": "Precision",
    "categories": [
      "Precision"
    ],
    "groupId": "source-group-f6e60d783503",
    "status": "complete",
    "allPairs": {
      "agreement": 0.8333333333333334,
      "assessedPairs": 6,
      "totalPairs": 6,
      "coverage": 1,
      "concordant": 5,
      "discordant": 1,
      "tied": 0
    },
    "withoutUncertain": {
      "agreement": 1,
      "assessedPairs": 5,
      "totalPairs": 5,
      "coverage": 1,
      "concordant": 5,
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
      "returnedIds": [
        "wallpaper-086",
        "wallpaper-052",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "missingIds": [],
      "fraction": 1
    },
    "eligibility": {
      "excludedReturned": [],
      "violations": 0
    },
    "discrepancies": [
      {
        "preferred": "wallpaper-093",
        "other": "wallpaper-086",
        "uncertain": true,
        "outcome": "discordant",
        "credit": 0
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
      "returnedIds": [
        "wallpaper-052"
      ],
      "missingIds": [
        "wallpaper-086",
        "wallpaper-093",
        "wallpaper-013"
      ],
      "fraction": 0.25
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
  "hits": [
    {
      "id": "composition-green-red-001-d",
      "score": 0.7555116
    },
    {
      "id": "madness-wallhaven-w55mqx",
      "score": 0.7347015
    },
    {
      "id": "madness-wallhaven-9oozpx",
      "score": 0.73340714
    },
    {
      "id": "madness-wallhaven-qrrkor",
      "score": 0.695022
    },
    {
      "id": "madness-wallhaven-zppjyg",
      "score": 0.6865564
    },
    {
      "id": "wallpaper-029",
      "score": 0.6847205
    },
    {
      "id": "madness-wallhaven-k88291",
      "score": 0.68452585
    },
    {
      "id": "proportion-green-001-b",
      "score": 0.6838457
    },
    {
      "id": "madness-wallhaven-7jj7ey",
      "score": 0.68201023
    },
    {
      "id": "madness-wallhaven-rqqwgj",
      "score": 0.6797568
    },
    {
      "id": "madness-wallhaven-xeejzz",
      "score": 0.67888576
    },
    {
      "id": "madness-wallhaven-gww9yl",
      "score": 0.6763496
    },
    {
      "id": "madness-wallhaven-po9eop",
      "score": 0.67310435
    },
    {
      "id": "wallpaper-083",
      "score": 0.67297167
    },
    {
      "id": "madness-wallhaven-gwwq27",
      "score": 0.67163616
    },
    {
      "id": "madness-wallhaven-lyyx7l",
      "score": 0.6685
    },
    {
      "id": "madness-wallhaven-xee7dd",
      "score": 0.6671441
    },
    {
      "id": "wallpaper-050",
      "score": 0.6669265
    },
    {
      "id": "wallpaper-052",
      "score": 0.6660232
    },
    {
      "id": "wallpaper-012",
      "score": 0.66174054
    },
    {
      "id": "madness-wallhaven-rqqwpw",
      "score": 0.6593584
    },
    {
      "id": "wallpaper-089",
      "score": 0.65934366
    },
    {
      "id": "wallpaper-058",
      "score": 0.65746367
    },
    {
      "id": "wallpaper-026",
      "score": 0.6566754
    },
    {
      "id": "madness-wallhaven-3qqv1d",
      "score": 0.65454257
    },
    {
      "id": "madness-wallhaven-lyyxqy",
      "score": 0.65356433
    },
    {
      "id": "madness-wallhaven-k88jv6",
      "score": 0.6521785
    },
    {
      "id": "wallpaper-071",
      "score": 0.6520683
    },
    {
      "id": "wallpaper-013",
      "score": 0.6507701
    },
    {
      "id": "madness-wallhaven-e881lw",
      "score": 0.64958763
    },
    {
      "id": "wallpaper-017",
      "score": 0.6483439
    },
    {
      "id": "wallpaper-019",
      "score": 0.6465466
    },
    {
      "id": "madness-wallhaven-ogg6zm",
      "score": 0.64460665
    },
    {
      "id": "madness-wallhaven-mllvky",
      "score": 0.64349467
    },
    {
      "id": "madness-wallhaven-lyyr9r",
      "score": 0.64327574
    },
    {
      "id": "madness-wallhaven-ogge85",
      "score": 0.6432488
    },
    {
      "id": "madness-wallhaven-zpp5yy",
      "score": 0.6428406
    },
    {
      "id": "madness-wallhaven-k885z7",
      "score": 0.64095306
    },
    {
      "id": "wallpaper-086",
      "score": 0.6409413
    },
    {
      "id": "madness-wallhaven-qrrlzr",
      "score": 0.64092296
    },
    {
      "id": "madness-wallhaven-6llmg7",
      "score": 0.6404554
    },
    {
      "id": "madness-wallhaven-d88mmj",
      "score": 0.6393589
    },
    {
      "id": "madness-wallhaven-2115ky",
      "score": 0.6393395
    },
    {
      "id": "madness-wallhaven-w5eq57",
      "score": 0.63924456
    },
    {
      "id": "madness-wallhaven-8ggdxo",
      "score": 0.6391173
    },
    {
      "id": "wallpaper-098",
      "score": 0.6382879
    },
    {
      "id": "wallpaper-024",
      "score": 0.63824666
    },
    {
      "id": "madness-wallhaven-6ll57w",
      "score": 0.6368625
    },
    {
      "id": "madness-wallhaven-gwwkoq",
      "score": 0.6362366
    },
    {
      "id": "wallpaper-081",
      "score": 0.63619274
    },
    {
      "id": "madness-wallhaven-w55dp6",
      "score": 0.6343586
    },
    {
      "id": "madness-wallhaven-k88jld",
      "score": 0.6338633
    },
    {
      "id": "madness-wallhaven-d88v3o",
      "score": 0.6326023
    },
    {
      "id": "madness-wallhaven-21yp59",
      "score": 0.63248736
    },
    {
      "id": "wallpaper-082",
      "score": 0.63187397
    },
    {
      "id": "wallpaper-055",
      "score": 0.630882
    },
    {
      "id": "wallpaper-020",
      "score": 0.63001114
    },
    {
      "id": "madness-wallhaven-6lly96",
      "score": 0.629776
    },
    {
      "id": "madness-wallhaven-ml91l9",
      "score": 0.6270093
    },
    {
      "id": "madness-wallhaven-gwwv23",
      "score": 0.6268324
    },
    {
      "id": "madness-wallhaven-d88k3m",
      "score": 0.62473094
    },
    {
      "id": "madness-wallhaven-qrre3d",
      "score": 0.62459207
    },
    {
      "id": "wallpaper-093",
      "score": 0.624368
    },
    {
      "id": "wallpaper-018",
      "score": 0.6243311
    },
    {
      "id": "madness-wallhaven-vpplmp",
      "score": 0.62397844
    },
    {
      "id": "madness-wallhaven-zppv8g",
      "score": 0.6237093
    },
    {
      "id": "wallpaper-099",
      "score": 0.6235574
    },
    {
      "id": "wallpaper-084",
      "score": 0.623164
    },
    {
      "id": "madness-wallhaven-d8gygl",
      "score": 0.622428
    },
    {
      "id": "madness-wallhaven-yqqww7",
      "score": 0.62156665
    },
    {
      "id": "madness-wallhaven-8gg1do",
      "score": 0.6201799
    },
    {
      "id": "wallpaper-096",
      "score": 0.61856145
    },
    {
      "id": "madness-wallhaven-5ygeg7",
      "score": 0.6181971
    },
    {
      "id": "madness-wallhaven-qrrejd",
      "score": 0.6178649
    },
    {
      "id": "madness-wallhaven-lyyg8p",
      "score": 0.6162488
    },
    {
      "id": "madness-wallhaven-3qqvk9",
      "score": 0.6149573
    },
    {
      "id": "madness-wallhaven-211d1x",
      "score": 0.614636
    },
    {
      "id": "madness-wallhaven-1qqmk3",
      "score": 0.613435
    },
    {
      "id": "evaluation-green-red-tulips",
      "score": 0.6129409
    },
    {
      "id": "madness-wallhaven-9oog5d",
      "score": 0.612675
    },
    {
      "id": "madness-wallhaven-mll1ry",
      "score": 0.6122044
    },
    {
      "id": "madness-wallhaven-poo5pj",
      "score": 0.61169523
    },
    {
      "id": "wallpaper-040",
      "score": 0.6109291
    },
    {
      "id": "madness-wallhaven-211lky",
      "score": 0.61049443
    },
    {
      "id": "wallpaper-075",
      "score": 0.60938436
    },
    {
      "id": "wallpaper-004",
      "score": 0.6081841
    },
    {
      "id": "madness-wallhaven-xee3wz",
      "score": 0.6081165
    },
    {
      "id": "madness-wallhaven-6llgd6",
      "score": 0.608004
    },
    {
      "id": "wallpaper-021",
      "score": 0.60771716
    },
    {
      "id": "madness-wallhaven-d882yl",
      "score": 0.6075354
    },
    {
      "id": "madness-wallhaven-7jj1qo",
      "score": 0.6075202
    },
    {
      "id": "wallpaper-078",
      "score": 0.60713625
    },
    {
      "id": "madness-wallhaven-k883md",
      "score": 0.6064057
    },
    {
      "id": "madness-wallhaven-9oopek",
      "score": 0.6061961
    },
    {
      "id": "evaluation-green-red-leaves",
      "score": 0.60601544
    },
    {
      "id": "madness-wallhaven-6llm17",
      "score": 0.60555786
    },
    {
      "id": "madness-wallhaven-vpp19p",
      "score": 0.60481733
    },
    {
      "id": "madness-wallhaven-w55kvr",
      "score": 0.60098684
    },
    {
      "id": "madness-wallhaven-6lle1w",
      "score": 0.599995
    },
    {
      "id": "madness-wallhaven-ml3ke9",
      "score": 0.5995998
    },
    {
      "id": "madness-wallhaven-jeew7y",
      "score": 0.5990798
    },
    {
      "id": "evaluation-gray-red-002-telephone",
      "score": 0.59905744
    },
    {
      "id": "wallpaper-061",
      "score": 0.59863675
    },
    {
      "id": "madness-wallhaven-e882dk",
      "score": 0.5985407
    },
    {
      "id": "madness-wallhaven-e88pr8",
      "score": 0.59788245
    },
    {
      "id": "madness-wallhaven-d88qeo",
      "score": 0.59735376
    },
    {
      "id": "madness-wallhaven-9oor8k",
      "score": 0.5965845
    },
    {
      "id": "madness-wallhaven-1qqxlv",
      "score": 0.59594524
    },
    {
      "id": "madness-wallhaven-p8jqem",
      "score": 0.5950609
    },
    {
      "id": "wallpaper-066",
      "score": 0.59407395
    },
    {
      "id": "wallpaper-034",
      "score": 0.5937995
    },
    {
      "id": "wallpaper-069",
      "score": 0.5937199
    },
    {
      "id": "wallpaper-076",
      "score": 0.5936283
    },
    {
      "id": "madness-wallhaven-poojxm",
      "score": 0.5928897
    },
    {
      "id": "madness-wallhaven-1qqx1g",
      "score": 0.5926861
    },
    {
      "id": "madness-wallhaven-ogg6q7",
      "score": 0.59253496
    },
    {
      "id": "madness-wallhaven-oggl19",
      "score": 0.59198314
    },
    {
      "id": "wallpaper-085",
      "score": 0.59153
    },
    {
      "id": "wallpaper-068",
      "score": 0.5913092
    },
    {
      "id": "madness-wallhaven-yqxzqx",
      "score": 0.59116817
    },
    {
      "id": "madness-wallhaven-gwwkql",
      "score": 0.5894607
    },
    {
      "id": "madness-wallhaven-yqq5rg",
      "score": 0.58935267
    },
    {
      "id": "madness-wallhaven-jee1rw",
      "score": 0.5889966
    },
    {
      "id": "madness-wallhaven-jeepkq",
      "score": 0.58848864
    },
    {
      "id": "madness-wallhaven-1qqwq3",
      "score": 0.5881618
    },
    {
      "id": "madness-wallhaven-jeeozw",
      "score": 0.5866885
    },
    {
      "id": "proportion-green-002-f",
      "score": 0.58221537
    },
    {
      "id": "madness-wallhaven-vppedl",
      "score": 0.58214813
    },
    {
      "id": "madness-wallhaven-8gge6y",
      "score": 0.58072037
    },
    {
      "id": "wallpaper-097",
      "score": 0.5789085
    },
    {
      "id": "madness-wallhaven-xee33d",
      "score": 0.57767045
    },
    {
      "id": "madness-wallhaven-5yyrx5",
      "score": 0.577351
    },
    {
      "id": "madness-wallhaven-gwwv9e",
      "score": 0.57548887
    },
    {
      "id": "madness-wallhaven-5yyq53",
      "score": 0.5745348
    },
    {
      "id": "wallpaper-064",
      "score": 0.574528
    },
    {
      "id": "madness-wallhaven-3qqrp3",
      "score": 0.5740018
    },
    {
      "id": "madness-wallhaven-5yyme5",
      "score": 0.5734216
    },
    {
      "id": "madness-wallhaven-6ll5z7",
      "score": 0.5733169
    },
    {
      "id": "madness-wallhaven-k881zd",
      "score": 0.57284874
    },
    {
      "id": "proportion-green-002-a",
      "score": 0.5720934
    },
    {
      "id": "proportion-green-001-a",
      "score": 0.57187116
    },
    {
      "id": "proportion-green-002-b",
      "score": 0.5704426
    },
    {
      "id": "proportion-green-002-c",
      "score": 0.56921405
    },
    {
      "id": "proportion-green-001-f",
      "score": 0.5685146
    },
    {
      "id": "evaluation-green-red-tulip-field",
      "score": 0.5683152
    },
    {
      "id": "madness-wallhaven-w556l7",
      "score": 0.5675532
    },
    {
      "id": "madness-wallhaven-e88pxk",
      "score": 0.5672008
    },
    {
      "id": "madness-wallhaven-3qqgrv",
      "score": 0.56682867
    },
    {
      "id": "proportion-green-002-e",
      "score": 0.5665601
    },
    {
      "id": "madness-wallhaven-qrrq67",
      "score": 0.56529737
    },
    {
      "id": "proportion-green-001-e",
      "score": 0.5640677
    },
    {
      "id": "proportion-green-001-c",
      "score": 0.5636637
    },
    {
      "id": "proportion-green-002-d",
      "score": 0.5629912
    },
    {
      "id": "madness-wallhaven-211519",
      "score": 0.56229776
    },
    {
      "id": "madness-wallhaven-zpproy",
      "score": 0.559599
    },
    {
      "id": "madness-wallhaven-k88zgm",
      "score": 0.55929965
    },
    {
      "id": "madness-wallhaven-mllykm",
      "score": 0.5571285
    },
    {
      "id": "wallpaper-070",
      "score": 0.55432093
    },
    {
      "id": "madness-wallhaven-lyyj52",
      "score": 0.5539094
    },
    {
      "id": "madness-wallhaven-eojxrr",
      "score": 0.551581
    },
    {
      "id": "madness-wallhaven-xee7jd",
      "score": 0.5512202
    },
    {
      "id": "wallpaper-027",
      "score": 0.5500695
    },
    {
      "id": "madness-wallhaven-ogg23p",
      "score": 0.54946864
    },
    {
      "id": "wallpaper-009",
      "score": 0.5482468
    },
    {
      "id": "madness-wallhaven-gwwdrd",
      "score": 0.5477757
    },
    {
      "id": "madness-wallhaven-mllw19",
      "score": 0.54671395
    },
    {
      "id": "madness-wallhaven-gwwqvq",
      "score": 0.54663765
    },
    {
      "id": "madness-wallhaven-poopke",
      "score": 0.54464513
    },
    {
      "id": "madness-wallhaven-m9vqy9",
      "score": 0.5440613
    },
    {
      "id": "wallpaper-042",
      "score": 0.5438105
    },
    {
      "id": "madness-wallhaven-yqq68g",
      "score": 0.5424879
    },
    {
      "id": "madness-wallhaven-5yy6r9",
      "score": 0.54004055
    },
    {
      "id": "madness-wallhaven-ogg1kp",
      "score": 0.53980714
    },
    {
      "id": "madness-wallhaven-xeewg3",
      "score": 0.53934944
    },
    {
      "id": "madness-wallhaven-1qqlq1",
      "score": 0.53927505
    },
    {
      "id": "madness-wallhaven-95jgkk",
      "score": 0.5385839
    },
    {
      "id": "madness-wallhaven-qr27rq",
      "score": 0.53688467
    },
    {
      "id": "proportion-green-001-d",
      "score": 0.5338988
    },
    {
      "id": "madness-wallhaven-lyyk7y",
      "score": 0.53263557
    },
    {
      "id": "madness-wallhaven-w55lz6",
      "score": 0.531092
    },
    {
      "id": "madness-wallhaven-d88w2l",
      "score": 0.5274692
    },
    {
      "id": "madness-wallhaven-qrrldr",
      "score": 0.51985335
    },
    {
      "id": "madness-wallhaven-xeezqv",
      "score": 0.5184834
    },
    {
      "id": "madness-wallhaven-3qq8jd",
      "score": 0.5179956
    },
    {
      "id": "precision-shade-001-c",
      "score": 0.51481164
    },
    {
      "id": "madness-wallhaven-poo99j",
      "score": 0.51433057
    },
    {
      "id": "precision-shade-001-b",
      "score": 0.514283
    },
    {
      "id": "precision-shade-001-d",
      "score": 0.514283
    },
    {
      "id": "madness-wallhaven-vppo6p",
      "score": 0.51143295
    },
    {
      "id": "madness-wallhaven-xl57go",
      "score": 0.5101
    },
    {
      "id": "madness-wallhaven-vppry3",
      "score": 0.5090152
    },
    {
      "id": "madness-wallhaven-rqqjrj",
      "score": 0.506865
    },
    {
      "id": "madness-wallhaven-zpp6mw",
      "score": 0.5052605
    },
    {
      "id": "madness-wallhaven-6llemx",
      "score": 0.5045042
    },
    {
      "id": "madness-wallhaven-rqqy5m",
      "score": 0.5041517
    },
    {
      "id": "madness-wallhaven-1qqe13",
      "score": 0.50269413
    },
    {
      "id": "madness-wallhaven-k88ld6",
      "score": 0.5024668
    },
    {
      "id": "madness-wallhaven-7jjm3v",
      "score": 0.50193113
    },
    {
      "id": "wallpaper-045",
      "score": 0.5018706
    },
    {
      "id": "madness-wallhaven-gwwdm3",
      "score": 0.5012462
    },
    {
      "id": "madness-wallhaven-jeejqm",
      "score": 0.500487
    },
    {
      "id": "wallpaper-056",
      "score": 0.49952292
    },
    {
      "id": "madness-wallhaven-rqq1ww",
      "score": 0.49910042
    },
    {
      "id": "madness-wallhaven-jeedjw",
      "score": 0.4986145
    },
    {
      "id": "madness-wallhaven-mllm61",
      "score": 0.49705568
    },
    {
      "id": "madness-wallhaven-lyykvy",
      "score": 0.49693143
    },
    {
      "id": "wallpaper-022",
      "score": 0.49660006
    },
    {
      "id": "wallpaper-001",
      "score": 0.49469647
    },
    {
      "id": "madness-wallhaven-8ggez2",
      "score": 0.49349833
    },
    {
      "id": "madness-wallhaven-jeeoym",
      "score": 0.49346304
    },
    {
      "id": "madness-wallhaven-d88evl",
      "score": 0.49270713
    },
    {
      "id": "precision-shade-001-a",
      "score": 0.49260795
    },
    {
      "id": "madness-wallhaven-xeeomd",
      "score": 0.49150315
    },
    {
      "id": "madness-wallhaven-jeeypy",
      "score": 0.48698437
    },
    {
      "id": "madness-wallhaven-2119jg",
      "score": 0.486003
    },
    {
      "id": "madness-wallhaven-vpqk88",
      "score": 0.4856946
    },
    {
      "id": "madness-wallhaven-r7kpmm",
      "score": 0.48535505
    },
    {
      "id": "madness-wallhaven-yq8k2d",
      "score": 0.48462373
    },
    {
      "id": "madness-wallhaven-gww9kd",
      "score": 0.48433492
    },
    {
      "id": "madness-wallhaven-mllvr9",
      "score": 0.4826257
    },
    {
      "id": "madness-wallhaven-21127y",
      "score": 0.48238912
    },
    {
      "id": "madness-wallhaven-jexkwm",
      "score": 0.48223022
    },
    {
      "id": "madness-wallhaven-9ooe9k",
      "score": 0.48056453
    },
    {
      "id": "madness-wallhaven-jee15p",
      "score": 0.48004723
    },
    {
      "id": "madness-wallhaven-vppd8p",
      "score": 0.4762394
    },
    {
      "id": "madness-wallhaven-w55mzq",
      "score": 0.4754059
    },
    {
      "id": "madness-wallhaven-w55re6",
      "score": 0.47427607
    },
    {
      "id": "madness-wallhaven-poov9e",
      "score": 0.47416472
    },
    {
      "id": "madness-wallhaven-yqq21g",
      "score": 0.47358486
    },
    {
      "id": "madness-wallhaven-7j3lve",
      "score": 0.47352776
    },
    {
      "id": "madness-wallhaven-qrrmp5",
      "score": 0.473331
    },
    {
      "id": "madness-wallhaven-3qqem9",
      "score": 0.47316962
    },
    {
      "id": "madness-wallhaven-poomw3",
      "score": 0.47194523
    },
    {
      "id": "madness-wallhaven-gww69l",
      "score": 0.47150356
    },
    {
      "id": "madness-wallhaven-w5531x",
      "score": 0.4714325
    },
    {
      "id": "madness-wallhaven-e88vyk",
      "score": 0.47134987
    },
    {
      "id": "madness-wallhaven-6lle7l",
      "score": 0.47120014
    },
    {
      "id": "madness-wallhaven-ogg7ql",
      "score": 0.4711407
    },
    {
      "id": "madness-wallhaven-gww16q",
      "score": 0.47103953
    },
    {
      "id": "madness-wallhaven-yqqw7g",
      "score": 0.47014493
    },
    {
      "id": "madness-wallhaven-yqqvv7",
      "score": 0.4697642
    },
    {
      "id": "madness-wallhaven-6llwv6",
      "score": 0.46716672
    },
    {
      "id": "madness-wallhaven-6llpwq",
      "score": 0.46703622
    },
    {
      "id": "madness-wallhaven-9oop2d",
      "score": 0.4667782
    },
    {
      "id": "madness-wallhaven-rqqoem",
      "score": 0.46607044
    },
    {
      "id": "wallpaper-094",
      "score": 0.46316156
    },
    {
      "id": "madness-wallhaven-lyy7kp",
      "score": 0.46113124
    },
    {
      "id": "madness-wallhaven-1qqok3",
      "score": 0.46072903
    },
    {
      "id": "wallpaper-057",
      "score": 0.4594561
    },
    {
      "id": "madness-wallhaven-gww23l",
      "score": 0.4565124
    },
    {
      "id": "madness-wallhaven-yqqemd",
      "score": 0.45549867
    },
    {
      "id": "madness-wallhaven-lql7vp",
      "score": 0.45379138
    },
    {
      "id": "madness-wallhaven-3qq589",
      "score": 0.45374668
    },
    {
      "id": "madness-wallhaven-mllv3k",
      "score": 0.4503871
    },
    {
      "id": "madness-wallhaven-1j9v7w",
      "score": 0.4499914
    },
    {
      "id": "madness-wallhaven-jeeokp",
      "score": 0.44964802
    },
    {
      "id": "madness-wallhaven-9oo8k1",
      "score": 0.44946378
    },
    {
      "id": "madness-wallhaven-7jje13",
      "score": 0.44680703
    },
    {
      "id": "wallpaper-014",
      "score": 0.44589376
    },
    {
      "id": "madness-wallhaven-6ll2dq",
      "score": 0.44532675
    },
    {
      "id": "wallpaper-073",
      "score": 0.44511285
    },
    {
      "id": "wallpaper-016",
      "score": 0.44492757
    },
    {
      "id": "madness-wallhaven-8ggwl1",
      "score": 0.44345376
    },
    {
      "id": "madness-wallhaven-k88z5m",
      "score": 0.43784237
    },
    {
      "id": "madness-wallhaven-poog2e",
      "score": 0.43631724
    },
    {
      "id": "madness-wallhaven-qrrv3r",
      "score": 0.43530723
    },
    {
      "id": "madness-wallhaven-mllr61",
      "score": 0.4338158
    },
    {
      "id": "madness-wallhaven-mlly98",
      "score": 0.43283314
    },
    {
      "id": "madness-wallhaven-5gk313",
      "score": 0.43221885
    },
    {
      "id": "madness-wallhaven-rqqop1",
      "score": 0.43112367
    },
    {
      "id": "wallpaper-006",
      "score": 0.42576578
    },
    {
      "id": "madness-wallhaven-mllelk",
      "score": 0.42199874
    },
    {
      "id": "madness-wallhaven-8gg1g2",
      "score": 0.4129737
    },
    {
      "id": "wallpaper-002",
      "score": 0.40877885
    },
    {
      "id": "wallpaper-054",
      "score": 0.40849
    },
    {
      "id": "wallpaper-030",
      "score": 0.40638608
    },
    {
      "id": "madness-wallhaven-9ooe6d",
      "score": 0.4031604
    },
    {
      "id": "madness-wallhaven-mll1mm",
      "score": 0.4018834
    },
    {
      "id": "madness-wallhaven-3qq7j9",
      "score": 0.400391
    },
    {
      "id": "madness-wallhaven-73og6v",
      "score": 0.39884582
    },
    {
      "id": "madness-wallhaven-rqq1mm",
      "score": 0.3959248
    },
    {
      "id": "madness-wallhaven-lyyko2",
      "score": 0.3958206
    },
    {
      "id": "madness-wallhaven-6llzxw",
      "score": 0.39352602
    },
    {
      "id": "madness-wallhaven-gwwq8e",
      "score": 0.3932686
    },
    {
      "id": "madness-wallhaven-9oolmx",
      "score": 0.39323157
    },
    {
      "id": "madness-wallhaven-e8865l",
      "score": 0.3900372
    },
    {
      "id": "madness-wallhaven-vpp2g5",
      "score": 0.38804793
    },
    {
      "id": "madness-wallhaven-1qqer1",
      "score": 0.38471884
    },
    {
      "id": "madness-wallhaven-jeeqxq",
      "score": 0.38425028
    },
    {
      "id": "madness-wallhaven-rqqe7q",
      "score": 0.3810556
    },
    {
      "id": "wallpaper-062",
      "score": 0.37305638
    },
    {
      "id": "madness-wallhaven-8ggwyj",
      "score": 0.3712423
    },
    {
      "id": "madness-wallhaven-lyyxjp",
      "score": 0.36842966
    },
    {
      "id": "madness-wallhaven-yqqe27",
      "score": 0.36807418
    },
    {
      "id": "wallpaper-041",
      "score": 0.36669612
    },
    {
      "id": "madness-wallhaven-vppyjp",
      "score": 0.36629707
    },
    {
      "id": "wallpaper-074",
      "score": 0.36371166
    },
    {
      "id": "madness-wallhaven-jeevkm",
      "score": 0.36366203
    },
    {
      "id": "madness-wallhaven-5yy3d3",
      "score": 0.36087105
    },
    {
      "id": "madness-wallhaven-3qq5j3",
      "score": 0.36041787
    },
    {
      "id": "madness-wallhaven-yqqwvd",
      "score": 0.35736942
    },
    {
      "id": "madness-wallhaven-mllw39",
      "score": 0.3539941
    },
    {
      "id": "madness-wallhaven-9oo7od",
      "score": 0.35154468
    },
    {
      "id": "madness-wallhaven-lyydwl",
      "score": 0.34854123
    },
    {
      "id": "madness-wallhaven-3qlxjy",
      "score": 0.34562865
    },
    {
      "id": "madness-wallhaven-8gg6eo",
      "score": 0.3444258
    },
    {
      "id": "madness-wallhaven-7jp81o",
      "score": 0.3442807
    },
    {
      "id": "madness-wallhaven-gww27e",
      "score": 0.3442139
    },
    {
      "id": "madness-wallhaven-9oow11",
      "score": 0.34366333
    },
    {
      "id": "madness-wallhaven-7jjom3",
      "score": 0.34209412
    },
    {
      "id": "madness-wallhaven-zppqdv",
      "score": 0.33263212
    },
    {
      "id": "madness-wallhaven-6llrk7",
      "score": 0.33236757
    },
    {
      "id": "wallpaper-007",
      "score": 0.33112863
    },
    {
      "id": "wallpaper-092",
      "score": 0.32552406
    },
    {
      "id": "wallpaper-090",
      "score": 0.3248055
    },
    {
      "id": "madness-wallhaven-9oov2d",
      "score": 0.32463637
    },
    {
      "id": "madness-wallhaven-lyyx5q",
      "score": 0.3225301
    },
    {
      "id": "wallpaper-063",
      "score": 0.32099333
    },
    {
      "id": "madness-wallhaven-mdvo1y",
      "score": 0.3207459
    },
    {
      "id": "wallpaper-088",
      "score": 0.31854615
    },
    {
      "id": "madness-wallhaven-8ggwro",
      "score": 0.3178859
    },
    {
      "id": "wallpaper-100",
      "score": 0.31689692
    },
    {
      "id": "madness-wallhaven-lyywml",
      "score": 0.31589913
    },
    {
      "id": "madness-wallhaven-kwxod1",
      "score": 0.31104833
    },
    {
      "id": "madness-wallhaven-d88z63",
      "score": 0.302765
    },
    {
      "id": "madness-wallhaven-e88r8o",
      "score": 0.2993084
    },
    {
      "id": "madness-wallhaven-5yymk9",
      "score": 0.29801977
    },
    {
      "id": "wallpaper-031",
      "score": 0.29737413
    },
    {
      "id": "wallpaper-028",
      "score": 0.29514197
    },
    {
      "id": "madness-wallhaven-e8891l",
      "score": 0.2948913
    },
    {
      "id": "madness-wallhaven-8gg61j",
      "score": 0.29435605
    },
    {
      "id": "madness-wallhaven-zpp5ww",
      "score": 0.29372844
    },
    {
      "id": "madness-wallhaven-yqqkdg",
      "score": 0.29262254
    },
    {
      "id": "madness-wallhaven-6llg7q",
      "score": 0.29128778
    },
    {
      "id": "madness-wallhaven-e88rok",
      "score": 0.28887287
    },
    {
      "id": "madness-wallhaven-e88q7k",
      "score": 0.28875756
    },
    {
      "id": "madness-wallhaven-x8359z",
      "score": 0.28841543
    },
    {
      "id": "madness-wallhaven-vppdjm",
      "score": 0.2878413
    },
    {
      "id": "madness-wallhaven-1qqlew",
      "score": 0.28773803
    },
    {
      "id": "madness-wallhaven-lmk37p",
      "score": 0.28645125
    },
    {
      "id": "madness-wallhaven-rqqxew",
      "score": 0.28634354
    },
    {
      "id": "madness-wallhaven-1qqdgw",
      "score": 0.2858801
    },
    {
      "id": "madness-wallhaven-r7kqj1",
      "score": 0.28417474
    },
    {
      "id": "madness-wallhaven-d8pk8m",
      "score": 0.28377715
    },
    {
      "id": "wallpaper-044",
      "score": 0.28244394
    },
    {
      "id": "madness-wallhaven-lyy22q",
      "score": 0.2817683
    },
    {
      "id": "madness-wallhaven-jeep8w",
      "score": 0.2811143
    },
    {
      "id": "madness-wallhaven-qrrox7",
      "score": 0.28030792
    },
    {
      "id": "wallpaper-015",
      "score": 0.27919543
    },
    {
      "id": "madness-wallhaven-zppz3w",
      "score": 0.27908456
    },
    {
      "id": "wallpaper-046",
      "score": 0.27786222
    },
    {
      "id": "madness-wallhaven-9oo2k1",
      "score": 0.27695596
    },
    {
      "id": "madness-wallhaven-3qq6m3",
      "score": 0.27658904
    },
    {
      "id": "madness-wallhaven-211dyx",
      "score": 0.27502564
    },
    {
      "id": "madness-wallhaven-poowxp",
      "score": 0.27469355
    },
    {
      "id": "madness-wallhaven-xe6qdv",
      "score": 0.27415258
    },
    {
      "id": "madness-wallhaven-yqqewx",
      "score": 0.27328458
    },
    {
      "id": "wallpaper-049",
      "score": 0.272336
    },
    {
      "id": "madness-wallhaven-8368k1",
      "score": 0.26886404
    },
    {
      "id": "madness-wallhaven-w55w3r",
      "score": 0.26862982
    },
    {
      "id": "madness-wallhaven-211er6",
      "score": 0.26738146
    },
    {
      "id": "madness-wallhaven-jeey9q",
      "score": 0.26682165
    },
    {
      "id": "madness-wallhaven-13qmlw",
      "score": 0.26158774
    },
    {
      "id": "madness-wallhaven-w55xgp",
      "score": 0.26061368
    },
    {
      "id": "madness-wallhaven-jeed6q",
      "score": 0.25843576
    },
    {
      "id": "madness-wallhaven-7jjo5e",
      "score": 0.25772008
    },
    {
      "id": "madness-wallhaven-j52vqm",
      "score": 0.25685558
    },
    {
      "id": "madness-wallhaven-ox2ool",
      "score": 0.25536245
    },
    {
      "id": "madness-wallhaven-6ll2zw",
      "score": 0.25112277
    },
    {
      "id": "madness-wallhaven-gwwvqe",
      "score": 0.24472803
    },
    {
      "id": "madness-wallhaven-lyyjvy",
      "score": 0.24470174
    },
    {
      "id": "madness-wallhaven-oggvw9",
      "score": 0.24245559
    },
    {
      "id": "madness-wallhaven-k88g21",
      "score": 0.23882188
    },
    {
      "id": "madness-wallhaven-jeeoxq",
      "score": 0.23199263
    },
    {
      "id": "madness-wallhaven-gwwmxq",
      "score": 0.22839285
    },
    {
      "id": "madness-wallhaven-mllg19",
      "score": 0.22787732
    },
    {
      "id": "wallpaper-043",
      "score": 0.2250273
    },
    {
      "id": "wallpaper-047",
      "score": 0.22497228
    },
    {
      "id": "madness-wallhaven-7jjwp3",
      "score": 0.22443743
    },
    {
      "id": "madness-wallhaven-9639xx",
      "score": 0.22217017
    },
    {
      "id": "madness-wallhaven-xeejw3",
      "score": 0.21988033
    },
    {
      "id": "wallpaper-011",
      "score": 0.21529256
    },
    {
      "id": "madness-wallhaven-yqqrp7",
      "score": 0.20965983
    },
    {
      "id": "madness-wallhaven-gwwm6d",
      "score": 0.2086433
    },
    {
      "id": "evaluation-gray-red-002-umbrella",
      "score": 0.20442504
    },
    {
      "id": "madness-wallhaven-vpp6d5",
      "score": 0.20297085
    },
    {
      "id": "madness-wallhaven-yqqrgl",
      "score": 0.20244864
    },
    {
      "id": "madness-wallhaven-qrrey5",
      "score": 0.20145713
    },
    {
      "id": "madness-wallhaven-9oo2dk",
      "score": 0.20043969
    },
    {
      "id": "madness-wallhaven-poo1kp",
      "score": 0.1962366
    },
    {
      "id": "madness-wallhaven-lyypwr",
      "score": 0.1948992
    },
    {
      "id": "madness-wallhaven-3qqgo3",
      "score": 0.1921285
    },
    {
      "id": "madness-wallhaven-9oow31",
      "score": 0.19120301
    },
    {
      "id": "madness-wallhaven-xee72o",
      "score": 0.18851306
    },
    {
      "id": "wallpaper-025",
      "score": 0.18696018
    },
    {
      "id": "madness-wallhaven-6llp5q",
      "score": 0.18273342
    },
    {
      "id": "madness-wallhaven-rqqj61",
      "score": 0.17977968
    },
    {
      "id": "madness-wallhaven-mllr38",
      "score": 0.17865928
    },
    {
      "id": "madness-wallhaven-jee8ry",
      "score": 0.17712225
    },
    {
      "id": "madness-wallhaven-jeel8q",
      "score": 0.17687936
    },
    {
      "id": "wallpaper-095",
      "score": 0.17625572
    },
    {
      "id": "madness-wallhaven-v9qkgm",
      "score": 0.17525917
    },
    {
      "id": "wallpaper-035",
      "score": 0.16990565
    },
    {
      "id": "madness-wallhaven-vppd75",
      "score": 0.16738245
    },
    {
      "id": "madness-wallhaven-6llrl7",
      "score": 0.16704383
    },
    {
      "id": "madness-wallhaven-jeey2y",
      "score": 0.16605043
    },
    {
      "id": "wallpaper-080",
      "score": 0.1650617
    },
    {
      "id": "madness-wallhaven-5yypm9",
      "score": 0.16414139
    },
    {
      "id": "madness-wallhaven-w557rr",
      "score": 0.16306369
    },
    {
      "id": "wallpaper-010",
      "score": 0.1611647
    },
    {
      "id": "wallpaper-067",
      "score": 0.1567058
    },
    {
      "id": "madness-wallhaven-ogg1wl",
      "score": 0.15636256
    },
    {
      "id": "wallpaper-065",
      "score": 0.15397611
    },
    {
      "id": "wallpaper-003",
      "score": 0.14904678
    },
    {
      "id": "wallpaper-087",
      "score": 0.14091401
    },
    {
      "id": "composition-green-red-001-a",
      "score": 0.13974352
    },
    {
      "id": "madness-wallhaven-gwwdeq",
      "score": 0.13787448
    },
    {
      "id": "madness-wallhaven-lyyv8r",
      "score": 0.13596117
    },
    {
      "id": "composition-green-red-001-e",
      "score": 0.13509972
    },
    {
      "id": "madness-wallhaven-8ggm6k",
      "score": 0.13397779
    },
    {
      "id": "madness-wallhaven-5yy8v1",
      "score": 0.13361725
    },
    {
      "id": "madness-wallhaven-gwwdpe",
      "score": 0.12959144
    },
    {
      "id": "madness-wallhaven-w55m8x",
      "score": 0.1267703
    },
    {
      "id": "madness-wallhaven-mdoqxy",
      "score": 0.12511209
    },
    {
      "id": "madness-wallhaven-d88v53",
      "score": 0.12464904
    },
    {
      "id": "madness-wallhaven-wqvoxr",
      "score": 0.120584995
    },
    {
      "id": "madness-wallhaven-yqqv3x",
      "score": 0.12034889
    },
    {
      "id": "madness-wallhaven-3qq5lv",
      "score": 0.11987028
    },
    {
      "id": "madness-wallhaven-vpp1vl",
      "score": 0.117384195
    },
    {
      "id": "madness-wallhaven-2112dx",
      "score": 0.11735653
    },
    {
      "id": "madness-wallhaven-d882g3",
      "score": 0.116137564
    },
    {
      "id": "madness-wallhaven-xee36v",
      "score": 0.11446759
    },
    {
      "id": "madness-wallhaven-vmwp58",
      "score": 0.11403627
    },
    {
      "id": "madness-wallhaven-qrroml",
      "score": 0.1136966
    },
    {
      "id": "madness-wallhaven-w55rr7",
      "score": 0.11262042
    },
    {
      "id": "madness-wallhaven-211jgy",
      "score": 0.1098844
    },
    {
      "id": "madness-wallhaven-6llzk6",
      "score": 0.108826295
    },
    {
      "id": "madness-wallhaven-gwweme",
      "score": 0.10478972
    },
    {
      "id": "wallpaper-051",
      "score": 0.10309901
    },
    {
      "id": "madness-wallhaven-qrr3m5",
      "score": 0.10202302
    },
    {
      "id": "madness-wallhaven-vmwlmm",
      "score": 0.10193537
    },
    {
      "id": "madness-wallhaven-6llzrw",
      "score": 0.100328036
    },
    {
      "id": "madness-wallhaven-211xrg",
      "score": 0.10004634
    },
    {
      "id": "madness-wallhaven-xee3kz",
      "score": 0.0997668
    },
    {
      "id": "madness-wallhaven-mllrdk",
      "score": 0.097041175
    },
    {
      "id": "madness-wallhaven-jeek5p",
      "score": 0.09595236
    },
    {
      "id": "madness-wallhaven-lyyp9y",
      "score": 0.09524322
    },
    {
      "id": "madness-wallhaven-qrre8l",
      "score": 0.095065355
    },
    {
      "id": "madness-wallhaven-j5eqpw",
      "score": 0.09354359
    },
    {
      "id": "madness-wallhaven-yqqqrg",
      "score": 0.09317732
    },
    {
      "id": "madness-wallhaven-5yymd3",
      "score": 0.090577714
    },
    {
      "id": "madness-wallhaven-rqqgkq",
      "score": 0.09043389
    },
    {
      "id": "madness-wallhaven-jeekjy",
      "score": 0.08660806
    },
    {
      "id": "madness-wallhaven-zppq2j",
      "score": 0.08563628
    },
    {
      "id": "wallpaper-023",
      "score": 0.07862677
    },
    {
      "id": "madness-wallhaven-8ggrqy",
      "score": 0.07742233
    },
    {
      "id": "madness-wallhaven-gwwxpl",
      "score": 0.07605174
    },
    {
      "id": "wallpaper-053",
      "score": 0.074340194
    },
    {
      "id": "composition-green-red-001-b",
      "score": 0.07388573
    },
    {
      "id": "composition-green-red-001-c",
      "score": 0.07388573
    },
    {
      "id": "composition-green-red-001-f",
      "score": 0.07388573
    },
    {
      "id": "madness-wallhaven-lyyker",
      "score": 0.071138345
    },
    {
      "id": "madness-wallhaven-rqqw2q",
      "score": 0.06860431
    },
    {
      "id": "madness-wallhaven-zppd8y",
      "score": 0.066263355
    },
    {
      "id": "madness-wallhaven-6ll7dx",
      "score": 0.06465715
    },
    {
      "id": "madness-wallhaven-rqqw7q",
      "score": 0.06386558
    },
    {
      "id": "madness-wallhaven-d88jym",
      "score": 0.06293025
    },
    {
      "id": "wallpaper-079",
      "score": 0.062832534
    },
    {
      "id": "madness-wallhaven-yqqoek",
      "score": 0.062002424
    },
    {
      "id": "madness-wallhaven-e88qdr",
      "score": 0.058415845
    },
    {
      "id": "madness-wallhaven-yqq3px",
      "score": 0.05600997
    },
    {
      "id": "madness-wallhaven-jeewoy",
      "score": 0.05571278
    },
    {
      "id": "madness-wallhaven-vpprr8",
      "score": 0.055046365
    },
    {
      "id": "madness-wallhaven-gwpo6e",
      "score": 0.05281861
    },
    {
      "id": "wallpaper-072",
      "score": 0.04915548
    },
    {
      "id": "madness-wallhaven-6o2qd7",
      "score": 0.044896916
    },
    {
      "id": "madness-wallhaven-3qqygv",
      "score": 0.041097306
    },
    {
      "id": "madness-wallhaven-jeev6q",
      "score": 0.0395567
    },
    {
      "id": "madness-wallhaven-k9m277",
      "score": 0.037986543
    },
    {
      "id": "madness-wallhaven-7jj1p3",
      "score": 0.035240505
    },
    {
      "id": "madness-wallhaven-2119yx",
      "score": 0.031624973
    },
    {
      "id": "wallpaper-048",
      "score": 0.031561874
    },
    {
      "id": "madness-wallhaven-8g5qr2",
      "score": 0.02833087
    },
    {
      "id": "madness-wallhaven-j3511m",
      "score": 0.02797322
    },
    {
      "id": "madness-wallhaven-1qqrev",
      "score": 0.026757343
    },
    {
      "id": "madness-wallhaven-gwwvpe",
      "score": 0.024124734
    },
    {
      "id": "madness-wallhaven-jeekxm",
      "score": 0.02274786
    },
    {
      "id": "madness-wallhaven-q625eq",
      "score": 0.021826418
    },
    {
      "id": "madness-wallhaven-gwwxwl",
      "score": 0.020020649
    },
    {
      "id": "madness-wallhaven-w55gjr",
      "score": 0.019820893
    },
    {
      "id": "madness-wallhaven-e873x8",
      "score": 0.019527746
    },
    {
      "id": "madness-wallhaven-ymg9kx",
      "score": 0.015508772
    },
    {
      "id": "madness-wallhaven-d88253",
      "score": 0.013996631
    },
    {
      "id": "madness-wallhaven-5yyj69",
      "score": 0.010633007
    },
    {
      "id": "madness-wallhaven-oggw5p",
      "score": 0.010081641
    },
    {
      "id": "madness-wallhaven-211wjx",
      "score": 0.009176911
    },
    {
      "id": "wallpaper-005",
      "score": 0.0091705015
    },
    {
      "id": "madness-wallhaven-vppv3l",
      "score": 0.008349399
    },
    {
      "id": "madness-wallhaven-ml3jm8",
      "score": 0.0078067877
    },
    {
      "id": "madness-wallhaven-jeerzw",
      "score": 0.007625719
    },
    {
      "id": "madness-wallhaven-y89mld",
      "score": 0.0072863833
    },
    {
      "id": "madness-wallhaven-jeerxp",
      "score": 0.006503775
    },
    {
      "id": "wallpaper-008",
      "score": 0.0061917887
    },
    {
      "id": "madness-wallhaven-rqqjl7",
      "score": 0.0054490035
    },
    {
      "id": "madness-wallhaven-d88vyl",
      "score": 0.005267818
    },
    {
      "id": "madness-wallhaven-7jjkde",
      "score": 0.0049546
    },
    {
      "id": "madness-wallhaven-rqqygw",
      "score": 0.004524016
    },
    {
      "id": "madness-wallhaven-qrrlq7",
      "score": 0.0035863281
    },
    {
      "id": "wallpaper-077",
      "score": 0.002665021
    },
    {
      "id": "madness-wallhaven-w55vwr",
      "score": 0.0018376485
    },
    {
      "id": "madness-wallhaven-d88d53",
      "score": 0.00066700525
    },
    {
      "id": "madness-wallhaven-lmmxol",
      "score": 0.00064292405
    },
    {
      "id": "madness-wallhaven-2116k9",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-211986",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-5yyy85",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-6ll7pq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9mrgk1",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-9ooez8",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-d88q5g",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-e88v9o",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-gwwlm3",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeej1q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeek6q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeelj5",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeeq3q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-jeer9q",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k881gm",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-k88kzd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-oggv5m",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-poo7gj",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-vppy93",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w553y6",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55lqx",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-w55mgq",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-yqq3wd",
      "score": 0.000001
    },
    {
      "id": "madness-wallhaven-zpp3mg",
      "score": 0.000001
    },
    {
      "id": "wallpaper-032",
      "score": 0.000001
    },
    {
      "id": "wallpaper-033",
      "score": 0.000001
    },
    {
      "id": "wallpaper-036",
      "score": 0.000001
    },
    {
      "id": "wallpaper-037",
      "score": 0.000001
    },
    {
      "id": "wallpaper-038",
      "score": 0.000001
    },
    {
      "id": "wallpaper-039",
      "score": 0.000001
    },
    {
      "id": "wallpaper-059",
      "score": 0.000001
    },
    {
      "id": "wallpaper-060",
      "score": 0.000001
    },
    {
      "id": "wallpaper-091",
      "score": 0.000001
    }
  ],
  "performance": {
    "samplesMs": [
      1.9333369999999945,
      1.53878499999999,
      2.14131900000001,
      2.117874999999998,
      1.5928569999999809,
      1.6188860000000034,
      1.483520999999996,
      2.253448999999989,
      2.2971519999999828,
      1.5095900000000029
    ],
    "sampleCount": 10,
    "p50Ms": 1.6188860000000034,
    "p95Ms": 2.2971519999999828,
    "maxMs": 2.2971519999999828,
    "failures": 0,
    "trials": [
      {
        "round": 0,
        "elapsedMs": 1.9333369999999945,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 1,
        "elapsedMs": 1.53878499999999,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 2,
        "elapsedMs": 2.14131900000001,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 3,
        "elapsedMs": 2.117874999999998,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 4,
        "elapsedMs": 1.5928569999999809,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 5,
        "elapsedMs": 1.6188860000000034,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 6,
        "elapsedMs": 1.483520999999996,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 7,
        "elapsedMs": 2.253448999999989,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 8,
        "elapsedMs": 2.2971519999999828,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      },
      {
        "round": 9,
        "elapsedMs": 1.5095900000000029,
        "hits": [
          {
            "id": "composition-green-red-001-d",
            "score": 0.7555116
          },
          {
            "id": "madness-wallhaven-w55mqx",
            "score": 0.7347015
          },
          {
            "id": "madness-wallhaven-9oozpx",
            "score": 0.73340714
          },
          {
            "id": "madness-wallhaven-qrrkor",
            "score": 0.695022
          },
          {
            "id": "madness-wallhaven-zppjyg",
            "score": 0.6865564
          },
          {
            "id": "wallpaper-029",
            "score": 0.6847205
          },
          {
            "id": "madness-wallhaven-k88291",
            "score": 0.68452585
          },
          {
            "id": "proportion-green-001-b",
            "score": 0.6838457
          },
          {
            "id": "madness-wallhaven-7jj7ey",
            "score": 0.68201023
          },
          {
            "id": "madness-wallhaven-rqqwgj",
            "score": 0.6797568
          },
          {
            "id": "madness-wallhaven-xeejzz",
            "score": 0.67888576
          },
          {
            "id": "madness-wallhaven-gww9yl",
            "score": 0.6763496
          },
          {
            "id": "madness-wallhaven-po9eop",
            "score": 0.67310435
          },
          {
            "id": "wallpaper-083",
            "score": 0.67297167
          },
          {
            "id": "madness-wallhaven-gwwq27",
            "score": 0.67163616
          },
          {
            "id": "madness-wallhaven-lyyx7l",
            "score": 0.6685
          },
          {
            "id": "madness-wallhaven-xee7dd",
            "score": 0.6671441
          },
          {
            "id": "wallpaper-050",
            "score": 0.6669265
          },
          {
            "id": "wallpaper-052",
            "score": 0.6660232
          },
          {
            "id": "wallpaper-012",
            "score": 0.66174054
          }
        ],
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
            "returnedIds": [
              "wallpaper-052"
            ],
            "missingIds": [
              "wallpaper-086",
              "wallpaper-093",
              "wallpaper-013"
            ],
            "fraction": 0.25
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
        "backendTookMs": null
      }
    ],
    "firstSuccessfulRound": 0,
    "requestedSamples": 10
  }
}
```

### palette-rainbow-batch-001: unsupported

```json
{
  "query": {
    "text": "Rainbow-like colors",
    "detail": "Bright colors across many hues. It does not need to contain a literal rainbow."
  },
  "status": "unsupported",
  "reason": "The precision grid supports exactly one picked-color vibe; named colors and proportions are unsupported.",
  "rankingCondition": null,
  "orderGroups": [
    [
      "wallpaper-094"
    ],
    [
      "wallpaper-003"
    ],
    [
      "wallpaper-034"
    ],
    [
      "wallpaper-004"
    ]
  ],
  "notes": [
    "Not sure about the last two"
  ],
  "evidenceContext": {
    "quickPass": true,
    "batchCaveat": {
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
    "originalJudgments": null,
    "rawAnswer": {
      "caseId": "palette-rainbow-batch-001",
      "status": "ranked",
      "ranking": [
        [
          "A"
        ],
        [
          "C"
        ],
        [
          "B"
        ],
        [
          "D"
        ]
      ],
      "notes": "Not sure about the last two",
      "updatedAt": "2026-09-19T22:42:17.495Z"
    },
    "rawUserResponses": [],
    "explicitPairUncertainty": [
      {
        "labels": [
          "B",
          "D"
        ],
        "wallpaperIds": [
          "wallpaper-034",
          "wallpaper-004"
        ],
        "source": "rawAnswer.notes",
        "treatment": "Keep the submitted order and this uncertainty; do not replace it with a tie or numeric confidence."
      }
    ],
    "interpretationFlags": [],
    "transferCaveats": null,
    "use": "development evidence"
  },
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
    "failures": 0,
    "trials": [],
    "requestedSamples": 0
  }
}
```

