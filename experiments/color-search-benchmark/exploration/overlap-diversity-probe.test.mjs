import test from 'node:test';
import assert from 'node:assert/strict';
import { diversityConfiguration, buildDiversityWorkload, summarizeDiversityTrials, validateDiversityIndex } from './overlap-diversity-probe.mjs';
import { buildOverlapQuery, resolveOverlapTargets } from './methods-overlap.mjs';
import { hash } from './service.mjs';

test('diversity workload covers 128 distinct spread anchors and exactly256 selected fields', () => {
  const workload = buildDiversityWorkload();
  assert.equal(workload.length, 256);
  assert.deepEqual(workload, buildDiversityWorkload());
  assert.notDeepEqual(workload.map(item => item.id), buildDiversityWorkload({ seed: 1234 }).map(item => item.id));
  assert.equal(new Set(workload.map(item => item.id)).size, 256);
  assert.deepEqual([...new Set(workload.map(item => item.regionIndex))].sort((a, b) => a - b), Array.from({ length: 128 }, (_, index) => index * 8));
  const selectedFields = new Set();
  for (const item of workload) {
    const target = resolveOverlapTargets('overlap-quality-dense', item.query).targets[0];
    assert.equal(target.regionIndex, item.regionIndex);
    assert.equal(target.anchorDistance, 0);
    for (const field of [target.coverageField, target.qualityField]) selectedFields.add(field);
    const body = buildOverlapQuery({ method: 'overlap-quality-dense', query: item.query });
    assert.equal(body.query.bool.should.length, 1);
    assert.equal(body.query.bool.filter.length, 3);
    assert.ok(!JSON.stringify(body).includes('script'));
  }
  assert.equal(selectedFields.size, 256);
  for (const index of new Set(workload.map(item => item.regionIndex))) assert.deepEqual(workload.filter(item => item.regionIndex === index).map(item => item.query.mode).sort(), ['proportions', 'vibe']);
});

test('configuration confines probe to one million existing records and bounded workload', () => {
  assert.deepEqual(diversityConfiguration().concurrencies, [4]);
  assert.equal(diversityConfiguration().repetitions, 2);
  assert.equal(diversityConfiguration().count, 1000000);
  assert.deepEqual(diversityConfiguration(['--counts', '1000000', '--concurrency', '4,16']).concurrencies, [4, 16]);
  for (const args of [['--counts', '1000'], ['--counts', '1000000,1000000'], ['--concurrency', '0'], ['--concurrency', '16,4'], ['--repeats', '20'], ['--index', 'production'], ['--limit', '0']]) assert.throws(() => diversityConfiguration(args));
});

test('first-pass failures remain failures after faster repeated requests', () => {
  const slow = [{ elapsedMs: 1000, queryId: 'one' }], fast = [{ elapsedMs: 2, queryId: 'one' }];
  assert.equal(summarizeDiversityTrials(slow).strictViable, false);
  assert.equal(summarizeDiversityTrials(fast, slow).strictViable, false);
  assert.equal(summarizeDiversityTrials(fast, slow).priorOverOneSecond, 1);
  assert.equal(summarizeDiversityTrials([{ elapsedMs: 1, error: 'shard failed' }]).strictViable, false);
  assert.equal(summarizeDiversityTrials(fast).strictViable, true);
  assert.equal(summarizeDiversityTrials(fast).viableAtTestedLoad, true);
  assert.equal(summarizeDiversityTrials([]).strictViable, false);
});

test('index guard verifies count, experiment identity and all selected doc-value types', () => {
  const workload = buildDiversityWorkload(), properties = {};
  for (const item of workload) {
    properties[item.fields.coverage] = { type: 'integer' };
    properties[item.fields.quality] = { type: 'float' };
  }
  const expectedFingerprints = Object.fromEntries(['definitionHash', 'computationHash', 'corpusHash', 'featureHash', 'preparationHash'].map(field => [field, `current-${field}`]));
  const identity = { test: 'identity', fingerprints: expectedFingerprints };
  const mapping = { properties, _meta: { experiment: 'overlap-scale', identity, identityHash: hash(identity) } };
  const checkpoint = { index: 'color-exploration-overlap-scale-v1', nextIndex: 1000000, identity, identityHash: hash(identity) };
  assert.doesNotThrow(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints, checkpoint }));
  assert.throws(() => validateDiversityIndex({ count: 999999, mapping, workload, expectedFingerprints, checkpoint }), /one million/);
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping: { ...mapping, _meta: { ...mapping._meta, identityHash: 'wrong' } }, workload, expectedFingerprints, checkpoint }), /identity/);
  const missing = structuredClone(mapping); delete missing.properties[workload[0].fields.quality];
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping: missing, workload, expectedFingerprints, checkpoint }), /field/);
  for (const field of Object.keys(expectedFingerprints)) {
    const older = structuredClone(mapping);
    older._meta.identity.fingerprints[field] = `older-${field}`;
    older._meta.identityHash = hash(older._meta.identity);
    const olderCheckpoint = { ...checkpoint, identity: older._meta.identity, identityHash: older._meta.identityHash };
    assert.throws(() => validateDiversityIndex({ count: 1000000, mapping: older, workload, expectedFingerprints, checkpoint: olderCheckpoint }), new RegExp(field));
  }
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping, workload, checkpoint }), /fingerprint/);
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints }), /checkpoint/);
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints, checkpoint: { ...checkpoint, index: 'color-exploration-other' } }), /checkpoint/);
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints, checkpoint: { ...checkpoint, identityHash: 'modified' } }), /checkpoint/);
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints, checkpoint: { ...checkpoint, nextIndex: 999999 } }), /checkpoint/);
});

test('recursively reordered OpenSearch identity keys preserve the trusted checkpoint binding', () => {
  const workload = buildDiversityWorkload(), properties = {};
  for (const item of workload) { properties[item.fields.coverage] = { type: 'integer' }; properties[item.fields.quality] = { type: 'float' }; }
  const expectedFingerprints = Object.fromEntries(['definitionHash', 'computationHash', 'corpusHash', 'featureHash', 'preparationHash'].map(field => [field, `current-${field}`]));
  const identity = { fingerprints: { ...expectedFingerprints, sourceHashes: { first: 'a', second: 'b' } }, seed: 99539473, other: [{ left: 1, right: 2 }] };
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
  const reordered = reorder(identity);
  assert.notEqual(hash(reordered), hash(identity), 'Raw order-sensitive hashes reproduce the service failure.');
  const checkpoint = { index: 'color-exploration-overlap-scale-v1', nextIndex: 1000000, identity, identityHash: hash(identity) };
  const mapping = { properties, _meta: { experiment: 'overlap-scale', identity: reordered, identityHash: checkpoint.identityHash } };
  assert.doesNotThrow(() => validateDiversityIndex({ count: 1000000, mapping, workload, expectedFingerprints, checkpoint }));
  const corrupted = structuredClone(mapping); corrupted._meta.identity.other[0].right = 3;
  assert.throws(() => validateDiversityIndex({ count: 1000000, mapping: corrupted, workload, expectedFingerprints, checkpoint }), /index identity/);
});
