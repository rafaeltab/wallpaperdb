# What the existing feedback cases measure for pixel cutoffs

Read-only dataset review, 2026-09-21. This records the interpretation of the
current 37-case dataset for the cutoff experiment. No scoring, query, image or
human judgment was changed. Numerical results belong to the completed run and
should be interpreted alongside this review.

Sources: [`evaluation/loop/dataset.mjs`](../evaluation/loop/dataset.mjs),
[`evaluation/loop/runner.mjs`](../evaluation/loop/runner.mjs),
[`evaluation/loop/metrics.mjs`](../evaluation/loop/metrics.mjs), and
[`configs/cutoff-profiles.json`](configs/cutoff-profiles.json). Historical query
records were passed through the runner's `searchQuery` normalization before
classification; their annotation fields are not search inputs.

## Summary

All configurations support the same 31 image-backed cases, containing 233 strict
human preference pairs. Six cases are unsupported. The supported cases involve
86 distinct judged images and at most two requested colors/properties per query.

| Interpretation of named colors | Cases affected by cutoff/profile/bucket count | Unchanged named-feature cases | Assessed pairs affected |
| --- | ---: | ---: | ---: |
| Concrete swatches | 22: 20 entirely anchored, 2 mixed | 9 | 164 / 233 |
| Named families | 3: all picked-color precision cases | 28 | 17 / 233 |

“Affected” means the scoring input can change; it does not guarantee that the
judged order changes. Quality influence and minimum average quality are fixed at
1 and 0 in this matrix. Named features therefore produce identical scores across
profiles, pixel cutoffs and bucket counts within each interpretation.

The primary agreement metric gives equal weight to each assessed query. Thus
only **3/31 of the named-family aggregate** can distinguish cutoff configurations.
Its other 28 cases cannot establish which cutoff is better.

## Picked-color cases: anchored in both interpretations

| Case ID | Input cohort | Picked color | Strict pairs | Review qualifications |
| --- | --- | --- | ---: | --- |
| `precision-shade-001` | Controlled fixture | `#FF2200` | 5 | Earlier deliberate review; synthetic bands |
| `precision-warm-red-batch-001` | Real image | `#FF2200` | 6 | Quick batch review |
| `precision-muted-green-batch-001` | Real image | `#4C8C72` | 6 | Quick batch review; one explicitly uncertain pair |

These are the **only** cutoff-sensitive cases in named-family mode. They cover
two unique picked colors. All three ask for a color's overall presence/appearance;
none requests a percentage of a picked hex color or an explicit degree of
closeness.

## Additional cases anchored in concrete-swatch mode

The following 17 cases are entirely anchored in concrete-swatch mode and entirely
unchanged named features in named-family mode.

| Case ID | Input cohort | Named color request | Strict pairs |
| --- | --- | --- | ---: |
| `perceived-red-001` | Real image | Red | 15 |
| `semantic-red-city-001` | Real image | Red with mandatory city eligibility | 3 |
| `proportion-green-001` | Controlled fixture | 40% green | 15 |
| `proportion-green-002` | Controlled fixture | 40% green | 15 |
| `composition-green-red-001` | Controlled fixture | 50% green, 50% red | 15 |
| `composition-green-red-real-001` | Real image | 50% green, 50% red | 6 |
| `composition-green-red-real-002` | Real image | 40% green, 40% red | 6 |
| `perceived-red-batch-001` | Real image | Red | 6 |
| `perceived-orange-batch-001` | Real image | Orange | 6 |
| `perceived-pink-batch-001` | Real image | Pink | 6 |
| `perceived-green-batch-001` | Real image | Green | 6 |
| `perceived-blue-batch-001` | Real image | Blue | 6 |
| `proportion-green-real-batch-001` | Real image | 40% green | 6 |
| `proportion-green-real-batch-002` | Real image | 70% green | 6 |
| `proportion-red-real-batch-001` | Real image | 20% red | 6 |
| `composition-blue-orange-batch-001` | Real image | 50% blue, 50% orange | 6 |
| `composition-blue-orange-batch-002` | Real image | 40% blue, 40% orange | 6 |

Two further cases mix one unchanged grayscale feature with an anchored red target
in concrete-swatch mode. Both targets become unchanged named features in
named-family mode:

| Case ID | Input cohort | Request | Strict pairs |
| --- | --- | --- | ---: |
| `composition-gray-red-batch-001` | Real image | 80% grayscale, 20% red | 6 |
| `composition-gray-red-batch-002` | Real image | 80% grayscale, 10% red | 6 |

These mixed cases test the red component's effect alongside fixed grayscale
scoring. They do not isolate cutoff behavior by itself.

## Cases invariant in both interpretations

All nine are real-image cases and use existing abstract named features:

| Case ID | Feature | Strict pairs |
| --- | --- | ---: |
| `vibe-grayscale-001` | Grayscale | 12 |
| `vibe-dark-001` | Dark | 15 |
| `vibe-dark-batch-001` | Dark | 6 |
| `vibe-light-batch-001` | Light | 6 |
| `vibe-vivid-batch-001` | Vivid | 6 |
| `vibe-strict-grayscale-batch-001` | Grayscale | 6 |
| `vibe-near-neutral-batch-001` | Near-neutral | 6 |
| `vibe-monochromatic-batch-001` | Monochromatic | 6 |
| `palette-rainbow-batch-001` | Rainbow-like hue distribution | 6 |

Their 69 pairs are useful regression checks. They are not evidence for a preferred
pixel cutoff, feathering curve or anchor count. The strict-grayscale case's
normalized query currently resolves to the existing `grayscale` feature; this
review preserves that interpretation rather than changing it during evaluation.

## Unsupported cases

| Case ID | Reason |
| --- | --- |
| `composition-001` | Conceptual composition, no image source |
| `composition-002` | Conceptual composition, no image source |
| `combination-gray-red-001` | Relative/accent objective not implemented |
| `combination-gray-red-002` | Relative/accent objective not implemented |
| `combination-gray-red-batch-001` | Relative/accent objective not implemented |
| `vibe-dark-accents-batch-001` | Relative/accent objective not implemented |

These six cases contribute 31 unassessed pairs. Coverage is therefore 233/264
pairs for the full dataset; unsupported cases must remain visible in reporting.

## Limits on interpreting the highest-scoring configuration

- **Development evidence, no held-out validation.** One reviewer supplied all
  judgments. The 24 batch rankings were explicitly described as quick and
  provisional. Five pairs are marked uncertain. Comparing 160 new configurations
  on the same examples makes a best observed result an exploratory tuning result.
- **The examples are correlated.** Strict pairs are transitive consequences of
  image rankings, not independent annotations. Supported cases form only four
  connected source-image/fixture groups of 26, 1, 2 and 2 cases. The largest group
  alone contains 26/31 supported cases. Configuration choices are correlated too;
  for example, strictest-cutoff consensus collapses to the corresponding hard
  cutoff.
- **The aggregate can hide the changed behavior.** In named-family mode, only
  three precision cases can change. Comparing named-family and concrete-swatch
  aggregates also changes what ordinary color names mean. A higher aggregate
  cannot be attributed solely to a better cutoff curve.
- **Fixtures remain in evaluation.** `precision-shade-001`,
  `proportion-green-001`, `proportion-green-002`, and
  `composition-green-red-001` account for 50/233 assessed pairs and 4/31 of the
  query-macro weight. The interactive gallery excludes these synthetic examples;
  the feedback dataset still includes them. Report the 27 real-image cases
  separately rather than silently changing the existing dataset.
- **New archive images are unjudged.** All 418 archive additions participate in
  search but have no preference labels. The primary full-ranking agreement
  compares scores only between judged images; it does not penalize an irrelevant
  unjudged image appearing above them. It is not a top-results relevance score.
- **The requested flexibility is sparsely covered.** There are no explicit
  broad-versus-tight closeness judgments, no picked-hex proportion cases, no
  supported queries with more than two targets, and no evidence that calibrates
  “25% closeness” against a person's intended tolerance. Smooth profiles measure
  effective area, while the existing percentage instructions describe whole-image
  proportions; rankings provide indirect preference evidence rather than a
  physical-coverage ground truth.
- **Ties need separate inspection.** Equal model scores earn half credit on strict
  human preferences. Narrow supports can create zero-score ties. An aggregate
  alone can obscure whether a change improves discrimination or collapses useful
  differences.
- **Latency covers a small workload.** The matrix uses 545 assets, one concurrent
  request and at most two targets in existing cases. Named-family timings mostly
  measure unchanged named features. These timings do not validate complex queries,
  concurrent users or million-wallpaper performance.

## Numerical analysis to accompany the completed run

Keep the existing headline metric and coverage, then additionally report:

1. Agreement on cutoff-sensitive cases: 22 concrete-swatch cases or three
   named-family precision cases, with the mixed cases identifiable.
2. Agreement on real-image cases, and on real-image cutoff-sensitive cases.
3. Per-case improvements, regressions and ties against the original method at the
   same bucket count and named interpretation.
4. Results with the five explicitly uncertain pairs excluded, preserving the
   existing sensitivity policy.
5. Timing on cutoff-sensitive cases alongside the full-workload timing.

These breakdowns explain the observations. They do not select a production method
or turn the current development set into independent validation.

## Completed matrix: 2026-09-21

Run: `2026-09-21T18-52-54.244Z-1101fa3a`.
The external run directory is
`/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/runs/2026-09-21T18-52-54.244Z-1101fa3a/`.
`run.json` contains the original results; `cutoff-analysis.json` is a compact
projection with per-case scores, subset metrics and comparisons against matched
original controls; `cutoff-findings.json` summarizes that projection.

All **168 configurations** completed: 160 cutoff configurations and eight
original controls. Every configuration supports 31 cases, leaves the same six
unsupported, and has zero case errors. All 26,040 measured requests succeeded;
there were zero eligibility violations. Full-ranking accuracy assesses all 233
pairs in supported cases, or 233/264 pairs across the complete dataset.

The original HTML renderer subsequently exceeded JavaScript's string-size limit.
This was a report-generation failure after `run.json` and the Markdown report had
been written, not a failed search or missing experiment. The root agent rebuilt
the report from the saved results without rerunning the matrix.

### Concrete-swatch observations

This table shows the highest *observed full-dataset agreement* at each bucket
count, selected after inspecting this development run. It is a descriptive
comparison, not a recommendation. “Real” excludes the four fixture cases;
“affected” contains the 22 cutoff-sensitive cases, including two mixed cases.

| Buckets | Observed configuration | Overall: original → new | Real only: original → new | Affected: original → new | Cases improved / regressed |
| ---: | --- | --- | --- | --- | ---: |
| 16 | Consensus, 50% | 72.47% → 73.66% | 74.44% → 75.06% | 68.64% → 70.30% | 3 / 1 |
| 64 | Feather, 0% | 65.59% → 67.96% | 70.12% → 69.88% | 58.94% → 62.27% | 5 / 2 |
| 256 | Consensus, 50% | 67.04% → 71.67% | 70.43% → 74.75% | 60.98% → 67.50% | 7 / 0 |
| 1,024 | Core-halo, 25% | 66.40% → 69.57% | 70.80% → 70.25% | 60.08% → 64.55% | 4 / 3 |

Fixture effects matter: the 64- and 1,024-bucket aggregate improvements above
coincide with slightly worse real-image agreement. For 1,024 buckets, consensus
at 50% instead reaches 72.41% on real images, versus 70.80% originally, although
its overall score is lower than core-halo at 25%.

The 256-bucket consensus/50% result improves five real-image cases and two
fixtures, with no case-level regression in this dataset:

- `precision-shade-001`: 20% → 40% (fixture).
- `composition-green-red-001`: 53.33% → 60% (fixture).
- `perceived-green-batch-001`: 66.67% → 83.33%.
- `composition-gray-red-batch-001`: 33.33% → 50%.
- `composition-gray-red-batch-002`: 50% → 66.67%.
- `composition-blue-orange-batch-001`: 50% → 83.33%.
- `composition-blue-orange-batch-002`: 66.67% → 100%.

These changes are useful candidates for further human inspection. Several are
related queries over repeated images, so seven improved cases are not seven
independent replications. Excluding explicitly uncertain pairs changes the
overall comparison from 67.10% originally to 71.18%, preserving the direction.

The highest concrete-swatch aggregate, 16-bucket consensus/50%, improves the
synthetic precision case and both grayscale/red proportion cases, but regresses
`precision-muted-green-batch-001` from 100% to 83.33%. Its real cutoff-sensitive
subset increases from 70.74% to 71.67% across 18 cases.

### Named-family and precision observations

The highest observed aggregate is **1,024-bucket consensus/50%, 75.05%**, versus
74.41% for its matched original control. Its entire +0.65 percentage-point gain
comes from `precision-shade-001`, the synthetic `#FF2200` example, improving from
20% to 40%. The other 30 supported case agreements are unchanged. Real-image
agreement stays **76.30%**.

| Picked-color case | Original 1,024 | Consensus 1,024 / 50% |
| --- | ---: | ---: |
| `precision-shade-001` | 20% | 40% |
| `precision-warm-red-batch-001` | 100% | 100% |
| `precision-muted-green-batch-001` | 100% | 100% |
| Three-case query mean | 73.33% | 80% |

The two real precision cases are already perfectly ordered by this original
control. The fixture is consequently decisive in the three-case improvement;
80% is not evidence of broad precision accuracy over arbitrary picked colors.

Across every count and named interpretation, the new **hard/50% configuration
preserves its matched original case agreements exactly**. The dedicated
integration tests additionally verified complete ordered hit/score equality.
Invariant named-feature subsets have exactly zero agreement change throughout
the matrix.

### Narrow supports produce many ties

Among the 164 cutoff-sensitive pairs in concrete-swatch mode:

| Buckets | Hard / 50% tied pairs | Hard / 90% tied pairs | Hard / 90% overall agreement |
| ---: | ---: | ---: | ---: |
| 16 | 6 | 108 | 61.18% |
| 64 | 3 | 76 | 60.11% |
| 256 | 5 | 97 | 58.76% |
| 1,024 | 1 | 92 | 65.00% |

The strictest hard cutoff loses discrimination on many judged comparisons. These
ties include absent-region/zero-score behavior and receive the documented half
credit. This does not establish that strict matching is undesirable when a user
explicitly requests it; the present cases do not supply that alternate intent.

### Small-corpus latency and setup

At 545 assets and concurrency one, per-configuration p95 ranges from **1.015 to
6.245 ms**. The slowest individual measured request is **55.137 ms**. There are no
one-second queries or failures in this measured workload. These are adapter
end-to-end measurements, including native OpenSearch ranking, not million-record
or concurrent-user results.

Cutoff-sensitive timing is available separately in the compact projection. For
example, p95 is 2.009 ms for concrete 16-bucket consensus/50%, 3.653 ms for concrete
256-bucket consensus/50%, and 3.979 ms for named-family 1,024-bucket consensus/50%.
The named-family subset has only 15 measured requests per configuration, so its
nearest-rank p95 is the maximum of those 15 observations; it is particularly
sensitive to an isolated slow sample.

Preparation totals **56.076 seconds** across all 168 configurations. The four
first-use cutoff verifications take 1.556, 3.056, 8.858 and 32.513 seconds for 16,
64, 256 and 1,024 buckets respectively. The other **156 cutoff configurations
reuse verification within this run**, after checking index identity and mutation
counters; reused setup takes a median 2.142 ms. The eight original controls use
their existing verification paths.

Measured top-20 requests sum to **60.733 seconds**; complete warmup-and-timing
blocks sum to **74.547 seconds**. The much longer wall time is explained by the
separate full-ranking accuracy requests, whose configured limit is 1,000 and which
return up to all 545 documents:

| Bucket count | Cutoff configurations | Total full-ranking accuracy HTTP time |
| ---: | ---: | ---: |
| 16 | 40 | 11.273 s |
| 64 | 40 | 37.683 s |
| 256 | 40 | 140.200 s |
| 1,024 | 40 | 691.360 s |

Across all 168 configurations, the **5,208 full-ranking accuracy requests consume
883.941 seconds of HTTP time**. OpenSearch's reported `took` accounts for
**868.665 seconds** of that total. Their combined p95 is **602.670 ms**, and the
slowest is **691.992 ms**. This path is deliberately outside the top-20 latency
samples, but it is still real search-service work and should not be hidden.

Preparation (56.076 s), full-ranking accuracy retrieval (883.941 s), and
warmup/timing blocks (74.547 s) together account for **1,014.563 seconds**, within
4.566 seconds of the **1,019.129-second** interval from run creation to writing
`run.json`. This explains the approximately 17-minute run without attributing it
to repeated full-index verification or ordinary top-20 query latency.

The full-ranking penalty rises sharply with index width and lies predominantly
inside OpenSearch. Fetching/decompressing stored data despite `_source: false`
is a plausible explanation, but the saved timings do not isolate that mechanism;
it remains a hypothesis. `cutoff-timing-attribution.json` records the bounded-memory
extraction of all saved accuracy HTTP and service timings. No searches were
rerun to obtain these figures.
