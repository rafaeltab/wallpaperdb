# Consolidated findings

`summary.mjs` reads saved feedback and scale artifacts. It performs no OpenSearch requests and changes no experiment results.

## Usage

The browser provider can call:

```js
const { html, markdown, summary } = await renderFindings();
```

The function also accepts `corpusStore`, `explorationStore`, and an HTTP(S) `reportBaseUrl` for tests or another environment. The default saved-report links use `http://zerotwo:8224`.

The CLI writes these files outside the repository:

```text
~/.local/share/wallpaperdb/color-evaluation/exploration/findings.html
~/.local/share/wallpaperdb/color-evaluation/exploration/findings.md
~/.local/share/wallpaperdb/color-evaluation/exploration/findings.json
```

Use the root Make target for the summary CLI. The visual prototype's `/findings` route can render current evidence directly; a refresh discovers newly saved results. HTML is static, includes no JavaScript, and uses horizontally scrollable tables on small screens.

## Selection and comparisons

- The main table preserves registry order; it is not a blended leaderboard.
- Each method uses its latest successful default-configuration feedback result on the complete expanded corpus, executed through OpenSearch.
- Unsupported-only and failed integration attempts do not supply accuracy scores. The invalid first round4 integration is explicitly excluded and linked in the excluded-attempt list.
- Parameter sweeps and other nondefault configurations appear in a separate sensitivity table. They never silently replace a method's default result.
- The accuracy value is query-macro pairwise agreement from the diagnostic result window. Coverage, supported-case counts, and the version excluding uncertain pairs remain visible.
- Comparison against HSV uses the same complete set of HSV-supported cases, currently twenty, and requires matching dataset and corpus fingerprints. A method that assesses only seventeen of those cases shows the missing coverage instead of substituting a seventeen-case comparison.
- Twenty-result judged-pair coverage is shown separately. Newly imported, unjudged images are neither relevant nor irrelevant by assumption.
- Reports, candidate configurations, workload settings, source hashes, descriptor hashes when recorded, run IDs, and corpus/dataset fingerprints remain accessible.

## Scale status

The generator reads both `exploration/scale/*/scale.json` and `exploration/rank-feature-scale/*/scale.json`. It keeps the latest saved profile for each method, document count, and concurrency. No result is inherited from a delegate, related method, or smaller corpus.

Strict PASS requires positive measured request coverage and **no errors or observations at or above one second in either warmups or timed requests**. This is recomputed from saved evidence because the initial baseline runner's own viability flag covered timed requests only. Missing warmup evidence cannot produce PASS. An absent million-document profile remains **not yet tested**.

Every profile displays latency, errors, threshold breaches, and warmup observations. The report identifies an unfinished scale artifact rather than implying a completed campaign.

New profiles reference a specific warmup invocation. A later warmup rerun cannot silently change an earlier profile's cold-start verdict. Trial failures and threshold breaches override contradictory aggregate counters.

## Scheduled arrival load

`exploration/arrival-load/*/load.json` appears in its own section. It never replaces or mixes with concurrency profiles. Each row retains method, document count, requests per second, measurement duration, query subset, latency, errors, rejected arrivals and warmup failures. Latency starts at the scheduled arrival and includes client dispatch delay. Rejections fail the strict criterion even if their measured latency is short. Source snapshot paths and completion markers remain visible.

Scale data uses synthetic descriptor mixtures. It adds no human judgments and is not evidence from a million independently sourced photographs. Short-block OpenSearch CPU counters may remain unchanged because statistics are cached; zero deltas do not mean zero CPU use. The first baseline scale run did not capture source hashes and full source snapshots at startup, and the report retains that provenance limitation.

## Reading large or active artifacts

Some feedback artifacts approach 100 MB because they contain complete hit arrays and repeated trial results. A streaming JSON projection skips those payloads before building JavaScript objects. The retained projection includes the original metric summaries, per-case agreements, coverage, configuration, and provenance.

Compact projections are cached by file size and modification time. A partially written scale artifact uses the last complete cached snapshot when available and emits a visible read warning. It never turns an unreadable artifact into a zero score or a passing benchmark. CLI output files are replaced atomically.

## Interpretation

All current judgments come from one observer; the twenty-four-case batch was explicitly a quick pass. Related examples are not independent samples, and there is no held-out population evaluation. Parameter sensitivity remains exploratory. This dashboard deliberately does not declare a global winner or combine accuracy and speed into one number.
