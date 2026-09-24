import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { auditFavoriteOptimization } from './favorite-optimization-audit.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const h = value => hash(canonical(value));
async function fixture(t, { failure = false, complete = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'favorite-opt-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sources = { 'exploration/example.mjs': 'export const fixed = true;\n' };
  const candidate = { id: 'example', method: 'favorite-fused-script', index: 'color-exploration-audit', parameters: { bucketCount: 256 } };
  const item = { ...candidate, id: 'example:red', candidateId: 'example', queryId: 'red', selectivity: 'all', query: { text: 'red' } };
  const mapping = { properties: { id: { type: 'keyword' } }, _meta: { identity: 'fixture' } };
  const state = { index: candidate.index, count: 100000, uuid: 'uuid-fixture', mapping, mappingHash: h(mapping), metadataHash: h(mapping._meta), indexing: { index_total: 100000, delete_total: 0 } };
  const body = { size: 20, query: { match_all: {} }, timeout: '950ms' };
  const plan = { schemaVersion: 1, experiment: 'favorite-optimization-benchmark', configuration: { count: 100000, requests: 32, durationMs: 10000, concurrencies: [1, 4], selectivities: ['all'] },
    configHash: hash('{}'), candidates: [candidate], cases: [item], queryPlans: [{ caseId: item.id, candidateId: candidate.id, index: candidate.index, body, bodyHash: hash(body) }],
    sourceSnapshotHash: hash(sources), sourceHashes: { 'exploration/example.mjs': hash(sources['exploration/example.mjs']) },
    indexFingerprints: [{ index: state.index, count: state.count, uuid: state.uuid, mappingHash: state.mappingHash, metadataHash: state.metadataHash, indexing: state.indexing }] };
  const hits = Array.from({ length: 20 }, (_, i) => ({ id: 'id' + String(i).padStart(2, '0'), score: 1 - i * .01 }));
  const common = { count: 100000, caseId: item.id, candidateId: candidate.id, method: candidate.method, index: candidate.index, parameters: candidate.parameters, queryId: item.queryId, selectivity: 'all' };
  const warmup = { ...common, phase: 'warmup', concurrency: 1, ordinal: 0, profileId: item.id + ':warmup', requestId: item.id + ':warmup:0', elapsedMs: 100, serviceTookMs: 90, hitCount: 20, hitsHash: hash(hits), hits, overOneSecond: false };
  const raw = [warmup], profiles = [];
  for (const concurrency of (failure ? [1] : [1, 4])) {
    const id = '100000:' + item.id + ':c' + concurrency;
    const trials = Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, elapsedMs: failure && ordinal === 0 ? 1001 : 100, ...(failure && ordinal === 0 ? { error: 'timeout', hitCount: 0 } : { serviceTookMs: 90, hitCount: 20 }), overOneSecond: failure && ordinal === 0 }));
    raw.push(...trials.map(row => ({ ...common, phase: 'timed', concurrency, profileId: id, requestId: id + ':' + row.ordinal, ...row, ...(!row.error ? { hitsHash: hash(hits) } : {}) })));
    profiles.push({ id, ...common, concurrency, elapsedMs: 10010, minimumRequests: 32, requestedDurationMs: 10000, requests: 32, p50Ms: 100, p95Ms: 100, p99Ms: 100, maxMs: failure ? 1001 : 100, errors: Number(failure), overOneSecond: Number(failure), warmupErrors: 0, warmupOverOneSecond: 0,
      strictTimedFailures: Number(failure), strictWarmupFailures: 0, strictFailures: Number(failure), timedRequestsViable: !failure, viableAtTestedLoad: !failure, throughputPerSecond: 32 / 10.01, successfulThroughputPerSecond: (failure ? 31 : 32) / 10.01, trials });
  }
  const { hits: omitted, ...compactWarmup } = warmup;
  const result = { ...plan, planHash: hash(plan), startedAt: '2026-09-23T01:00:00.000Z', ...(complete ? { finishedAt: '2026-09-23T01:01:00.000Z', indexAfter: [state] } : {}), indexBefore: [state], profiles, warmups: [{ caseId: item.id, candidateId: candidate.id, count: 100000, trials: [compactWarmup] }],
    skipped: failure ? [{ caseId: item.id, concurrencies: [4], reason: 'Strict warmup/timed failure prevents higher load.' }] : [], settling: [{ settled: true }], instrumentation: [] };
  const save = async () => {
    const requests = raw.map(row => JSON.stringify(row) + '\n').join('');
    result.recording = { totalRows: raw.length, totalBytes: Buffer.byteLength(requests) };
    await Promise.all([writeFile(path.join(directory, 'plan.json'), JSON.stringify(plan)), writeFile(path.join(directory, 'source-snapshot.json'), JSON.stringify(sources)), writeFile(path.join(directory, 'benchmark.json'), JSON.stringify(result)), writeFile(path.join(directory, 'requests.jsonl'), requests)]);
  };
  await save();
  return { directory, plan, result, sources, raw, save };
}

test('audits a complete campaign without importing its scorer or summary code', async t => {
  const f = await fixture(t), audit = await auditFavoriteOptimization(f.directory);
  assert.equal(audit.integrityPassed, true, JSON.stringify(audit.errors));
  assert.equal(audit.complete, true); assert.equal(audit.accepted, true);
  assert.deepEqual(audit.totals, { timedRequests: 64, warmupRequests: 1, timedErrors: 0, timedOverOneSecond: 0, timedStrictFailures: 0, warmupErrors: 0, warmupOverOneSecond: 0, warmupStrictFailures: 0 });
});
test('counts the union of error and one-second failures once', async t => {
  const f = await fixture(t, { failure: true }), audit = await auditFavoriteOptimization(f.directory);
  assert.equal(audit.integrityPassed, true, JSON.stringify(audit.errors));
  assert.equal(audit.totals.timedErrors, 1); assert.equal(audit.totals.timedOverOneSecond, 1); assert.equal(audit.totals.timedStrictFailures, 1);
  assert.equal(audit.failedProfiles, 1); assert.equal(audit.accepted, true, 'Valid evidence can describe a failed performance profile.');
});
test('detects edited summaries, missing request counts, short duration and omitted concurrency', async t => {
  const f = await fixture(t); f.result.profiles[0].p95Ms = 0; f.result.profiles[0].minimumRequests = 31; f.result.profiles[0].elapsedMs = 9999; f.result.profiles.pop(); await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  assert.equal(audit.integrityPassed, false);
  for (const pattern of ['p95Ms', 'minimumRequests', 'duration', 'unaccounted', 'checkpoint']) assert.ok(audit.errors.some(error => error.includes(pattern)), pattern);
});
test('checks raw parity, duplicate request identities and successful hit hashes', async t => {
  const f = await fixture(t); f.raw[1].elapsedMs = 101; f.raw.push(f.raw[1]); f.raw[0].hitsHash = 'bad'; await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  for (const pattern of ['parity', 'duplicate', 'hitsHash']) assert.ok(audit.errors.some(error => error.includes(pattern)), pattern);
});
test('checks source, query and before/after mapping fingerprints independently', async t => {
  const f = await fixture(t); f.sources['exploration/example.mjs'] += '// changed'; f.result.indexAfter = structuredClone(f.result.indexBefore); f.result.indexAfter[0].mapping.properties.id.type = 'text'; f.plan.queryPlans[0].body.size = 19; await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  for (const pattern of ['source', 'mappingHash', 'bodyHash', 'planHash']) assert.ok(audit.errors.some(error => error.includes(pattern)), pattern);
});
test('keeps interrupted campaign rows as pending evidence, never declares complete', async t => {
  const f = await fixture(t, { complete: false }); f.result.profiles.pop(); await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  assert.equal(audit.integrityPassed, true, JSON.stringify(audit.errors));
  assert.equal(audit.complete, false); assert.equal(audit.accepted, false);
  assert.equal(audit.pendingTimedRows, 32);
});
test('requires explicit justified skips and rejects running higher load after failure', async t => {
  const f = await fixture(t, { failure: true }); f.result.skipped = []; await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('unaccounted')));
});
test('rejects non-finite recorded latency and threshold flags inconsistent with latency', async t => {
  const f = await fixture(t); f.raw[1].elapsedMs = null; f.raw[2].overOneSecond = true; await f.save();
  const audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('latency')));
  assert.ok(audit.errors.some(error => error.includes('overOneSecond')));
});
test('checks recorder bytes/rows and includes separately recorded resources', async t => {
  const f = await fixture(t); await writeFile(path.join(f.directory, 'resources.jsonl'), JSON.stringify({ profileId: f.result.profiles[0].id, at: '2026-09-23T01:00:01Z', nodes: {} }) + '\n');
  const audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('recording.totalRows')));
  assert.ok(audit.errors.some(error => error.includes('recording.totalBytes')));
});
test('instrumentation counters must match the raw profile tree', async t => {
  const f = await fixture(t), query = f.plan.queryPlans[0];
  f.plan.configuration.instrumentationServiceTimeoutMs = 30000;
  f.plan.configuration.instrumentationClientTimeoutMs = 35000;
  f.result.planHash = hash(f.plan);
  const rawNode = { type: 'ScriptScoreQuery', description: 'example', time_in_nanos: 123, breakdown: { score_count: 100000, score: 100 } };
  f.result.instrumentation = [{ caseId: query.caseId, candidateId: query.candidateId, index: query.index, excludedFromTiming: true, excludedFromViability: true,
    serverTimeoutMs: 30000, clientTimeoutMs: 35000, bodyHash: hash({ ...query.body, timeout: '30000ms', profile: true }), partial: false,
    body: { timed_out: false, _shards: { failed: 0 }, profile: { shards: [{ id: 'shard', searches: [{ query: [rawNode], collector: [] }] }] } },
    summary: { queryNodes: [{ shard: 'shard', search: 0, queryPath: [0], type: rawNode.type, description: rawNode.description, timeInNanos: 123, counts: { score_count: 99999 }, breakdown: rawNode.breakdown }], collectors: [] } }];
  await f.save(); const audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('instrumentation query counters')));
});

test('a completed workload with failed final stats remains auditable, retained and unqualified', async t => {
  const f = await fixture(t, { complete: false });
  f.result.profiles.pop(); f.raw.splice(33);
  const profile = f.result.profiles[0];
  Object.assign(profile, { measurementComplete: true, finalResourceCollectionComplete: false, after: null, cpuMs: null, clientCpuMs: null,
    viableAtTestedLoad: false, resourceCollectionError: { error: 'fetch failed', errorDetails: { cause: { code: 'ECONNRESET' } } }, resourceErrors: 1 });
  f.result.interruption = { at: '2026-09-23T01:01:00.000Z', error: 'fetch failed' };
  await f.save();
  let audit = await auditFavoriteOptimization(f.directory);
  assert.equal(audit.integrityPassed, true, JSON.stringify(audit.errors)); assert.equal(audit.accepted, false);
  assert.equal(audit.pendingTimedRows, 0); assert.equal(audit.failedProfiles, 1); assert.equal(audit.incompleteResourceProfiles, 1);
  assert.equal(audit.totals.timedRequests, 32);
  profile.viableAtTestedLoad = true; await f.save(); audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('viableAtTestedLoad')));
  profile.viableAtTestedLoad = false; profile.cpuMs = 1; await f.save(); audit = await auditFavoriteOptimization(f.directory);
  assert.ok(audit.errors.some(error => error.includes('resource')));
});
