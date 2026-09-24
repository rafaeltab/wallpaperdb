import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument } from './favorite-utilities.mjs';
import { toFavoritePrecisionDocument } from './favorite-precision-utilities.mjs';
import { compileFavoriteUtilityEncoder, originalFavoriteEncodedDocument } from './favorite-compiled-encoder.mjs';

const allEncodings = ['numeric', 'rank8', 'rank16', 'rankfloat', 'rank18', 'rank27'];
const queries = [
  { mode: 'vibe', targets: [{ color: '#ff0000' }, { name: 'dark' }, { name: 'grayscale' }] },
  { mode: 'proportions', targets: [{ color: '#00ff00', percent: 0 }, { color: '#ff0000', percent: 100 }] },
  { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }, { name: 'light', percent: 60 }] },
];
const presets = [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
const projection = createFavoriteUtilityPlan({ requests: presets.flatMap(parameters => queries.map(query => ({ query, parameters }))) });
function measured(plan, value) {
  return { id: 'sample', reference_id: 'original', cohort: 'real', partition: 73, tags: ['city'],
    ...Object.fromEntries(plan.measurementFields.map((field, i) => [field, field.startsWith('cov_')
      ? (value === undefined ? [0, 1, 2567, 7654, 9999, 10000][i % 6] : value * 10000)
      : Math.fround(value === undefined ? [0, .25, .51, .75, .9, 1][i % 6] : value)])) };
}

test('compiled encoder is byte-identical across every encoding and all nine controls', () => {
  for (const encodings of [...allEncodings.map(encoding => [encoding]), allEncodings.slice(0, 4), allEncodings.slice(4), allEncodings]) {
    const encode = compileFavoriteUtilityEncoder(projection, { encodings });
    for (const value of [0, 1, undefined]) {
      const document = measured(projection, value), original = originalFavoriteEncodedDocument(document, projection, { encodings });
      const compiled = encode(document);
      assert.deepEqual(compiled, original);
      assert.equal(JSON.stringify(compiled), JSON.stringify(original));
    }
  }
});

test('full6138-utility favorite bank preserves descriptor, preset field and digit insertion order', () => {
  const plan = createFavoriteUtilityPlan();
  assert.equal(plan.utilityCount, 6138);
  const document = measured(plan), encode = compileFavoriteUtilityEncoder(plan, { encodings: allEncodings });
  const expected = originalFavoriteEncodedDocument(document, plan, { encodings: allEncodings });
  const actual = encode(document);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
});

test('compatibility oracle directly uses unchanged original encoders for each existing family', () => {
  const document = measured(projection);
  for (const encodings of [['numeric'], ['rank8', 'rank16', 'rankfloat'], ['numeric', 'rank16']]) {
    assert.deepEqual(originalFavoriteEncodedDocument(document, projection, { encodings }), toFavoriteUtilityDocument(document, projection, { encodings }));
  }
  for (const encodings of [['rank18'], ['rank27'], ['rank27', 'rank18']]) {
    assert.deepEqual(originalFavoriteEncodedDocument(document, projection, { encodings }), toFavoritePrecisionDocument(document, projection, { encodings }));
  }
});

test('compiled validation retains original metadata defaults and rejects corrupt measurements', () => {
  const encode = compileFavoriteUtilityEncoder(projection, { encodings: ['rank16'] });
  const document = measured(projection);
  delete document.reference_id; delete document.cohort; delete document.partition; delete document.tags;
  assert.deepEqual(encode(document), toFavoriteUtilityDocument(document, projection, { encodings: ['rank16'] }));
  for (const id of ['', undefined, 123]) assert.throws(() => encode({ ...document, id }), /ID/);
  const coverage = projection.measurementFields.find(field => field.startsWith('cov_'));
  const quality = projection.measurementFields.find(field => !field.startsWith('cov_'));
  for (const value of [-1, .5, 10001, Infinity, undefined]) assert.throws(() => encode({ ...document, [coverage]: value }), /measurement/);
  for (const value of [-.1, 1.1, NaN, undefined]) assert.throws(() => encode({ ...document, [quality]: value }), /measurement/);
  for (const encodings of [[], ['bad'], ['rank16', 'rank16']]) assert.throws(() => compileFavoriteUtilityEncoder(projection, { encodings }));
});

test('compiled encoders keep independent returned documents and capture a serializable plan', () => {
  const plan = JSON.parse(JSON.stringify(projection)), document = measured(plan);
  const encode = compileFavoriteUtilityEncoder(plan, { encodings: ['rank18', 'numeric', 'rank16'] });
  const before = encode(document), expected = structuredClone(before);
  for (const group of Object.values(before).filter(value => value && typeof value === 'object' && !Array.isArray(value))) {
    for (const key of Object.keys(group)) group[key] = 0;
  }
  assert.deepEqual(encode(document), expected);
  plan.descriptors[0].key = 'changed-after-compilation';
  plan.descriptors[0].scoreComponents[0].weight = 100;
  assert.deepEqual(encode(document), expected);
});
