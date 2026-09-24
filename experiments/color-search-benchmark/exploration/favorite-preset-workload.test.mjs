import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_PRESET_WORKLOAD, favoritePresetId, withFavoritePresets, favoritePresetWarmupOrdinals,
  summarizeFavoritePresetCoverage } from './favorite-preset-workload.mjs';
import { optimizationArrivalConfiguration, optimizationArrivalQueries, optimizationArrivalWarmupOrdinals,
  compileOptimizationArrivalPlans, optimizationArrivalTrialIdentity, selectOptimizationArrivalCandidates,
  optimizationArrivalPresetApprovals } from './favorite-optimization-arrival.mjs';
import { buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';

test('nine presets interleave identical query shapes while retaining exact favorite controls', () => {
  const base = optimizationArrivalQueries('fixed'), before = structuredClone(base), queries = withFavoritePresets(base);
  assert.equal(queries.length, 36); assert.equal(new Set(queries.map(query => query.id)).size, 36);
  assert.deepEqual(base, before);
  for (let i = 0; i < base.length; i++) for (let j = 0; j < 9; j++) {
    const item = queries[i * 9 + j], preset = FAVORITE_PRESET_WORKLOAD.presets[j];
    assert.equal(item.baseQueryId, base[i].id); assert.equal(item.presetId, preset.id);
    assert.deepEqual(item.query, base[i].query); assert.deepEqual(item.filter, base[i].filter);
    assert.equal(favoritePresetId(item.parameters), preset.id);
  }
  const candidate = { id: 'numeric', method: 'favorite-utility-numeric', parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 } };
  const plans = compileOptimizationArrivalPlans(candidate, queries, buildFavoriteUtilityQuery);
  for (const plan of plans) assert.ok(plan.utilityKeys.every(key => key.endsWith('_' + favoritePresetId(plan.parameters))));
  const favorite = plans.filter(plan => favoritePresetId(plan.parameters) === 'q050_w1');
  const original = compileOptimizationArrivalPlans(candidate, base, buildFavoriteUtilityQuery);
  assert.deepEqual(favorite.map(plan => plan.body), original.map(plan => plan.body));
});

test('preset workload rejects ambiguous IDs and invalid controls', () => {
  assert.throws(() => withFavoritePresets([]));
  assert.throws(() => withFavoritePresets([{ id: 'a' }, { id: 'a' }]));
  assert.throws(() => favoritePresetId({ qualityInfluence: .25, cutoffBlendExponent: 1 }));
  assert.throws(() => favoritePresetId({ qualityInfluence: 1, cutoffBlendExponent: 2 }));
});

test('fixed and varied preset workloads preserve base ordering and balanced preset distribution', () => {
  for (const [workload, expected] of [['fixed', 36], ['varied', 675]]) {
    const queries = optimizationArrivalQueries('presets-' + workload);
    assert.equal(queries.length, expected);
    assert.deepEqual(queries, withFavoritePresets(optimizationArrivalQueries(workload)));
    assert.deepEqual(optimizationArrivalWarmupOrdinals('presets-' + workload, expected), Array.from({ length: expected }, (_, i) => i));
  }
});

test('wide preset warmup covers64base queries in every preset without warming the whole bank', () => {
  const queries = optimizationArrivalQueries('presets-wide');
  assert.equal(queries.length, 73656);
  const ordinals = optimizationArrivalWarmupOrdinals('presets-wide', queries.length);
  assert.deepEqual(ordinals, favoritePresetWarmupOrdinals(8184));
  assert.equal(ordinals.length, 576); assert.equal(new Set(ordinals).size, 576);
  for (const preset of FAVORITE_PRESET_WORKLOAD.presets) assert.equal(ordinals.filter(i => queries[i].presetId === preset.id).length, 64);
  assert.equal(ordinals[0], 0); assert.equal(ordinals.at(-1), queries.length - 1);
});

test('only mixed wide workloads permit enough bounded duration for a complete all9cycle', () => {
  const args = ['--config', 'c.json', '--artifact', 'a/benchmark.json', '--directory', 'b'];
  assert.equal(optimizationArrivalConfiguration([...args, '--workload', 'presets-wide', '--duration-seconds', '1200']).durationMs, 1200000);
  assert.equal(optimizationArrivalConfiguration([...args, '--workload', 'presets-wide', '--duration-seconds', '1800']).durationMs, 1800000);
  for (const workload of ['fixed', 'varied', 'wide', 'presets-fixed', 'presets-varied']) assert.throws(() => optimizationArrivalConfiguration([...args, '--workload', workload, '--duration-seconds', '601']));
  assert.throws(() => optimizationArrivalConfiguration([...args, '--workload', 'presets-wide', '--duration-seconds', '1801']));
});

test('preset coverage counts real returned keys and strict failures separately, preserving empty presets', () => {
  const candidate = { id: 'numeric', method: 'favorite-utility-numeric', parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 } };
  const queries = optimizationArrivalQueries('presets-fixed'), queryPlans = compileOptimizationArrivalPlans(candidate, queries, buildFavoriteUtilityQuery);
  const row = (offset, extra = {}) => ({ elapsedMs: 5, ...optimizationArrivalTrialIdentity(candidate, queries, offset), ...extra });
  const trials = [row(0), row(9, { elapsedMs: 1050 }), row(18, { elapsedMs: 1000, error: 'timeout' }), row(27, { error: 'full', clientRejected: true }), row(1)];
  const result = summarizeFavoritePresetCoverage({ trials, queryPlans });
  assert.equal(result.length, 9);
  const first = result.find(item => item.presetId === 'q000_w0');
  assert.equal(first.scheduledRequests, 4); assert.equal(first.dispatchedRequests, 3); assert.equal(first.successfulRequests, 2);
  assert.equal(first.withinBudgetRequests, 1); assert.equal(first.strictFailures, 3); assert.equal(first.errors, 2); assert.equal(first.atOrAboveOneSecond, 2);
  assert.equal(first.successfulUtilityKeyCount, 2); assert.equal(first.expectedUtilityKeyCount, 6138); assert.equal(first.fullUtilityBankCovered, false);
  assert.equal(result.find(item => item.presetId === 'q100_w3').scheduledRequests, 0);
  const altered = structuredClone(trials); altered[0].parameters.qualityInfluence = 1;
  assert.throws(() => summarizeFavoritePresetCoverage({ trials: altered, queryPlans }), /identity|preset/i);
});

function primaryEvidence() {
  const base = { method: 'favorite-utility-numeric', index: 'color-exploration-all9-test', parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 },
    builder: { module: './favorite-utilities.mjs', export: 'buildFavoriteUtilityQuery' } };
  const candidates = FAVORITE_PRESET_WORKLOAD.presets.map(preset => ({ ...base, id: 'numeric-' + preset.id.replace('_', '-'), parameters: { ...base.parameters, ...preset.parameters } }));
  const queries = optimizationArrivalQueries('fixed');
  return { finishedAt: '2026-09-24T00:00:00Z', experiment: 'favorite-optimization-benchmark', configuration: { count: 1000000 }, candidates,
    profiles: candidates.flatMap(candidate => queries.map(item => ({ candidateId: candidate.id, queryId: item.id, selectivity: 'all', concurrency: 1, viableAtTestedLoad: true,
      trials: Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, elapsedMs: 5 })), minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: 10000 }))),
    warmups: candidates.flatMap(candidate => queries.map(item => ({ candidateId: candidate.id, caseId: candidate.id + ':' + item.id, trials: [{ elapsedMs: 5 }] }))) };
}

test('mixed arrivals require passing fixed C1evidence for every preset on the exact method and index', () => {
  const artifact = primaryEvidence(), candidate = artifact.candidates.find(item => item.id === 'numeric-q050-w1');
  assert.equal(optimizationArrivalPresetApprovals(candidate, artifact).length, 9);
  assert.equal(selectOptimizationArrivalCandidates([candidate], artifact, { requireAllPresets: true }).selected.length, 1);
  for (const mutation of [a => { a.candidates[0].index += '-other'; }, a => { a.profiles[0].trials[0].elapsedMs = 1000; }, a => { a.warmups[0].trials[0].error = 'timeout'; }, a => { a.candidates.push(structuredClone(a.candidates[0])); }]) {
    const changed = structuredClone(artifact); mutation(changed);
    assert.throws(() => optimizationArrivalPresetApprovals(candidate, changed), /preset|C1/i);
    assert.equal(selectOptimizationArrivalCandidates([candidate], changed, { requireAllPresets: true }).selected.length, 0);
  }
  const favoriteOnly = structuredClone(artifact); favoriteOnly.candidates = [candidate];
  assert.equal(selectOptimizationArrivalCandidates([candidate], favoriteOnly).selected.length, 1);
});
