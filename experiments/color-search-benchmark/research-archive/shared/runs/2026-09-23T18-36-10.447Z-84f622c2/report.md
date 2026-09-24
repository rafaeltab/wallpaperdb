# Color evaluation: 2026-09-23T18-36-10.447Z-84f622c2

[Complete raw measurements and diagnostics](./run.json). Large diagnostic payloads are kept in that artifact instead of duplicated in this report.

## Evidence and interpretation

No combined score or automatic winner. Accuracy, coverage, latency and resource costs remain separate.

Agreement measures recorded preferences on assessed pairs. Missing comparisons remain unassessed; high agreement with low coverage is incomplete evidence. The sensitivity column excludes explicitly uncertain pairs; it does not invent confidence weights.

These development judgments are not independent population samples or a held-out benchmark. Repeated optimization against them can overfit.

Timing describes this harness, corpus, environment and execution path. Local-reference timing excludes search-backend execution. These measurements do not establish performance for 1 million or 100 million wallpapers. Do not compare speed across different execution classes or workloads.

```json
{
  "reviewerCount": 1,
  "logicalCaseCount": 38,
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
    "Connected source-image and fixture-family groups are recorded for future split design; no held-out split is claimed.",
    "Optional follow-up image cases are included in this run. Their case IDs and evidence groups distinguish them from the legacy 37; aggregate accuracy is not directly comparable to a legacy-only run."
  ]
}
```

## Run conditions

```json
{
  "id": "2026-09-23T18-36-10.447Z-84f622c2",
  "createdAt": "2026-09-23T18:36:10.452Z",
  "dataset": {
    "hash": "ad79fa37f9809998ef53fd2336f558bb24905c2c2cb5522980fad7d126e36815",
    "caseCount": 38,
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
      "evaluation/responses/30b36a99-4c94-4f15-9e18-27373dea04c5.json": "36a41bccdff3313eccbbf612ccb0057944b44e2a8b9e40524310d552592a0b76",
      "evaluation/perceived-red-pagoda-001.json": "b4fad82d0d5048cb87ef3191ec463f639be0a40295e12d19aec2f81164eaf273"
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
| All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches) | No approximation statement supplied | A pixel may contribute to several regions. These are marginal observations, not an exclusive palette; there is no separate outside-color purity penalty. Picked colors use the nearest indexed anchor. A separately measured shade-aware similarity relaxes lightness and partially normalizes chroma for chromatic anchors, with a near-black visibility guard. Neutral anchors retain the original distance. This directional tolerance is provisional. Feather and core-halo percentages are effective coverage weighted by pixel admission; hard-cutoff percentages are literal covered area. Consensus averages independently scored cutoff components. Averaged coverage and quality are display summaries, never the scoring input. OpenSearch ranks globally. Linear quality uses native functions; power quality may use a Painless score function. Small-corpus timings do not establish million-wallpaper latency. A separately indexed hue gate multiplies shade quality: for fully chromatic anchors, full within 10° of OKLab hue, smooth fade to zero at 30°. Near-neutral anchors blend the gate toward 1; neutral anchors retain their original metric. These angles are not HSV/HSL degrees. Fixed experimental tolerances are not population-calibrated. Development judgments are from one observer; new ZIP wallpapers are unjudged. |
| Favorite256: precomputed float utility · doc-value ID fetch | No approximation statement supplied | Preserves the favorite256 shade-aware strict-hue measurements, anchors and independently weighted five-cutoff formula at offered presets. Quality influence is restricted to 0, 0.5 or 1; cutoff weighting to 0, 1 or 3; target proportions to multiples of 5%. Other scoring controls retain the saved defaults. Moving per-target sums before query-time averaging changes float32 rounding order. Formula preservation does not mean bitwise score or near-tie order identity. Abstract vibes and named families retain the original single named-feature definition. Overlap is marginal; there is no new palette-purity or accent objective. Every eligible document participates in the OpenSearch ranking, including zero-score documents. There is no candidate retrieval or application reranking. Float32 target utilities and scores; same mathematical formula at supported presets, with changed floating-point grouping. Development judgments are from one observer; new ZIP wallpapers are unjudged. Fetch-only refinement: score calculations, eligible documents, sort and original precision limitations are unchanged. Requires the existing id keyword field to have doc values. It uses the same parent index; numeric sort still requires numeric points. Avoiding stored-field fetch may reduce fetch cost on source-disabled indexes. The benefit requires measurement; it is not a ranking change. |
| Favorite256: globally bounded numeric utilities · pooled PIT cleanup | No approximation statement supplied | Preserves the favorite256 shade-aware strict-hue measurements, anchors and independently weighted five-cutoff formula at offered presets. Quality influence is restricted to 0, 0.5 or 1; cutoff weighting to 0, 1 or 3; target proportions to multiples of 5%. Other scoring controls retain the saved defaults. Moving per-target sums before query-time averaging changes float32 rounding order. Formula preservation does not mean bitwise score or near-tie order identity. Abstract vibes and named families retain the original single named-feature definition. Overlap is marginal; there is no new palette-purity or accent objective. Every eligible document participates in the OpenSearch ranking, including zero-score documents. There is no candidate retrieval or application reranking. Float32 target utilities and scores; same mathematical formula at supported presets, with changed floating-point grouping. Requires numeric utility fields indexed as float points as well as doc values. Multiple service requests and PIT lifetime add cost; this is not an approximate shortlist reranker. Development judgments are from one observer; new ZIP wallpapers are unjudged. Only PIT cleanup transport changes. The shared pool must survive individual queries; no retries are added. |
| Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup | No approximation statement supplied | Preserves the favorite256 shade-aware strict-hue measurements, anchors and independently weighted five-cutoff formula at offered presets. Quality influence is restricted to 0, 0.5 or 1; cutoff weighting to 0, 1 or 3; target proportions to multiples of 5%. Other scoring controls retain the saved defaults. Moving per-target sums before query-time averaging changes float32 rounding order. Formula preservation does not mean bitwise score or near-tie order identity. Abstract vibes and named families retain the original single named-feature definition. Overlap is marginal; there is no new palette-purity or accent objective. Every eligible document participates in the OpenSearch ranking, including zero-score documents. There is no candidate retrieval or application reranking. Float32 target utilities and scores; same mathematical formula at supported presets, with changed floating-point grouping. Requires numeric utility fields indexed as float points as well as doc values. Multiple service requests and PIT lifetime add cost; this is not an approximate shortlist reranker. Development judgments are from one observer; new ZIP wallpapers are unjudged. Extra numeric intersections may cost more than they save; this separate prototype needs real scale measurements. Duplicate utility fields conservatively retain the original bound; existing duplicate-target score behavior is unchanged. Only PIT cleanup transport changes. The shared pool must survive individual queries; no retries are added. |

## Per-query semantic warnings

| Candidate | Case | Warnings |
| --- | --- | --- |


No observations available.

## Large-window ranking diagnostic

These accuracy calls use a separate result limit (1000). They help inspect the scoring formula and coverage. Do not pair this agreement with latency measured at the timed result limit (20), especially for approximate retrieval.

| Candidate | Execution | OK / total | Unsupported | Errors | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches) | opensearch | 32/38 | 6 | 0 | 69.5% | 68.9% | 88.3% | 86.7% | 0 |
| Favorite256: precomputed float utility · doc-value ID fetch | opensearch | 32/38 | 6 | 0 | 69.5% | 68.9% | 88.3% | 86.7% | 0 |
| Favorite256: globally bounded numeric utilities · pooled PIT cleanup | opensearch | 32/38 | 6 | 0 | 69.5% | 68.9% | 88.3% | 86.7% | 0 |
| Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup | opensearch | 32/38 | 6 | 0 | 69.5% | 68.9% | 88.3% | 86.7% | 0 |

## Timed-search accuracy (first measured sample)

This quality view uses the first successful measured search per case at the same result limit (20) as the performance samples. It is not an average across repeated searches; approximate or nondeterministic methods may vary. Repeated raw trial results remain in diagnostics. Missing judged images are unassessed, so agreement must be read alongside pair and image coverage.

| Candidate | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches) | 13/38 | 48.7% | 51.4% | 19.2% | 34.2% | 0 |
| Favorite256: precomputed float utility · doc-value ID fetch | 13/38 | 48.7% | 51.4% | 19.2% | 34.2% | 0 |
| Favorite256: globally bounded numeric utilities · pooled PIT cleanup | 13/38 | 48.7% | 51.4% | 19.2% | 34.2% | 0 |
| Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup | 13/38 | 48.7% | 51.4% | 19.2% | 34.2% | 0 |

## Measured performance

Setup is measured separately. Latency percentiles pool measured query samples in this workload; inspect case details for slow queries. Warmup, cache control, repetitions and execution metadata are recorded above and below. Small sample counts do not establish stable tail latency.

| Candidate | Execution | Samples | p50 | p95 | Maximum | Failures | Setup |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches) | opensearch | 96 | 3.38 ms | 4.24 ms | 6.75 ms | 0 | 3191.36 ms |
| Favorite256: precomputed float utility · doc-value ID fetch | opensearch | 96 | 0.77 ms | 1.15 ms | 2.16 ms | 0 | 483.58 ms |
| Favorite256: globally bounded numeric utilities · pooled PIT cleanup | opensearch | 96 | 3.07 ms | 4.66 ms | 6.10 ms | 0 | 188.18 ms |
| Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup | opensearch | 96 | 2.92 ms | 4.51 ms | 68.20 ms | 0 | 217.99 ms |

## Resource observations

Harness CPU covers the measured block, including warmups. Memory values are process snapshots, not isolated candidate peaks; retained allocations from earlier candidates can affect them. Backend resources and index storage remain n/a when unmeasured. Scope and raw values are preserved in diagnostics.

| Candidate | Harness CPU | RSS before | RSS after | Heap used after | Backend CPU | Backend memory | Index store |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches) | 140.42 ms | 302.93 MiB | 305.68 MiB | 158.47 MiB | n/a | n/a | n/a |
| Favorite256: precomputed float utility · doc-value ID fetch | 102.10 ms | 331.37 MiB | 335.62 MiB | 173.55 MiB | n/a | n/a | n/a |
| Favorite256: globally bounded numeric utilities · pooled PIT cleanup | 449.37 ms | 350.79 MiB | 368.29 MiB | 201.63 MiB | n/a | n/a | n/a |
| Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup | 360.15 ms | 394.34 MiB | 412.09 MiB | 231.17 MiB | n/a | n/a | n/a |

## All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches): categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 9/14 | 59.3% | 59.3% | 76.4% | 71.2% | 0 |
| Perceived color | 7/7 | 76.7% | 75.7% | 100.0% | 100.0% | 0 |
| Vibe | 8/9 | 85.4% | 85.4% | 91.3% | 90.0% | 0 |
| Precision | 3/3 | 56.7% | 53.3% | 100.0% | 100.0% | 0 |
| Semantic filtering | 1/1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Proportions | 3/3 | 44.4% | 45.6% | 100.0% | 100.0% | 0 |
| Palette | 1/1 | 66.7% | 60.0% | 100.0% | 100.0% | 0 |

## All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches): cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | ok | 86.7% | 86.7% | 15/15 | — | 0 | n/a | 0.0% | 3.64 ms |
| vibe-grayscale-001 | grayscale | ok | 100.0% | 100.0% | 12/12 | — | 0 | n/a | 0.0% | 6.75 ms |
| vibe-dark-001 | dark | ok | 100.0% | 100.0% | 15/15 | — | 0 | n/a | 0.0% | 3.68 ms |
| combination-gray-red-001 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | ok | 20.0% | 20.0% | 5/5 | — | 0 | 20.0% | 100.0% | 4.21 ms |
| semantic-red-city-001 | A city wallpaper with a red feel (Condition: Assuming C matches the city tag.) | ok | 100.0% | 100.0% | 3/3 | — | 0 | 100.0% | 100.0% | 1.96 ms |
| proportion-green-001 | 40% green; the rest doesn’t matter | ok | 86.7% | 86.7% | 15/15 | — | 0 | 100.0% | 20.0% | 3.39 ms |
| proportion-green-002 | 40% green; the rest doesn’t matter | ok | 93.3% | 93.3% | 15/15 | — | 0 | 93.3% | 100.0% | 3.32 ms |
| composition-green-red-001 | 50% green, 50% red | ok | 53.3% | 53.3% | 15/15 | — | 0 | 53.3% | 100.0% | 4.11 ms |
| composition-green-red-real-001 | 50% green, 50% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | 100.0% | 16.7% | 3.87 ms |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | ok | 0.0% | 0.0% | 6/6 | — | 0 | 0.0% | 16.7% | 4.24 ms |
| perceived-red-batch-001 | Red | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.63 ms |
| perceived-orange-batch-001 | Orange | ok | 83.3% | 83.3% | 6/6 | — | 0 | 100.0% | 16.7% | 4.24 ms |
| perceived-pink-batch-001 | Pink | ok | 33.3% | 33.3% | 6/6 | — | 0 | n/a | 0.0% | 4.01 ms |
| perceived-green-batch-001 | Green | ok | 83.3% | 80.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.29 ms |
| perceived-blue-batch-001 | Blue | ok | 83.3% | 80.0% | 6/6 | — | 0 | n/a | 0.0% | 4.01 ms |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | ok | 16.7% | 20.0% | 6/6 | — | 0 | 0.0% | 16.7% | 4.68 ms |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | 0.0% | 16.7% | 3.36 ms |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 4.28 ms |
| vibe-dark-batch-001 | Dark | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 4.20 ms |
| vibe-light-batch-001 | Light | ok | 83.3% | 83.3% | 6/6 | — | 0 | 0.0% | 16.7% | 3.87 ms |
| vibe-vivid-batch-001 | Bright, vivid colors | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.52 ms |
| vibe-strict-grayscale-batch-001 | Grayscale | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 2.60 ms |
| vibe-near-neutral-batch-001 | Almost grayscale | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.03 ms |
| vibe-monochromatic-batch-001 | One hue overall | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 3.15 ms |
| combination-gray-red-batch-001 | Grayscale with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 3.88 ms |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 4.12 ms |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 3.84 ms |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 3.98 ms |
| precision-warm-red-batch-001 | Close to #FF2200 | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 3.50 ms |
| precision-muted-green-batch-001 | Close to #4C8C72 | ok | 50.0% | 40.0% | 6/6 | — | 0 | 66.7% | 50.0% | 3.92 ms |
| palette-rainbow-batch-001 | Rainbow-like colors | ok | 66.7% | 60.0% | 6/6 | — | 0 | n/a | 0.0% | 3.70 ms |
| perceived-red-pagoda-001 | red | ok | 100.0% | 100.0% | 1/1 | — | 0 | n/a | 0.0% | 3.31 ms |

## All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches): visual comparisons

This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.

### perceived-red-001

red

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-048 &gt; wallpaper-060 &gt; wallpaper-077

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-077 &gt; wallpaper-048 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### vibe-grayscale-001

grayscale

Submitted preference groups: wallpaper-066 = wallpaper-070 = wallpaper-061 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

Method score groups: wallpaper-061 &gt; wallpaper-066 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, madness-wallhaven-mllr38, wallpaper-063

### vibe-dark-001

dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

Method score groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

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

Method score groups: precision-shade-001-c &gt; precision-shade-001-d &gt; precision-shade-001-a &gt; precision-shade-001-b

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-f, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### semantic-red-city-001

A city wallpaper with a red feel (Condition: Assuming C matches the city tag.)

Submitted preference groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

Method score groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-001

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-d &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-e

Method score groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-d &gt; proportion-green-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### proportion-green-002

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-a &gt; proportion-green-002-b &gt; proportion-green-002-e

Method score groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-b &gt; proportion-green-002-a &gt; proportion-green-002-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-001-f, composition-green-red-001-e, composition-green-red-001-a, composition-green-red-001-b, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### composition-green-red-001

50% green, 50% red

Submitted preference groups: composition-green-red-001-b &gt; composition-green-red-001-d &gt; composition-green-red-001-e &gt; composition-green-red-001-f &gt; composition-green-red-001-a &gt; composition-green-red-001-c

Method score groups: composition-green-red-001-b &gt; composition-green-red-001-a &gt; composition-green-red-001-c &gt; composition-green-red-001-d &gt; composition-green-red-001-f &gt; composition-green-red-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, evaluation-green-red-tulips, evaluation-green-red-tulip-field, proportion-green-002-d

### composition-green-red-real-001

50% green, 50% red

Submitted preference groups: wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-leaves &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-f, composition-green-red-001-e, precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, proportion-green-002-d

### composition-green-red-real-002

40% green, 40% red; the remaining 20% is unspecified

Submitted preference groups: evaluation-green-red-leaves &gt; wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulip-field &gt; evaluation-green-red-tulips &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-f, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-e, composition-green-red-001-d, proportion-green-002-f, precision-shade-001-a, proportion-green-001-f, proportion-green-002-c, madness-wallhaven-rqq1ww, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-rqqjrj, proportion-green-002-a, madness-wallhaven-w55xgp

### perceived-red-batch-001

Red

Submitted preference groups: wallpaper-037 &gt; wallpaper-095 &gt; wallpaper-084 &gt; wallpaper-044

Method score groups: wallpaper-037 &gt; wallpaper-084 &gt; wallpaper-044 &gt; wallpaper-095

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### perceived-orange-batch-001

Orange

Submitted preference groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-036 &gt; wallpaper-087

Method score groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-087 &gt; wallpaper-036

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: wallpaper-037, madness-wallhaven-9639xx, wallpaper-058, madness-wallhaven-rqqjrj, madness-wallhaven-gwwkql, madness-wallhaven-qrroml, madness-wallhaven-lyyv8r, wallpaper-094, madness-wallhaven-xe6qdv, madness-wallhaven-gwwq8e, madness-wallhaven-gwwmxq, madness-wallhaven-lyyko2, madness-wallhaven-jeeoxq, madness-wallhaven-v9qkgm, madness-wallhaven-k9m277, madness-wallhaven-rqqxew, precision-shade-001-a, madness-wallhaven-w55xgp

### perceived-pink-batch-001

Pink

Submitted preference groups: wallpaper-044 &gt; wallpaper-039 &gt; wallpaper-033 &gt; wallpaper-048

Method score groups: wallpaper-039 &gt; wallpaper-048 &gt; wallpaper-033 &gt; wallpaper-044

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-lmmxol, madness-wallhaven-w5531x, madness-wallhaven-7j3lve, madness-wallhaven-d88evl, madness-wallhaven-zpp3mg, madness-wallhaven-9mrgk1, madness-wallhaven-vppyjp, wallpaper-038, madness-wallhaven-jeey2y, madness-wallhaven-2116k9, madness-wallhaven-j3511m, madness-wallhaven-k881zd, madness-wallhaven-6llwv6, madness-wallhaven-211dyx, wallpaper-035, madness-wallhaven-e88rok, madness-wallhaven-q625eq, madness-wallhaven-6llrl7, madness-wallhaven-jeekjy

### perceived-green-batch-001

Green

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-083 &gt; wallpaper-093

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: proportion-green-001-e, composition-green-red-001-f, proportion-green-001-a, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, proportion-green-001-c, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, madness-wallhaven-5yyme5

### perceived-blue-batch-001

Blue

Submitted preference groups: wallpaper-091 &gt; wallpaper-030 &gt; wallpaper-047 &gt; wallpaper-010

Method score groups: wallpaper-091 &gt; wallpaper-047 &gt; wallpaper-030 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-6ll7pq, madness-wallhaven-2119jg, madness-wallhaven-rqqj61, wallpaper-032, madness-wallhaven-6ll2zw, madness-wallhaven-8gge6y, madness-wallhaven-9oow11, wallpaper-057, madness-wallhaven-jeekxm, madness-wallhaven-w55rr7, madness-wallhaven-9oo2k1, madness-wallhaven-k88zgm, madness-wallhaven-zppq2j, wallpaper-039, madness-wallhaven-jeelj5, madness-wallhaven-lyypwr, madness-wallhaven-7jjwp3, madness-wallhaven-9mrgk1

### proportion-green-real-batch-001

40% green; the remaining 60% is unspecified

Submitted preference groups: wallpaper-093 &gt; wallpaper-081 &gt; wallpaper-083 &gt; wallpaper-050

Method score groups: wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093 &gt; wallpaper-081

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-001-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj

### proportion-green-real-batch-002

70% green; the remaining 30% is unspecified

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-012 &gt; wallpaper-090

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-090 &gt; wallpaper-012

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-f, proportion-green-001-a, proportion-green-001-e, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, proportion-green-001-c, madness-wallhaven-ogg6zm

### proportion-red-real-batch-001

20% red; the remaining 80% is unspecified

Submitted preference groups: wallpaper-029 &gt; wallpaper-060 &gt; wallpaper-084 &gt; wallpaper-082

Method score groups: wallpaper-029 &gt; wallpaper-082 &gt; wallpaper-084 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: evaluation-green-red-tulips, precision-shade-001-b, madness-wallhaven-xeewg3, evaluation-green-red-tulip-field, madness-wallhaven-6llzk6, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-w55xgp, madness-wallhaven-ox2ool, madness-wallhaven-gwwvqe, madness-wallhaven-gwwkql, madness-wallhaven-d88evl, madness-wallhaven-8368k1, madness-wallhaven-w553y6, madness-wallhaven-13qmlw, madness-wallhaven-yqqrp7, madness-wallhaven-rqq1ww, madness-wallhaven-3qq5lv, madness-wallhaven-7j3lve

### vibe-dark-batch-001

Dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-011 &gt; wallpaper-079 &gt; wallpaper-075

Method score groups: wallpaper-011 &gt; wallpaper-067 &gt; wallpaper-079 &gt; wallpaper-075

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

### vibe-light-batch-001

Light

Submitted preference groups: wallpaper-088 &gt; wallpaper-051 &gt; wallpaper-073 &gt; wallpaper-096

Method score groups: wallpaper-051 &gt; wallpaper-088 &gt; wallpaper-073 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-y89mld, madness-wallhaven-jeek5p, wallpaper-060, wallpaper-006, madness-wallhaven-xeejw3, madness-wallhaven-wqvoxr, wallpaper-010, madness-wallhaven-jeey9q, madness-wallhaven-2116k9, wallpaper-003, wallpaper-055, madness-wallhaven-8gg1g2, madness-wallhaven-lmmxol, madness-wallhaven-yqq68g, madness-wallhaven-k88z5m, madness-wallhaven-5gk313, madness-wallhaven-eojxrr, madness-wallhaven-vppedl

### vibe-vivid-batch-001

Bright, vivid colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-032 &gt; wallpaper-052 &gt; wallpaper-098

Method score groups: wallpaper-032 &gt; wallpaper-094 &gt; wallpaper-098 &gt; wallpaper-052

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-f, madness-wallhaven-ogg6zm, madness-wallhaven-lyykvy, madness-wallhaven-5yy3d3, wallpaper-037, proportion-green-001-e, madness-wallhaven-8ggez2, composition-green-red-001-d, wallpaper-033, madness-wallhaven-rqqjrj, madness-wallhaven-6ll7pq, madness-wallhaven-9639xx, precision-shade-001-a, precision-shade-001-c, precision-shade-001-d

### vibe-strict-grayscale-batch-001

Grayscale

Submitted preference groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-071 &gt; wallpaper-007

Method score groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-071

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-near-neutral-batch-001

Almost grayscale

Submitted preference groups: wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-062 &gt; wallpaper-096

Method score groups: wallpaper-062 &gt; wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-vppy93, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-monochromatic-batch-001

One hue overall

Submitted preference groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

Method score groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-1qqrev, madness-wallhaven-1qqx1g, madness-wallhaven-211986, madness-wallhaven-2119yx, madness-wallhaven-3qqygv, madness-wallhaven-5yy3d3, madness-wallhaven-7jj1p3, madness-wallhaven-8g5qr2, madness-wallhaven-8ggm6k, madness-wallhaven-8ggrqy, madness-wallhaven-9oop2d, madness-wallhaven-9oow31, madness-wallhaven-d88d53, madness-wallhaven-d88jym, madness-wallhaven-d88q5g, madness-wallhaven-e88r8o, madness-wallhaven-gwwm6d, madness-wallhaven-gwwvpe, madness-wallhaven-jeerxp, madness-wallhaven-lyyj52

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

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-9ooez8, madness-wallhaven-ogg23p, wallpaper-084, madness-wallhaven-xeewg3, madness-wallhaven-3qqv1d, wallpaper-043, wallpaper-029, madness-wallhaven-rqq1mm, proportion-green-001-c, madness-wallhaven-wqvoxr, madness-wallhaven-rqqw2q, madness-wallhaven-w5eq57, wallpaper-016

### composition-gray-red-batch-002

80% grayscale, 10% red; the remaining 10% is unspecified

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-042 &gt; wallpaper-048 &gt; wallpaper-060

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-ogg23p, madness-wallhaven-xeewg3, wallpaper-029, madness-wallhaven-3qqv1d, madness-wallhaven-9ooez8, wallpaper-016, proportion-green-001-c, madness-wallhaven-w5eq57, wallpaper-043, madness-wallhaven-wqvoxr, madness-wallhaven-rqq1mm, madness-wallhaven-zppd8y, madness-wallhaven-yqqoek, wallpaper-088

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

Method score groups: wallpaper-058 &gt; wallpaper-057 &gt; wallpaper-040 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, wallpaper-091, wallpaper-037, madness-wallhaven-lyyv8r, madness-wallhaven-rqqjrj, wallpaper-094, madness-wallhaven-q625eq, madness-wallhaven-mllrdk, madness-wallhaven-8gge6y, madness-wallhaven-yqqrp7, madness-wallhaven-gwwkql, madness-wallhaven-rqqj61, madness-wallhaven-2119jg, madness-wallhaven-xe6qdv, madness-wallhaven-k88zgm, madness-wallhaven-poov9e, madness-wallhaven-9oo2k1, madness-wallhaven-9639xx, precision-shade-001-a

### composition-blue-orange-batch-002

40% blue, 40% orange; the remaining 20% is unspecified

Submitted preference groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-002 &gt; wallpaper-057

Method score groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-057 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-lyyv8r, wallpaper-091, madness-wallhaven-mllrdk, madness-wallhaven-yqqrp7, madness-wallhaven-q625eq, wallpaper-094, madness-wallhaven-8gge6y, madness-wallhaven-poov9e, madness-wallhaven-gwwkql, wallpaper-031, madness-wallhaven-jeekxm, evaluation-green-red-tulip-field, madness-wallhaven-k88zgm, madness-wallhaven-2119jg, madness-wallhaven-9oozpx, madness-wallhaven-gwwvqe, precision-shade-001-a, madness-wallhaven-9oo2k1

### precision-warm-red-batch-001

Close to #FF2200

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### precision-muted-green-batch-001

Close to #4C8C72

Submitted preference groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-093 &gt; wallpaper-086

Method score groups: wallpaper-093 &gt; wallpaper-052 &gt; wallpaper-086 &gt; wallpaper-013

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-d, proportion-green-001-b, madness-wallhaven-xeejzz, wallpaper-050, madness-wallhaven-gww9yl, madness-wallhaven-gwwq27, madness-wallhaven-d88mmj, wallpaper-083, madness-wallhaven-po9eop, madness-wallhaven-8ggdxo, madness-wallhaven-rqqwgj, madness-wallhaven-6llmg7, madness-wallhaven-k88jv6, madness-wallhaven-lyyx7l, wallpaper-081, wallpaper-058, madness-wallhaven-qrrkor

### palette-rainbow-batch-001

Rainbow-like colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-003 &gt; wallpaper-034 &gt; wallpaper-004

Method score groups: wallpaper-094 &gt; wallpaper-034 &gt; wallpaper-004 &gt; wallpaper-003

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-13qmlw, madness-wallhaven-rqqwpw, madness-wallhaven-k88zgm, madness-wallhaven-q625eq, madness-wallhaven-9oozpx, madness-wallhaven-oggv5m, madness-wallhaven-mllrdk, wallpaper-038, wallpaper-042, madness-wallhaven-3qqvk9, wallpaper-031, madness-wallhaven-w55rr7, wallpaper-040, madness-wallhaven-yqqrp7, madness-wallhaven-vpp1vl, madness-wallhaven-d88evl, wallpaper-090, madness-wallhaven-9oo2k1, madness-wallhaven-mllelk

### perceived-red-pagoda-001

red

Submitted preference groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

Method score groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

## All cutoffs: shade-aware + strict hue (256 buckets, all cutoffs, blend 1, concrete-swatches): configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 34003,
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

### perceived-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72461,
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

### vibe-grayscale-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 69657,
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

### vibe-dark-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 71406,
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

### combination-gray-red-001: unsupported

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12606,
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
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
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
    "groupId": "source-group-098714935267",
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
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64081,
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

### semantic-red-city-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12221,
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

### proportion-green-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72051,
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

### proportion-green-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62177,
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

### composition-green-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 70441,
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

### composition-green-red-real-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65302,
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

### composition-green-red-real-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64397,
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

### perceived-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62121,
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

### perceived-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61312,
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

### perceived-pink-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62664,
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

### perceived-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62419,
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

### perceived-blue-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62546,
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

### proportion-green-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62921,
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

### proportion-green-real-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62418,
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

### proportion-red-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62217,
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

### vibe-dark-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61793,
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

### vibe-light-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61628,
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

### vibe-vivid-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61622,
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

### vibe-strict-grayscale-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61570,
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

### vibe-near-neutral-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61738,
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

### vibe-monochromatic-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 60696,
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

### combination-gray-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-gray-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63610,
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

### composition-gray-red-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62949,
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

### vibe-dark-accents-batch-001: unsupported

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-blue-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62515,
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

### composition-blue-orange-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62120,
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

### precision-warm-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61757,
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

### precision-muted-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61555,
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

### palette-rainbow-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62050,
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

### perceived-red-pagoda-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 59415,
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

## Favorite256: precomputed float utility · doc-value ID fetch: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 9/14 | 59.3% | 59.3% | 76.4% | 71.2% | 0 |
| Perceived color | 7/7 | 76.7% | 75.7% | 100.0% | 100.0% | 0 |
| Vibe | 8/9 | 85.4% | 85.4% | 91.3% | 90.0% | 0 |
| Precision | 3/3 | 56.7% | 53.3% | 100.0% | 100.0% | 0 |
| Semantic filtering | 1/1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Proportions | 3/3 | 44.4% | 45.6% | 100.0% | 100.0% | 0 |
| Palette | 1/1 | 66.7% | 60.0% | 100.0% | 100.0% | 0 |

## Favorite256: precomputed float utility · doc-value ID fetch: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | ok | 86.7% | 86.7% | 15/15 | — | 0 | n/a | 0.0% | 0.73 ms |
| vibe-grayscale-001 | grayscale | ok | 100.0% | 100.0% | 12/12 | — | 0 | n/a | 0.0% | 0.99 ms |
| vibe-dark-001 | dark | ok | 100.0% | 100.0% | 15/15 | — | 0 | n/a | 0.0% | 0.90 ms |
| combination-gray-red-001 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | ok | 20.0% | 20.0% | 5/5 | — | 0 | 20.0% | 100.0% | 0.73 ms |
| semantic-red-city-001 | A city wallpaper with a red feel (Condition: Assuming C matches the city tag.) | ok | 100.0% | 100.0% | 3/3 | — | 0 | 100.0% | 100.0% | 0.85 ms |
| proportion-green-001 | 40% green; the rest doesn’t matter | ok | 86.7% | 86.7% | 15/15 | — | 0 | 100.0% | 20.0% | 1.75 ms |
| proportion-green-002 | 40% green; the rest doesn’t matter | ok | 93.3% | 93.3% | 15/15 | — | 0 | 93.3% | 100.0% | 0.80 ms |
| composition-green-red-001 | 50% green, 50% red | ok | 53.3% | 53.3% | 15/15 | — | 0 | 53.3% | 100.0% | 1.16 ms |
| composition-green-red-real-001 | 50% green, 50% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | 100.0% | 16.7% | 0.97 ms |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | ok | 0.0% | 0.0% | 6/6 | — | 0 | 0.0% | 16.7% | 0.85 ms |
| perceived-red-batch-001 | Red | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 0.74 ms |
| perceived-orange-batch-001 | Orange | ok | 83.3% | 83.3% | 6/6 | — | 0 | 100.0% | 16.7% | 1.15 ms |
| perceived-pink-batch-001 | Pink | ok | 33.3% | 33.3% | 6/6 | — | 0 | n/a | 0.0% | 0.87 ms |
| perceived-green-batch-001 | Green | ok | 83.3% | 80.0% | 6/6 | — | 0 | 0.0% | 16.7% | 0.83 ms |
| perceived-blue-batch-001 | Blue | ok | 83.3% | 80.0% | 6/6 | — | 0 | n/a | 0.0% | 0.87 ms |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | ok | 16.7% | 20.0% | 6/6 | — | 0 | 0.0% | 16.7% | 0.91 ms |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | 0.0% | 16.7% | 1.15 ms |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 0.97 ms |
| vibe-dark-batch-001 | Dark | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 0.82 ms |
| vibe-light-batch-001 | Light | ok | 83.3% | 83.3% | 6/6 | — | 0 | 0.0% | 16.7% | 0.97 ms |
| vibe-vivid-batch-001 | Bright, vivid colors | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 0.71 ms |
| vibe-strict-grayscale-batch-001 | Grayscale | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 0.69 ms |
| vibe-near-neutral-batch-001 | Almost grayscale | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 0.77 ms |
| vibe-monochromatic-batch-001 | One hue overall | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 0.74 ms |
| combination-gray-red-batch-001 | Grayscale with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 1.06 ms |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 0.88 ms |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 0.95 ms |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 0.93 ms |
| precision-warm-red-batch-001 | Close to #FF2200 | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 1.03 ms |
| precision-muted-green-batch-001 | Close to #4C8C72 | ok | 50.0% | 40.0% | 6/6 | — | 0 | 66.7% | 50.0% | 1.08 ms |
| palette-rainbow-batch-001 | Rainbow-like colors | ok | 66.7% | 60.0% | 6/6 | — | 0 | n/a | 0.0% | 2.16 ms |
| perceived-red-pagoda-001 | red | ok | 100.0% | 100.0% | 1/1 | — | 0 | n/a | 0.0% | 0.87 ms |

## Favorite256: precomputed float utility · doc-value ID fetch: visual comparisons

This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.

### perceived-red-001

red

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-048 &gt; wallpaper-060 &gt; wallpaper-077

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-077 &gt; wallpaper-048 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### vibe-grayscale-001

grayscale

Submitted preference groups: wallpaper-066 = wallpaper-070 = wallpaper-061 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

Method score groups: wallpaper-061 &gt; wallpaper-066 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, madness-wallhaven-mllr38, wallpaper-063

### vibe-dark-001

dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

Method score groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

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

Method score groups: precision-shade-001-c &gt; precision-shade-001-d &gt; precision-shade-001-a &gt; precision-shade-001-b

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-f, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### semantic-red-city-001

A city wallpaper with a red feel (Condition: Assuming C matches the city tag.)

Submitted preference groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

Method score groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-001

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-d &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-e

Method score groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-d &gt; proportion-green-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### proportion-green-002

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-a &gt; proportion-green-002-b &gt; proportion-green-002-e

Method score groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-b &gt; proportion-green-002-a &gt; proportion-green-002-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-001-f, composition-green-red-001-e, composition-green-red-001-a, composition-green-red-001-b, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### composition-green-red-001

50% green, 50% red

Submitted preference groups: composition-green-red-001-b &gt; composition-green-red-001-d &gt; composition-green-red-001-e &gt; composition-green-red-001-f &gt; composition-green-red-001-a &gt; composition-green-red-001-c

Method score groups: composition-green-red-001-b &gt; composition-green-red-001-a &gt; composition-green-red-001-c &gt; composition-green-red-001-d &gt; composition-green-red-001-f &gt; composition-green-red-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, evaluation-green-red-tulips, evaluation-green-red-tulip-field, proportion-green-002-d

### composition-green-red-real-001

50% green, 50% red

Submitted preference groups: wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-leaves &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-f, composition-green-red-001-e, precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, proportion-green-002-d

### composition-green-red-real-002

40% green, 40% red; the remaining 20% is unspecified

Submitted preference groups: evaluation-green-red-leaves &gt; wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulip-field &gt; evaluation-green-red-tulips &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-f, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-e, composition-green-red-001-d, proportion-green-002-f, precision-shade-001-a, proportion-green-001-f, proportion-green-002-c, madness-wallhaven-rqq1ww, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-rqqjrj, proportion-green-002-a, madness-wallhaven-w55xgp

### perceived-red-batch-001

Red

Submitted preference groups: wallpaper-037 &gt; wallpaper-095 &gt; wallpaper-084 &gt; wallpaper-044

Method score groups: wallpaper-037 &gt; wallpaper-084 &gt; wallpaper-044 &gt; wallpaper-095

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### perceived-orange-batch-001

Orange

Submitted preference groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-036 &gt; wallpaper-087

Method score groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-087 &gt; wallpaper-036

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: wallpaper-037, madness-wallhaven-9639xx, wallpaper-058, madness-wallhaven-rqqjrj, madness-wallhaven-gwwkql, madness-wallhaven-qrroml, madness-wallhaven-lyyv8r, wallpaper-094, madness-wallhaven-xe6qdv, madness-wallhaven-gwwq8e, madness-wallhaven-gwwmxq, madness-wallhaven-lyyko2, madness-wallhaven-jeeoxq, madness-wallhaven-v9qkgm, madness-wallhaven-k9m277, madness-wallhaven-rqqxew, precision-shade-001-a, madness-wallhaven-w55xgp

### perceived-pink-batch-001

Pink

Submitted preference groups: wallpaper-044 &gt; wallpaper-039 &gt; wallpaper-033 &gt; wallpaper-048

Method score groups: wallpaper-039 &gt; wallpaper-048 &gt; wallpaper-033 &gt; wallpaper-044

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-lmmxol, madness-wallhaven-w5531x, madness-wallhaven-7j3lve, madness-wallhaven-d88evl, madness-wallhaven-zpp3mg, madness-wallhaven-9mrgk1, madness-wallhaven-vppyjp, wallpaper-038, madness-wallhaven-jeey2y, madness-wallhaven-2116k9, madness-wallhaven-j3511m, madness-wallhaven-k881zd, madness-wallhaven-6llwv6, madness-wallhaven-211dyx, wallpaper-035, madness-wallhaven-e88rok, madness-wallhaven-q625eq, madness-wallhaven-6llrl7, madness-wallhaven-jeekjy

### perceived-green-batch-001

Green

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-083 &gt; wallpaper-093

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: proportion-green-001-e, composition-green-red-001-f, proportion-green-001-a, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, proportion-green-001-c, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, madness-wallhaven-5yyme5

### perceived-blue-batch-001

Blue

Submitted preference groups: wallpaper-091 &gt; wallpaper-030 &gt; wallpaper-047 &gt; wallpaper-010

Method score groups: wallpaper-091 &gt; wallpaper-047 &gt; wallpaper-030 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-6ll7pq, madness-wallhaven-2119jg, madness-wallhaven-rqqj61, wallpaper-032, madness-wallhaven-6ll2zw, madness-wallhaven-8gge6y, madness-wallhaven-9oow11, wallpaper-057, madness-wallhaven-jeekxm, madness-wallhaven-w55rr7, madness-wallhaven-9oo2k1, madness-wallhaven-k88zgm, madness-wallhaven-zppq2j, wallpaper-039, madness-wallhaven-jeelj5, madness-wallhaven-lyypwr, madness-wallhaven-7jjwp3, madness-wallhaven-9mrgk1

### proportion-green-real-batch-001

40% green; the remaining 60% is unspecified

Submitted preference groups: wallpaper-093 &gt; wallpaper-081 &gt; wallpaper-083 &gt; wallpaper-050

Method score groups: wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093 &gt; wallpaper-081

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-001-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj

### proportion-green-real-batch-002

70% green; the remaining 30% is unspecified

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-012 &gt; wallpaper-090

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-090 &gt; wallpaper-012

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-f, proportion-green-001-a, proportion-green-001-e, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, proportion-green-001-c, madness-wallhaven-ogg6zm

### proportion-red-real-batch-001

20% red; the remaining 80% is unspecified

Submitted preference groups: wallpaper-029 &gt; wallpaper-060 &gt; wallpaper-084 &gt; wallpaper-082

Method score groups: wallpaper-029 &gt; wallpaper-082 &gt; wallpaper-084 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: evaluation-green-red-tulips, precision-shade-001-b, madness-wallhaven-xeewg3, evaluation-green-red-tulip-field, madness-wallhaven-6llzk6, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-w55xgp, madness-wallhaven-ox2ool, madness-wallhaven-gwwvqe, madness-wallhaven-gwwkql, madness-wallhaven-d88evl, madness-wallhaven-8368k1, madness-wallhaven-w553y6, madness-wallhaven-13qmlw, madness-wallhaven-yqqrp7, madness-wallhaven-rqq1ww, madness-wallhaven-3qq5lv, madness-wallhaven-7j3lve

### vibe-dark-batch-001

Dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-011 &gt; wallpaper-079 &gt; wallpaper-075

Method score groups: wallpaper-011 &gt; wallpaper-067 &gt; wallpaper-079 &gt; wallpaper-075

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

### vibe-light-batch-001

Light

Submitted preference groups: wallpaper-088 &gt; wallpaper-051 &gt; wallpaper-073 &gt; wallpaper-096

Method score groups: wallpaper-051 &gt; wallpaper-088 &gt; wallpaper-073 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-y89mld, madness-wallhaven-jeek5p, wallpaper-060, wallpaper-006, madness-wallhaven-xeejw3, madness-wallhaven-wqvoxr, wallpaper-010, madness-wallhaven-jeey9q, madness-wallhaven-2116k9, wallpaper-003, wallpaper-055, madness-wallhaven-8gg1g2, madness-wallhaven-lmmxol, madness-wallhaven-yqq68g, madness-wallhaven-k88z5m, madness-wallhaven-5gk313, madness-wallhaven-eojxrr, madness-wallhaven-vppedl

### vibe-vivid-batch-001

Bright, vivid colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-032 &gt; wallpaper-052 &gt; wallpaper-098

Method score groups: wallpaper-032 &gt; wallpaper-094 &gt; wallpaper-098 &gt; wallpaper-052

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-f, madness-wallhaven-ogg6zm, madness-wallhaven-lyykvy, madness-wallhaven-5yy3d3, wallpaper-037, proportion-green-001-e, madness-wallhaven-8ggez2, composition-green-red-001-d, wallpaper-033, madness-wallhaven-rqqjrj, madness-wallhaven-6ll7pq, madness-wallhaven-9639xx, precision-shade-001-a, precision-shade-001-c, precision-shade-001-d

### vibe-strict-grayscale-batch-001

Grayscale

Submitted preference groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-071 &gt; wallpaper-007

Method score groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-071

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-near-neutral-batch-001

Almost grayscale

Submitted preference groups: wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-062 &gt; wallpaper-096

Method score groups: wallpaper-062 &gt; wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-vppy93, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-monochromatic-batch-001

One hue overall

Submitted preference groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

Method score groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-1qqrev, madness-wallhaven-1qqx1g, madness-wallhaven-211986, madness-wallhaven-2119yx, madness-wallhaven-3qqygv, madness-wallhaven-5yy3d3, madness-wallhaven-7jj1p3, madness-wallhaven-8g5qr2, madness-wallhaven-8ggm6k, madness-wallhaven-8ggrqy, madness-wallhaven-9oop2d, madness-wallhaven-9oow31, madness-wallhaven-d88d53, madness-wallhaven-d88jym, madness-wallhaven-d88q5g, madness-wallhaven-e88r8o, madness-wallhaven-gwwm6d, madness-wallhaven-gwwvpe, madness-wallhaven-jeerxp, madness-wallhaven-lyyj52

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

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-9ooez8, madness-wallhaven-ogg23p, wallpaper-084, madness-wallhaven-xeewg3, madness-wallhaven-3qqv1d, wallpaper-043, wallpaper-029, madness-wallhaven-rqq1mm, proportion-green-001-c, madness-wallhaven-wqvoxr, madness-wallhaven-rqqw2q, madness-wallhaven-w5eq57, wallpaper-016

### composition-gray-red-batch-002

80% grayscale, 10% red; the remaining 10% is unspecified

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-042 &gt; wallpaper-048 &gt; wallpaper-060

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-ogg23p, madness-wallhaven-xeewg3, wallpaper-029, madness-wallhaven-3qqv1d, madness-wallhaven-9ooez8, wallpaper-016, proportion-green-001-c, madness-wallhaven-w5eq57, wallpaper-043, madness-wallhaven-wqvoxr, madness-wallhaven-rqq1mm, madness-wallhaven-zppd8y, madness-wallhaven-yqqoek, wallpaper-088

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

Method score groups: wallpaper-058 &gt; wallpaper-057 &gt; wallpaper-040 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, wallpaper-091, wallpaper-037, madness-wallhaven-lyyv8r, madness-wallhaven-rqqjrj, wallpaper-094, madness-wallhaven-q625eq, madness-wallhaven-mllrdk, madness-wallhaven-8gge6y, madness-wallhaven-yqqrp7, madness-wallhaven-gwwkql, madness-wallhaven-rqqj61, madness-wallhaven-2119jg, madness-wallhaven-xe6qdv, madness-wallhaven-k88zgm, madness-wallhaven-poov9e, madness-wallhaven-9oo2k1, madness-wallhaven-9639xx, precision-shade-001-a

### composition-blue-orange-batch-002

40% blue, 40% orange; the remaining 20% is unspecified

Submitted preference groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-002 &gt; wallpaper-057

Method score groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-057 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-lyyv8r, wallpaper-091, madness-wallhaven-mllrdk, madness-wallhaven-yqqrp7, madness-wallhaven-q625eq, wallpaper-094, madness-wallhaven-8gge6y, madness-wallhaven-poov9e, madness-wallhaven-gwwkql, wallpaper-031, madness-wallhaven-jeekxm, evaluation-green-red-tulip-field, madness-wallhaven-k88zgm, madness-wallhaven-2119jg, madness-wallhaven-9oozpx, madness-wallhaven-gwwvqe, precision-shade-001-a, madness-wallhaven-9oo2k1

### precision-warm-red-batch-001

Close to #FF2200

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### precision-muted-green-batch-001

Close to #4C8C72

Submitted preference groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-093 &gt; wallpaper-086

Method score groups: wallpaper-093 &gt; wallpaper-052 &gt; wallpaper-086 &gt; wallpaper-013

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-d, proportion-green-001-b, madness-wallhaven-xeejzz, wallpaper-050, madness-wallhaven-gww9yl, madness-wallhaven-gwwq27, madness-wallhaven-d88mmj, wallpaper-083, madness-wallhaven-po9eop, madness-wallhaven-8ggdxo, madness-wallhaven-rqqwgj, madness-wallhaven-6llmg7, madness-wallhaven-k88jv6, madness-wallhaven-lyyx7l, wallpaper-081, wallpaper-058, madness-wallhaven-qrrkor

### palette-rainbow-batch-001

Rainbow-like colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-003 &gt; wallpaper-034 &gt; wallpaper-004

Method score groups: wallpaper-094 &gt; wallpaper-034 &gt; wallpaper-004 &gt; wallpaper-003

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-13qmlw, madness-wallhaven-rqqwpw, madness-wallhaven-k88zgm, madness-wallhaven-q625eq, madness-wallhaven-9oozpx, madness-wallhaven-oggv5m, madness-wallhaven-mllrdk, wallpaper-038, wallpaper-042, madness-wallhaven-3qqvk9, wallpaper-031, madness-wallhaven-w55rr7, wallpaper-040, madness-wallhaven-yqqrp7, madness-wallhaven-vpp1vl, madness-wallhaven-d88evl, wallpaper-090, madness-wallhaven-9oo2k1, madness-wallhaven-mllelk

### perceived-red-pagoda-001

red

Submitted preference groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

Method score groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

## Favorite256: precomputed float utility · doc-value ID fetch: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 33756,
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

### perceived-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72762,
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

### vibe-grayscale-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 69959,
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

### vibe-dark-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 71704,
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

### combination-gray-red-001: unsupported

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12606,
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
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
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
    "groupId": "source-group-098714935267",
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
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64383,
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

### semantic-red-city-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12522,
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

### proportion-green-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72342,
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

### proportion-green-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62463,
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

### composition-green-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 70749,
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

### composition-green-red-real-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65608,
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

### composition-green-red-real-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64671,
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

### perceived-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62417,
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

### perceived-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61611,
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

### perceived-pink-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62963,
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

### perceived-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62724,
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

### perceived-blue-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62849,
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

### proportion-green-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63223,
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

### proportion-green-real-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62716,
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

### proportion-red-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62516,
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

### vibe-dark-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62098,
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

### vibe-light-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61928,
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

### vibe-vivid-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61923,
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

### vibe-strict-grayscale-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61872,
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

### vibe-near-neutral-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62037,
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

### vibe-monochromatic-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 60990,
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

### combination-gray-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-gray-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63918,
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

### composition-gray-red-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63229,
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

### vibe-dark-accents-batch-001: unsupported

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-blue-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62803,
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

### composition-blue-orange-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62414,
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

### precision-warm-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62058,
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

### precision-muted-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61846,
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

### palette-rainbow-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62345,
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

### perceived-red-pagoda-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 59711,
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

## Favorite256: globally bounded numeric utilities · pooled PIT cleanup: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 9/14 | 59.3% | 59.3% | 76.4% | 71.2% | 0 |
| Perceived color | 7/7 | 76.7% | 75.7% | 100.0% | 100.0% | 0 |
| Vibe | 8/9 | 85.4% | 85.4% | 91.3% | 90.0% | 0 |
| Precision | 3/3 | 56.7% | 53.3% | 100.0% | 100.0% | 0 |
| Semantic filtering | 1/1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Proportions | 3/3 | 44.4% | 45.6% | 100.0% | 100.0% | 0 |
| Palette | 1/1 | 66.7% | 60.0% | 100.0% | 100.0% | 0 |

## Favorite256: globally bounded numeric utilities · pooled PIT cleanup: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | ok | 86.7% | 86.7% | 15/15 | — | 0 | n/a | 0.0% | 2.81 ms |
| vibe-grayscale-001 | grayscale | ok | 100.0% | 100.0% | 12/12 | — | 0 | n/a | 0.0% | 3.36 ms |
| vibe-dark-001 | dark | ok | 100.0% | 100.0% | 15/15 | — | 0 | n/a | 0.0% | 3.24 ms |
| combination-gray-red-001 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | ok | 20.0% | 20.0% | 5/5 | — | 0 | 20.0% | 100.0% | 3.27 ms |
| semantic-red-city-001 | A city wallpaper with a red feel (Condition: Assuming C matches the city tag.) | ok | 100.0% | 100.0% | 3/3 | — | 0 | 100.0% | 100.0% | 2.20 ms |
| proportion-green-001 | 40% green; the rest doesn’t matter | ok | 86.7% | 86.7% | 15/15 | — | 0 | 100.0% | 20.0% | 3.67 ms |
| proportion-green-002 | 40% green; the rest doesn’t matter | ok | 93.3% | 93.3% | 15/15 | — | 0 | 93.3% | 100.0% | 4.98 ms |
| composition-green-red-001 | 50% green, 50% red | ok | 53.3% | 53.3% | 15/15 | — | 0 | 53.3% | 100.0% | 4.24 ms |
| composition-green-red-real-001 | 50% green, 50% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | 100.0% | 16.7% | 3.95 ms |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | ok | 0.0% | 0.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.89 ms |
| perceived-red-batch-001 | Red | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.06 ms |
| perceived-orange-batch-001 | Orange | ok | 83.3% | 83.3% | 6/6 | — | 0 | 100.0% | 16.7% | 3.05 ms |
| perceived-pink-batch-001 | Pink | ok | 33.3% | 33.3% | 6/6 | — | 0 | n/a | 0.0% | 4.52 ms |
| perceived-green-batch-001 | Green | ok | 83.3% | 80.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.39 ms |
| perceived-blue-batch-001 | Blue | ok | 83.3% | 80.0% | 6/6 | — | 0 | n/a | 0.0% | 2.96 ms |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | ok | 16.7% | 20.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.24 ms |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | 0.0% | 16.7% | 3.23 ms |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 3.00 ms |
| vibe-dark-batch-001 | Dark | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 4.95 ms |
| vibe-light-batch-001 | Light | ok | 83.3% | 83.3% | 6/6 | — | 0 | 0.0% | 16.7% | 3.15 ms |
| vibe-vivid-batch-001 | Bright, vivid colors | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.74 ms |
| vibe-strict-grayscale-batch-001 | Grayscale | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 3.41 ms |
| vibe-near-neutral-batch-001 | Almost grayscale | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.25 ms |
| vibe-monochromatic-batch-001 | One hue overall | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 3.04 ms |
| combination-gray-red-batch-001 | Grayscale with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 4.09 ms |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 6.10 ms |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 4.00 ms |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 4.73 ms |
| precision-warm-red-batch-001 | Close to #FF2200 | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 3.27 ms |
| precision-muted-green-batch-001 | Close to #4C8C72 | ok | 50.0% | 40.0% | 6/6 | — | 0 | 66.7% | 50.0% | 2.97 ms |
| palette-rainbow-batch-001 | Rainbow-like colors | ok | 66.7% | 60.0% | 6/6 | — | 0 | n/a | 0.0% | 2.90 ms |
| perceived-red-pagoda-001 | red | ok | 100.0% | 100.0% | 1/1 | — | 0 | n/a | 0.0% | 4.66 ms |

## Favorite256: globally bounded numeric utilities · pooled PIT cleanup: visual comparisons

This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.

### perceived-red-001

red

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-048 &gt; wallpaper-060 &gt; wallpaper-077

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-077 &gt; wallpaper-048 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### vibe-grayscale-001

grayscale

Submitted preference groups: wallpaper-066 = wallpaper-070 = wallpaper-061 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

Method score groups: wallpaper-061 &gt; wallpaper-066 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, madness-wallhaven-mllr38, wallpaper-063

### vibe-dark-001

dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

Method score groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

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

Method score groups: precision-shade-001-c &gt; precision-shade-001-d &gt; precision-shade-001-a &gt; precision-shade-001-b

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-f, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### semantic-red-city-001

A city wallpaper with a red feel (Condition: Assuming C matches the city tag.)

Submitted preference groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

Method score groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-001

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-d &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-e

Method score groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-d &gt; proportion-green-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### proportion-green-002

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-a &gt; proportion-green-002-b &gt; proportion-green-002-e

Method score groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-b &gt; proportion-green-002-a &gt; proportion-green-002-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-001-f, composition-green-red-001-e, composition-green-red-001-a, composition-green-red-001-b, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### composition-green-red-001

50% green, 50% red

Submitted preference groups: composition-green-red-001-b &gt; composition-green-red-001-d &gt; composition-green-red-001-e &gt; composition-green-red-001-f &gt; composition-green-red-001-a &gt; composition-green-red-001-c

Method score groups: composition-green-red-001-b &gt; composition-green-red-001-a &gt; composition-green-red-001-c &gt; composition-green-red-001-d &gt; composition-green-red-001-f &gt; composition-green-red-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, evaluation-green-red-tulips, evaluation-green-red-tulip-field, proportion-green-002-d

### composition-green-red-real-001

50% green, 50% red

Submitted preference groups: wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-leaves &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-f, composition-green-red-001-e, precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, proportion-green-002-d

### composition-green-red-real-002

40% green, 40% red; the remaining 20% is unspecified

Submitted preference groups: evaluation-green-red-leaves &gt; wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulip-field &gt; evaluation-green-red-tulips &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-f, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-e, composition-green-red-001-d, proportion-green-002-f, precision-shade-001-a, proportion-green-001-f, proportion-green-002-c, madness-wallhaven-rqq1ww, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-rqqjrj, proportion-green-002-a, madness-wallhaven-w55xgp

### perceived-red-batch-001

Red

Submitted preference groups: wallpaper-037 &gt; wallpaper-095 &gt; wallpaper-084 &gt; wallpaper-044

Method score groups: wallpaper-037 &gt; wallpaper-084 &gt; wallpaper-044 &gt; wallpaper-095

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### perceived-orange-batch-001

Orange

Submitted preference groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-036 &gt; wallpaper-087

Method score groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-087 &gt; wallpaper-036

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: wallpaper-037, madness-wallhaven-9639xx, wallpaper-058, madness-wallhaven-rqqjrj, madness-wallhaven-gwwkql, madness-wallhaven-qrroml, madness-wallhaven-lyyv8r, wallpaper-094, madness-wallhaven-xe6qdv, madness-wallhaven-gwwq8e, madness-wallhaven-gwwmxq, madness-wallhaven-lyyko2, madness-wallhaven-jeeoxq, madness-wallhaven-v9qkgm, madness-wallhaven-k9m277, madness-wallhaven-rqqxew, precision-shade-001-a, madness-wallhaven-w55xgp

### perceived-pink-batch-001

Pink

Submitted preference groups: wallpaper-044 &gt; wallpaper-039 &gt; wallpaper-033 &gt; wallpaper-048

Method score groups: wallpaper-039 &gt; wallpaper-048 &gt; wallpaper-033 &gt; wallpaper-044

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-lmmxol, madness-wallhaven-w5531x, madness-wallhaven-7j3lve, madness-wallhaven-d88evl, madness-wallhaven-zpp3mg, madness-wallhaven-9mrgk1, madness-wallhaven-vppyjp, wallpaper-038, madness-wallhaven-jeey2y, madness-wallhaven-2116k9, madness-wallhaven-j3511m, madness-wallhaven-k881zd, madness-wallhaven-6llwv6, madness-wallhaven-211dyx, wallpaper-035, madness-wallhaven-e88rok, madness-wallhaven-q625eq, madness-wallhaven-6llrl7, madness-wallhaven-jeekjy

### perceived-green-batch-001

Green

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-083 &gt; wallpaper-093

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: proportion-green-001-e, composition-green-red-001-f, proportion-green-001-a, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, proportion-green-001-c, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, madness-wallhaven-5yyme5

### perceived-blue-batch-001

Blue

Submitted preference groups: wallpaper-091 &gt; wallpaper-030 &gt; wallpaper-047 &gt; wallpaper-010

Method score groups: wallpaper-091 &gt; wallpaper-047 &gt; wallpaper-030 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-6ll7pq, madness-wallhaven-2119jg, madness-wallhaven-rqqj61, wallpaper-032, madness-wallhaven-6ll2zw, madness-wallhaven-8gge6y, madness-wallhaven-9oow11, wallpaper-057, madness-wallhaven-jeekxm, madness-wallhaven-w55rr7, madness-wallhaven-9oo2k1, madness-wallhaven-k88zgm, madness-wallhaven-zppq2j, wallpaper-039, madness-wallhaven-jeelj5, madness-wallhaven-lyypwr, madness-wallhaven-7jjwp3, madness-wallhaven-9mrgk1

### proportion-green-real-batch-001

40% green; the remaining 60% is unspecified

Submitted preference groups: wallpaper-093 &gt; wallpaper-081 &gt; wallpaper-083 &gt; wallpaper-050

Method score groups: wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093 &gt; wallpaper-081

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-001-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj

### proportion-green-real-batch-002

70% green; the remaining 30% is unspecified

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-012 &gt; wallpaper-090

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-090 &gt; wallpaper-012

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-f, proportion-green-001-a, proportion-green-001-e, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, proportion-green-001-c, madness-wallhaven-ogg6zm

### proportion-red-real-batch-001

20% red; the remaining 80% is unspecified

Submitted preference groups: wallpaper-029 &gt; wallpaper-060 &gt; wallpaper-084 &gt; wallpaper-082

Method score groups: wallpaper-029 &gt; wallpaper-082 &gt; wallpaper-084 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: evaluation-green-red-tulips, precision-shade-001-b, madness-wallhaven-xeewg3, evaluation-green-red-tulip-field, madness-wallhaven-6llzk6, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-w55xgp, madness-wallhaven-ox2ool, madness-wallhaven-gwwvqe, madness-wallhaven-gwwkql, madness-wallhaven-d88evl, madness-wallhaven-8368k1, madness-wallhaven-w553y6, madness-wallhaven-13qmlw, madness-wallhaven-yqqrp7, madness-wallhaven-rqq1ww, madness-wallhaven-3qq5lv, madness-wallhaven-7j3lve

### vibe-dark-batch-001

Dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-011 &gt; wallpaper-079 &gt; wallpaper-075

Method score groups: wallpaper-011 &gt; wallpaper-067 &gt; wallpaper-079 &gt; wallpaper-075

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

### vibe-light-batch-001

Light

Submitted preference groups: wallpaper-088 &gt; wallpaper-051 &gt; wallpaper-073 &gt; wallpaper-096

Method score groups: wallpaper-051 &gt; wallpaper-088 &gt; wallpaper-073 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-y89mld, madness-wallhaven-jeek5p, wallpaper-060, wallpaper-006, madness-wallhaven-xeejw3, madness-wallhaven-wqvoxr, wallpaper-010, madness-wallhaven-jeey9q, madness-wallhaven-2116k9, wallpaper-003, wallpaper-055, madness-wallhaven-8gg1g2, madness-wallhaven-lmmxol, madness-wallhaven-yqq68g, madness-wallhaven-k88z5m, madness-wallhaven-5gk313, madness-wallhaven-eojxrr, madness-wallhaven-vppedl

### vibe-vivid-batch-001

Bright, vivid colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-032 &gt; wallpaper-052 &gt; wallpaper-098

Method score groups: wallpaper-032 &gt; wallpaper-094 &gt; wallpaper-098 &gt; wallpaper-052

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-f, madness-wallhaven-ogg6zm, madness-wallhaven-lyykvy, madness-wallhaven-5yy3d3, wallpaper-037, proportion-green-001-e, madness-wallhaven-8ggez2, composition-green-red-001-d, wallpaper-033, madness-wallhaven-rqqjrj, madness-wallhaven-6ll7pq, madness-wallhaven-9639xx, precision-shade-001-a, precision-shade-001-c, precision-shade-001-d

### vibe-strict-grayscale-batch-001

Grayscale

Submitted preference groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-071 &gt; wallpaper-007

Method score groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-071

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-near-neutral-batch-001

Almost grayscale

Submitted preference groups: wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-062 &gt; wallpaper-096

Method score groups: wallpaper-062 &gt; wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-vppy93, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-monochromatic-batch-001

One hue overall

Submitted preference groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

Method score groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-1qqrev, madness-wallhaven-1qqx1g, madness-wallhaven-211986, madness-wallhaven-2119yx, madness-wallhaven-3qqygv, madness-wallhaven-5yy3d3, madness-wallhaven-7jj1p3, madness-wallhaven-8g5qr2, madness-wallhaven-8ggm6k, madness-wallhaven-8ggrqy, madness-wallhaven-9oop2d, madness-wallhaven-9oow31, madness-wallhaven-d88d53, madness-wallhaven-d88jym, madness-wallhaven-d88q5g, madness-wallhaven-e88r8o, madness-wallhaven-gwwm6d, madness-wallhaven-gwwvpe, madness-wallhaven-jeerxp, madness-wallhaven-lyyj52

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

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-9ooez8, madness-wallhaven-ogg23p, wallpaper-084, madness-wallhaven-xeewg3, madness-wallhaven-3qqv1d, wallpaper-043, wallpaper-029, madness-wallhaven-rqq1mm, proportion-green-001-c, madness-wallhaven-wqvoxr, madness-wallhaven-rqqw2q, madness-wallhaven-w5eq57, wallpaper-016

### composition-gray-red-batch-002

80% grayscale, 10% red; the remaining 10% is unspecified

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-042 &gt; wallpaper-048 &gt; wallpaper-060

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-ogg23p, madness-wallhaven-xeewg3, wallpaper-029, madness-wallhaven-3qqv1d, madness-wallhaven-9ooez8, wallpaper-016, proportion-green-001-c, madness-wallhaven-w5eq57, wallpaper-043, madness-wallhaven-wqvoxr, madness-wallhaven-rqq1mm, madness-wallhaven-zppd8y, madness-wallhaven-yqqoek, wallpaper-088

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

Method score groups: wallpaper-058 &gt; wallpaper-057 &gt; wallpaper-040 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, wallpaper-091, wallpaper-037, madness-wallhaven-lyyv8r, madness-wallhaven-rqqjrj, wallpaper-094, madness-wallhaven-q625eq, madness-wallhaven-mllrdk, madness-wallhaven-8gge6y, madness-wallhaven-yqqrp7, madness-wallhaven-gwwkql, madness-wallhaven-rqqj61, madness-wallhaven-2119jg, madness-wallhaven-xe6qdv, madness-wallhaven-k88zgm, madness-wallhaven-poov9e, madness-wallhaven-9oo2k1, madness-wallhaven-9639xx, precision-shade-001-a

### composition-blue-orange-batch-002

40% blue, 40% orange; the remaining 20% is unspecified

Submitted preference groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-002 &gt; wallpaper-057

Method score groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-057 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-lyyv8r, wallpaper-091, madness-wallhaven-mllrdk, madness-wallhaven-yqqrp7, madness-wallhaven-q625eq, wallpaper-094, madness-wallhaven-8gge6y, madness-wallhaven-poov9e, madness-wallhaven-gwwkql, wallpaper-031, madness-wallhaven-jeekxm, evaluation-green-red-tulip-field, madness-wallhaven-k88zgm, madness-wallhaven-2119jg, madness-wallhaven-9oozpx, madness-wallhaven-gwwvqe, precision-shade-001-a, madness-wallhaven-9oo2k1

### precision-warm-red-batch-001

Close to #FF2200

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### precision-muted-green-batch-001

Close to #4C8C72

Submitted preference groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-093 &gt; wallpaper-086

Method score groups: wallpaper-093 &gt; wallpaper-052 &gt; wallpaper-086 &gt; wallpaper-013

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-d, proportion-green-001-b, madness-wallhaven-xeejzz, wallpaper-050, madness-wallhaven-gww9yl, madness-wallhaven-gwwq27, madness-wallhaven-d88mmj, wallpaper-083, madness-wallhaven-po9eop, madness-wallhaven-8ggdxo, madness-wallhaven-rqqwgj, madness-wallhaven-6llmg7, madness-wallhaven-k88jv6, madness-wallhaven-lyyx7l, wallpaper-081, wallpaper-058, madness-wallhaven-qrrkor

### palette-rainbow-batch-001

Rainbow-like colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-003 &gt; wallpaper-034 &gt; wallpaper-004

Method score groups: wallpaper-094 &gt; wallpaper-034 &gt; wallpaper-004 &gt; wallpaper-003

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-13qmlw, madness-wallhaven-rqqwpw, madness-wallhaven-k88zgm, madness-wallhaven-q625eq, madness-wallhaven-9oozpx, madness-wallhaven-oggv5m, madness-wallhaven-mllrdk, wallpaper-038, wallpaper-042, madness-wallhaven-3qqvk9, wallpaper-031, madness-wallhaven-w55rr7, wallpaper-040, madness-wallhaven-yqqrp7, madness-wallhaven-vpp1vl, madness-wallhaven-d88evl, wallpaper-090, madness-wallhaven-9oo2k1, madness-wallhaven-mllelk

### perceived-red-pagoda-001

red

Submitted preference groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

Method score groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

## Favorite256: globally bounded numeric utilities · pooled PIT cleanup: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 35784,
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

### perceived-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 73596,
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

### vibe-grayscale-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 70795,
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

### vibe-dark-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72536,
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

### combination-gray-red-001: unsupported

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12606,
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
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
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
    "groupId": "source-group-098714935267",
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
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65220,
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

### semantic-red-city-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 13351,
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

### proportion-green-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 73184,
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

### proportion-green-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63303,
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

### composition-green-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 71698,
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

### composition-green-red-real-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 66566,
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

### composition-green-red-real-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65626,
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

### perceived-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63261,
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

### perceived-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62443,
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

### perceived-pink-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63796,
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

### perceived-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63557,
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

### perceived-blue-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63688,
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

### proportion-green-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64064,
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

### proportion-green-real-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63556,
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

### proportion-red-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63351,
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

### vibe-dark-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62934,
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

### vibe-light-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62769,
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

### vibe-vivid-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62762,
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

### vibe-strict-grayscale-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62712,
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

### vibe-near-neutral-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62875,
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

### vibe-monochromatic-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 61838,
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

### combination-gray-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-gray-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64873,
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

### composition-gray-red-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64189,
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

### vibe-dark-accents-batch-001: unsupported

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-blue-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63749,
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

### composition-blue-orange-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63363,
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

### precision-warm-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62889,
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

### precision-muted-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62684,
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

### palette-rainbow-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63186,
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

### perceived-red-pagoda-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 60545,
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

## Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup: categories

| Category | Assessed / total cases | Agreement | Without uncertain pairs | Pair coverage | Image coverage | Eligibility violations |
| --- | --- | --- | --- | --- | --- | --- |
| Combinations | 9/14 | 59.3% | 59.3% | 76.4% | 71.2% | 0 |
| Perceived color | 7/7 | 76.7% | 75.7% | 100.0% | 100.0% | 0 |
| Vibe | 8/9 | 85.4% | 85.4% | 91.3% | 90.0% | 0 |
| Precision | 3/3 | 56.7% | 53.3% | 100.0% | 100.0% | 0 |
| Semantic filtering | 1/1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Proportions | 3/3 | 44.4% | 45.6% | 100.0% | 100.0% | 0 |
| Palette | 1/1 | 66.7% | 60.0% | 100.0% | 100.0% | 0 |

## Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup: cases

| Case | Query | Status / reason | Large-window agreement | Without uncertain pairs | Assessed / total pairs | Missing judged images | Eligibility violations | Timed first-sample agreement | Timed pair coverage | p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| composition-001 | 80% grayscale 20% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/1 | composition-001/A, composition-001/B | 0 | n/a | 0.0% | n/a |
| composition-002 | 80% grayscale 10% red | unsupported: Conceptual compositions have no image source; image-backed candidates must report this case unsupported. | n/a | n/a | 0/0 | composition-002/A, composition-002/B | 0 | n/a | n/a | n/a |
| perceived-red-001 | red | ok | 86.7% | 86.7% | 15/15 | — | 0 | n/a | 0.0% | 3.09 ms |
| vibe-grayscale-001 | grayscale | ok | 100.0% | 100.0% | 12/12 | — | 0 | n/a | 0.0% | 3.24 ms |
| vibe-dark-001 | dark | ok | 100.0% | 100.0% | 15/15 | — | 0 | n/a | 0.0% | 2.59 ms |
| combination-gray-red-001 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/15 | wallpaper-042, wallpaper-060, wallpaper-037, wallpaper-065, wallpaper-029, wallpaper-048 | 0 | n/a | 0.0% | n/a |
| combination-gray-red-002 | mostly grayscale, with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/3 | evaluation-gray-red-002-telephone, wallpaper-048, evaluation-gray-red-002-umbrella | 0 | n/a | 0.0% | n/a |
| precision-shade-001 | Color picker: #FF2200 | ok | 20.0% | 20.0% | 5/5 | — | 0 | 20.0% | 100.0% | 2.86 ms |
| semantic-red-city-001 | A city wallpaper with a red feel (Condition: Assuming C matches the city tag.) | ok | 100.0% | 100.0% | 3/3 | — | 0 | 100.0% | 100.0% | 4.51 ms |
| proportion-green-001 | 40% green; the rest doesn’t matter | ok | 86.7% | 86.7% | 15/15 | — | 0 | 100.0% | 20.0% | 3.38 ms |
| proportion-green-002 | 40% green; the rest doesn’t matter | ok | 93.3% | 93.3% | 15/15 | — | 0 | 93.3% | 100.0% | 2.96 ms |
| composition-green-red-001 | 50% green, 50% red | ok | 53.3% | 53.3% | 15/15 | — | 0 | 53.3% | 100.0% | 3.79 ms |
| composition-green-red-real-001 | 50% green, 50% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | 100.0% | 16.7% | 3.77 ms |
| composition-green-red-real-002 | 40% green, 40% red; the remaining 20% is unspecified | ok | 0.0% | 0.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.65 ms |
| perceived-red-batch-001 | Red | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 4.14 ms |
| perceived-orange-batch-001 | Orange | ok | 83.3% | 83.3% | 6/6 | — | 0 | 100.0% | 16.7% | 3.06 ms |
| perceived-pink-batch-001 | Pink | ok | 33.3% | 33.3% | 6/6 | — | 0 | n/a | 0.0% | 2.87 ms |
| perceived-green-batch-001 | Green | ok | 83.3% | 80.0% | 6/6 | — | 0 | 0.0% | 16.7% | 3.31 ms |
| perceived-blue-batch-001 | Blue | ok | 83.3% | 80.0% | 6/6 | — | 0 | n/a | 0.0% | 68.20 ms |
| proportion-green-real-batch-001 | 40% green; the remaining 60% is unspecified | ok | 16.7% | 20.0% | 6/6 | — | 0 | 0.0% | 16.7% | 4.96 ms |
| proportion-green-real-batch-002 | 70% green; the remaining 30% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | 0.0% | 16.7% | 4.51 ms |
| proportion-red-real-batch-001 | 20% red; the remaining 80% is unspecified | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 2.94 ms |
| vibe-dark-batch-001 | Dark | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 2.67 ms |
| vibe-light-batch-001 | Light | ok | 83.3% | 83.3% | 6/6 | — | 0 | 0.0% | 16.7% | 3.23 ms |
| vibe-vivid-batch-001 | Bright, vivid colors | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.33 ms |
| vibe-strict-grayscale-batch-001 | Grayscale | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 3.04 ms |
| vibe-near-neutral-batch-001 | Almost grayscale | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 2.97 ms |
| vibe-monochromatic-batch-001 | One hue overall | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 4.48 ms |
| combination-gray-red-batch-001 | Grayscale with red accents | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-095, wallpaper-060, evaluation-gray-red-002-telephone, wallpaper-063 | 0 | n/a | 0.0% | n/a |
| composition-gray-red-batch-001 | 80% grayscale, 20% red | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 4.29 ms |
| composition-gray-red-batch-002 | 80% grayscale, 10% red; the remaining 10% is unspecified | ok | 66.7% | 66.7% | 6/6 | — | 0 | n/a | 0.0% | 3.53 ms |
| vibe-dark-accents-batch-001 | Mostly dark, with small bright areas | unsupported: This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations. | n/a | n/a | 0/6 | wallpaper-005, wallpaper-032, wallpaper-022, wallpaper-015 | 0 | n/a | 0.0% | n/a |
| composition-blue-orange-batch-001 | 50% blue, 50% orange | ok | 50.0% | 50.0% | 6/6 | — | 0 | n/a | 0.0% | 3.72 ms |
| composition-blue-orange-batch-002 | 40% blue, 40% orange; the remaining 20% is unspecified | ok | 83.3% | 83.3% | 6/6 | — | 0 | n/a | 0.0% | 4.15 ms |
| precision-warm-red-batch-001 | Close to #FF2200 | ok | 100.0% | 100.0% | 6/6 | — | 0 | n/a | 0.0% | 2.92 ms |
| precision-muted-green-batch-001 | Close to #4C8C72 | ok | 50.0% | 40.0% | 6/6 | — | 0 | 66.7% | 50.0% | 4.76 ms |
| palette-rainbow-batch-001 | Rainbow-like colors | ok | 66.7% | 60.0% | 6/6 | — | 0 | n/a | 0.0% | 3.08 ms |
| perceived-red-pagoda-001 | red | ok | 100.0% | 100.0% | 1/1 | — | 0 | n/a | 0.0% | 3.30 ms |

## Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup: visual comparisons

This shows the large-window diagnostic ranking, not the separately measured timed-search result. Only judged examples appear in image comparisons. Submitted ties and partial orders are preserved; equal method scores are shown together. Unjudged retrieved IDs have no human preference label. Images load from the evaluation report server.

### perceived-red-001

red

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-048 &gt; wallpaper-060 &gt; wallpaper-077

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-027 &gt; wallpaper-077 &gt; wallpaper-048 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### vibe-grayscale-001

grayscale

Submitted preference groups: wallpaper-066 = wallpaper-070 = wallpaper-061 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

Method score groups: wallpaper-061 &gt; wallpaper-066 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-092 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, madness-wallhaven-mllr38, wallpaper-063

### vibe-dark-001

dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

Method score groups: wallpaper-067 &gt; wallpaper-022 &gt; wallpaper-091 &gt; wallpaper-068 &gt; wallpaper-054 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

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

Method score groups: precision-shade-001-c &gt; precision-shade-001-d &gt; precision-shade-001-a &gt; precision-shade-001-b

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-f, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### semantic-red-city-001

A city wallpaper with a red feel (Condition: Assuming C matches the city tag.)

Submitted preference groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

Method score groups: wallpaper-027 &gt; wallpaper-029 &gt; wallpaper-022

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: —

### proportion-green-001

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-d &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-e

Method score groups: proportion-green-001-f &gt; proportion-green-001-c &gt; proportion-green-001-a &gt; proportion-green-001-b &gt; proportion-green-001-d &gt; proportion-green-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### proportion-green-002

40% green; the rest doesn’t matter

Submitted preference groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-a &gt; proportion-green-002-b &gt; proportion-green-002-e

Method score groups: proportion-green-002-f &gt; proportion-green-002-c &gt; proportion-green-002-d &gt; proportion-green-002-b &gt; proportion-green-002-a &gt; proportion-green-002-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-001-f, composition-green-red-001-e, composition-green-red-001-a, composition-green-red-001-b, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj, wallpaper-050, wallpaper-083

### composition-green-red-001

50% green, 50% red

Submitted preference groups: composition-green-red-001-b &gt; composition-green-red-001-d &gt; composition-green-red-001-e &gt; composition-green-red-001-f &gt; composition-green-red-001-a &gt; composition-green-red-001-c

Method score groups: composition-green-red-001-b &gt; composition-green-red-001-a &gt; composition-green-red-001-c &gt; composition-green-red-001-d &gt; composition-green-red-001-f &gt; composition-green-red-001-e

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, evaluation-green-red-tulips, evaluation-green-red-tulip-field, proportion-green-002-d

### composition-green-red-real-001

50% green, 50% red

Submitted preference groups: wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-leaves &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-b, composition-green-red-001-a, composition-green-red-001-c, composition-green-red-001-d, composition-green-red-001-f, composition-green-red-001-e, precision-shade-001-c, precision-shade-001-d, proportion-green-002-a, proportion-green-002-e, proportion-green-002-c, proportion-green-001-f, precision-shade-001-a, proportion-green-002-f, madness-wallhaven-rqq1ww, proportion-green-001-a, madness-wallhaven-rqqjrj, proportion-green-002-d

### composition-green-red-real-002

40% green, 40% red; the remaining 20% is unspecified

Submitted preference groups: evaluation-green-red-leaves &gt; wallpaper-082 &gt; evaluation-green-red-tulips &gt; evaluation-green-red-tulip-field

Method score groups: evaluation-green-red-tulip-field &gt; evaluation-green-red-tulips &gt; wallpaper-082 &gt; evaluation-green-red-leaves

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-b, composition-green-red-001-f, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-e, composition-green-red-001-d, proportion-green-002-f, precision-shade-001-a, proportion-green-001-f, proportion-green-002-c, madness-wallhaven-rqq1ww, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-rqqjrj, proportion-green-002-a, madness-wallhaven-w55xgp

### perceived-red-batch-001

Red

Submitted preference groups: wallpaper-037 &gt; wallpaper-095 &gt; wallpaper-084 &gt; wallpaper-044

Method score groups: wallpaper-037 &gt; wallpaper-084 &gt; wallpaper-044 &gt; wallpaper-095

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### perceived-orange-batch-001

Orange

Submitted preference groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-036 &gt; wallpaper-087

Method score groups: wallpaper-031 &gt; wallpaper-046 &gt; wallpaper-087 &gt; wallpaper-036

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: wallpaper-037, madness-wallhaven-9639xx, wallpaper-058, madness-wallhaven-rqqjrj, madness-wallhaven-gwwkql, madness-wallhaven-qrroml, madness-wallhaven-lyyv8r, wallpaper-094, madness-wallhaven-xe6qdv, madness-wallhaven-gwwq8e, madness-wallhaven-gwwmxq, madness-wallhaven-lyyko2, madness-wallhaven-jeeoxq, madness-wallhaven-v9qkgm, madness-wallhaven-k9m277, madness-wallhaven-rqqxew, precision-shade-001-a, madness-wallhaven-w55xgp

### perceived-pink-batch-001

Pink

Submitted preference groups: wallpaper-044 &gt; wallpaper-039 &gt; wallpaper-033 &gt; wallpaper-048

Method score groups: wallpaper-039 &gt; wallpaper-048 &gt; wallpaper-033 &gt; wallpaper-044

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-lmmxol, madness-wallhaven-w5531x, madness-wallhaven-7j3lve, madness-wallhaven-d88evl, madness-wallhaven-zpp3mg, madness-wallhaven-9mrgk1, madness-wallhaven-vppyjp, wallpaper-038, madness-wallhaven-jeey2y, madness-wallhaven-2116k9, madness-wallhaven-j3511m, madness-wallhaven-k881zd, madness-wallhaven-6llwv6, madness-wallhaven-211dyx, wallpaper-035, madness-wallhaven-e88rok, madness-wallhaven-q625eq, madness-wallhaven-6llrl7, madness-wallhaven-jeekjy

### perceived-green-batch-001

Green

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-083 &gt; wallpaper-093

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: proportion-green-001-e, composition-green-red-001-f, proportion-green-001-a, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, proportion-green-001-c, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, madness-wallhaven-5yyme5

### perceived-blue-batch-001

Blue

Submitted preference groups: wallpaper-091 &gt; wallpaper-030 &gt; wallpaper-047 &gt; wallpaper-010

Method score groups: wallpaper-091 &gt; wallpaper-047 &gt; wallpaper-030 &gt; wallpaper-010

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-6ll7pq, madness-wallhaven-2119jg, madness-wallhaven-rqqj61, wallpaper-032, madness-wallhaven-6ll2zw, madness-wallhaven-8gge6y, madness-wallhaven-9oow11, wallpaper-057, madness-wallhaven-jeekxm, madness-wallhaven-w55rr7, madness-wallhaven-9oo2k1, madness-wallhaven-k88zgm, madness-wallhaven-zppq2j, wallpaper-039, madness-wallhaven-jeelj5, madness-wallhaven-lyypwr, madness-wallhaven-7jjwp3, madness-wallhaven-9mrgk1

### proportion-green-real-batch-001

40% green; the remaining 60% is unspecified

Submitted preference groups: wallpaper-093 &gt; wallpaper-081 &gt; wallpaper-083 &gt; wallpaper-050

Method score groups: wallpaper-050 &gt; wallpaper-083 &gt; wallpaper-093 &gt; wallpaper-081

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, proportion-green-002-f, proportion-green-001-f, proportion-green-002-c, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, composition-green-red-001-a, proportion-green-002-a, composition-green-red-001-b, proportion-green-002-e, proportion-green-001-c, madness-wallhaven-e88pr8, madness-wallhaven-5yyme5, proportion-green-001-a, madness-wallhaven-ogg6q7, madness-wallhaven-3qqvk9, madness-wallhaven-d88mmj

### proportion-green-real-batch-002

70% green; the remaining 30% is unspecified

Submitted preference groups: wallpaper-086 &gt; wallpaper-050 &gt; wallpaper-012 &gt; wallpaper-090

Method score groups: wallpaper-050 &gt; wallpaper-086 &gt; wallpaper-090 &gt; wallpaper-012

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-f, proportion-green-001-a, proportion-green-001-e, proportion-green-002-e, composition-green-red-001-b, proportion-green-002-a, composition-green-red-001-a, proportion-green-002-c, proportion-green-001-f, composition-green-red-001-c, proportion-green-002-f, composition-green-red-001-e, proportion-green-002-d, proportion-green-002-b, madness-wallhaven-gww9yl, madness-wallhaven-po9eop, proportion-green-001-c, madness-wallhaven-ogg6zm

### proportion-red-real-batch-001

20% red; the remaining 80% is unspecified

Submitted preference groups: wallpaper-029 &gt; wallpaper-060 &gt; wallpaper-084 &gt; wallpaper-082

Method score groups: wallpaper-029 &gt; wallpaper-082 &gt; wallpaper-084 &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: evaluation-green-red-tulips, precision-shade-001-b, madness-wallhaven-xeewg3, evaluation-green-red-tulip-field, madness-wallhaven-6llzk6, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-w55xgp, madness-wallhaven-ox2ool, madness-wallhaven-gwwvqe, madness-wallhaven-gwwkql, madness-wallhaven-d88evl, madness-wallhaven-8368k1, madness-wallhaven-w553y6, madness-wallhaven-13qmlw, madness-wallhaven-yqqrp7, madness-wallhaven-rqq1ww, madness-wallhaven-3qq5lv, madness-wallhaven-7j3lve

### vibe-dark-batch-001

Dark

Submitted preference groups: wallpaper-067 &gt; wallpaper-011 &gt; wallpaper-079 &gt; wallpaper-075

Method score groups: wallpaper-011 &gt; wallpaper-067 &gt; wallpaper-079 &gt; wallpaper-075

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-jeerxp, madness-wallhaven-w55vwr, madness-wallhaven-211wjx, madness-wallhaven-5yyj69, madness-wallhaven-yqq3wd, madness-wallhaven-vppv3l, madness-wallhaven-gwwvpe, madness-wallhaven-3qqygv, madness-wallhaven-d88jym, madness-wallhaven-rqqw7q, madness-wallhaven-oggw5p, madness-wallhaven-1qqrev, madness-wallhaven-6ll7dx, madness-wallhaven-w55gjr, madness-wallhaven-lyyp9y, madness-wallhaven-e873x8, madness-wallhaven-d88253, madness-wallhaven-mllr38, madness-wallhaven-gwwdeq, madness-wallhaven-yqqv3x

### vibe-light-batch-001

Light

Submitted preference groups: wallpaper-088 &gt; wallpaper-051 &gt; wallpaper-073 &gt; wallpaper-096

Method score groups: wallpaper-051 &gt; wallpaper-088 &gt; wallpaper-073 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-y89mld, madness-wallhaven-jeek5p, wallpaper-060, wallpaper-006, madness-wallhaven-xeejw3, madness-wallhaven-wqvoxr, wallpaper-010, madness-wallhaven-jeey9q, madness-wallhaven-2116k9, wallpaper-003, wallpaper-055, madness-wallhaven-8gg1g2, madness-wallhaven-lmmxol, madness-wallhaven-yqq68g, madness-wallhaven-k88z5m, madness-wallhaven-5gk313, madness-wallhaven-eojxrr, madness-wallhaven-vppedl

### vibe-vivid-batch-001

Bright, vivid colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-032 &gt; wallpaper-052 &gt; wallpaper-098

Method score groups: wallpaper-032 &gt; wallpaper-094 &gt; wallpaper-098 &gt; wallpaper-052

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-b, composition-green-red-001-c, composition-green-red-001-a, composition-green-red-001-f, madness-wallhaven-ogg6zm, madness-wallhaven-lyykvy, madness-wallhaven-5yy3d3, wallpaper-037, proportion-green-001-e, madness-wallhaven-8ggez2, composition-green-red-001-d, wallpaper-033, madness-wallhaven-rqqjrj, madness-wallhaven-6ll7pq, madness-wallhaven-9639xx, precision-shade-001-a, precision-shade-001-c, precision-shade-001-d

### vibe-strict-grayscale-batch-001

Grayscale

Submitted preference groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-071 &gt; wallpaper-007

Method score groups: wallpaper-068 &gt; wallpaper-070 &gt; wallpaper-007 &gt; wallpaper-071

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, madness-wallhaven-vppy93, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-near-neutral-batch-001

Almost grayscale

Submitted preference groups: wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-062 &gt; wallpaper-096

Method score groups: wallpaper-062 &gt; wallpaper-007 &gt; wallpaper-071 &gt; wallpaper-096

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-d88jym, madness-wallhaven-e88r8o, madness-wallhaven-gwwvpe, madness-wallhaven-rqqw7q, madness-wallhaven-vppy93, madness-wallhaven-gwwm6d, madness-wallhaven-lyyj52, madness-wallhaven-ml3jm8, wallpaper-005, wallpaper-023, wallpaper-053, wallpaper-061, wallpaper-068, madness-wallhaven-1qqx1g, wallpaper-006, madness-wallhaven-rqqy5m, madness-wallhaven-3qqygv, wallpaper-066, madness-wallhaven-mllr38, wallpaper-063

### vibe-monochromatic-batch-001

One hue overall

Submitted preference groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

Method score groups: wallpaper-009 &gt; wallpaper-091 &gt; wallpaper-008 &gt; wallpaper-004

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-1qqrev, madness-wallhaven-1qqx1g, madness-wallhaven-211986, madness-wallhaven-2119yx, madness-wallhaven-3qqygv, madness-wallhaven-5yy3d3, madness-wallhaven-7jj1p3, madness-wallhaven-8g5qr2, madness-wallhaven-8ggm6k, madness-wallhaven-8ggrqy, madness-wallhaven-9oop2d, madness-wallhaven-9oow31, madness-wallhaven-d88d53, madness-wallhaven-d88jym, madness-wallhaven-d88q5g, madness-wallhaven-e88r8o, madness-wallhaven-gwwm6d, madness-wallhaven-gwwvpe, madness-wallhaven-jeerxp, madness-wallhaven-lyyj52

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

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-yqqoek, madness-wallhaven-9ooez8, madness-wallhaven-ogg23p, wallpaper-084, madness-wallhaven-xeewg3, madness-wallhaven-3qqv1d, wallpaper-043, wallpaper-029, madness-wallhaven-rqq1mm, proportion-green-001-c, madness-wallhaven-wqvoxr, madness-wallhaven-rqqw2q, madness-wallhaven-w5eq57, wallpaper-016

### composition-gray-red-batch-002

80% grayscale, 10% red; the remaining 10% is unspecified

Submitted preference groups: evaluation-gray-red-002-umbrella &gt; wallpaper-042 &gt; wallpaper-048 &gt; wallpaper-060

Method score groups: wallpaper-042 &gt; wallpaper-048 &gt; evaluation-gray-red-002-umbrella &gt; wallpaper-060

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-3qq5lv, precision-shade-001-b, madness-wallhaven-w553y6, madness-wallhaven-d8pk8m, madness-wallhaven-rqqjl7, madness-wallhaven-ogg23p, madness-wallhaven-xeewg3, wallpaper-029, madness-wallhaven-3qqv1d, madness-wallhaven-9ooez8, wallpaper-016, proportion-green-001-c, madness-wallhaven-w5eq57, wallpaper-043, madness-wallhaven-wqvoxr, madness-wallhaven-rqq1mm, madness-wallhaven-zppd8y, madness-wallhaven-yqqoek, wallpaper-088

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

Method score groups: wallpaper-058 &gt; wallpaper-057 &gt; wallpaper-040 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, wallpaper-091, wallpaper-037, madness-wallhaven-lyyv8r, madness-wallhaven-rqqjrj, wallpaper-094, madness-wallhaven-q625eq, madness-wallhaven-mllrdk, madness-wallhaven-8gge6y, madness-wallhaven-yqqrp7, madness-wallhaven-gwwkql, madness-wallhaven-rqqj61, madness-wallhaven-2119jg, madness-wallhaven-xe6qdv, madness-wallhaven-k88zgm, madness-wallhaven-poov9e, madness-wallhaven-9oo2k1, madness-wallhaven-9639xx, precision-shade-001-a

### composition-blue-orange-batch-002

40% blue, 40% orange; the remaining 20% is unspecified

Submitted preference groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-002 &gt; wallpaper-057

Method score groups: wallpaper-058 &gt; wallpaper-040 &gt; wallpaper-057 &gt; wallpaper-002

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-c, madness-wallhaven-lyyv8r, wallpaper-091, madness-wallhaven-mllrdk, madness-wallhaven-yqqrp7, madness-wallhaven-q625eq, wallpaper-094, madness-wallhaven-8gge6y, madness-wallhaven-poov9e, madness-wallhaven-gwwkql, wallpaper-031, madness-wallhaven-jeekxm, evaluation-green-red-tulip-field, madness-wallhaven-k88zgm, madness-wallhaven-2119jg, madness-wallhaven-9oozpx, madness-wallhaven-gwwvqe, precision-shade-001-a, madness-wallhaven-9oo2k1

### precision-warm-red-batch-001

Close to #FF2200

Submitted preference groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

Method score groups: wallpaper-037 &gt; wallpaper-082 &gt; wallpaper-087 &gt; wallpaper-046

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

### precision-muted-green-batch-001

Close to #4C8C72

Submitted preference groups: wallpaper-052 &gt; wallpaper-013 &gt; wallpaper-093 &gt; wallpaper-086

Method score groups: wallpaper-093 &gt; wallpaper-052 &gt; wallpaper-086 &gt; wallpaper-013

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-d, proportion-green-001-b, madness-wallhaven-xeejzz, wallpaper-050, madness-wallhaven-gww9yl, madness-wallhaven-gwwq27, madness-wallhaven-d88mmj, wallpaper-083, madness-wallhaven-po9eop, madness-wallhaven-8ggdxo, madness-wallhaven-rqqwgj, madness-wallhaven-6llmg7, madness-wallhaven-k88jv6, madness-wallhaven-lyyx7l, wallpaper-081, wallpaper-058, madness-wallhaven-qrrkor

### palette-rainbow-batch-001

Rainbow-like colors

Submitted preference groups: wallpaper-094 &gt; wallpaper-003 &gt; wallpaper-034 &gt; wallpaper-004

Method score groups: wallpaper-094 &gt; wallpaper-034 &gt; wallpaper-004 &gt; wallpaper-003

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: madness-wallhaven-13qmlw, madness-wallhaven-rqqwpw, madness-wallhaven-k88zgm, madness-wallhaven-q625eq, madness-wallhaven-9oozpx, madness-wallhaven-oggv5m, madness-wallhaven-mllrdk, wallpaper-038, wallpaper-042, madness-wallhaven-3qqvk9, wallpaper-031, madness-wallhaven-w55rr7, wallpaper-040, madness-wallhaven-yqqrp7, madness-wallhaven-vpp1vl, madness-wallhaven-d88evl, wallpaper-090, madness-wallhaven-9oo2k1, madness-wallhaven-mllelk

### perceived-red-pagoda-001

red

Submitted preference groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

Method score groups: madness-wallhaven-ogg7ql &gt; wallpaper-031

No submitted ordering for: —

Not returned by this method: —

Unjudged retrieved IDs among the first 20 results: composition-green-red-001-e, composition-green-red-001-d, composition-green-red-001-b, composition-green-red-001-a, precision-shade-001-c, precision-shade-001-d, composition-green-red-001-c, composition-green-red-001-f, precision-shade-001-a, madness-wallhaven-rqq1ww, wallpaper-037, madness-wallhaven-rqqjrj, madness-wallhaven-w55xgp, evaluation-green-red-tulip-field, precision-shade-001-b, evaluation-green-red-tulips, madness-wallhaven-gww23l, madness-wallhaven-gwwlm3, madness-wallhaven-j5eqpw, madness-wallhaven-xeewg3

## Favorite256: numeric utilities with global maxima bounds · pooled PIT cleanup: configuration and diagnostics

### Configuration, execution, source fingerprints and setup

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 36098,
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

### perceived-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 73849,
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

### vibe-grayscale-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 71031,
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

### vibe-dark-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72787,
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

### combination-gray-red-001: unsupported

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 12606,
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
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
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
    "groupId": "source-group-098714935267",
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
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65463,
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

### semantic-red-city-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 13605,
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

### proportion-green-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 73431,
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

### proportion-green-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63564,
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

### composition-green-red-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 72026,
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

### composition-green-red-real-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 66878,
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

### composition-green-red-real-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65942,
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

### perceived-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63501,
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

### perceived-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62684,
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

### perceived-pink-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64043,
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

### perceived-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63810,
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

### perceived-blue-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63930,
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

### proportion-green-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64301,
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

### proportion-green-real-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63806,
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

### proportion-red-real-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63605,
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

### vibe-dark-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63185,
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

### vibe-light-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63017,
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

### vibe-vivid-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63008,
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

### vibe-strict-grayscale-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62951,
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

### vibe-near-neutral-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63112,
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

### vibe-monochromatic-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62074,
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

### combination-gray-red-batch-001: unsupported

```json
{
  "query": {
    "text": "Grayscale with red accents",
    "detail": "A mostly grayscale feel, with red as the color that stands out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-gray-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 65197,
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

### composition-gray-red-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64514,
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

### vibe-dark-accents-batch-001: unsupported

```json
{
  "query": {
    "text": "Mostly dark, with small bright areas",
    "detail": "A dark overall feel, with bright spots that stand out."
  },
  "status": "unsupported",
  "reason": "This prototype has no accent or relative-contrast objective. Use explicit proportions for these combinations.",
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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
    "groupId": "source-group-098714935267",
    "status": "partial",
    "allPairs": {
      "agreement": null,
      "assessedPairs": 0,
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

### composition-blue-orange-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 64074,
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

### composition-blue-orange-batch-002: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63686,
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

### precision-warm-red-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63143,
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

### precision-muted-green-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 62938,
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

### palette-rainbow-batch-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 63437,
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

### perceived-red-pagoda-001: ok

```json
{
  "note": "Large diagnostic payload omitted from this rendered report. Complete unchanged measurements are in the sibling run.json artifact.",
  "characters": 60801,
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

