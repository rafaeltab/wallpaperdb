import test from 'node:test';
import assert from 'node:assert/strict';
import { LINKED_STRICTNESS_BANKS, linkedStrictnessBank, linkedStrictnessSelection, createLinkedStrictnessPlan,
  supportsLinkedStrictness, buildLinkedStrictnessQuery } from './linked-strictness.mjs';
import { buildFavoriteDocvalueFetchQuery } from './favorite-docvalue-fetch.mjs';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { compileFavoriteUtilityEncoder } from './favorite-compiled-encoder.mjs';

const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
test('linked paths preserve the favorite midpoint and deliberately restrict independent controls', () => {
  assert.deepEqual(LINKED_STRICTNESS_BANKS.map(bank => bank.steps.map(step => [step.qualityInfluence, step.cutoffBlendExponent])),
    [[[0, 0], [.5, 1], [1, 3]], [[0, 0], [.5, 0], [.5, 1], [1, 1], [1, 3]]]);
  for (const bank of LINKED_STRICTNESS_BANKS) {
    const favorite = linkedStrictnessSelection({ bankId: bank.id, stepIndex: bank.favoriteStep });
    assert.equal(favorite.qualityInfluence, .5); assert.equal(favorite.cutoffBlendExponent, 1);
    assert.equal(favorite.bucketCount, 256); assert.equal(favorite.qualityCurve, 'linear'); assert.equal(favorite.minimumQuality, 0);
  }
  assert.throws(() => linkedStrictnessBank('unknown'));
  for (const stepIndex of [-1, 3, .5, '1']) assert.throws(() => linkedStrictnessSelection({ bankId: 'linked-3', stepIndex }));
});

test('compact plans include every target and zero-to-100 percent profile with only selected linked pairs', () => {
  for (const bank of LINKED_STRICTNESS_BANKS) {
    const plan = createLinkedStrictnessPlan(bank.id);
    assert.equal(plan.utilityCount, 279 * 12 * bank.steps.length);
    assert.equal(new Set(plan.descriptors.map(d => d.key)).size, plan.utilityCount);
    assert.equal(plan.scope, 'full'); assert.equal(plan.linkedStrictness.percentageStep, 10);
    const counts = new Map();
    for (const d of plan.descriptors) {
      const match = d.key.match(/^(r\d{4}|n_.+)_(v|p\d{3})_q(000|050|100)_w(0|1|3)$/);
      assert.ok(match, d.key);
      assert.ok(match[2] === 'v' || Number(match[2].slice(1)) % 10 === 0);
      const pair = Number(match[3]) / 100 + ':' + match[4];
      assert.ok(bank.steps.some(step => step.qualityInfluence + ':' + step.cutoffBlendExponent === pair));
      counts.set(match[1] + ':' + pair, (counts.get(match[1] + ':' + pair) ?? 0) + 1);
    }
    assert.equal(counts.size, 279 * bank.steps.length); assert.ok([...counts.values()].every(value => value === 12));
  }
});

test('query validation rejects intermediate amounts and score overrides instead of silently snapping', () => {
  for (const percent of [5, 15, 33]) assert.equal(supportsLinkedStrictness({ bankId: 'linked-3', stepIndex: 1,
    query: { mode: 'proportions', targets: [{ color: '#ff0000', percent }] } }).supported, false);
  const zero = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 0 }, { color: '#00ff00', percent: 40 }] };
  assert.equal(supportsLinkedStrictness({ bankId: 'linked-3', stepIndex: 1, query: zero }).supported, true);
  assert.equal(supportsLinkedStrictness({ bankId: 'linked-3', stepIndex: 1, query: red, parameters: { qualityInfluence: 1 } }).supported, false);
});

test('queries use the unchanged global numeric score and exclude fixture IDs in OpenSearch', () => {
  for (const bank of LINKED_STRICTNESS_BANKS) for (const [stepIndex] of bank.steps.entries()) {
    const options = { bankId: bank.id, stepIndex, query: red, excludedIds: ['fixture-a'], limit: 24 };
    const actual = buildLinkedStrictnessQuery(options);
    const expected = buildFavoriteDocvalueFetchQuery({ method: 'favorite-utility-numeric-docvalues', query: red,
      parameters: linkedStrictnessSelection(options), excludedIds: options.excludedIds, limit: 24 });
    assert.deepEqual(actual, expected); assert.equal(actual.stored_fields, '_none_'); assert.deepEqual(actual.docvalue_fields, ['id']);
    assert.match(JSON.stringify(actual.query), /fixture-a/);
  }
});

test('compact encoding retains every selected parent utility exactly, including favorite scores', () => {
  const bank = linkedStrictnessBank('linked-3'), compact = createLinkedStrictnessPlan(bank.id);
  const parent = createFavoriteUtilityPlan({ presets: bank.steps.map(({ qualityInfluence, cutoffBlendExponent }) => ({ qualityInfluence, cutoffBlendExponent })) });
  const measurement = { id: 'measured-sample', tags: ['city'], ...Object.fromEntries(parent.measurementFields.map((field, i) =>
    [field, field.startsWith('cov_') ? (i * 137) % 10001 : Math.fround((i % 101) / 100)])) };
  const expected = toFavoriteUtilityDocument(measurement, parent, { encodings: ['numeric'] });
  const actual = compileFavoriteUtilityEncoder(compact, { encodings: ['numeric'] })(measurement);
  assert.equal(Object.keys(actual.utilities).length, 10044);
  for (const [key, value] of Object.entries(actual.utilities)) assert.equal(value, expected.utilities[key], key);
});
