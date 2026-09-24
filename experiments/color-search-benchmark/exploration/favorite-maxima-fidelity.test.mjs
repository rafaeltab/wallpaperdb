import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { maximaFidelityConfiguration, maximaFidelityJobs, captureMaximaExecution, inspectMaximaExecution,
  countMaximaCandidates, runFavoriteMaximaFidelity } from './favorite-maxima-fidelity.mjs';
import { buildFavoriteUtilityQuery, createFavoriteUtilityPlan } from './favorite-utilities.mjs';

const index = 'color-exploration-maxima-fidelity-test';
const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const pair = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#00ff00', percent: 50 }] };
const response = hits => ({ wallMs: 1, body: { took: 1, hits: { hits } } });
const scored = values => response(values.map(([id, score]) => ({ fields: { id: [id] }, _score: score })));
const seed = values => response(values.map(([id, utility]) => ({ fields: { id: [id] }, _score: null, sort: [utility, id] })));
async function capturedPair() {
  const queue = [seed([['a', .9], ['b', .8]]), seed([['c', .6], ['e', .595]]),
    scored([['b', .65], ['a', .5]]), scored([['outside-seeds', .69], ['b', .65]])];
  const request = async (route, settings) => {
    if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'snapshot', _shards: { failed: 0 } } };
    if (settings.method === 'DELETE') return { body: { pits: [{ pit_id: 'snapshot', successful: true }] } };
    assert.ok(queue.length); return queue.shift();
  };
  const options = { index, query: pair, limit: 2, excludedIds: ['excluded'], filter: { term: { cohort: 'real' } } };
  return { options, ...await captureMaximaExecution(options, { request }) };
}

test('configuration fixes a scratch index and new external evidence directory', () => {
  const config = maximaFidelityConfiguration(['--directory', '/tmp/new-maxima-fidelity']);
  assert.equal(config.index, 'color-exploration-favorite-points-real-v2');
  for (const args of [[], ['--directory', process.cwd()], ['--directory', '/'], ['--directory', '/tmp/x', '--index', 'production'],
    ['--directory', '/tmp/x', '--directory', '/tmp/y'], ['--directory', '/tmp/x', '--favorite-only']]) assert.throws(() => maximaFidelityConfiguration(args));
});

test('campaign includes all576 main comparisons plus filtered, empty, zero-tie and duplicate cases', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const documents = Array.from({ length: 30 }, (_, i) => ({ id: 'doc-' + String(i).padStart(2, '0'), cohort: 'real',
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? 0 : .5])) }));
  const jobs = maximaFidelityJobs(documents);
  assert.equal(jobs.length, 160); assert.equal(jobs.reduce((sum, row) => sum + row.limits.length, 0), 626);
  assert.equal(jobs.slice(0, 144).reduce((sum, row) => sum + row.limits.length, 0), 576);
  assert.equal(new Set(jobs.slice(0, 144).map(row => row.parameters.qualityInfluence + ':' + row.parameters.cutoffBlendExponent)).size, 9);
  assert.equal(jobs.filter(row => row.duplicateDiagnostic).length, 2);
  assert.ok(jobs.some(row => row.zeroScores)); assert.ok(jobs.some(row => row.id === 'empty-eligibility'));
  assert.ok(jobs.some(row => row.filter && row.id.startsWith('cohort-')));
});

test('inspection binds global maxima, unchanged score/filter clauses, final service order and complete PIT lifecycle', async () => {
  const { options, result, trace } = await capturedPair();
  const checked = inspectMaximaExecution(result, trace, buildFavoriteUtilityQuery(options));
  assert.equal(checked.positiveThresholdApplied, true); assert.ok(checked.bounds.maximaBounds.addedRanges > 0);
  assert.deepEqual(checked.finalServiceHitIds, ['outside-seeds', 'b']); assert.equal(checked.stageCount, 6);
  const mutations = [
    rows => { rows.at(-2).request.body.query.bool.should = []; },
    rows => { rows.at(-2).request.body.query.bool.filter.push({ ids: { values: ['b'] } }); },
    rows => { rows[1].request.body.query.bool.filter = []; },
    rows => { rows[1].request.body.query.bool.must = [{ ids: { values: ['a', 'b'] } }]; },
    rows => { rows.at(-2).request.body.pit.id = 'other'; },
    rows => { rows.at(-1).response.body.pits[0].successful = false; },
    rows => { rows[1].response.body.hits.hits[0].sort[0] = .5; },
  ];
  for (const mutate of mutations) { const changed = structuredClone(trace); mutate(changed); assert.throws(() => inspectMaximaExecution(result, changed, buildFavoriteUtilityQuery(options))); }
});

test('duplicate resolved utility fields must retain the original OR bound without maxima ANDs', async () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#fe0000', percent: 50 }] };
  const queue = [seed([['a', .8], ['b', .7]]), scored([['a', .4], ['b', .35]]), scored([['a', .4], ['b', .35]])];
  const options = { index, query, limit: 2 };
  const capture = await captureMaximaExecution(options, { request: async (route, settings) => {
    if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'snapshot', _shards: { failed: 0 } } };
    if (settings.method === 'DELETE') return { body: { pits: [{ pit_id: 'snapshot', successful: true }] } };
    return queue.shift();
  } });
  const checked = inspectMaximaExecution(capture.result, capture.trace, buildFavoriteUtilityQuery(options));
  assert.equal(checked.bounds.maximaBounds.fallback, 'duplicate-utility-fields'); assert.equal(checked.bounds.maximaBounds.addedRanges, 0);
});

test('candidate counts distinguish original OR pruning from extra maxima pruning and reject partial counts', async () => {
  const { options, result, trace } = await capturedPair(), inspected = inspectMaximaExecution(result, trace, buildFavoriteUtilityQuery(options));
  const calls = [];
  const counts = await countMaximaCandidates(index, inspected, 545, 2, { request: async (route, settings) => {
    calls.push({ route, settings }); return { body: { count: calls.length === 1 ? 100 : 10 } };
  } });
  assert.equal(counts.originalPruned, 445); assert.equal(counts.additionallyPruned, 90); assert.equal(counts.totalPruned, 535);
  assert.equal(counts.trace.length, 2); assert.equal(calls[0].settings.body.query.bool.filter.length, inspected.orFilters.length);
  assert.ok(calls[1].settings.body.query.bool.filter.length > calls[0].settings.body.query.bool.filter.length);
  await assert.rejects(countMaximaCandidates(index, inspected, 545, 2, { request: async () => ({ body: { count: 1 } }) }), /counts/);
  await assert.rejects(countMaximaCandidates(index, inspected, 545, 2, { request: async () => ({ body: { count: 2, _shards: { failed: 1 } } }) }), error => {
    assert.match(error.message, /Partial/); assert.equal(error.countTrace[0].response.body._shards.failed, 1); return true;
  });
});

test('failed search attempts remain in captured evidence and PIT cleanup is retained', async () => {
  let closed = false;
  await assert.rejects(captureMaximaExecution({ index, query: red }, { request: async (route, settings) => {
    if (route.includes('/_search/point_in_time?')) return { body: { pit_id: 'snapshot', _shards: { failed: 0 } } };
    if (settings.method === 'DELETE') { closed = true; return { body: { pits: [{ pit_id: 'snapshot', successful: true }] } }; }
    throw Error('Service failure');
  } }), error => {
    assert.equal(error.executionTrace.length, 3); assert.match(error.executionTrace[1].error, /Service failure/);
    assert.equal(error.executionTrace.at(-1).request.method, 'DELETE'); return true;
  });
  assert.equal(closed, true);
});

test('existing artifact directories fail before service access', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maxima-fidelity-'));
  try {
    await assert.rejects(runFavoriteMaximaFidelity({ directory }, { request: async () => assert.fail('Service access before directory guard.') }), /EEXIST/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
