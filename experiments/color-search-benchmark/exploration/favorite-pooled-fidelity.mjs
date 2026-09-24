// Read-only real-service correctness for the actual pooled cleanup variants.
// Every candidate call uses the real native pooled transport, with an explicit
// response witness. Full rankings are retrieved only for offline validation.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, BASE, hash } from './service.mjs';
import { loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { searchFavoriteDocvalueUtilities, buildFavoriteDocvalueQuery } from './favorite-docvalue-fetch.mjs';
import { maximaFidelityJobs, inspectMaximaExecution } from './favorite-maxima-fidelity.mjs';
import { assertExecutionIndex, inspectBoundedExecution, assertSameExecutionRanking } from './favorite-execution-fidelity.mjs';
import { createFavoritePooledDeleteTransport } from './favorite-pooled-delete.mjs';
import { FAVORITE_POOLED_METHODS, executeFavoritePooledUtilitySearch } from './favorite-pooled-utilities.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const realIndex = 'color-exploration-favorite-points-real-v2', shardIndex = 'color-exploration-favorite-multishard-real-v1';
const shardReceipt = '/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/multishard-fidelity-v1/fidelity.json';
const controls = () => [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
export function pooledFidelityConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) { const key = args[i], value = args[++i];
    assert.ok(['--directory', '--three-shards'].includes(key) && value && !value.startsWith('--') && !Object.hasOwn(values, key), 'Use new external --directory and --three-shards true|false.'); values[key] = value; }
  assert.ok(values['--directory']); const directory = path.resolve(values['--directory']);
  assert.ok(directory !== '/' && directory !== repository && !directory.startsWith(repository + path.sep));
  assert.ok(values['--three-shards'] === undefined || ['true', 'false'].includes(values['--three-shards']));
  return { directory, indices: [realIndex, ...(values['--three-shards'] === 'false' ? [] : [shardIndex])] };
}
export const pooledFidelityJobs = maximaFidelityJobs;
function errorDetail(error) { return { name: error.name, message: error.message, stack: error.stack, code: error.code, transport: error.transport,
  ...(error.cause ? { cause: { name: error.cause.name, message: error.cause.message, code: error.cause.code, syscall: error.cause.syscall } } : {}) }; }

export async function capturePooledExecution(options, { request } = {}) {
  assert.equal(typeof request, 'function', 'Capture must wrap an actual pooled transport request.');
  const trace = [];
  const capture = async (route, settings = {}) => {
    const row = { route, request: { method: settings.method ?? 'GET', body: settings.body, timeoutMs: settings.timeoutMs } }; trace.push(row);
    try { const response = await request(route, settings); row.response = response; return response; }
    catch (error) { row.error = errorDetail(error); throw error; }
  };
  try { return { result: await executeFavoritePooledUtilitySearch({ ...options, request: capture }), trace }; }
  catch (error) { error.executionTrace = trace; error.executionOptions = options; throw error; }
}

export function inspectPooledExecution(result, trace, numericBody, { method, shards }) {
  const maxima = method === 'favorite-utility-maxima-bounded-pooled-delete';
  assert.ok(FAVORITE_POOLED_METHODS.some(item => item.id === method));
  const inspection = maxima ? inspectMaximaExecution(result, trace, numericBody) : inspectBoundedExecution(result, trace, numericBody);
  const searches = trace.filter(row => row.route.startsWith('_search?'));
  const fields = [...new Set(numericBody.query.bool.should.map(term => term.function_score.field_value_factor.field))];
  const seeds = searches.filter(row => row.request.body.track_scores === false);
  assert.equal(seeds.length, fields.length);
  for (const [i, seed] of seeds.entries()) {
    assert.deepEqual(seed.request.body.query, { bool: { filter: numericBody.query.bool.filter } });
    assert.deepEqual(seed.request.body.sort, [{ [fields[i]]: { order: 'desc', missing: 0 } }, { id: 'asc' }]);
  }
  const opened = trace[0]; assert.ok(opened.route.includes('/_search/point_in_time?'));
  let pit = opened.response.body.pit_id; assert.ok(pit); const pits = new Set([pit]);
  for (const row of [opened, ...searches]) {
    assert.equal(row.response.body._shards?.total, shards); assert.equal(row.response.body._shards?.successful, shards); assert.equal(row.response.body._shards?.failed, 0);
    if (row === opened) continue;
    assert.equal(row.request.body.pit?.id, pit); if (row.response.body.pit_id) { pit = row.response.body.pit_id; pits.add(pit); }
  }
  const final = searches.at(-1).request.body;
  assert.deepEqual(final.query.bool.must, numericBody.query.bool.must); assert.deepEqual(final.sort, numericBody.sort); assert.equal(final.size, numericBody.size);
  if (!maxima && result.evidence.globalBounds.threshold > 0) {
    assert.deepEqual(final.query.bool.filter.slice(numericBody.query.bool.filter.length), [{ bool: { should: fields.map(field => ({ range: { [field]: { gte: result.evidence.globalBounds.threshold } } })), minimum_should_match: 1 } }]);
  }
  const closed = trace.at(-1); assert.equal(closed.route, '_search/point_in_time'); assert.equal(closed.request.method, 'DELETE');
  assert.deepEqual(new Set(closed.request.body.pit_id), pits);
  assert.ok([...pits].every(id => closed.response.body.pits.some(item => item.pit_id === id && item.successful)));
  const witness = closed.response.transport;
  assert.equal(witness?.kind, 'favorite-pooled-pit-delete'); assert.equal(witness.version, 1); assert.equal(witness.attempts, 1); assert.equal(typeof witness.reusedSocket, 'boolean');
  assert.equal(result.evidence.transport.nativeDeleteRequests, 1); assert.equal(result.evidence.transport.nativeDeleteResponses, 1); assert.equal(result.evidence.transport.attempts, 1);
  assert.equal(result.evidence.transport.reusedConnections, Number(witness.reusedSocket));
  return { positiveThresholdApplied: inspection.positiveThresholdApplied, pooledCleanupCount: 1, reusedConnections: Number(witness.reusedSocket),
    maximaRanges: result.evidence.globalBounds.maximaBounds?.addedRanges ?? 0, duplicateFallback: result.evidence.globalBounds.maximaBounds?.fallback === 'duplicate-utility-fields' };
}

async function snapshot(index, request) {
  const [count, mapping, settings, stats] = await Promise.all([request(index + '/_count'), request(index + '/_mapping'), request(index + '/_settings'), request(index + '/_stats/docs,indexing?level=shards')]);
  assert.equal(count.body._shards.failed, 0); const configured = settings.body[index].settings.index, primary = stats.body.indices[index].primaries;
  const value = { index, count: count.body.count, uuid: configured.uuid, mapping: mapping.body[index].mappings, settings: configured, stats: stats.body };
  value.generation = { count: value.count, uuid: value.uuid, mappingHash: hash(value.mapping), settingsHash: hash(configured), docs: primary.docs,
    indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total }; return value;
}

export async function runFavoritePooledFidelity(config) {
  assert.equal(BASE, 'http://127.0.0.1:19216');
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const save = (name, value) => writeFile(path.join(config.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(config.directory, name), JSON.stringify(value) + '\n');
  const pool = createFavoritePooledDeleteTransport({ base: BASE });
  const result = { schemaVersion: 1, experiment: 'favorite-pooled-fidelity', configuration: config, startedAt: new Date().toISOString(),
    methods: FAVORITE_POOLED_METHODS.map(method => method.id), rows: [], references: [], before: {}, after: {},
    positiveBounds: 0, maximaRanges: 0, reusedCleanups: 0,
    limitations: ['Same numeric OpenSearch objective on545 measured assets; all returned scores/order must match exactly. No capacity or human-accuracy claim.',
      'Existing duplicate-target defect remains in both parent and transport variants; duplicate tests cover preserved fallback behavior.',
      'The optional three-primary index lives on one physical node; this is distributed-shard correctness, not a multi-node resilience test.',
      'All query/PIT operations and scoring happen in OpenSearch; captured complete rankings are offline test evidence only.'] };
  try {
    const sources = await favoriteSourceSnapshot(import.meta.url); result.sourceSnapshotHash = hash(sources); await save('source-snapshot.json', sources);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 }), documents = await loadHueDocuments(256), ids = documents.map(doc => doc.id).sort();
    assert.equal(ids.length, 545); assert.equal(new Set(ids).size, 545);
    result.sourceIdentityHash = verified.identityHash; result.documentsHash = hash(documents);
    const jobs = pooledFidelityJobs(documents), required = createFavoriteUtilityPlan({ requests: jobs }); await save('jobs.json', jobs);
    for (const index of config.indices) {
      const before = await snapshot(index, api); result.before[index] = before;
      assert.equal(before.mapping.properties.id.type, 'keyword'); assert.notEqual(before.mapping.properties.id.doc_values, false);
      if (index === realIndex) assertExecutionIndex(before, { sourceIdentityHash: verified.identityHash, documentsHash: result.documentsHash, plan: createFavoriteUtilityPlan({ presets: controls() }), allPresets: true });
      else {
        const bytes = await readFile(shardReceipt), receipt = JSON.parse(bytes); result.multishardReceiptHash = hash(bytes);
        assert.equal(receipt.passed, true); assert.ok(receipt.finishedAt); assert.deepEqual(before.generation, receipt.after.generation);
        assert.equal(before.settings.number_of_shards, '3'); assert.equal(before.mapping._meta.sourceIdentityHash, verified.identityHash);
        assert.equal(before.mapping._meta.sourceDocumentsHash, result.documentsHash); assert.equal(before.count, 545); assert.equal(before.mapping._meta.numericPoints, true);
        for (const { key } of required.descriptors) { const field = before.mapping.properties.utilities.properties[key]; assert.equal(field?.type, 'float'); assert.notEqual(field.index, false); assert.notEqual(field.doc_values, false); }
      }
    }
    await save('index-before.json', result.before);
    result.expectedExecutions = jobs.reduce((sum, job) => sum + job.limits.length, 0) * config.indices.length * result.methods.length;
    assert.equal(result.expectedExecutions, config.indices.length * 1252);
    for (const job of jobs) {
      const options = { query: job.query, parameters: job.parameters, eligibleIds: job.eligibleIds, excludedIds: job.excludedIds, filter: job.filter };
      const referenceTrace = []; let reference;
      try { reference = await searchFavoriteDocvalueUtilities({ ...options, index: realIndex, limit: 1000, timeoutMs: 10000 }, { request: async (route, settings) => {
        const row = { route, request: { method: settings.method, body: settings.body } }; referenceTrace.push(row);
        try { const response = await api(route, settings); row.response = response; return response; } catch (error) { row.error = errorDetail(error); throw error; }
      } }); } catch (error) { error.referenceTrace = referenceTrace; throw error; }
      if (job.completeCorpus) assert.deepEqual(reference.hits.map(hit => hit.id).sort(), ids);
      if (job.id === 'empty-eligibility') assert.equal(reference.hits.length, 0);
      if (job.zeroScores) { assert.ok(reference.hits.length >= 2); assert.ok(reference.hits.every(hit => hit.score === 0)); assert.deepEqual(reference.hits.map(hit => hit.id), reference.hits.map(hit => hit.id).sort()); }
      await append('references.jsonl', { queryId: job.id, options, body: buildFavoriteDocvalueQuery({ ...options, limit: 1000 }), reference, trace: referenceTrace });
      result.references.push({ queryId: job.id, parameters: job.parameters, count: reference.hits.length });
      for (const index of config.indices) for (const method of result.methods) for (const limit of job.limits) {
        // This is the actual persistent native pool. Passing api here would be
        // rejected by the wrapper's positive cleanup-transport witness.
        const captured = await capturePooledExecution({ ...options, index, method, limit, timeoutMs: 10000 }, { request: pool.request });
        await append('service-traces.jsonl', { queryId: job.id, parameters: job.parameters, index, method, limit, ...captured });
        const comparison = assertSameExecutionRanking(reference.hits.slice(0, limit), captured.result.hits, { exactScores: true });
        const inspection = inspectPooledExecution(captured.result, captured.trace, buildFavoriteUtilityQuery({ ...options, limit }), { method, shards: Number(result.before[index].settings.number_of_shards) });
        result.rows.push({ queryId: job.id, parameters: job.parameters, index, method, limit, ...comparison, ...inspection, evidence: captured.result.evidence });
        result.positiveBounds += Number(inspection.positiveThresholdApplied); result.maximaRanges += Number(inspection.maximaRanges > 0); result.reusedCleanups += inspection.reusedConnections;
      }
      await append('progress.jsonl', { at: new Date().toISOString(), queryId: job.id, completedReferences: result.references.length, completedExecutions: result.rows.length });
    }
    for (const index of config.indices) { result.after[index] = await snapshot(index, api); assert.deepEqual(result.after[index].generation, result.before[index].generation); }
    await save('index-after.json', result.after); result.transport = pool.snapshot();
    assert.equal(result.transport.nativeDeleteCompleted, result.expectedExecutions); assert.equal(result.transport.nativeDeleteFailed, 0); assert.ok(result.transport.reusedSockets > 0);
    assert.equal(result.reusedCleanups, result.transport.reusedSockets); assert.equal(result.rows.length, result.expectedExecutions); assert.equal(result.references.length, jobs.length);
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash);
    result.finishedAt = new Date().toISOString(); result.passed = true; await save('fidelity.json', result); return result;
  } catch (error) {
    result.error = errorDetail(error); result.interruptedAt = new Date().toISOString(); result.transport = pool.snapshot();
    if (error.executionTrace) await save('failure-trace.json', { options: error.executionOptions, trace: error.executionTrace, evidence: error.evidence });
    if (error.referenceTrace) await save('failure-reference-trace.json', error.referenceTrace);
    await save('failure.json', result); throw error;
  } finally { await pool.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoritePooledFidelity(pooledFidelityConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ passed: result.passed, comparisons: result.rows.length, pooledCleanups: result.transport.nativeDeleteCompleted, reusedCleanups: result.reusedCleanups }));
}
