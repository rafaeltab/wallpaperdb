import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './service.mjs';
import { FAVORITE_SNAPSHOT_SHA256 } from './favorite-scale-corpus.mjs';
import { hueMapping } from './hue-index.mjs';
import { favoriteScaleCases } from './favorite-scale.mjs';
import {
  favoriteMaintenanceConfiguration, validateFavoriteMaintenanceCampaign,
  validateFavoriteMaintenanceState, assertFavoriteMaintenanceStable,
  favoriteMaintenanceOperations,
} from './favorite-maintenance.mjs';

function fixture(bucketCount = 256) {
  const frozenMapping = hueMapping({ bucketCount, source: true });
  const identity = { experiment: 'strict-hue-favorite-scale', scope: 'full', bucketCount,
    source: { snapshotManifestHash: FAVORITE_SNAPSHOT_SHA256 }, mappingHash: hash(frozenMapping) };
  const artifact = { experiment: identity.experiment, snapshotId: 'strict-hue-favorite-001',
    index: `color-exploration-favorite-full-b${bucketCount}-scale-v1`, scope: 'full', configuration: { scope: 'full', bucketCount },
    identity, identityHash: hash(identity), finishedAt: '2026-09-22T01:00:00Z', interruptions: [],
    invocations: [{ id: 'complete', at: '2026-09-22T00:00:00Z', finishedAt: '2026-09-22T01:00:00Z' }],
    settling: [{ invocationId: 'complete', phase: 'after-campaign', settled: true, quietSamples: 2, samples: [
      { at: '2026-09-22T00:59:58Z', active: 0, queued: 0, queryCurrent: 0, fetchCurrent: 0, merges: 0 },
      { at: '2026-09-22T00:59:59Z', active: 0, queued: 0, queryCurrent: 0, fetchCurrent: 0, merges: 0 },
    ] }],
    indexSettings: { uuid: 'expected-uuid' }, finalIndexStats: { primaries: { docs: { count: 100000 } } } };
  const campaign = validateFavoriteMaintenanceCampaign(artifact, 'full' + bucketCount);
  const state = {
    mapping: { body: { [artifact.index]: { mappings: { ...frozenMapping.mappings, _meta: { experiment: artifact.experiment, identityHash: artifact.identityHash, identity } } } } },
    settings: { body: { [artifact.index]: { settings: { index: { uuid: 'expected-uuid', number_of_shards: '1', number_of_replicas: '0' } } } } },
    count: { body: { count: 100000 } },
  };
  return { artifact, campaign, state };
}

function separateCompletionFixture() {
  const { artifact: parent } = fixture(1024);
  delete parent.finishedAt; delete parent.finalIndexStats;
  parent.sourceSnapshotHash = 'frozen-primary-source';
  parent.invocations = [{ id: 'indexing', at: '2026-09-21T20:00:00Z' }, { id: 'resume', at: '2026-09-21T22:00:00Z' }];
  parent.interruptions = [
    { invocationId: 'indexing', at: '2026-09-21T21:00:00Z', error: 'Error: Search queue or merges did not settle; refusing to contaminate another block.' },
    { invocationId: 'resume', at: '2026-09-21T22:01:00Z', error: 'Error: Favorite scale mapping differs from frozen inputs.' },
  ];
  parent.settling = [{ invocationId: 'indexing', phase: 'after-indexing', settled: false }];
  parent.workload = favoriteScaleCases(parent.configuration); parent.profiles = []; parent.warmups = [];
  const parentArtifactHash = hash(JSON.stringify(parent)), parentArtifactPath = '/tmp/campaign/full1024/scale.json';
  const completion = { experiment: 'strict-hue-favorite-completion', readOnly: true, mappingNormalization: 'opensearch-omitted-source-enabled-true-v1',
    parentArtifact: parentArtifactPath, parentArtifactHash, parentIdentityHash: parent.identityHash, index: parent.index, scope: 'full', bucketCount: 1024, count: 100000,
    primarySourceSnapshotHash: parent.sourceSnapshotHash, parentHistory: { invocations: parent.invocations, interruptions: parent.interruptions, settling: parent.settling },
    startedAt: '2026-09-22T00:00:00Z', finishedAt: '2026-09-22T01:00:00Z',
    indexBefore: { uuid: 'expected-uuid', count: 100000, mappingHash: 'same-mapping', sampleValuesHash: 'same-values' },
    indexAfter: { uuid: 'expected-uuid', count: 100000, mappingHash: 'same-mapping', sampleValuesHash: 'same-values' },
    finalIndexStats: { primaries: { docs: { count: 100000 } } },
    profiles: parent.workload.map(item => ({ caseId: item.id, method: item.method, parameters: item.parameters, count: 100000, concurrency: 1,
      minimumRequests: 32, requestedDurationMs: 10000, elapsedMs: 10000, trials: Array.from({ length: 32 }, (_, ordinal) => ({ ordinal, elapsedMs: 1 })) })),
    warmups: parent.workload.map(item => ({ caseId: item.id, count: 100000, trials: [{ ordinal: 0, elapsedMs: 1 }] })),
    settling: [{ phase: 'after-campaign', settled: true, quietSamples: 2, samples: [
      { at: '2026-09-22T00:59:58Z', active: 0, queued: 0, queryCurrent: 0, fetchCurrent: 0, merges: 0 },
      { at: '2026-09-22T00:59:59Z', active: 0, queued: 0, queryCurrent: 0, fetchCurrent: 0, merges: 0 },
    ] }],
  };
  return { parent, options: { completion, parentArtifactHash, parentArtifactPath } };
}

test('maintenance CLI requires an explicit root and new output directory', () => {
  const config = favoriteMaintenanceConfiguration(['--campaign-root', '/tmp/campaign', '--directory', '/tmp/campaign/maintenance']);
  assert.equal(config.campaignRoot, '/tmp/campaign');
  assert.equal(config.directory, '/tmp/campaign/maintenance');
  assert.throws(() => favoriteMaintenanceConfiguration([]), /campaign-root|directory/);
  assert.throws(() => favoriteMaintenanceConfiguration(['--campaign-root', '/tmp/a', '--directory', '/tmp/a']), /new/);
  assert.throws(() => favoriteMaintenanceConfiguration(['--unknown', 'value']), /Unknown/);
});

test('campaign guard rejects partial, interrupted, incorrect-count and wrong-identity inputs', () => {
  const { artifact } = fixture();
  assert.equal(validateFavoriteMaintenanceCampaign(artifact, 'full256').count, 100000);
  assert.throws(() => validateFavoriteMaintenanceCampaign({ ...artifact, finishedAt: undefined }, 'full256'), /finished/);
  assert.throws(() => validateFavoriteMaintenanceCampaign({ ...artifact, interruptions: [{}] }, 'full256'), /interrupt/);
  assert.throws(() => validateFavoriteMaintenanceCampaign({ ...artifact, identityHash: 'wrong' }, 'full256'), /identity/);
  assert.throws(() => validateFavoriteMaintenanceCampaign(artifact, 'full1024'), /bank|scope/);
  assert.throws(() => validateFavoriteMaintenanceCampaign({ ...artifact, finalIndexStats: { primaries: { docs: { count: 99999 } } } }, 'full256'), /count/);
});

test('completed resume admits a resolved historical settle timeout and preserves its evidence', () => {
  const { artifact } = fixture();
  artifact.invocations.unshift({ id: 'earlier-attempt', at: '2026-09-21T22:00:00Z' });
  artifact.interruptions.push({ invocationId: 'earlier-attempt', at: '2026-09-21T23:00:00Z',
    error: 'Error: Search queue or merges did not settle; refusing to contaminate another block.\n at settle (...)', nextIndex: 100000 });
  artifact.settling.unshift({ invocationId: 'earlier-attempt', phase: 'after-indexing', settled: false, elapsedMs: 120000,
    samples: [{ at: '2026-09-21T22:59:59Z', active: 0, queued: 0, queryCurrent: 0, fetchCurrent: 0, merges: 1 }] });
  const accepted = validateFavoriteMaintenanceCampaign(artifact, 'full256');
  assert.deepEqual(accepted.completionEvidence.interruptions, artifact.interruptions);
  assert.deepEqual(accepted.completionEvidence.invocations, artifact.invocations);
  assert.deepEqual(accepted.completionEvidence.settling, artifact.settling);
  for (const mutate of [
    a => { a.invocations.at(-1).finishedAt = undefined; },
    a => { a.interruptions[0].at = '2026-09-22T00:30:00Z'; },
    a => { a.interruptions[0].invocationId = 'complete'; },
    a => { a.interruptions[0].error = 'Different failure'; },
    a => { a.settling.shift(); },
    a => { a.settling.at(-1).samples.at(-1).merges = 1; },
    a => { a.settling.at(-1).invocationId = 'earlier-attempt'; },
  ]) {
    const changed = structuredClone(artifact); mutate(changed);
    assert.throws(() => validateFavoriteMaintenanceCampaign(changed, 'full256'), /finished|interrupt|settle/);
  }
});

test('separate completion binds the unfinished full1024 parent and all original100k cases', () => {
  const { parent, options } = separateCompletionFixture();
  const before = JSON.stringify(parent);
  const accepted = validateFavoriteMaintenanceCampaign(parent, 'full1024', options);
  assert.equal(accepted.completionEvidence.kind, 'separate-read-only-completion');
  assert.equal(accepted.completionEvidence.completedCaseIds.length, 12);
  assert.equal(JSON.stringify(parent), before);
  for (const mutate of [
    o => { o.parentArtifactHash = 'changed-parent'; },
    o => { o.completion.parentIdentityHash = 'wrong-identity'; },
    o => { o.completion.parentHistory.interruptions = []; },
    o => { o.completion.indexAfter.uuid = 'replacement-index'; },
    o => { o.completion.profiles.pop(); },
    o => { o.completion.profiles[0].requestedDurationMs = 0; },
    o => { o.completion.settling.at(-1).samples.at(-1).merges = 1; },
    o => { o.completion.finishedAt = undefined; },
  ]) {
    const changed = structuredClone(options); mutate(changed);
    assert.throws(() => validateFavoriteMaintenanceCampaign(parent, 'full1024', changed), /lineage|history|identity|cases|protocol|settle|finished/);
  }
});

test('every retained-index precondition rejects UUID, count or metadata changes', () => {
  const { campaign, state } = fixture();
  assert.equal(validateFavoriteMaintenanceState(campaign, state), true);
  const changed = structuredClone(state); changed.count.body.count = 99999;
  assert.throws(() => validateFavoriteMaintenanceState(campaign, changed), /count/);
  const recreated = structuredClone(state); recreated.settings.body[campaign.index].settings.index.uuid = 'other';
  assert.throws(() => validateFavoriteMaintenanceState(campaign, recreated), /UUID/);
  const foreign = structuredClone(state); foreign.mapping.body[campaign.index].mappings._meta.identityHash = 'other';
  assert.throws(() => validateFavoriteMaintenanceState(campaign, foreign), /identity/);
});

test('preexisting schema drift fails even when the saved metadata identity is unchanged', () => {
  const { campaign, state } = fixture();
  for (const mutate of [
    mapping => { mapping._source.enabled = false; },
    mapping => { mapping.dynamic = 'true'; },
    mapping => { mapping.properties.foreign = { type: 'float' }; },
    mapping => { mapping.properties.cov_o0004_hard_q00.type = 'float'; },
    mapping => { delete mapping.properties.quality_o0004_hard_q00; },
  ]) {
    const changed = structuredClone(state); mutate(changed.mapping.body[campaign.index].mappings);
    assert.throws(() => validateFavoriteMaintenanceState(campaign, changed), /mapping.*frozen/);
  }
});

test('omitted default enabled source matches explicit true without permitting source or field drift', () => {
  const { campaign, state } = fixture();
  const omitted = structuredClone(state); delete omitted.mapping.body[campaign.index].mappings._source;
  assert.equal(validateFavoriteMaintenanceState(campaign, omitted), true);
  assert.equal(assertFavoriteMaintenanceStable(campaign, state, omitted), true);
  const empty = structuredClone(state); empty.mapping.body[campaign.index].mappings._source = {};
  assert.equal(validateFavoriteMaintenanceState(campaign, empty), true);
  const pruning = structuredClone(state); pruning.mapping.body[campaign.index].mappings._source = { excludes: ['quality_*'] };
  assert.throws(() => validateFavoriteMaintenanceState(campaign, pruning), /mapping.*frozen/);
  const disabled = structuredClone(state); disabled.mapping.body[campaign.index].mappings._source.enabled = false;
  assert.throws(() => validateFavoriteMaintenanceState(campaign, disabled), /mapping.*frozen/);
  const changed = structuredClone(omitted); changed.mapping.body[campaign.index].mappings.properties.cov_o0004_hard_q00.type = 'float';
  assert.throws(() => validateFavoriteMaintenanceState(campaign, changed), /mapping.*frozen/);
});

test('normal maintenance exposes only flush and refresh operations and checks stable metadata', () => {
  const { campaign, state } = fixture();
  assert.deepEqual(favoriteMaintenanceOperations(campaign.index), [
    { kind: 'flush', route: campaign.index + '/_flush?wait_if_ongoing=true', method: 'POST' },
    { kind: 'refresh', route: campaign.index + '/_refresh', method: 'POST' },
  ]);
  assert.equal(assertFavoriteMaintenanceStable(campaign, state, structuredClone(state)), true);
  const changed = structuredClone(state); changed.mapping.body[campaign.index].mappings.properties = { foreign: { type: 'keyword' } };
  assert.throws(() => assertFavoriteMaintenanceStable(campaign, state, changed), /mapping/);
});
