import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_VARIANTS, FAVORITE_WORKLOAD } from './favorite-scale-corpus.mjs';
import { favoriteScaleCases, favoriteScaleConfiguration } from './favorite-scale.mjs';
import { hash } from './service.mjs';
import {
  favoriteArrivalConfiguration, selectFavoriteArrivalCases,
  summarizeFavoriteArrival, validateFavoriteArrivalArtifact,
  validateFavoriteArrivalMapping, favoriteArrivalValueMatches,
} from './favorite-arrival.mjs';

function fixture() {
  const inputs = { scope: 'projection', source: { pinned: 'source' }, identityHash: 'inputs', fields: ['cov_example'], mapping: { settings: {}, mappings: { dynamic: 'strict', _source: { enabled: false }, properties: { cov_example: { type: 'integer' } } } } };
  const cases = favoriteScaleCases(favoriteScaleConfiguration());
  const identity = { experiment: 'strict-hue-favorite-scale', scope: 'projection', source: inputs.source, sourceIdentityHash: inputs.identityHash,
    mappingHash: hash(inputs.mapping), fields: inputs.fields, variants: FAVORITE_VARIANTS.map(({ id, method, parameters }) => ({ id, method, parameters })), workloadHash: hash(FAVORITE_WORKLOAD), seed: 99539473 };
  const artifact = { experiment: 'strict-hue-favorite-scale', snapshotId: 'strict-hue-favorite-001', finishedAt: '2026-09-22T00:00:00Z', scope: 'projection',
    index: 'color-exploration-favorite-projection-scale-v1', identity, identityHash: hash(identity), source: inputs.source,
    indexSettings: { uuid: 'original-uuid' }, finalIndexStats: { primaries: { docs: { count: 1000000 } } }, workload: cases,
    configuration: { scope: 'projection', seed: 99539473 }, profiles: [], warmups: [] };
  for (const item of cases.filter(item => item.selectivity === 'all' && ['picked-one-vibe', 'picked-five-portions'].includes(item.queryId))) {
    const warmupId = item.id + ':warmup';
    const warmup = { ordinal: 0, elapsedMs: 1, phase: 'warmup', caseId: item.id, parameters: item.parameters };
    artifact.warmups.push({ id: warmupId, count: 1000000, caseId: item.id, trials: [warmup] });
    artifact.profiles.push({ id: item.id + ':profile', count: 1000000, caseId: item.id, concurrency: 1,
      method: item.method, parameters: item.parameters, warmupId, warmupIds: [warmupId], viableAtTestedLoad: true,
      minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: 10000,
      trials: Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, phase: 'timed', elapsedMs: 1, caseId: item.id, parameters: item.parameters })) });
  }
  return { inputs, artifact };
}

test('arrival campaign has fixed bounded rates and requires separate explicit artifact/output paths', () => {
  const config = favoriteArrivalConfiguration(['--artifact', '/tmp/primary/scale.json', '--directory', '/tmp/arrival']);
  assert.deepEqual(config.rates, [1, 4, 8, 16]);
  assert.equal(config.durationMs, 30000);
  assert.equal(config.maxInFlight, 128);
  assert.throws(() => favoriteArrivalConfiguration([]), /artifact|directory/);
  assert.throws(() => favoriteArrivalConfiguration(['--artifact', 'a', '--directory', 'b', '--rate', '99']), /unknown/i);
  assert.throws(() => favoriteArrivalConfiguration(['--artifact', '/tmp/same/scale.json', '--directory', '/tmp/same']), /separate/i);
});

test('selection requires clean million-record C1 timed requests and every case warmup', () => {
  const { artifact } = fixture();
  assert.equal(selectFavoriteArrivalCases(artifact).selected.length, 4);
  artifact.warmups[0].trials[0].elapsedMs = 1000;
  let selected = selectFavoriteArrivalCases(artifact);
  assert.equal(selected.selected.length, 3);
  assert.match(selected.omitted[0].reason, /warmup/);
  artifact.profiles[1].trials[2].error = 'timeout';
  artifact.profiles[2].trials = [];
  artifact.profiles[3].count = 100000;
  selected = selectFavoriteArrivalCases(artifact);
  assert.equal(selected.selected.length, 0);
  assert.equal(selected.omitted.length, 4);
});

test('a short million-record smoke profile cannot qualify for arrival load', () => {
  const { artifact } = fixture();
  artifact.profiles[0].requestedDurationMs = 0;
  artifact.profiles[1].elapsedMs = 9000;
  artifact.profiles[2].minimumRequests = 10;
  const result = selectFavoriteArrivalCases(artifact);
  assert.equal(result.selected.length, 1);
  assert.equal(result.omitted.length, 3);
});

test('compact timed rows inherit exact profile provenance without losing failure checks', () => {
  const { artifact } = fixture();
  for (const profile of artifact.profiles) profile.trials = profile.trials.map(({ ordinal, elapsedMs }) => ({ ordinal, elapsedMs, hitCount: 20, overOneSecond: false }));
  assert.equal(selectFavoriteArrivalCases(artifact).selected.length, 4);
  artifact.profiles[0].trials[3].elapsedMs = 1000;
  artifact.profiles[1].parameters = { ...artifact.profiles[1].parameters, qualityInfluence: 1 };
  assert.equal(selectFavoriteArrivalCases(artifact).selected.length, 2);
});

test('index sample audits compare float32 quality representations while keeping coverage exact', () => {
  assert.equal(favoriteArrivalValueMatches('quality_o0004_hard_q00', .4, Math.fround(.4)), true);
  assert.equal(favoriteArrivalValueMatches('quality_o0004_hard_q00', .41, Math.fround(.4)), false);
  assert.equal(favoriteArrivalValueMatches('quality_o0004_hard_q00', NaN, 0), false);
  assert.equal(favoriteArrivalValueMatches('cov_o0004_hard_q00', 4000.01, 4000), false);
});

test('arrival accounting retains union failures, rejection and scheduled-to-result latency', () => {
  const trials = [
    { ordinal: 0, elapsedMs: 2, schedulerDelayMs: 1 },
    { ordinal: 1, elapsedMs: 1100, schedulerDelayMs: 10, error: 'slow failure' },
    { ordinal: 2, elapsedMs: 50, schedulerDelayMs: 50, error: 'client cap', clientRejected: true },
  ];
  const summary = summarizeFavoriteArrival(trials, [{ elapsedMs: 1000, error: 'warmup failed' }]);
  assert.equal(summary.errors, 2);
  assert.equal(summary.overOneSecond, 1);
  assert.equal(summary.strictTimedFailures, 2);
  assert.equal(summary.strictWarmupFailures, 1);
  assert.equal(summary.strictFailures, 3);
  assert.equal(summary.clientRejected, 1);
  assert.equal(summary.maximumSchedulerDelayMs, 50);
  assert.equal(summary.viableAtTestedLoad, false);
  assert.throws(() => summarizeFavoriteArrival([{ ordinal: 4, elapsedMs: 1, schedulerDelayMs: 0 }], []), /ordinal/);
});

test('artifact identity validation rejects unfinished, altered, wrong-count or changed-tuning campaigns', () => {
  const { artifact, inputs } = fixture();
  assert.equal(validateFavoriteArrivalArtifact(artifact, inputs), true);
  assert.throws(() => validateFavoriteArrivalArtifact({ ...artifact, finishedAt: undefined }, inputs), /finished/);
  assert.throws(() => validateFavoriteArrivalArtifact({ ...artifact, identityHash: 'wrong' }, inputs), /identity/);
  assert.throws(() => validateFavoriteArrivalArtifact({ ...artifact, finalIndexStats: { primaries: { docs: { count: 999999 } } } }, inputs), /million/);
  const changed = structuredClone(artifact); changed.workload[0].parameters = { ...changed.workload[0].parameters, qualityInfluence: 1 };
  assert.throws(() => validateFavoriteArrivalArtifact(changed, inputs), /parameters/);
});

test('retained index validation rejects changed mapping, provenance, UUID and document count', () => {
  const { artifact, inputs } = fixture();
  const mapping = { ...inputs.mapping.mappings, _meta: { experiment: artifact.experiment, identity: artifact.identity, identityHash: artifact.identityHash } };
  const settings = { uuid: 'original-uuid', number_of_shards: '1', number_of_replicas: '0' };
  const args = { artifact, inputs, mapping, settings, count: 1000000 };
  assert.equal(validateFavoriteArrivalMapping(args), true);
  assert.throws(() => validateFavoriteArrivalMapping({ ...args, count: 999999 }), /count/);
  assert.throws(() => validateFavoriteArrivalMapping({ ...args, settings: { ...settings, uuid: 'recreated' } }), /UUID/);
  assert.throws(() => validateFavoriteArrivalMapping({ ...args, mapping: { ...mapping, properties: {} } }), /mapping/);
  assert.throws(() => validateFavoriteArrivalMapping({ ...args, mapping: { ...mapping, _meta: {} } }), /identity/);
});
