# Color-search evaluation loop

This is the shared feedback loop for comparing and improving color-search methods. It does not shortlist methods or select a production architecture. Register a method, change parameters or combine approaches inside an adapter, run the same evaluation, then inspect accuracy, coverage, timing and regressions.

[Capabilities and expansion needs](EXTENSIONS.md) distinguishes what can already be prototyped through adapters from the shared work needed for broader relevance, retrieval and production-scale comparisons.

The user explicitly corrected the earlier move toward method selection: build the loop first, then use its evidence to explore broadly. The existing cosine/L2 formulas are initial integration controls, not privileged finalists.

## Run and inspect

From the repository root:

```sh
make color-eval-test
make color-eval-run
make color-eval-serve
```

Open **http://zerotwo:8224/** for saved runs or **http://zerotwo:8224/latest** for the latest report. The server is read-only. It does not execute methods or accept new human judgments. The existing batch annotation service stays separate on port 8222.

[Initial validation](VALIDATION.md) records the actual local/OpenSearch runs, focused checks, service operations and the unrelated repository CI failure.

The default run uses [configs/initial.json](configs/initial.json). Select another configuration with:

```sh
make color-eval-run COLOR_EVAL_CONFIG=/absolute/path/to/config.json
```

Each run is saved under `~/.local/share/wallpaperdb/color-evaluation/runs/<run-id>/`, outside the worktree. It contains:

- `run.json`: configuration, code hashes, environment, setup measurements, ranked IDs/scores, raw timing samples, failures and metric results.
- `dataset.json`: a frozen normalized judgment snapshot, provenance and metric policy.
- `corpus.json`: source IDs, filenames and image hashes.
- `report.html` / `report.md`: readable results and compatible run-to-run comparisons.
- Adapter-specific evidence, such as the initial controls' extracted descriptors.

Run artifacts use unique directories; the runner does not overwrite earlier evidence. `latest.json` is a mutable navigation pointer. HTML/Markdown reports can be regenerated from an immutable run:

```sh
make color-eval-report COLOR_EVAL_RUN=/path/to/run.json COLOR_EVAL_PREVIOUS=/path/to/earlier/run.json
```

The CLI automatically compares with the last saved run when available; `compareWith` in the configuration selects another saved run. Configuration and implementation changes are expected comparison variables. Changed datasets, evidence coverage, workloads, execution classes or environments can make particular comparisons unavailable; the report explains why.

## What accuracy currently means

The loader imports **37 logical judgment records**, including the 24 quick batch rankings, without counting the standalone batch case twice. These are related cases from one observer, not independent population samples. Original orders, ties, uncertain pairs, comments and the quick-pass caveat remain in the snapshot.

Metric policy v1 is deliberately explicit and replaceable:

1. Derive strict pairwise preferences from each submitted order; human tie groups impose no internal order.
2. A model receives 1 for matching a strict preference, 0 for reversing it, and 0.5 for equal model scores.
3. Missing endpoints are unassessed. They never silently become last-ranked or irrelevant.
4. Average agreement within a query, then across assessed queries. Show category results, assessed-pair/image coverage, complete-case agreement, unsupported cases, errors and semantic eligibility violations alongside it.
5. Also show a sensitivity score omitting the five specifically uncertain pairs. The entire batch's quick-pass caveat still applies to both scores; no confidence weights are invented.

This is agreement with the recorded preferences, not “percentage accurate human perception.” Derived pairs are not independent observations. Ordinal ranks are not converted to invented relevance grades, so this first version does not claim an nDCG or precision-at-k score from them. Unknown returned wallpapers need additional judgments before usefulness can be assessed.

Two conceptual composition cases have no source images and remain visibly unsupported by image adapters. Their permissive/absolute judgments are preserved rather than fabricated into strict orders. A semantic case assumes one image qualifies as a city; its conditional scenario stays visible. Related image/query groups are recorded for future dataset splits; current data is development material, not held-out validation.

### Large-window diagnostic versus timed-request accuracy

The runner makes a separate ranking request with `accuracyLimit` to compare the judged images when possible. This is a **large-window ranking diagnostic**, not proof of production top-k quality.

Performance uses `limit`, which can be smaller. The returned hits and accuracy for every measured request are saved. The report's timed-search accuracy uses the **first successful measured request per case**, with coverage shown; subsequent samples remain inspectable. In particular, do not pair the large-window diagnostic with a cheaper small-window latency to claim a superior ANN method. Repeated-request accuracy variation can be analyzed from the saved trials; this initial summary is not an uncertainty estimate over those trials.

Retrieval correctness against each method's exhaustive objective is a separate question. The initial exact adapters declare their execution scope, but this loop does not yet prove recall or global completeness for arbitrary future ANN/hybrid adapters. Add a reference/check appropriate to the candidate, preserving its results as separate evidence.

## Performance contract

Workload defaults: one warmup round, five measured rounds, concurrency one, 20 returned hits, a 1,000-hit large-window diagnostic, and a 10-second per-search deadline. These are initial **measurement settings**, not accepted production latency targets.

- Measure elapsed time around the entire adapter `search` call, including query construction, network requests and response processing. An adapter making several planning/retrieval requests must await all of them before returning.
- Extracting image descriptors and creating an index happen in `prepare`; their costs are recorded separately.
- Warmups finish before measured work starts. Cases rotate within each round. Candidate runs are sequential; memory, machine load and backend caches are not isolated or flushed automatically.
- Store every sample and report nearest-rank p50/p95/max, failure counts, sample counts and workload settings. A handful of samples is pipeline verification, not a stable production tail-latency estimate.
- Record harness-process CPU for the warmup/measurement block and before/after memory snapshots. These are not isolated per-candidate peak RAM. OpenSearch CPU/RAM remain explicitly unmeasured until a resource collector is added. Initial exact-index setup records store size.
- Abort on the search deadline and reject calls that return after it. Cancellation is cooperative: an in-process CPU-bound plugin cannot be forcibly interrupted by an event-loop timer. Such candidates need worker/process isolation for a hard execution budget. A failed case stops further queued timing trials for that case; failures and missing samples remain visible.

Local exhaustive scoring is a formula reference. Its timing does not establish OpenSearch, gateway or million-document performance. The real OpenSearch adapter measures its HTTP search path on the declared corpus, not the full gateway request. Representative large collections, concurrent load, paging and production filters remain additional workload profiles to add to this same loop.

## Add any candidate or combination

Configuration modules resolve relative to the configuration file. The runner dynamically loads the module; it has no fixed shortlist of allowed search techniques.

```json
{
  "schemaVersion": 1,
  "label": "An explicit experiment hypothesis",
  "workload": {"warmup": 1, "repeats": 20, "concurrency": 1, "limit": 20, "accuracyLimit": 1000},
  "candidates": [
    {"id": "my-method", "module": "./my-method.mjs", "parameters": {"someWeight": 0.7}}
  ]
}
```

An adapter exports `createCandidate({config, context})`, returning:

```js
{
  metadata: {id, label, sourceFiles, execution, limitations},
  supports(caseData), // {supported, reason?}
  async prepare(),   // descriptors/index setup and backend provenance
  async search({caseData, limit, signal}), // {hits: [{id, score}], ...evidence}
  async close()
}
```

Higher finite scores rank first. Return unique corpus IDs in descending-score order. Report unsupported queries rather than ignoring their constraints. Declare partial/shard failures; never present a partial response as a successful globally complete search. All modules are trusted local experiment code, not sandboxed third-party plugins.

`context` supplies image sources and a run directory, without human rankings. Requests contain only normalized search intent and any declared eligibility scenario. Historical query annotations containing prior preferences are deliberately excluded from adapter inputs. The frozen source dataset retains them for evaluation. New query controls should extend/version this search-input boundary explicitly; do not attach annotations to it.

A module may combine several representations/scorers or coordinate several OpenSearch queries. The loop measures its complete search path and keeps its configuration. This first foundation does not implement a new hybrid algorithm or assume that a capped rerank is globally correct.

### Parameter sweeps

Each sweep becomes a separately identified configuration with its exact parameters recorded:

```json
{
  "id": "hsv-query-width",
  "module": "../adapters.mjs",
  "metric": "cosine",
  "sweep": {"sigma": [0.06, 0.1, 0.3]}
}
```

The runner expands the Cartesian product; it does not choose a winner or silently discard regressions. The initial HSV adapter accepts only its implemented parameter names and rejects ineffective/unknown sweep axes. Other modules define their own parameters.

## Initial OpenSearch integration

The same existing HSV formulas can run through OpenSearch's exact `knn_score`. Configure an adapter with `execution: "opensearch-exact"` and `opensearch: {"url":"http://127.0.0.1:19216","allowCreateIndex":true}`. The existing isolated experiment service is the intended target, not the application index.

An executable integration-check configuration is included:

```sh
make color-eval-run COLOR_EVAL_CONFIG=experiments/color-search-benchmark/evaluation/loop/configs/opensearch-smoke.json
```

The adapter creates a fresh `color-eval-*` index, rejects an existing name, records actual server version/topology and keeps the index with run evidence. It does not overwrite or delete existing experiment/application indexes. A metric configuration changes only this experiment. The current cosine control reproduces the default linear Gaussian formula, not the production HNSW retrieval path or alternative spread strategies.

Named colors use declared historical swatches; percentages enter historical mixture weights. Those controls explicitly do not implement all the desired whole-image/remainder semantics. Their weaknesses are useful baseline evidence, not reasons to redefine the evaluation cases.

## The ongoing loop

1. Register a candidate, combination or parameter hypothesis.
2. Run the same versioned development cases and declared workload.
3. Inspect accuracy, timed-search coverage, speed, failures and category/case regressions together.
4. Inspect the actual wallpapers where methods disagree; collect additional judgments in batches when necessary.
5. Change the method, configuration or justified metric policy and rerun. Version policy/data changes instead of comparing incompatible numbers.
6. Expand the shared corpus and operational profiles as needed, and eventually use fresh grouped held-out cases and more reviewers.

Accuracy and speed remain separate outcomes. The loop provides evidence for exploring methods and combinations; a storage saving or aggregate score does not compensate for an unacceptable query category. No production architecture or narrowed candidate set follows from establishing the harness.
