// THROWAWAY correctness campaign. Three logical shards on the isolated real
// service; all scores and global selection remain inside OpenSearch.
import assert from 'node:assert/strict';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, BASE, hash, safeIndexName } from './service.mjs';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { FAVORITE_PARAMETERS, loadFavoriteScaleInputs } from './favorite-scale-corpus.mjs';
import { loadHueDocuments } from './hue-index.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { createFavoriteUtilityPlan, favoriteUtilityMapping, toFavoriteUtilityDocument, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { favoriteUtilityBatcher, validateUtilityBulk } from './favorite-utility-index.mjs';
import { assertFavoriteUtilityMapping } from './favorite-utility-mapping.mjs';
import { duplicateExecutionCases, filteredExecutionCases, assertSameExecutionRanking, inspectBoundedExecution } from './favorite-execution-fidelity.mjs';
import { inspectMaximaExecution } from './favorite-maxima-fidelity.mjs';
import { searchFavoriteDocvalueUtilities } from './favorite-docvalue-fetch.mjs';
import { executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';

const repository = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const referenceIndex = 'color-exploration-favorite-points-real-v2';
const favorite = { ...FAVORITE_PARAMETERS, bucketCount: 256 };
export const MULTISHARD_METHODS = Object.freeze(['favorite-utility-numeric-docvalues', 'favorite-utility-sorted-docvalues', 'favorite-utility-bounded', 'favorite-utility-maxima-bounded']);

export function multishardConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    assert.ok(['--directory', '--index'].includes(key) && value && !value.startsWith('--') && !Object.hasOwn(values, key), 'Unknown, repeated or missing option.');
    values[key] = value;
  }
  assert.ok(values['--directory'], 'Provide a new external directory.');
  const directory = path.resolve(values['--directory']);
  assert.ok(directory !== path.parse(directory).root && directory !== repository && !directory.startsWith(repository + path.sep), 'Use an external directory.');
  return { directory, index: safeIndexName(values['--index'] ?? 'color-exploration-favorite-multishard-real-v1'), base: 'http://127.0.0.1:19216' };
}

export function multishardRequests() {
  return [
    ...[0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].flatMap(cutoffBlendExponent => FIDELITY_QUERIES.map(item => ({
      ...item, parameters: { ...favorite, qualityInfluence, cutoffBlendExponent }, completeCorpus: true })))),
    ...duplicateExecutionCases().map(item => ({ ...item, parameters: favorite, completeCorpus: true })),
  ];
}

export function multishardMapping(plan, metadata) {
  const mapping = favoriteUtilityMapping(plan, { source: false, shards: 3, encodings: ['numeric'] });
  for (const field of Object.values(mapping.mappings.properties.utilities.properties)) delete field.index; // Default true enables numeric points.
  mapping.mappings._meta = metadata;
  return mapping;
}

export function validateMultishardDistribution(shards, expectedIds) {
  assert.equal(shards.length, 3); assert.ok(shards.every(ids => ids.length > 0));
  const ids = shards.flat(); assert.equal(new Set(ids).size, ids.length, 'Document appeared in more than one shard.');
  assert.deepEqual([...ids].sort(), [...expectedIds].sort(), 'Shard inventory differs from corpus.');
  return shards.map(ids => ids.length);
}

export async function writeMultishardDocuments({ index, documents, request, record }) {
  safeIndexName(index);
  let indexed = 0, bulkCount = 0;
  const batcher = favoriteUtilityBatcher({ maximumBytes: 1024 * 1024 });
  const send = async batch => {
    const row = { ordinal: bulkCount++, ids: batch.ids, bodyHash: hash(batch.body), bytes: batch.bytes };
    try {
      const response = await request(index + '/_bulk', { method: 'POST', body: batch.body });
      row.response = response; indexed += validateUtilityBulk(response.body, batch); row.acknowledged = true;
    } catch (error) { row.error = String(error.stack ?? error); throw error; }
    finally { await record(row); }
  };
  for (const document of documents) for (const batch of batcher.add(document)) await send(batch);
  for (const batch of batcher.finish()) await send(batch);
  return { indexed, bulkCount };
}

export async function captureMultishardExecution(method, options, { request = api, shards = 3 } = {}) {
  assert.ok(MULTISHARD_METHODS.includes(method));
  const trace = [];
  const capture = async (route, settings = {}) => {
    const row = { route, request: { method: settings.method ?? 'GET', body: settings.body, timeoutMs: settings.timeoutMs } }; trace.push(row);
    try {
      row.response = await request(route, settings);
      if (route.includes('_search?') || route.includes('/_search/point_in_time?')) {
        const state = row.response.body._shards;
        assert.equal(state?.total, shards, 'Expected three global shards (or the explicit reference shard count).');
        assert.equal(state.successful, shards); assert.equal(state.failed, 0);
      }
      return row.response;
    } catch (error) { row.error = String(error.stack ?? error); throw error; }
  };
  try {
    const result = method === 'favorite-utility-bounded' ? await executeFavoriteBoundedUtilitySearch({ ...options, request: capture })
      : method === 'favorite-utility-maxima-bounded' ? await executeFavoriteMaximaBoundedUtilitySearch({ ...options, request: capture })
        : await searchFavoriteDocvalueUtilities({ ...options, method }, { request: capture });
    return { result, trace };
  } catch (error) { error.executionTrace = trace; throw error; }
}

async function snapshot(index, request) {
  const [count, mapping, settings, stats] = await Promise.all([request(index + '/_count'), request(index + '/_mapping'), request(index + '/_settings'), request(index + '/_stats/docs,indexing?level=shards')]);
  const configured = settings.body[index].settings.index, primary = stats.body.indices[index].primaries;
  const result = { index, count: count.body.count, uuid: configured.uuid, mapping: mapping.body[index].mappings, settings: configured, stats: stats.body };
  result.generation = { count: result.count, uuid: result.uuid, mappingHash: hash(result.mapping), settingsHash: hash(configured), docs: primary.docs,
    indexingTotal: primary.indexing.index_total, deleteTotal: primary.indexing.delete_total };
  return result;
}

function validatePitTrace(trace) {
  let pit = trace[0].response.body.pit_id; assert.ok(pit);
  const pits = new Set([pit]);
  for (const call of trace.filter(row => row.route.startsWith('_search?'))) {
    assert.equal(call.request.body.pit.id, pit);
    pit = call.response.body.pit_id ?? pit; pits.add(pit);
  }
  const closed = trace.at(-1); assert.equal(closed.request.method, 'DELETE');
  assert.deepEqual(new Set(closed.request.body.pit_id), pits);
  assert.ok([...pits].every(id => closed.response.body.pits.some(entry => entry.pit_id === id && entry.successful)));
}

export async function runMultishardFidelity(config) {
  assert.equal(BASE, config.base, 'This campaign may use only the real19216 service.');
  const request = (route, options = {}) => api(route, { ...options, base: config.base });
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const save = (name, value) => writeFile(path.join(config.directory, name), JSON.stringify(value, null, 2), { flag: 'wx' });
  const append = (name, value) => appendFile(path.join(config.directory, name), JSON.stringify(value) + '\n');
  const result = { schemaVersion: 1, experiment: 'favorite-multishard-fidelity', configuration: config, startedAt: new Date().toISOString(),
    methods: MULTISHARD_METHODS, rows: [], positiveBoundExecutions: 0, maximaRangeExecutions: 0, duplicateFallbacks: 0,
    limitations: ['Three primary shards and zero replicas on one physical node test shard reduction, not multi-node failure or network behavior.',
      'Correctness only; full-million indexing and other correctness work may overlap. No performance or capacity inference.',
      'Same retained545 assets and189 projected utility fields, not a full utility bank or independent large corpus.',
      'The preserved duplicate-target score defect remains; duplicate cases test parity and conservative fallback.'] };
  try {
    const source = await favoriteSourceSnapshot(import.meta.url); result.sourceSnapshotHash = hash(source); await save('source-snapshot.json', source);
    const verified = await loadFavoriteScaleInputs({ scope: 'full', bucketCount: 256 }), measurements = await loadHueDocuments(256);
    assert.equal(measurements.length, 545); const ids = measurements.map(d => d.id).sort(); assert.equal(new Set(ids).size, 545);
    const valuesReceipt = verified.source.receipts.find(row => row.bucketCount === 256);
    assert.equal(hash(measurements.map(d => ({ id: d.id, hash: hash(d) }))), valuesReceipt.valuesHash);
    result.sourceIdentityHash = verified.identityHash; result.measurementsHash = hash(measurements);
    const requests = multishardRequests(), filtered = filteredExecutionCases(measurements);
    assert.ok(filtered.some(row => row.zeroScores));
    const jobs = [...requests, ...filtered.map(row => ({ ...row, parameters: favorite, completeCorpus: false }))].map(row => ({ ...row, limits: [20, 3, 545] }));
    const plan = createFavoriteUtilityPlan({ requests: jobs }); result.utilityCount = plan.utilityCount; result.planHash = hash(plan);
    await save('plan.json', plan); await save('jobs.json', jobs);
    const documents = measurements.map(d => toFavoriteUtilityDocument(d, plan, { encodings: ['numeric'] }));
    const serialized = documents.map(d => JSON.stringify(d)).join('\n') + '\n'; result.documentsHash = hash(serialized); result.orderedIdsHash = hash(documents.map(d => d.id));
    await writeFile(path.join(config.directory, 'documents.ndjson'), serialized, { flag: 'wx' });
    const metadata = { experiment: result.experiment, sourceIdentityHash: result.sourceIdentityHash, sourceDocumentsHash: result.measurementsHash,
      planHash: result.planHash, encodedDocumentsHash: result.documentsHash, mode: 'real', scope: 'projection', count: 545, presets: 'all', numericPoints: true, encodings: ['numeric'], utilityDefinitionVersion: 2 };
    const mapping = multishardMapping(plan, metadata); await save('mapping.json', mapping);
    const original = await snapshot(referenceIndex, request);
    assert.equal(original.count, 545); assert.equal(original.settings.number_of_shards, '1');
    assert.equal(original.mapping._meta.sourceDocumentsHash, result.measurementsHash); assert.equal(original.mapping._meta.sourceIdentityHash, verified.identityHash);
    assert.equal(original.mapping._meta.utilityDefinitionVersion, 2); assert.equal(original.mapping._meta.scope, 'full');
    assert.equal(original.mapping._meta.numericPoints, true); assert.equal(original.mapping._meta.presets, 'all');
    for (const descriptor of plan.descriptors) {
      const field = original.mapping.properties.utilities.properties[descriptor.key];
      assert.equal(field?.type, 'float'); assert.notEqual(field.index, false); assert.notEqual(field.doc_values, false);
    }
    result.referenceBefore = original;
    result.creation = await request(config.index, { method: 'PUT', body: mapping }); await save('creation.json', result.creation);
    assert.ok(result.creation.body.acknowledged && result.creation.body.shards_acknowledged);
    Object.assign(result, await writeMultishardDocuments({ index: config.index, documents, request, record: row => append('bulk.jsonl', row) }));
    result.refresh = await request(config.index + '/_refresh', { method: 'POST' });
    result.before = await snapshot(config.index, request); await save('index-before.json', result.before);
    assert.equal(result.before.count, 545); assert.equal(result.before.settings.number_of_shards, '3'); assert.equal(result.before.settings.number_of_replicas, '0');
    assertFavoriteUtilityMapping(result.before.mapping, mapping.mappings);
    const shards = [];
    for (let shard = 0; shard < 3; shard++) {
      // Documented Search API preference restricts this inventory to one shard.
      const response = await request(config.index + '/_search?request_cache=false&preference=_shards:' + shard, { method: 'POST',
        body: { size: 545, _source: false, stored_fields: '_none_', docvalue_fields: ['id'], query: { match_all: {} }, sort: [{ id: 'asc' }] } });
      assert.equal(response.body._shards.total, 1); assert.equal(response.body._shards.failed, 0); assert.equal(response.body.timed_out, false);
      const shardIds = response.body.hits.hits.map(hit => hit.fields.id[0]); shards.push(shardIds); await append('shards.jsonl', { shard, ids: shardIds, response });
    }
    result.shardCounts = validateMultishardDistribution(shards, ids);
    result.physicalNodes = [...new Set(Object.values(result.before.stats.indices[config.index].shards).flat().map(shard => shard.routing.node))];
    result.expectedExecutions = jobs.length * 3 * MULTISHARD_METHODS.length; result.referenceCases = jobs.length;
    for (const job of jobs) {
      const options = { query: job.query, parameters: job.parameters, eligibleIds: job.eligibleIds, excludedIds: job.excludedIds, filter: job.filter, timeoutMs: 10000 };
      const reference = await captureMultishardExecution('favorite-utility-numeric-docvalues', { ...options, index: referenceIndex, limit: 545 }, { request, shards: 1 });
      if (job.completeCorpus) assert.deepEqual(reference.result.hits.map(h => h.id).sort(), ids);
      if (job.zeroScores) assert.ok(reference.result.hits.length >= 2 && reference.result.hits.every(h => h.score === 0));
      await append('references.jsonl', { queryId: job.id, parameters: job.parameters, options, ...reference });
      for (const limit of job.limits) for (const method of MULTISHARD_METHODS) {
        const captured = await captureMultishardExecution(method, { ...options, index: config.index, limit }, { request });
        await append('service-traces.jsonl', { queryId: job.id, parameters: job.parameters, method, limit, ...captured });
        const compared = assertSameExecutionRanking(reference.result.hits.slice(0, limit), captured.result.hits, { exactScores: method !== 'favorite-utility-sorted-docvalues' });
        let bounds;
        if (method.includes('bounded')) {
          validatePitTrace(captured.trace);
          const body = buildFavoriteUtilityQuery({ ...options, limit });
          const inspected = method === 'favorite-utility-maxima-bounded' ? inspectMaximaExecution(captured.result, captured.trace, body) : inspectBoundedExecution(captured.result, captured.trace, body);
          bounds = captured.result.evidence.globalBounds;
          if (bounds.threshold > 0) result.positiveBoundExecutions++;
          if (bounds.maximaBounds?.addedRanges) result.maximaRangeExecutions++;
          if (job.duplicateDiagnostic && bounds.threshold > 0 && method === 'favorite-utility-maxima-bounded') { assert.equal(bounds.maximaBounds.fallback, 'duplicate-utility-fields'); result.duplicateFallbacks++; }
          assert.deepEqual(inspected.finalServiceHitIds, captured.result.hits.map(h => h.id));
        }
        result.rows.push({ queryId: job.id, parameters: job.parameters, method, limit, ...compared, bounds });
      }
      await append('progress.jsonl', { at: new Date().toISOString(), queryId: job.id, executions: result.rows.length });
    }
    result.after = await snapshot(config.index, request); result.referenceAfter = await snapshot(referenceIndex, request);
    assert.deepEqual(result.before.generation, result.after.generation); assert.deepEqual(result.referenceBefore.generation, result.referenceAfter.generation);
    assert.equal(hash(await favoriteSourceSnapshot(import.meta.url)), result.sourceSnapshotHash); assert.equal(result.rows.length, result.expectedExecutions);
    result.passed = true; result.finishedAt = new Date().toISOString(); await save('fidelity.json', result); return result;
  } catch (error) {
    result.error = String(error.stack ?? error); result.interruptedAt = new Date().toISOString();
    if (error.executionTrace) await save('failure-trace.json', error.executionTrace);
    await save('failure.json', result); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runMultishardFidelity(multishardConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ directory: result.configuration.directory, index: result.configuration.index, shardCounts: result.shardCounts, executions: result.rows.length, passed: result.passed }));
}
