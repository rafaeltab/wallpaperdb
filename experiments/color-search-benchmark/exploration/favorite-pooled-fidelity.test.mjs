import test from 'node:test';
import assert from 'node:assert/strict';
import { pooledFidelityConfiguration, pooledFidelityJobs, capturePooledExecution, inspectPooledExecution } from './favorite-pooled-fidelity.mjs';
import { FAVORITE_POOLED_METHODS } from './favorite-pooled-utilities.mjs';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery } from './favorite-utilities.mjs';

test('default covers both preserved real indexes; invalid/output/worktree options fail', () => {
  const config = pooledFidelityConfiguration(['--directory', '/tmp/new-pooled-fidelity']);
  assert.equal(config.indices.length, 2); assert.equal(config.indices[1], 'color-exploration-favorite-multishard-real-v1');
  assert.equal(pooledFidelityConfiguration(['--directory', '/tmp/x', '--three-shards', 'false']).indices.length, 1);
  for (const args of [[], ['--directory', process.cwd()], ['--directory', '/tmp/x', '--three-shards', 'maybe'], ['--directory', '/tmp/x', '--index', 'production']]) assert.throws(() => pooledFidelityConfiguration(args));
});

test('reused626-case suite covers nine presets, full rankings, top-k, metadata, empty and duplicate cases', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } }] });
  const docs = Array.from({ length: 30 }, (_, i) => ({ id: 'doc-' + i, cohort: 'real', ...Object.fromEntries(plan.measurementFields.map(key => [key, key.startsWith('cov_') ? 0 : .5])) }));
  const jobs = pooledFidelityJobs(docs);
  assert.equal(jobs.length, 160); assert.equal(jobs.reduce((n, job) => n + job.limits.length, 0), 626);
  assert.equal(jobs.filter(job => job.duplicateDiagnostic).length, 2); assert.ok(jobs.some(job => job.zeroScores));
  assert.ok(jobs.some(job => job.id === 'empty-eligibility')); assert.ok(jobs.some(job => job.eligibleIds && job.excludedIds));
});

async function capture(method) {
  const options = { method, index: 'color-exploration-test', query: { mode: 'vibe', targets: [{ color: '#ff0000' }] }, limit: 1 };
  const shards = { total: 3, successful: 3, failed: 0 };
  const request = async (route, settings) => route.includes('point_in_time?') ? { body: { pit_id: 'one', _shards: shards } }
    : settings.method === 'DELETE' ? { body: { pits: settings.body.pit_id.map(pit_id => ({ pit_id, successful: true })) }, transport: { kind: 'favorite-pooled-pit-delete', version: 1, attempts: 1, reusedSocket: true } }
      : { body: { pit_id: 'two', _shards: shards, hits: { hits: [{ fields: { id: ['x'] }, _score: .8, sort: [.8, 'x'] }] } } };
  return { options, ...await capturePooledExecution(options, { request }) };
}

test('inspection binds actual pooled cleanup, three-shard searches, scoring and PIT lifecycle for both methods', async () => {
  for (const method of FAVORITE_POOLED_METHODS) {
    const { options, result, trace } = await capture(method.id), numeric = buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' });
    const checked = inspectPooledExecution(result, trace, numeric, { method: method.id, shards: 3 });
    assert.equal(checked.pooledCleanupCount, 1); assert.equal(checked.reusedConnections, 1);
    for (const mutate of [
      rows => { delete rows.at(-1).response.transport; },
      rows => { rows[1].response.body._shards.successful = 2; },
      rows => { rows[1].request.body.query.bool.must = [{ match_all: {} }]; },
      rows => { rows.at(-2).request.body.query.bool.filter.push({ ids: { values: ['x'] } }); },
      rows => { rows.at(-1).response.body.pits[0].successful = false; },
    ]) { const changed = structuredClone(trace); mutate(changed); assert.throws(() => inspectPooledExecution(result, changed, numeric, { method: method.id, shards: 3 })); }
  }
});

test('failed transport retains captured failing stage and original nested cause', async () => {
  const cause = Object.assign(Error('reset'), { code: 'ECONNRESET' });
  await assert.rejects(capturePooledExecution({ method: FAVORITE_POOLED_METHODS[0].id, index: 'color-exploration-test', query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } },
    { request: async () => { throw new TypeError('fetch failed', { cause }); } }), error => {
    assert.equal(error.cause.code, 'ECONNRESET'); assert.equal(error.executionTrace.length, 1); assert.match(error.executionTrace[0].route, /point_in_time/); return true;
  });
});
