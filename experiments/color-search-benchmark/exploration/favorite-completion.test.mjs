import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './service.mjs';
import { FAVORITE_VARIANTS, FAVORITE_WORKLOAD, favoriteProjectionFields, favoriteProjectionMapping } from './favorite-scale-corpus.mjs';
import { favoriteScaleConfiguration, favoriteScaleCases, favoriteQueryPlans } from './favorite-scale.mjs';
import { favoriteCompletionConfiguration, normalizeFavoriteCompletionMapping, validateFavoriteCompletionParent, validateFavoriteCompletionMapping, favoriteCompletionCases } from './favorite-completion.mjs';

function fixture() {
  const configuration = favoriteScaleConfiguration(['--scope', 'full', '--bucket-count', '1024', '--counts', '10000,100000', '--concurrency', '1']);
  const workload = favoriteScaleCases(configuration), fields = favoriteProjectionFields();
  const mapping = favoriteProjectionMapping(fields); mapping.mappings._source.enabled = true;
  const inputs = { scope: 'full', bucketCount: 1024, fields, mapping, source: { identityHash: 'extracted' }, identityHash: 'full-inputs' };
  const primarySource = { 'exploration/favorite-scale.mjs': 'frozen' }, sourceHashes = Object.fromEntries(Object.entries(primarySource).map(([name, text]) => [name, hash(text)]));
  const identity = { scope: 'full', bucketCount: 1024, source: inputs.source, sourceIdentityHash: inputs.identityHash, mappingHash: hash(mapping), fields, seed: configuration.seed, workloadHash: hash(FAVORITE_WORKLOAD), variants: FAVORITE_VARIANTS.filter(variant => variant.bucketCount === 1024).map(({ id, method, parameters }) => ({ id, method, parameters })), sourceHashes };
  const artifact = { experiment: 'strict-hue-favorite-scale', snapshotId: 'strict-hue-favorite-001', index: 'color-exploration-favorite-full-b1024-scale-v1', scope: 'full', configuration, identity, identityHash: hash(identity), source: inputs.source, workload, queryPlans: favoriteQueryPlans(workload, fields), sourceSnapshotHash: hash(primarySource), indexSettings: { uuid: 'original-uuid' },
    interruptions: [{ error: 'Error: Search queue or merges did not settle; refusing to contaminate another block.' }, { error: 'Error: Favorite scale mapping differs from frozen inputs.' }],
    profiles: workload.map(item => ({ caseId: item.id, count: 10000, concurrency: 1, method: item.method, parameters: item.parameters })), warmups: [], invocations: [{ id: 'first' }, { id: 'resume' }], settling: [] };
  const checkpoint = { index: artifact.index, identityHash: artifact.identityHash, nextIndex: 100000, completedStage: 100000 };
  const actualMapping = { ...mapping.mappings, _meta: { experiment: artifact.experiment, identity, identityHash: artifact.identityHash } }; delete actualMapping._source;
  const settings = { uuid: 'original-uuid', number_of_shards: '1', number_of_replicas: '0' };
  const hitsHash = 'a'.repeat(64);
  const reference = { queryPlans: artifact.queryPlans, warmups: workload.map(item => ({ id: item.id + ':reference-warmup', count: 100000, caseId: item.id, trials: [{ caseId: item.id, phase: 'warmup', method: item.method, parameters: item.parameters, elapsedMs: 10, hitCount: 20, hitsHash }] })) };
  return { artifact, inputs, checkpoint, primarySource, currentPrimarySource: primarySource, mapping: actualMapping, settings, count: 100000, reference };
}

test('completion options pin the original twelve-case100k C1 protocol and separate output', () => {
  const config = favoriteCompletionConfiguration(['--artifact', '/tmp/full1024/scale.json', '--reference-artifact', '/tmp/projection/scale.json', '--directory', '/tmp/completion', '--dry-run']);
  assert.equal(config.dryRun, true);
  assert.equal(config.count, 100000);
  assert.deepEqual(config.concurrencies, [1]);
  assert.equal(config.requests, 32);
  assert.equal(config.durationMs, 10000);
  assert.equal(config.settleMs, 600000);
  assert.throws(() => favoriteCompletionConfiguration([]), /artifact|directory/);
  assert.throws(() => favoriteCompletionConfiguration(['--artifact', '/tmp/a/scale.json', '--reference-artifact', '/tmp/b/scale.json', '--directory', '/tmp/a']), /separate/);
  assert.throws(() => favoriteCompletionConfiguration(['--requests', '1']), /Unknown/);
});

test('normalization recognizes only the omitted source-enabled default, without mutation', () => {
  const data = fixture();
  assert.equal(data.mapping._source, undefined);
  const normalized = normalizeFavoriteCompletionMapping(data.mapping);
  assert.deepEqual(normalized._source, { enabled: true });
  assert.equal(data.mapping._source, undefined);
  assert.equal(validateFavoriteCompletionMapping(data).omittedEnabledSourceDefault, true);
  assert.equal(validateFavoriteCompletionMapping({ ...data, mapping: { ...data.mapping, _source: { enabled: true } } }).omittedEnabledSourceDefault, false);
  for (const source of [{ enabled: false }, { enabled: true, excludes: ['quality_*'] }, { enabled: true, includes: ['id'] }, {}, null]) {
    assert.throws(() => validateFavoriteCompletionMapping({ ...data, mapping: { ...data.mapping, _source: source } }), /mapping/);
  }
});

test('semantic-default exception still rejects every mapping, source identity, UUID and count drift', () => {
  const data = fixture();
  for (const patch of [
    { mapping: { ...data.mapping, dynamic: false } },
    { mapping: { ...data.mapping, properties: { ...data.mapping.properties, foreign: { type: 'integer' } } } },
    { mapping: { ...data.mapping, _meta: { ...data.mapping._meta, identityHash: 'changed' } } },
    { settings: { ...data.settings, uuid: 'recreated' } }, { settings: { ...data.settings, number_of_shards: '2' } }, { count: 99999 },
  ]) assert.throws(() => validateFavoriteCompletionMapping({ ...data, ...patch }));
});

test('completion preserves the interrupted parent and rejects unrelated or already-timed stages', () => {
  const data = fixture();
  assert.equal(validateFavoriteCompletionParent(data), true);
  assert.throws(() => validateFavoriteCompletionParent({ ...data, artifact: { ...data.artifact, finishedAt: 'finished' } }), /incomplete/);
  assert.throws(() => validateFavoriteCompletionParent({ ...data, checkpoint: { ...data.checkpoint, nextIndex: 99999 } }), /checkpoint/);
  assert.throws(() => validateFavoriteCompletionParent({ ...data, currentPrimarySource: {} }), /source/);
  const changed = structuredClone(data.artifact); changed.profiles[0].count = 100000;
  assert.throws(() => validateFavoriteCompletionParent({ ...data, artifact: changed }), /100k|10k/);
  const hidden = structuredClone(data.artifact); hidden.interruptions.push({ error: 'unrelated data corruption' });
  assert.throws(() => validateFavoriteCompletionParent({ ...data, artifact: hidden }), /interruptions/);
  const scoring = structuredClone(data.artifact); scoring.queryPlans[0].body.size = 10;
  assert.throws(() => validateFavoriteCompletionParent({ ...data, artifact: scoring }), /query plans/);
});

test('every original query/filter has an exact successful same-count projection reference', () => {
  const data = fixture(), cases = favoriteCompletionCases(data.artifact, data.reference);
  assert.equal(cases.length, 12);
  assert.equal(cases.filter(item => item.selectivity === 'all').length, 4);
  assert.equal(cases.filter(item => item.selectivity === 'partition10').length, 4);
  assert.equal(cases.filter(item => item.selectivity === 'tag1').length, 4);
  assert.ok(cases.every(item => item.reference.available && item.parameters.bucketCount === 1024));
  const failed = structuredClone(data.reference); failed.warmups[0].trials[0].error = 'timeout';
  assert.throws(() => favoriteCompletionCases(data.artifact, failed), /reference/);
  const changed = structuredClone(data.reference); changed.queryPlans[0].bodyHash = 'different';
  assert.throws(() => favoriteCompletionCases(data.artifact, changed), /query plan/);
});
