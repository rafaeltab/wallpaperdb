// Read-only evaluation of the planner on the existing, previously warmed scratch index.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { plannedMultiSearch, choosePlannerStrategy, requireCompleteSearch } from "./global-planner.mjs";
import { ROOT, api, readJson, saveJson, distribution, waitForIdle } from "./global-common.mjs";
import { multiQuery, boundedMultiSearch } from "./global-multi.mjs";
import { closePit } from "./global-bounded.mjs";
import { buildQueries } from "./global-varied.mjs";

const INDEX = "color-global-multi-1000000-v1";
const SOURCE_FILES = ["global-planner.mjs", "global-planner-evaluate.mjs", "global-varied.mjs", "global-multi.mjs", "global-multi-fast-source.mjs", "global-joint.mjs", "global-joint-bounded.mjs", "global-bounded.mjs", "global-common.mjs", "global-native.mjs"];
const sha = value => createHash("sha256").update(value).digest("hex");
const sourceHashes = async () => Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, sha(await readFile(new URL(file, ROOT)))])));

async function indexState() {
  const stats = (await api(`/${INDEX}/_stats/docs,indexing`)).body.indices[INDEX];
  return { uuid: stats.uuid, documents: stats.primaries.docs.count, deleted: stats.primaries.docs.deleted, indexedOperations: stats.primaries.indexing.index_total, deletedOperations: stats.primaries.indexing.delete_total };
}

function normalizedHits(hits) {
  assert.equal(new Set(hits.map(hit => hit._id)).size, hits.length, "Duplicate IDs in one page.");
  return hits.map(hit => {
    assert.ok(Number.isFinite(hit._score));
    return { id: hit._id, score: Math.fround(hit._score) };
  });
}

async function directSearch(query, extra = {}) {
  const body = multiQuery(query.colors, { size: 20, filters: query.filters ?? [], scriptVariant: "typed", timeout: "15s", ...extra });
  const response = await api(body.pit ? "/_search?allow_partial_search_results=false" : `/${INDEX}/_search?allow_partial_search_results=false`, body);
  requireCompleteSearch(response.body);
  return response;
}

async function run(method, query) {
  const started = performance.now();
  if (method === "exhaustive") {
    const response = await directSearch(query);
    return { hits: normalizedHits(response.body.hits.hits), wallMs: performance.now() - started, requests: 1, took: response.body.took, searchQueries: 1 };
  }
  const result = await (method === "planner" ? plannedMultiSearch : boundedMultiSearch)(INDEX, query.colors, { size: 20, filters: query.filters ?? [], scriptVariant: "typed", timeout: "15s" });
  let hits;
  try { hits = normalizedHits(result.hits); }
  finally { await closePit(result.pitId); }
  return { hits, wallMs: performance.now() - started, requests: result.timing.requests + 1, searchQueries: result.timing.requests - 1, strategy: result.strategy ?? "adaptive", eligibleTotal: result.eligibleTotal ?? null, countMs: result.timing.countMs ?? 0, threshold: result.threshold ?? null, diagnostics: result.diagnostics };
}

async function edgeChecks() {
  const checks = [];
  const colors = [{ family: "dark", amount: .2 }, { family: "blue", amount: .15 }, { family: "navy", amount: .1 }];
  const cases = [
    { id: "absent_filters", filters: undefined, strategy: "adaptive" },
    { id: "empty_filter_array", filters: [], strategy: "adaptive" },
    { id: "empty_metadata_result", filters: [{ term: { partition: 999 } }], strategy: "direct", expectedCount: 0 },
    { id: "exact_limit", filters: [{ term: { partition: 0 } }], strategy: "direct", expectedCount: 10000 },
    { id: "above_limit_one", filters: [{ bool: { should: [{ term: { partition: 0 } }, { ids: { values: ["mix-000000001"] } }], minimum_should_match: 1 } }], strategy: "adaptive" },
    { id: "above_limit_many", filters: [{ terms: { partition: [0, 1] } }], strategy: "adaptive" },
  ];
  for (const test of cases) for (const mode of ["target", "minimum"]) {
    const result = await plannedMultiSearch(INDEX, colors, { size: 13, ...(test.filters === undefined ? {} : { filters: test.filters }), mode });
    let pitId = result.pitId;
    try {
      assert.equal(result.strategy, test.strategy);
      if (test.expectedCount !== undefined) assert.deepEqual(result.eligibleTotal, { value: test.expectedCount, relation: "eq" });
      assert.equal(result.diagnostics.metadataCountRequested, Boolean(test.filters?.length));
      const reference = await directSearch({ colors, filters: test.filters }, { size: 13, mode, pit: { id: pitId, keep_alive: "2m" } });
      pitId = reference.body.pit_id ?? pitId;
      assert.deepEqual(normalizedHits(result.hits), normalizedHits(reference.body.hits.hits));
      if (test.expectedCount === 0) { assert.equal(result.exhausted, true); assert.equal(result.next, null); }
      checks.push({ id: test.id, mode, strategy: result.strategy, eligibleTotal: result.eligibleTotal, hits: result.hits.length, passed: true });
    } finally { await closePit(pitId); }
  }
  for (const test of [
    { id: "direct_pagination_exhaustion", filters: [{ ids: { values: Array.from({ length: 17 }, (_, i) => `mix-${String(i).padStart(9, "0")}`) } }], strategy: "direct", size: 7, pages: 3, referenceSize: 17, exhausted: true },
    { id: "direct_partition_pagination", filters: [{ term: { partition: 3 } }], strategy: "direct", size: 7, pages: 3, referenceSize: 21, exhausted: false },
    { id: "adaptive_pagination", filters: [], strategy: "adaptive", size: 7, pages: 3, referenceSize: 21, exhausted: false },
  ]) {
    const collected = [];
    let page = await plannedMultiSearch(INDEX, colors, { size: test.size, filters: test.filters }), pitId = page.pitId;
    try {
      const reference = await directSearch({ colors, filters: test.filters }, { size: test.referenceSize, pit: { id: pitId, keep_alive: "2m" } });
      pitId = reference.body.pit_id ?? pitId;
      for (let i = 0; i < test.pages; i++) {
        assert.equal(page.strategy, test.strategy);
        collected.push(...normalizedHits(page.hits));
        if (i + 1 < test.pages) {
          assert.ok(page.next);
          const next = { ...page.next, pit: pitId };
          await assert.rejects(plannedMultiSearch(INDEX, [{ family: "green", amount: .4 }], { size: test.size, filters: test.filters, ...next }), /different planner query/);
          page = await plannedMultiSearch(INDEX, colors, { size: test.size, filters: test.filters, ...next });
          pitId = page.pitId;
        }
      }
      assert.equal(new Set(collected.map(hit => hit.id)).size, collected.length);
      assert.deepEqual(collected, normalizedHits(reference.body.hits.hits));
      assert.equal(page.exhausted, test.exhausted);
      checks.push({ id: test.id, strategy: test.strategy, pages: test.pages, hits: collected.length, exhausted: page.exhausted, passed: true });
    } finally { await closePit(pitId); }
  }
  return checks;
}

function summarize(report) {
  const queries = new Map(report.queries.map(query => [query.id, query]));
  const result = [];
  for (const [stage, rows, methods] of [["sequential", report.sequential, ["exhaustive", "adaptive", "planner"]], ["concurrency4", report.concurrent, ["adaptive", "planner"]]]) {
    for (const method of methods) for (const regions of [null, 1, 2, 3, 5]) for (const selectivity of regions === null ? [null] : ["all", "one_percent"]) {
      const subset = rows.filter(row => row[method]).map(row => ({ ...queries.get(row.query), ...row[method] })).filter(row => (regions === null || row.regions === regions) && (selectivity === null || row.selectivity === selectivity));
      if (subset.length) result.push({ stage, method, regions, selectivity, wallMs: distribution(subset.map(row => row.wallMs)), requests: distribution(subset.map(row => row.requests)), countMs: distribution(subset.map(row => row.countMs ?? 0)), strategies: Object.fromEntries(["direct", "adaptive"].map(strategy => [strategy, subset.filter(row => row.strategy === strategy).length])) });
    }
  }
  return result;
}

function markdown(report) {
  return `# Metadata-aware exact color query planner

Status: **${report.status}**. Generated ${report.generatedAt}; completed ${report.completedAt ?? "pending"}.

## Strategy and correctness

The planner uses the typed existing scorer and changes only which complete OpenSearch query executes. Without metadata filters it uses adaptive bounds. With filters, it creates or reuses a PIT (a stable index snapshot) and runs a metadata-only search with \`size: 0\` and \`track_total_hits: 10001\` on that same PIT. Only an **exact count of at most 10,000** chooses direct scoring of every eligible document. Larger or lower-bound counts choose adaptive search. An exact zero count returns an exhausted empty page.

The 10,000 threshold was selected from the previous [changing-query experiment](GLOBAL-VARIED.md), where direct scoring won on 1% metadata partitions. It is a workload-specific prototype choice, not a universally optimal threshold. The count itself adds a request and can cost more than its benefit on some queries.

Both paths rank entirely in OpenSearch using the unchanged joint hard-area objective. The count has no color bounds and no pagination cursor. Score requests reuse the count's latest PIT; subsequent pages retain the complete sort tuple and validate a query fingerprint. Each filtered page recounts metadata on the same PIT. Timeouts, partial results and early termination fail the count/direct path; the existing adaptive path retains its completeness checks. The caller owns the returned PIT and must close it. On failure, the planner closes a PIT it created.

## Evaluation scope

- The same frozen one-million-document synthetic mixture index, 60 deterministic varied queries, 18 family definitions, and typed script as the previous workload. These are descriptor mixtures of 100 wallpapers and 20 fixtures, not one million independent wallpapers.
- The node, scripts, data and query set were **already warmed** by prior experiments. No cache flush. This experiment deliberately retests the known workload to evaluate the planner decision; it is not an unseen-query or cold-start trial.
- Fresh direct, adaptive and planned queries are run in rotating method order. Every ordered top-20 ID and float32 score must agree. Index mutation counters and all relevant source hashes must remain unchanged.
- Sequential latency includes each method's complete request path. Adaptive/planner timings include PIT creation and cleanup; planner timings also include counting. Direct reference latency is one score request.
- After sequential validation, separate concurrency-four passes run the same 60-query mixed workload, first adaptive then planner. This warms caches further and gives the second pass a possible cache advantage. Every concurrent result is compared to the fresh exhaustive reference.
- Additional tests cover omitted filters, empty filter arrays, an empty result, exactly10,000/10,001/more eligible documents, both target/minimum modes, same-PIT direct/adaptive pagination, exhaustion and mismatched query rejection.

Index: \`${report.index}\`. Data cache key: \`${report.dataCacheKey}\`. Index mutation counters unchanged: **${report.unchangedIndex ?? "pending"}**. Source hashes unchanged: **${report.unchangedSources ?? "pending"}**.

## Results

Sequential comparisons passed: **${report.sequential.filter(row => row.passed).length}/60**. Concurrent checks: **${report.concurrent.filter(row => row.passed).length}/120**. Edge/pagination checks: **${report.edgeChecks.length}**. Failures: **${report.failures.length}**.

| Pass | Method | Regions | Filter | n | Median ms | p95 ms | Max ms | Median requests |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
${report.summary.map(row => `| ${row.stage} | ${row.method} | ${row.regions ?? "all"} | ${row.selectivity ?? "mixed"} | ${row.wallMs.samples} | ${row.wallMs.median.toFixed(1)} | ${row.wallMs.p95.toFixed(1)} | ${row.wallMs.max.toFixed(1)} | ${row.requests.median} |`).join("\n")}

Per-family-count/filter groups contain only seven or eight changing queries. Their p95 is the largest observation and is not a stable production tail estimate. The finite workload and already warmed state limit generalization; experimental family definitions still require human relevance evaluation.

## Reproduce

Run \`make color-global-planner\` while other indexing/benchmark work is idle. The existing dedicated OpenSearch2.11 scratch index is required; the runner creates PITs but never rebuilds data, mutates documents, or changes the UI. [global-planner.json](global-planner.json) records source/data hashes, mutation counters, complete ordered results, all timing samples, count decisions, and failures.
`;
}

async function checkpoint(report) {
  report.summary = summarize(report);
  await saveJson("global-planner.json", report);
  await writeFile(new URL("GLOBAL-PLANNER.md", ROOT), markdown(report));
}

export async function main() {
  assert.equal(choosePlannerStrategy([], undefined), "adaptive");
  assert.equal(choosePlannerStrategy([{}], { value: 0, relation: "eq" }), "direct");
  assert.equal(choosePlannerStrategy([{}], { value: 10_000, relation: "eq" }), "direct");
  assert.equal(choosePlannerStrategy([{}], { value: 10_001, relation: "eq" }), "adaptive");
  assert.equal(choosePlannerStrategy([{}], { value: 10_000, relation: "gte" }), "adaptive");
  assert.throws(() => requireCompleteSearch({ timed_out: true }));
  assert.throws(() => requireCompleteSearch({ terminated_early: true }));
  assert.throws(() => requireCompleteSearch({ _shards: { failed: 1 } }));
  await assert.rejects(plannedMultiSearch("color-global-multi-1000000-v1", [{ family: "green", amount: .4 }], { search_after: [.8, "example"] }), /Pagination requires/);
  await assert.rejects(plannedMultiSearch(INDEX, [{ family: "green", amount: .4 }], { maxError: .3 }), /planner ranks all/);
  const queries = buildQueries();
  const bytes = await readFile(new URL("global-multi-data.json", ROOT));
  const data = JSON.parse(bytes), indexing = await readJson("global-multi-indexing.json");
  assert.equal(data.cacheKey, indexing.dataCacheKey);
  assert.ok(indexing.indexes.some(row => row.index === INDEX && row.count === 1_000_000));
  await waitForIdle();
  const before = await indexState();
  assert.equal(before.documents, 1_000_000);
  const report = { generatedAt: new Date().toISOString(), status: "running", index: INDEX, dataCacheKey: data.cacheKey, dataSha256: sha(bytes), indexFingerprint: indexing.fingerprint, indexBefore: before, sourceHashes: await sourceHashes(), opensearchVersion: (await api("/")).body.version, queries, sequential: [], concurrent: [], edgeChecks: [], failures: [], summary: [], concurrentPasses: [], cachePolicy: "Previously warmed node and exact query set. No flush; fresh sequential rotating-method comparison, then adaptive and planner concurrency passes in that order." };
  await checkpoint(report);
  try {
    report.edgeChecks = await edgeChecks();
    console.log(`Planner edge checks passed: ${report.edgeChecks.length}.`);
    for (const [i, query] of queries.entries()) {
      const methods = ["exhaustive", "adaptive", "planner"], offset = i % methods.length;
      const row = { query: query.id, methodOrder: [...methods.slice(offset), ...methods.slice(0, offset)], passed: false };
      for (const method of row.methodOrder) row[method] = await run(method, query);
      assert.equal(row.exhaustive.hits.length, 20);
      assert.deepEqual(row.planner.hits, row.exhaustive.hits);
      assert.deepEqual(row.adaptive.hits, row.exhaustive.hits);
      assert.equal(row.planner.strategy, query.filters.length ? "direct" : "adaptive");
      if (query.filters.length) assert.deepEqual(row.planner.eligibleTotal, { value: 10_000, relation: "eq" });
      row.passed = true; report.sequential.push(row);
      if (report.sequential.length % 10 === 0) console.log(`Planner sequential: ${report.sequential.length}/60.`);
      await checkpoint(report);
    }
    report.indexAfterSequential = await indexState();
    assert.deepEqual(report.indexAfterSequential, before, "Index changed during sequential evaluation.");
    const references = new Map(report.sequential.map(row => [row.query, row.exhaustive.hits]));
    for (const method of ["adaptive", "planner"]) {
      const started = performance.now(); let next = 0;
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < queries.length) {
          const query = queries[next++], row = { query: query.id, passed: false };
          try {
            row[method] = await run(method, query);
            assert.deepEqual(row[method].hits, references.get(query.id));
            row.passed = true;
          } catch (error) { report.failures.push({ stage: `concurrency4/${method}`, query: query.id, error: error.message }); }
          report.concurrent.push(row);
        }
      }));
      report.concurrentPasses.push({ method, inFlight: 4, elapsedMs: performance.now() - started, queries: queries.length });
      console.log(`Planner concurrency4 ${method}: ${report.concurrentPasses.at(-1).elapsedMs.toFixed(1)}ms for60queries.`);
      await checkpoint(report);
    }
  } catch (error) {
    report.failures.push({ stage: "evaluation", error: error.message });
    console.error(error);
  }
  report.indexAfter = await indexState();
  report.unchangedIndex = JSON.stringify(before) === JSON.stringify(report.indexAfter);
  report.finalSourceHashes = await sourceHashes();
  report.unchangedSources = JSON.stringify(report.sourceHashes) === JSON.stringify(report.finalSourceHashes);
  if (!report.unchangedIndex) report.failures.push({ stage: "mutation", error: "Index mutation counters changed." });
  if (!report.unchangedSources) report.failures.push({ stage: "provenance", error: "Source hashes changed during evaluation." });
  report.completedAt = new Date().toISOString();
  report.status = report.failures.length ? "completed with failures" : "completed";
  await checkpoint(report);
  console.log(JSON.stringify({ status: report.status, sequential: report.sequential.length, concurrent: report.concurrent.filter(row => row.passed).length, edges: report.edgeChecks.length, failures: report.failures, summary: report.summary.filter(row => row.regions === null) }, null, 2));
  if (report.failures.length) process.exitCode = 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
