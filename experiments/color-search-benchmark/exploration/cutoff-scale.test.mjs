import test from 'node:test';
import assert from 'node:assert/strict';
import { cutoffFields } from './cutoff-definition.mjs';
import { resolveCutoffTargets, buildCutoffQuery } from './methods-cutoff.mjs';
import { mixOverlapDocuments } from './overlap-scale-corpus.mjs';
import {
  cutoffScaleConfiguration, validateCutoffScaleConfiguration, cutoffScaleVariants,
  CUTOFF_SCALE_WORKLOAD, cutoffProjectionFields, cutoffProjectionMapping,
  projectCutoffDocument, syntheticCutoffProjection, cutoffEligibleCount, validateCutoffProjectionResume,
} from './cutoff-scale.mjs';

test('scale defaults are bounded and invalid or mistyped controls fail', () => {
  const config = cutoffScaleConfiguration();
  assert.deepEqual(config.counts, [100000, 1000000]);
  assert.deepEqual(config.bucketCounts, [16, 64, 256, 1024]);
  assert.deepEqual(config.cutoffs, [.5, 0]);
  assert.deepEqual(config.concurrencies, [1, 4, 16]);
  assert.equal(cutoffScaleVariants(config).length, 32);
  assert.throws(() => cutoffScaleConfiguration(['--typo', '1']), /unknown/i);
  assert.throws(() => cutoffScaleConfiguration(['--counts']), /value/i);
  for (const patch of [{ cutoffs: [.1] }, { bucketCounts: [32] }, { profiles: ['other'] }, { profiles: ['hard', 'hard'] }, { repetitions: 100 }, { durationSeconds: 61 }, { requestTimeoutMs: 950 }]) {
    assert.throws(() => validateCutoffScaleConfiguration({ ...config, ...patch }));
  }
});

test('the projection covers every selected query field plus paired physical coverage measurements', () => {
  const config = cutoffScaleConfiguration(), variants = cutoffScaleVariants(config);
  const fields = cutoffProjectionFields(variants), set = new Set(fields);
  assert.ok(fields.length > 0 && fields.length < 30720);
  assert.equal(fields.length, set.size);
  const mapping = cutoffProjectionMapping(fields);
  assert.equal(mapping.mappings.dynamic, 'strict');
  assert.equal(mapping.mappings._source.enabled, false);
  assert.equal(mapping.mappings.properties.tags.type, 'keyword');
  for (const variant of variants) for (const item of CUTOFF_SCALE_WORKLOAD) {
    const resolved = resolveCutoffTargets(variant.method, item.query, { parameters: variant.parameters });
    for (const target of resolved.targets) for (const component of target.components) {
      for (const field of [component.coverageField, component.qualityField, component.physicalCoverageField]) assert.ok(set.has(field), field);
      assert.ok(set.has('quality_' + component.physicalCoverageField.slice(4)));
    }
    const query = buildCutoffQuery({ method: variant.method, parameters: variant.parameters, query: item.query, filter: item.filter });
    assert.ok(!JSON.stringify(query).includes('script_score'));
    for (const field of fields) assert.ok(mapping.mappings.properties[field]);
  }
  for (const field of fields.filter(field => field.startsWith('cov_'))) assert.ok(set.has('quality_' + field.slice(4)));
});

test('projection fails closed on missing or invalid measured fields and keeps only its declared data', () => {
  const fields = Object.values(cutoffFields(4, 'hard', .5));
  const source = { id: 'a', tags: ['red'], [fields[0]]: 1000, [fields[1]]: .75, unrelated: 1 };
  const projected = projectCutoffDocument(source, fields);
  assert.equal(projected[fields[0]], 1000);
  assert.equal(projected[fields[1]], .75);
  assert.deepEqual(projected.tags, ['red']);
  assert.ok(!('unrelated' in projected));
  assert.throws(() => projectCutoffDocument({ ...source, [fields[0]]: undefined }, fields), /missing|invalid/i);
  assert.throws(() => projectCutoffDocument({ ...source, [fields[0]]: -1 }, fields), /invalid/i);
  assert.throws(() => projectCutoffDocument({ ...source, [fields[1]]: NaN }, fields), /invalid/i);
});

test('effective and physical coverage use conditional quality-mass mixing without normalization', () => {
  const hard = cutoffFields(4, 'hard', .5), feather = cutoffFields(4, 'feather', .5);
  const fields = [hard.coverage, feather.coverage];
  const a = { id: 'a', [hard.coverage]: 10000, [hard.quality]: 1, [feather.coverage]: 5000, [feather.quality]: 1 };
  const b = { id: 'b', [hard.coverage]: 0, [hard.quality]: 0, [feather.coverage]: 2500, [feather.quality]: .5 };
  const mix = mixOverlapDocuments(a, b, .25, 7, fields);
  assert.equal(mix[hard.coverage], 2500);
  assert.equal(mix[hard.quality], 1);
  assert.equal(mix[feather.coverage], 3125);
  assert.equal(mix[feather.quality], Math.fround(.7));
  const synthetic = syntheticCutoffProjection([a, b], 101, { coverageFields: fields, seed: 123 });
  assert.deepEqual(synthetic, syntheticCutoffProjection([a, b], 101, { coverageFields: fields, seed: 123 }));
  assert.equal(synthetic.id, 'cutoff-projection-synthetic-000000101');
  assert.equal(synthetic.partition, 1);
  assert.ok(synthetic.tags.includes('synthetic-one-percent'));
  assert.equal(synthetic[hard.quality], 1);
});

test('filter cardinalities match deterministic synthetic tags and partition assignments', () => {
  const docs = [{ id: 'a', cov_o0004_hard_q50: 1, quality_o0004_hard_q50: .5 }];
  for (const count of [1, 2, 9, 10, 99, 100, 101, 105, 1000]) {
    const projected = Array.from({ length: count }, (_, index) => syntheticCutoffProjection(docs, index));
    for (const item of CUTOFF_SCALE_WORKLOAD) {
      const eligible = item.filter?.range ? projected.filter(doc => doc.partition < 10) : item.filter?.term ? projected.filter(doc => doc.tags.includes('synthetic-one-percent')) : projected;
      assert.equal(cutoffEligibleCount(count, item), eligible.length);
    }
  }
});

test('resume accepts reordered mapping JSON and a deterministic partial bulk, refusing identity or field drift', () => {
  const fields = Object.values(cutoffFields(4, 'hard', .5)), expectedMapping = cutoffProjectionMapping(fields).mappings;
  const existingMapping = { ...expectedMapping, properties: Object.fromEntries(Object.entries(expectedMapping.properties).reverse()) };
  const config = { checkpoint: { identityHash: 'same', nextIndex: 100, batchSize: 20 }, metadata: { identityHash: 'same', fullIndexCapacityMeasured: false }, identityHash: 'same', actual: 110, nextBatchSize: 20, expectedMapping, existingMapping };
  assert.equal(validateCutoffProjectionResume(config), true);
  assert.throws(() => validateCutoffProjectionResume({ ...config, nextBatchSize: 10 }), /smaller batch/);
  assert.throws(() => validateCutoffProjectionResume({ ...config, actual: 121 }), /count/);
  assert.throws(() => validateCutoffProjectionResume({ ...config, identityHash: 'changed' }), /identity/);
  assert.throws(() => validateCutoffProjectionResume({ ...config, checkpoint: null }), /identity/);
  assert.throws(() => validateCutoffProjectionResume({ ...config, existingMapping: { ...existingMapping, properties: { ...existingMapping.properties, foreign: { type: 'float' } } } }), /mapping/);
  assert.throws(() => validateCutoffProjectionResume({ ...config, metadata: { ...config.metadata, fullIndexCapacityMeasured: true } }), /mapping/);
});
