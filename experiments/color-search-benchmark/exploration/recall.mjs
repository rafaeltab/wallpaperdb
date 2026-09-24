// Retrieval diagnostic only. All candidate and reference rankings come from OpenSearch.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { METHODS, buildQuery } from './methods.mjs';
import { BASE, INDEX, STORE, api, safeIndexName, validateSearchResponse } from './service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const queries = [
  { id: 'red-vibe', query: { text: 'red' } },
  { id: 'green-target40', query: { colorTargets: [{ colorName: 'green', targetImagePercent: 40 }], unspecifiedRemainderPercent: 60 } },
  { id: 'red-green-target50', query: { colorTargets: [{ colorName: 'red', targetImagePercent: 50 }, { colorName: 'green', targetImagePercent: 50 }], unspecifiedRemainderPercent: 0 } },
  { id: 'warm-red-precision', query: { swatchHex: '#ff2200' } },
];

export function compareRetrieval({ reference, actual, exactScores, limit = 20 }) {
  const expected = reference.slice(0, limit);
  if (!expected.length) return { status: actual.length ? 'unexpected-results' : 'empty-eligible-set', expectedCount: 0, returnedCount: actual.length, strictRecall: null, tieAwareRecall: null };
  const expectedIds = new Set(expected.map(hit => hit.id));
  const seen = new Set();
  for (const hit of actual) {
    if (seen.has(hit.id)) throw new Error('Duplicate ANN document ID');
    seen.add(hit.id);
    if (!exactScores.has(hit.id)) throw new Error(`Missing exact service score for ANN document ${hit.id}`);
  }
  const boundary = expected.at(-1).score;
  // Scores are returned as float32 by different native scoring implementations.
  const epsilon = Math.max(1e-6, Math.abs(boundary) * 2e-6);
  const matched = actual.filter(hit => expectedIds.has(hit.id)).length;
  const acceptable = actual.filter(hit => exactScores.get(hit.id) >= boundary - epsilon).length;
  const regrets = actual.map(hit => Math.max(0, boundary - exactScores.get(hit.id)));
  const regret = regrets.reduce((sum, value) => sum + value, 0);
  const badHits = actual.filter(hit => exactScores.get(hit.id) < boundary - epsilon).map(hit => ({ id: hit.id, annScore: hit.score, exactScore: exactScores.get(hit.id), boundaryRegret: boundary - exactScores.get(hit.id) }));
  return { status: 'assessed', expectedCount: expected.length, returnedCount: actual.length,
    strictRecall: matched / expected.length, tieAwareRecall: acceptable / expected.length,
    strictMatches: matched, equivalentOrBetterScoreHits: acceptable, missingSlots: Math.max(0, expected.length - actual.length),
    boundaryScore: boundary, scoreTolerance: epsilon,
    boundaryTieObserved: reference.length > expected.length && Math.abs(reference[expected.length].score - boundary) <= epsilon,
    meanReturnedBoundaryRegret: actual.length ? regret / actual.length : null,
    maximumBoundaryRegret: regrets.length ? Math.max(...regrets) : null,
    firstResultRegret: actual.length ? Math.max(0, expected[0].score - exactScores.get(actual[0].id)) : null,
    badHits,
  };
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
};
function summarize(records) {
  const result = [];
  for (const method of [...new Set(records.map(r => r.method))]) for (const k of [...new Set(records.map(r => r.k))]) {
    const matching = records.filter(r => r.method === method && r.k === k);
    const trials = matching.flatMap(r => r.trials ?? []).filter(t => t.metrics?.status === 'assessed');
    const mean = key => trials.length ? trials.reduce((sum, t) => sum + t.metrics[key], 0) / trials.length : null;
    result.push({ method, k, queryProfiles: matching.length, assessedTrials: trials.length, failedQueryProfiles: matching.filter(r => r.error).length,
      strictRecallMean: mean('strictRecall'), tieAwareRecallMean: mean('tieAwareRecall'),
      worstStrictRecall: trials.length ? Math.min(...trials.map(t => t.metrics.strictRecall)) : null,
      worstTieAwareRecall: trials.length ? Math.min(...trials.map(t => t.metrics.tieAwareRecall)) : null,
      latencyMs: { p50: percentile(trials.map(t => t.elapsedMs), 0.5), p95: percentile(trials.map(t => t.elapsedMs), 0.95), max: percentile(trials.map(t => t.elapsedMs), 1) },
      warning: 'These repeated single-client diagnostic timings are not a concurrent production load benchmark.',
    });
  }
  return result;
}

export async function runRecall(options = {}) {
  const base = options.base ?? process.env.COLOR_EXPLORATION_RECALL_BASE ?? BASE;
  const index = safeIndexName(options.index ?? process.env.COLOR_EXPLORATION_RECALL_INDEX ?? INDEX);
  const outputRoot = options.outputRoot ?? process.env.COLOR_EXPLORATION_RECALL_OUTPUT ?? path.join(STORE, 'recall');
  const limit = Number(options.limit ?? process.env.COLOR_EXPLORATION_RECALL_LIMIT ?? 20);
  const ks = options.ks ?? (process.env.COLOR_EXPLORATION_RECALL_KS ?? '20,100,500').split(',').map(Number);
  const repeats = Number(options.repeats ?? process.env.COLOR_EXPLORATION_RECALL_REPEATS ?? 3);
  const methodIds = options.methodIds ?? process.env.COLOR_EXPLORATION_RECALL_METHODS?.split(',');
  const methods = METHODS.filter(method => method.vector && method.approximate && (!methodIds || methodIds.includes(method.id)));
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || ks.some(k => !Number.isInteger(k) || k < limit || k > 10000) || !Number.isInteger(repeats) || repeats < 1 || repeats > 100 || !methods.length) throw new Error('Invalid recall diagnostic configuration');
  const call = (route, options = {}) => api(route, { ...options, base, timeoutMs: options.timeoutMs ?? 60000 });
  const search = async body => {
    const started = performance.now();
    const response = await call(`${index}/_search?request_cache=false`, { method: 'POST', body });
    return { hits: validateSearchResponse(response.body), elapsedMs: performance.now() - started, serviceTookMs: response.body.took };
  };
  const count = (await call(`${index}/_count`)).body.count;
  const version = (await call('')).body.version;
  const topology = (await call('_nodes?filter_path=nodes.*.name,nodes.*.version,nodes.*.os.available_processors,nodes.*.os.allocated_processors,nodes.*.jvm.mem.heap_max_in_bytes')).body;
  const settings = (await call(`${index}/_settings?flat_settings=true`)).body;
  const mapping = (await call(`${index}/_mapping`)).body;
  const fields = mapping[index]?.mappings?.properties ?? {};
  const unavailable = methods.filter(method => !fields[method.field]).map(method => ({ method: method.id, reason: `Index has no field ${method.field}` }));
  const availableMethods = methods.filter(method => fields[method.field]);
  let profiles;
  if (count <= 10000) {
    const response = await call(`${index}/_search`, { method: 'POST', body: { size: count || 1, _source: false, track_total_hits: false, query: { match_all: {} }, sort: [{ id: 'asc' }] } });
    const ids = response.body.hits.hits.map(hit => hit._id);
    if (ids.length !== count) throw new Error('Small-corpus ID enumeration was incomplete');
    profiles = [{ id: 'all', eligibleCount: count }, ...[10, 100].map(divisor => {
      const eligibleIds = ids.filter(id => Number.parseInt(sha(id).slice(0, 8), 16) % divisor === 0);
      return { id: divisor === 10 ? 'filter10pct-ids' : 'filter1pct-ids', eligibleIds, eligibleCount: eligibleIds.length,
        definition: `Deterministic SHA256(ID) modulo ${divisor} equals zero; real source metadata has no useful partition distribution.` };
    })];
  } else {
    profiles = [{ id: 'all', eligibleCount: count }, { id: 'filter10pct-partition', filter: { range: { partition: { lt: 10 } } } }, { id: 'filter1pct-partition', filter: { term: { partition: 1 } } }];
    for (const profile of profiles.filter(p => p.filter)) profile.eligibleCount = (await call(`${index}/_count`, { method: 'POST', body: { query: profile.filter } })).body.count;
  }
  const selectedProfiles = options.profiles ?? process.env.COLOR_EXPLORATION_RECALL_PROFILES?.split(',');
  if (selectedProfiles) profiles = profiles.filter(profile => selectedProfiles.includes(profile.id));
  const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
  const filenames = ['recall.mjs', 'methods.mjs', 'query.mjs', 'corpus-colors.mjs'];
  const sourceHashes = Object.fromEntries(await Promise.all(filenames.map(async name => [name, sha(await readFile(path.join(ROOT, name)))])));
  const result = { schemaVersion: 1, id, status: 'running', startedAt: new Date().toISOString(), base, index, indexCount: count, version, topology, settings,
    sourceHashes, configuration: { limit, ks, repeats, methods: availableMethods.map(m => m.id), queries, profiles }, unavailable, records: [], summary: [],
    scoring: 'Exact knn_score computes both global references and independent scores of ANN-returned IDs. Native cosine score conventions are never compared directly.',
    caveats: ['Strict ID recall penalizes alternate members of a score tie; tie-aware recall treats any score at the exact cutoff as equivalent.', 'Score tolerances account for float32 response rounding, not broad perceptual equivalence.', 'This measures retrieval agreement for the implemented vector objective, not human perception accuracy.', 'Timings include the query call but exclude exact reference work and do not establish concurrent throughput.'],
  };
  await mkdir(outputRoot, { recursive: true });
  const partial = path.join(outputRoot, `${id}.partial.json`), filename = path.join(outputRoot, `${id}.json`);
  const checkpoint = async () => { result.summary = summarize(result.records); await writeFile(partial, JSON.stringify(result, null, 2)); };
  await checkpoint();
  for (const method of availableMethods) for (const queryCase of queries) for (const profile of profiles) {
    const request = { method, query: queryCase.query, eligibleIds: profile.eligibleIds, filter: profile.filter };
    const exactMethod = { ...method, exactVector: true, approximate: false };
    let reference;
    try { reference = await search(buildQuery({ ...request, method: exactMethod, limit: limit + 1 })); }
    catch (error) {
      for (const k of ks) result.records.push({ method: method.id, queryId: queryCase.id, profile: profile.id, eligibleCount: profile.eligibleCount, k, error: `Exact reference failed: ${error.message}` });
      await checkpoint(); continue;
    }
    for (const k of ks) {
      const record = { method: method.id, queryId: queryCase.id, profile: profile.id, eligibleCount: profile.eligibleCount, k,
        reference: { hits: reference.hits, elapsedMs: reference.elapsedMs, serviceTookMs: reference.serviceTookMs }, trials: [] };
      try {
        // One untimed warmup isolates the reported comparison from first compilation/cache fill.
        await search(buildQuery({ ...request, limit, parameters: { k } }));
        const trials = [];
        for (let repeat = 0; repeat < repeats; repeat++) {
          const started = performance.now();
          const response = await search(buildQuery({ ...request, limit, parameters: { k } }));
          trials.push({ repeat, ...response, elapsedMs: performance.now() - started });
        }
        const ids = [...new Set(trials.flatMap(trial => trial.hits.map(hit => hit.id)))];
        const independent = ids.length ? await search(buildQuery({ ...request, method: exactMethod, eligibleIds: ids, limit: ids.length })) : { hits: [] };
        const exactScores = new Map(independent.hits.map(hit => [hit.id, hit.score]));
        record.exactScoresForReturnedIds = independent.hits;
        record.trials = trials.map(trial => ({ ...trial, metrics: compareRetrieval({ reference: reference.hits, actual: trial.hits, exactScores, limit }) }));
      } catch (error) { record.error = error.message; }
      result.records.push(record);
      await checkpoint();
    }
    console.log(JSON.stringify({ method: method.id, query: queryCase.id, profile: profile.id, progress: result.records.length, output: partial }));
  }
  result.finalIndexCount = (await call(`${index}/_count`)).body.count;
  result.status = result.finalIndexCount === count ? 'complete' : 'index-count-changed';
  result.completedAt = new Date().toISOString();
  await checkpoint();
  await rename(partial, filename);
  console.log(JSON.stringify({ status: result.status, output: filename, summary: result.summary }));
  return { result, filename };
}

function selfTest() {
  const reference = [{ id: 'a', score: 1 }, { id: 'b', score: 0.8 }, { id: 'c', score: 0.8 }];
  const tie = compareRetrieval({ reference, actual: [{ id: 'a', score: 999 }, { id: 'c', score: 123 }], exactScores: new Map([['a', 1], ['c', 0.8]]), limit: 2 });
  assert.equal(tie.strictRecall, 0.5); assert.equal(tie.tieAwareRecall, 1); assert.equal(tie.meanReturnedBoundaryRegret, 0); assert.equal(tie.boundaryTieObserved, true);
  const miss = compareRetrieval({ reference, actual: [{ id: 'd', score: 999 }], exactScores: new Map([['d', 0.6]]), limit: 2 });
  assert.equal(miss.tieAwareRecall, 0); assert.equal(miss.missingSlots, 1); assert.ok(Math.abs(miss.maximumBoundaryRegret - 0.2) < 1e-12);
  console.log('Recall metric self-checks passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) selfTest();
  else await runRecall();
}
