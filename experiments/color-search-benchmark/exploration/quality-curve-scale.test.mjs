import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './service.mjs';
import { cutoffProjectionMapping, CUTOFF_SCALE_INDEX } from './cutoff-scale.mjs';
import {
  qualityCurveScaleConfiguration, qualityCurveScaleVariants, qualityCurveScaleCases,
  validateQualityCurveProjection, validateQualityCurveStorageSources,
  QUALITY_CURVE_STORAGE_SOURCES,
} from './quality-curve-scale.mjs';

test('quality-curve comparison creates eight influence3 variants and separate query blocks', () => {
  const config = qualityCurveScaleConfiguration(), variants = qualityCurveScaleVariants(config), cases = qualityCurveScaleCases(config);
  assert.equal(config.requests, 16);
  assert.deepEqual(config.concurrencies, [1, 4]);
  assert.equal(variants.length, 8);
  assert.equal(cases.length, 16);
  assert.equal(new Set(cases.map(item => item.id)).size, 16);
  for (const variant of variants) {
    assert.ok(['cutoff-hard', 'cutoff-feather'].includes(variant.method));
    assert.ok([256, 1024].includes(variant.parameters.bucketCount));
    assert.equal(variant.parameters.pixelCutoff, 0);
    assert.equal(variant.parameters.qualityInfluence, 3);
    assert.equal(variant.parameters.minimumQuality, 0);
    assert.ok(['linear', 'power'].includes(variant.parameters.qualityCurve));
  }
  for (const item of cases) {
    assert.ok(['picked-one-vibe', 'picked-five-portions'].includes(item.queryId));
    assert.equal(item.query.targets.length, item.queryId === 'picked-one-vibe' ? 1 : 5);
    assert.ok(!item.filter);
  }
});

test('bounded controls reject accidental workload expansion or missing option values', () => {
  for (const args of [['--requests', '15'], ['--requests', '129'], ['--concurrency', '16'], ['--concurrency', '4,1'], ['--requests'], ['--unknown', '1']]) assert.throws(() => qualityCurveScaleConfiguration(args));
  assert.equal(qualityCurveScaleConfiguration(['--dry-run']).dryRun, true);
});

function fixture() {
  const fields = ['cov_o0004_hard_q00', 'quality_o0004_hard_q00'], expected = cutoffProjectionMapping(fields);
  const identity = { kind: 'query-field-projection-only', fields, mappingHash: hash(expected), source: { identityHash: 'original-extraction', projectedDocumentsHash: 'source-values' }, computationHashes: { 'methods-cutoff.mjs': 'old-query-source' } };
  const identityHash = hash(identity);
  const main = { finishedAt: '2026-09-21T00:00:00Z', index: CUTOFF_SCALE_INDEX, identity, identityHash, projection: { fields, fieldCount: fields.length, fullIndexCapacityMeasured: false } };
  const checkpoint = { identityHash, nextIndex: 1000000 };
  const mapping = { ...expected.mappings, properties: Object.fromEntries(Object.entries(expected.mappings.properties).reverse()), _meta: { identityHash, identity, fullIndexCapacityMeasured: false } };
  return { main, checkpoint, mapping, count: 1000000 };
}

test('retained projection checks document count, mapping and stored source identity', () => {
  const data = fixture();
  assert.equal(validateQualityCurveProjection(data), true);
  for (const patch of [{ count: 999999 }, { main: { ...data.main, finishedAt: null } }, { checkpoint: { ...data.checkpoint, identityHash: 'different' } }, { mapping: { ...data.mapping, properties: { ...data.mapping.properties, foreign: { type: 'float' } } } }, { mapping: { ...data.mapping, _meta: { ...data.mapping._meta, identity: { ...data.mapping._meta.identity, source: {} } } } }]) assert.throws(() => validateQualityCurveProjection({ ...data, ...patch }));
});

test('changed scoring code is intentional; changed storage geometry or extraction is rejected', () => {
  const stored = Object.fromEntries(QUALITY_CURVE_STORAGE_SOURCES.map(name => [name, 'unchanged:' + name]));
  const current = { ...stored, 'methods-cutoff.mjs': 'new-power-query', 'quality-curve.mjs': 'new-module' };
  assert.equal(validateQualityCurveStorageSources({ ...stored, 'methods-cutoff.mjs': 'old-linear-query' }, current), true);
  assert.throws(() => validateQualityCurveStorageSources(stored, { ...current, 'cutoff-definition.mjs': 'changed' }), /storage source/i);
  assert.throws(() => validateQualityCurveStorageSources(stored, {}), /storage source/i);
});
