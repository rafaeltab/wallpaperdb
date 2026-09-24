import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { createFavoriteUtilityPlan, favoriteUtilityReference } from './favorite-utilities.mjs';
import { FAVORITE_PRECISION_METHODS, favoritePrecisionReference, favoritePrecisionMapping, FAVORITE_PRECISION_DEFINITION } from './favorite-precision-utilities.mjs';
import { hash } from './service.mjs';
import {
  PRECISION_FIDELITY_BOUNDS, precisionFidelityConfiguration, createPrecisionFidelityContext,
  reconstructPrecisionQueryScore, precisionFidelityOracle, assertPrecisionFidelityMetadata, runFavoritePrecisionFidelity,
} from './favorite-precision-fidelity.mjs';

const red = { targets: [{ color: '#ff0000' }] };
const presets = [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
function measurement(context, value) {
  return { id: 'test', ...Object.fromEntries(context.utilityPlan.measurementFields.map((field, i) => [field,
    field.startsWith('cov_') ? (value === undefined ? [0, 2345, 6789, 10000][i % 4] : value * 10000)
      : Math.fround(value === undefined ? [.01, .51, .89, 1][i % 4] : value)])) };
}

test('defaults select144 query/preset combinations and enforce isolated artifact/index names', () => {
  assert.equal(FIDELITY_QUERIES.length * presets.length, 144);
  const parsed = precisionFidelityConfiguration(['--directory', '/tmp/precision-fidelity']);
  assert.equal(parsed.allPresets, true);
  assert.equal(parsed.precisionIndex, 'color-exploration-favorite-precision-real-v1');
  assert.equal(precisionFidelityConfiguration(['--directory', '/tmp/test', '--favorite-only']).allPresets, false);
  for (const args of [[], ['--directory'], ['--directory', process.cwd()], ['--directory', process.cwd() + '/test'],
    ['--directory', '/'], ['--directory', '/tmp/test', '--index', '../unsafe'], ['--directory', '/tmp/test', '--unknown']]) {
    assert.throws(() => precisionFidelityConfiguration(args));
  }
});

test('all144 original queries/presets have valid independent utility and query-term reconstructions', () => {
  for (const preset of presets) for (const item of FIDELITY_QUERIES) {
    const context = createPrecisionFidelityContext(item.query, preset), document = measurement(context);
    const result = precisionFidelityOracle(document, context);
    assert.equal(result.numeric, favoriteUtilityReference(document, item.query, { parameters: context.parameters }));
    for (const method of FAVORITE_PRECISION_METHODS) {
      assert.equal(result.scores[method.id], favoritePrecisionReference(document, item.query, { method, parameters: context.parameters }));
      assert.ok(result.maximumTargetErrors[method.encoding] <= PRECISION_FIDELITY_BOUNDS[method.encoding].targetQuantization + 2e-16);
      assert.ok(Math.abs(result.scores[method.id] - result.native) <= PRECISION_FIDELITY_BOUNDS[method.encoding].originalScore);
    }
  }
});

test('zero, near-one and repeated targets retain the full requested-target average', () => {
  const queries = [red, { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#ff0000', percent: 50 }] }];
  for (const query of queries) for (const value of [0, 1]) {
    const context = createPrecisionFidelityContext(query), document = measurement(context, value);
    const actual = precisionFidelityOracle(document, context);
    assert.equal(actual.numeric, favoriteUtilityReference(document, query));
    for (const method of FAVORITE_PRECISION_METHODS) assert.equal(actual.scores[method.id], favoritePrecisionReference(document, query, { method }));
    if (query === red && value === 0) assert.deepEqual(Object.values(actual.scores), [0, 0]);
  }
});

test('query reconstruction treats absent digits as zero and rejects malformed/nonrepresentable terms', () => {
  const body = { query: { bool: { should: [{ rank_feature: { field: 'group.key', linear: {}, boost: .25 } }] } } };
  assert.equal(reconstructPrecisionQueryScore({}, body), 0);
  assert.equal(reconstructPrecisionQueryScore({ group: { key: 511 } }, body), 127.75);
  for (const value of [-1, .5, 512, Infinity]) assert.throws(() => reconstructPrecisionQueryScore({ group: { key: value } }, body));
  assert.throws(() => reconstructPrecisionQueryScore({}, { query: { bool: { should: [{}] } } }));
});

test('metadata checks reject incomplete, wrong-source, wrong-definition or changed mapping indexes', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const mapping = favoritePrecisionMapping(plan).mappings;
  mapping._meta = { experiment: 'strict-hue-favorite-precision-utilities', precisionDefinitionVersion: FAVORITE_PRECISION_DEFINITION.version,
    parentUtilityDefinitionVersion: FAVORITE_PRECISION_DEFINITION.parentUtilityDefinitionVersion,
    identityHash: 'a'.repeat(64), sourceIdentityHash: 'source', sourceDocumentsHash: 'documents', planHash: hash(plan),
    mode: 'real', scope: 'full', count: 545, presets: 'all', encodings: ['rank18', 'rank27'] };
  const snapshot = { count: 545, uuid: 'uuid', mapping };
  const options = { sourceIdentityHash: 'source', documentsHash: 'documents', plan };
  assert.doesNotThrow(() => assertPrecisionFidelityMetadata(snapshot, options));
  for (const changes of [{ sourceIdentityHash: 'wrong' }, { precisionDefinitionVersion: 2 }, { parentUtilityDefinitionVersion: 99 },
    { presets: 'favorite' }, { scope: 'projection' }, { mode: 'scale' }, { encodings: ['rank18'] }, { count: 544 }, { planHash: 'wrong' }]) {
    const changed = structuredClone(snapshot); Object.assign(changed.mapping._meta, changes);
    assert.throws(() => assertPrecisionFidelityMetadata(changed, options));
  }
  assert.throws(() => assertPrecisionFidelityMetadata({ ...snapshot, count: 544 }, options));
  const missingField = structuredClone(snapshot); delete missingField.mapping.properties.utility_rank18_q050_w1;
  assert.throws(() => assertPrecisionFidelityMetadata(missingField, options));
});

test('an existing output directory fails before any service access or evidence replacement', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'favorite-precision-fidelity-'));
  try {
    await assert.rejects(runFavoritePrecisionFidelity({ directory }), /EEXIST/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
