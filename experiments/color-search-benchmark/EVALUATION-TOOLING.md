# Color search evaluation tooling options

**Current implementation, 2026-09-20:** the [common feedback loop](evaluation/loop/README.md) now uses a small Node runner, `node:test` checks, pluggable method modules and immutable JSON/HTML/Markdown artifacts. This establishes the reusable contract without a new framework dependency or narrowed search-method set. The tool survey below is historical research; choosing a runner does not choose a search architecture.

Research date: **2026-09-16**. **Proposal only: no tool selected or implemented.** No project code, tests, benchmarks, or infrastructure were run for this note.

The reusable idea from Evalite is a dataset, several candidate implementations, independent scorers, and a comparison report. That workflow does not require an LLM or an LLM judge. The evaluation criteria and human judgments should be agreed before choosing a runner.

## Shortlist

| Option | What it supplies | What we would still own |
| --- | --- | --- |
| Existing TypeScript + Vitest, with a small evaluation wrapper | Familiar runner; assertions; JSON/HTML output and custom reporters. The repository already declares Vitest `^3.0.0`. | Dataset and candidate contracts, continuous scores, run comparison, and a wallpaper-specific visual review page. |
| Promptfoo with custom providers and deterministic scorers | JS/TS provider hooks, JS score functions, a web comparison viewer, manual scores/comments, and exports. | A provider adapter for search results, relevance scorers, and suitable ranked-image presentation. It uses prompt/model terminology even when evaluating another system. |
| OpenSearch 2.11 `_rank_eval`, as a component | Runs search requests against an index with supplied document ratings; returns aggregate/per-query ranking metrics and unrated documents. | Human judgment collection, preference-pair checks, multi-request search orchestration, experiment history, and latency/resource measurement. |

Vitest v3 supports built-in JSON/HTML/JUnit reporters and custom reporters. Using it as a continuous quality-score dashboard would be a design we build, rather than a built-in feature. [Vitest v3 reporters](https://v3.vitest.dev/guide/reporters), [repository dependency](../../package.json).

Promptfoo permits custom JS/TS providers and scorer functions that return numeric scores or structured grading results. A provider could call a color-search candidate and return ranked IDs plus metadata; this adaptation is a proposal, not a tested integration. [Custom providers](https://www.promptfoo.dev/docs/providers/custom-api/), [JavaScript assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/).

Its viewer supports comparing runs, images, custom manual scores, comments, filters, and CSV/JSON export. Whether it presents ordered wallpaper grids comfortably should be a selection criterion. A viewer score is not automatically a reusable relevance label; we would keep judgments in a separate versioned dataset. [Web viewer](https://www.promptfoo.dev/docs/usage/web-ui/).

The version-specific OpenSearch 2.11 documentation confirms `_rank_eval` and document ratings. It is useful when an experiment maps to a search request. An adaptive method involving several requests should also be evaluated through its complete public query path. The API does not replace the broader evaluation loop. [OpenSearch 2.11 ranking evaluation](https://docs.opensearch.org/2.11/api-reference/rank-eval/).

## Evalite maintenance check

The user reports that Evalite is no longer maintained. The primary repository and README checked here do not contain an archive or discontinuation notice; the package README still describes experimental development, and the v1 pull request contains 2026 activity. Those facts do **not** establish a current support commitment. Maintenance status remains unconfirmed from these sources; there is no need to depend on Evalite to adopt its workflow. [Repository](https://github.com/mattpocock/evalite), [package README](https://github.com/mattpocock/evalite/blob/main/packages/evalite/readme.md), [v1 pull request](https://github.com/mattpocock/evalite/pull/240).

## Suggested decision

Keep TypeScript/Vitest and Promptfoo as the two runner candidates. Choose after agreeing the judgment format, metrics, and visual review needs. Treat `_rank_eval` as an optional ranking-metric component rather than a competing complete framework. Whichever runner we choose, collect production-style latency and resource measurements separately under controlled cache/concurrency conditions; test-runner durations and viewer timings alone are insufficient.
