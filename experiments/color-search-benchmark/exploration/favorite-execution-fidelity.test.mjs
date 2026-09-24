import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFavoriteUtilityPlan, buildFavoriteUtilityQuery, favoriteUtilityReference } from './favorite-utilities.mjs';
import { favoriteCompiledMapping } from './favorite-compiled-index.mjs';
import { hash } from './service.mjs';
import {
  executionFidelityConfiguration, assertSameExecutionRanking, numericExecutionOracle, inspectBoundedExecution,
  captureFavoriteExecution, filteredExecutionCases, duplicateExecutionCases, assertExecutionIndex, runFavoriteExecutionFidelity,
} from './favorite-execution-fidelity.mjs';

const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const response = hits => ({ wallMs: 1, body: { took: 1, timed_out: false, _shards: { failed: 0 }, hits: { hits } } });
const scored = hits => response(hits.map(([id, score]) => ({ fields: { id: [id] }, _score: score })));

test('execution config selects the dedicated points index and rejects unsafe output reuse paths', () => {
  assert.deepEqual(executionFidelityConfiguration(['--directory', '/tmp/execution-fidelity']), {
    directory: '/tmp/execution-fidelity', index: 'color-exploration-favorite-points-real-v2', allPresets: true,
  });
  assert.equal(executionFidelityConfiguration(['--directory', '/tmp/a', '--favorite-only']).allPresets, false);
  for (const args of [[], ['--directory'], ['--directory', '/'], ['--directory', process.cwd()],
    ['--directory', process.cwd() + '/output'], ['--directory', '/tmp/a', '--index', 'unsafe'], ['--unknown', 'value']]) {
    assert.throws(() => executionFidelityConfiguration(args));
  }
});

test('ranking comparison allows only float32-equivalent transport differences and retains exact ties', () => {
  const expected = [{ id: 'a', score: .7123133 }, { id: 'b', score: .7123133 }, { id: 'c', score: 0 }];
  const transport = expected.map(hit => ({ ...hit, score: Math.fround(hit.score) }));
  const compared = assertSameExecutionRanking(expected, transport);
  assert.equal(compared.float32ScoresIdentical, true); assert.equal(compared.transportScoresIdentical, false);
  assert.throws(() => assertSameExecutionRanking(expected, transport, { exactScores: true }));
  assert.throws(() => assertSameExecutionRanking(expected, [transport[1], transport[0], transport[2]]));
  assert.throws(() => assertSameExecutionRanking(expected, transport.map(hit => ({ ...hit, score: hit.score + .0001 }))));
  assert.equal(assertSameExecutionRanking([], []).count, 0);
});

test('numeric oracle reconstructs actual query terms for repeated, zero and mixed targets', () => {
  for (const query of [red,
    { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#ff0000', percent: 50 }] },
    { mode: 'proportions', targets: [{ color: '#00ff00', percent: 0 }, { name: 'dark', percent: 40 }] }]) {
    for (const qualityInfluence of [0, .5, 1]) for (const cutoffBlendExponent of [0, 1, 3]) {
      const parameters = { qualityInfluence, cutoffBlendExponent };
      const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] }), body = buildFavoriteUtilityQuery({ query, parameters });
      const document = { id: 'a', ...Object.fromEntries(plan.measurementFields.map((field, i) => [field, field.startsWith('cov_') ? [0, 10000, 3210][i % 3] : Math.fround(.65)])) };
      assert.equal(numericExecutionOracle(document, plan, body), favoriteUtilityReference(document, query, { parameters }));
    }
  }
});

test('trace capture follows the actual sorted service path and keeps raw sort-value evidence', async () => {
  const calls = [];
  const request = async (route, options) => {
    calls.push({ route, ...options });
    return response([{ _id: 'a', _score: options.body.track_scores ? .8 : null, sort: [Math.fround(.8), 'a'] }]);
  };
  const fast = await captureFavoriteExecution('favorite-utility-sorted', { index: 'color-exploration-test', query: red }, { request });
  assert.equal(fast.result.hits[0].score, Math.fround(.8));
  assert.equal(fast.trace.length, 1); assert.equal(fast.trace[0].request.body.track_scores, false);
  assert.deepEqual(fast.trace[0].response.body.hits.hits[0].sort, [Math.fround(.8), 'a']);
  const control = await captureFavoriteExecution('favorite-utility-sorted-scored', { index: 'color-exploration-test', query: red }, { request });
  assert.equal(control.result.hits[0].score, .8); assert.equal(control.trace[0].request.body.track_scores, true);
});

test('failed execution carries raw service trace for the immutable failure artifact', async () => {
  await assert.rejects(captureFavoriteExecution('favorite-utility-sorted', { index: 'color-exploration-test', query: red }, {
    request: async () => response([{ _id: 'invalid', _score: null, sort: [null] }]),
  }), error => {
    assert.equal(error.executionMethod, 'favorite-utility-sorted');
    assert.equal(error.executionTrace.length, 1);
    assert.equal(error.executionTrace[0].response.body.hits.hits[0]._id, 'invalid');
    return true;
  });
});

test('bounded trace proves global final ranges and records actual service IDs outside the seeds', async () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#00ff00', percent: 50 }] };
  const queue = [scored([['a', null], ['b', null]]), scored([['c', null], ['b', null]]),
    scored([['b', .8], ['a', .7]]), scored([['global-winner', .9], ['b', .8]])];
  const request = async (route, options) => {
    if (route.includes('/_search/point_in_time?')) return { wallMs: 1, body: { pit_id: 'snapshot', _shards: { failed: 0 } } };
    if (options.method === 'DELETE') return { wallMs: 1, body: { pits: [{ pit_id: 'snapshot', successful: true }] } };
    assert.ok(queue.length); return queue.shift();
  };
  const options = { index: 'color-exploration-test', query, limit: 2, excludedIds: ['excluded'], filter: { term: { cohort: 'real' } } };
  const { result, trace } = await captureFavoriteExecution('favorite-utility-bounded', options, { request });
  const evidence = inspectBoundedExecution(result, trace, buildFavoriteUtilityQuery(options));
  assert.equal(evidence.positiveThresholdApplied, true); assert.equal(evidence.searchStageCount, 4);
  assert.equal(evidence.stageCount, 6); assert.deepEqual(evidence.finalServiceHitIds, ['global-winner', 'b']);
  assert.equal(trace[0].response.body.pit_id, 'snapshot'); assert.equal(trace.at(-1).request.method, 'DELETE');
  const tampered = structuredClone(trace);
  tampered.at(-2).request.body.query.bool.filter.at(-1).bool.should = [{ ids: { values: ['b'] } }];
  assert.throws(() => inspectBoundedExecution(result, tampered, buildFavoriteUtilityQuery(options)), /global numeric ranges/);
});

test('representative cases include combined metadata restrictions, empty eligibility and natural zero ties', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const documents = Array.from({ length: 30 }, (_, i) => ({ id: 'doc-' + String(i).padStart(2, '0'), cohort: i % 2 ? 'real' : 'fixture',
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? 0 : .5])) }));
  const cases = filteredExecutionCases(documents);
  assert.equal(cases.length, 14);
  assert.ok(cases.some(item => item.filter?.term?.cohort));
  assert.ok(cases.some(item => item.eligibleIds?.length && item.excludedIds?.length));
  assert.deepEqual(cases.find(item => item.id === 'empty-eligibility').eligibleIds, []);
  assert.equal(cases.find(item => item.id === 'zero-score-ties').eligibleIds.length, documents.length);
});

test('duplicate diagnostics include literal duplicates and distinct hex colors resolving to one anchor', () => {
  const cases = duplicateExecutionCases();
  assert.equal(cases.length, 2);
  for (const item of cases) {
    assert.equal(item.duplicateDiagnostic, true);
    assert.equal(new Set(item.resolvedUtilityKeys).size, 1);
    assert.deepEqual(item.query.targets.map(target => target.percent), [50, 50]);
    assert.deepEqual(item.equivalentSingleTarget.targets, [item.query.targets[0]]);
  }
  assert.equal(cases[0].query.targets[0].color, cases[0].query.targets[1].color);
  assert.notEqual(cases[1].query.targets[0].color, cases[1].query.targets[1].color);
});

test('index validation requires complete numeric points, known source and the requested presets', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const mapping = favoriteCompiledMapping(plan, { encodings: ['numeric'], numericPoints: true }).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-utilities', utilityDefinitionVersion: 2, numericPoints: true,
    mode: 'real', scope: 'full', count: 545, sourceIdentityHash: 'source', sourceDocumentsHash: 'documents',
    encodings: ['numeric'], planHash: hash(plan), presets: 'all' };
  const snapshot = { count: 545, uuid: 'id', mapping }, options = { sourceIdentityHash: 'source', documentsHash: 'documents', plan };
  assert.doesNotThrow(() => assertExecutionIndex(snapshot, options));
  const defaultsOmitted = structuredClone(snapshot);
  for (const field of Object.values(defaultsOmitted.mapping.properties.utilities.properties)) { delete field.index; delete field.doc_values; }
  assert.doesNotThrow(() => assertExecutionIndex(defaultsOmitted, options));
  for (const changes of [{ numericPoints: false }, { sourceIdentityHash: 'wrong' }, { presets: 'favorite' }, { scope: 'projection' }, { encodings: ['rank18'] }]) {
    const altered = structuredClone(snapshot); Object.assign(altered.mapping._meta, changes);
    assert.throws(() => assertExecutionIndex(altered, options));
  }
  const noPoints = structuredClone(snapshot); noPoints.mapping.properties.utilities.properties[plan.descriptors[0].key].index = false;
  assert.throws(() => assertExecutionIndex(noPoints, options));
});

test('existing evidence directories are rejected before service access', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'favorite-execution-fidelity-'));
  try { await assert.rejects(runFavoriteExecutionFidelity({ directory }), /EEXIST/); assert.deepEqual(await readdir(directory), []); }
  finally { await rm(directory, { force: true, recursive: true }); }
});
