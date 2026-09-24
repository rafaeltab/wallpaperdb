import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './service.mjs';
import { FAVORITE_VARIANTS, FAVORITE_WORKLOAD, favoriteProjectionFields, favoriteProjectionMapping } from './favorite-scale-corpus.mjs';
import { favoriteScaleCases, favoriteScaleConfiguration, favoriteQueryPlans, remainingFavoriteConcurrencies, summarizeFavoriteTrials } from './favorite-scale.mjs';
import { favoriteMaintainedConfiguration, validateFavoriteMaintainedParent, favoriteMaintainedCases, checkFavoriteMaintainedParity } from './favorite-maintained.mjs';

function fixture() {
  const configuration = favoriteScaleConfiguration(), workload = favoriteScaleCases(configuration), fields = favoriteProjectionFields();
  const inputs = { scope: 'projection', fields, mapping: favoriteProjectionMapping(fields), source: { measured: 'strict-hue' }, identityHash: 'frozen-inputs' };
  const primarySource = { 'exploration/example.mjs': 'export const frozen = true;' };
  const sourceHashes = Object.fromEntries(Object.entries(primarySource).map(([name, source]) => [name, hash(source)]));
  const identity = { sourceIdentityHash: inputs.identityHash, source: inputs.source, mappingHash: hash(inputs.mapping), fields, scope: 'projection', seed: configuration.seed, workloadHash: hash(FAVORITE_WORKLOAD), variants: FAVORITE_VARIANTS.map(({ id, method, parameters }) => ({ id, method, parameters })), sourceHashes };
  const hits = Array.from({ length: 20 }, (_, ordinal) => ({ id: `favorite-synthetic-${String(ordinal).padStart(9, '0')}`, score: 1 - ordinal / 100 }));
  const artifact = { experiment: 'strict-hue-favorite-scale', snapshotId: 'strict-hue-favorite-001', index: 'color-exploration-favorite-projection-scale-v1', scope: 'projection', configuration, source: inputs.source, identity, identityHash: hash(identity), finishedAt: '2026-09-22T00:00:00Z', finalIndexStats: { primaries: { docs: { count: 1000000 } } }, workload, queryPlans: favoriteQueryPlans(workload, fields), sourceSnapshotHash: hash(primarySource), sourceHashes,
    warmups: workload.filter(item => item.selectivity === 'all').map(item => ({ id: item.id + ':warmup', count: 1000000, caseId: item.id, trials: [{ caseId: item.id, phase: 'warmup', method: item.method, parameters: item.parameters, hitCount: 20, hitsHash: hash(hits), elapsedMs: 50, ordinal: 0 }] })) };
  return { artifact, inputs, primarySource, currentPrimarySource: primarySource, hits };
}

test('maintained confirmation uses a new output and fixed eight-case concurrency protocol', () => {
  const config = favoriteMaintainedConfiguration(['--artifact', '/tmp/primary/scale.json', '--directory', '/tmp/maintained', '--maintenance-record', '/tmp/maintenance.json']);
  assert.deepEqual(config.concurrencies, [1, 4, 16]);
  assert.equal(config.requests, 32);
  assert.equal(config.durationMs, 10000);
  assert.equal(config.serviceTimeoutMs, 950);
  assert.equal(config.clientTimeoutMs, 1500);
  assert.throws(() => favoriteMaintainedConfiguration([]), /artifact|directory/);
  assert.throws(() => favoriteMaintainedConfiguration(['--artifact', '/tmp/a/scale.json', '--directory', '/tmp/a']), /separate/);
  assert.throws(() => favoriteMaintainedConfiguration(['--artifact', 'a', '--directory', 'b', '--requests', '1']), /Unknown/);
  const cases = favoriteMaintainedCases(fixture().artifact);
  assert.equal(cases.length, 8);
  assert.equal(new Set(cases.map(item => item.id)).size, 8);
  assert.ok(cases.every(item => item.selectivity === 'all' && !item.filter));
  assert.deepEqual([...new Set(cases.map(item => item.queryId))], ['picked-one-vibe', 'picked-one-green40', 'picked-two-portions', 'picked-five-portions']);
});

test('parent validation rejects changed source, query plan, mapping provenance or unsupported scope', () => {
  const data = fixture();
  assert.equal(validateFavoriteMaintainedParent(data), true);
  assert.throws(() => validateFavoriteMaintainedParent({ ...data, currentPrimarySource: { changed: 'source' } }), /source/);
  const changedPlan = structuredClone(data.artifact); changedPlan.queryPlans[0].body.size = 10;
  assert.throws(() => validateFavoriteMaintainedParent({ ...data, artifact: changedPlan }), /query plans/);
  assert.throws(() => validateFavoriteMaintainedParent({ ...data, artifact: { ...data.artifact, scope: 'full' } }), /projection/);
  assert.throws(() => validateFavoriteMaintainedParent({ ...data, artifact: { ...data.artifact, identityHash: 'different' } }), /identity/);
});

test('reference cases bind original complete warmup scores and report unavailable references', () => {
  const { artifact, hits } = fixture();
  const cases = favoriteMaintainedCases(artifact);
  assert.equal(cases[0].reference.hitsHash, hash(hits));
  assert.deepEqual(cases[0].reference.warmupIds, [artifact.warmups[0].id]);
  artifact.warmups[0].trials[0].error = 'timeout';
  const missing = favoriteMaintainedCases(artifact)[0];
  assert.equal(missing.reference.available, false);
  assert.match(missing.reference.reason, /successful/);
  const changed = fixture().artifact;
  changed.warmups[0].trials.push({ ...changed.warmups[0].trials[0], hitsHash: 'b'.repeat(64) });
  assert.throws(() => favoriteMaintainedCases(changed), /inconsistent/);
  const wrongTuning = fixture().artifact;
  wrongTuning.warmups[0].trials[0].parameters = { qualityInfluence: 3 };
  assert.throws(() => favoriteMaintainedCases(wrongTuning), /provenance/);
});

test('complete ordered top20 must exactly preserve the original score hash when available', () => {
  const { artifact, hits } = fixture(), reference = favoriteMaintainedCases(artifact)[0].reference;
  assert.deepEqual(checkFavoriteMaintainedParity(hits, reference), { available: true, matches: true, hitsHash: hash(hits) });
  assert.equal(checkFavoriteMaintainedParity(hits, { available: false }).available, false);
  assert.throws(() => checkFavoriteMaintainedParity(hits.slice(0, 19), reference), /top20/);
  const changed = structuredClone(hits); changed[0].score += .001;
  assert.throws(() => checkFavoriteMaintainedParity(changed, reference), /parity/);
  assert.throws(() => checkFavoriteMaintainedParity([...hits].reverse(), reference), /ordered/);
});

test('maintained blocks retain primary warmup failure gating and union accounting', () => {
  const warmups = [{ ordinal: 0, elapsedMs: 1100, error: 'timeout' }];
  assert.deepEqual(remainingFavoriteConcurrencies({ requested: [1, 4, 16], profiles: [], warmups }), [1]);
  const timed = [{ ordinal: 0, elapsedMs: 1100, error: 'timeout' }, { ordinal: 1, elapsedMs: 20 }];
  const summary = summarizeFavoriteTrials(timed, warmups);
  assert.equal(summary.strictTimedFailures, 1);
  assert.equal(summary.strictWarmupFailures, 1);
  assert.equal(summary.viableAtTestedLoad, false);
});
