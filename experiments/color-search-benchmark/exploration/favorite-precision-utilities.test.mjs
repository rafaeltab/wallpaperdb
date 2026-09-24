import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoriteUtilityPlan, toFavoriteUtilityDocument, buildFavoriteUtilityQuery, quantizeRankFeature, favoriteUtilityReference } from './favorite-utilities.mjs';
import {
  FAVORITE_PRECISION_METHODS, FAVORITE_PRECISION_DEFINITION, favoritePrecisionMethod,
  favoritePrecisionDigits, favoritePrecisionRankField, favoritePrecisionEncodingValueCount,
  favoritePrecisionMapping, toFavoritePrecisionDocument, buildFavoritePrecisionQuery,
  supportsFavoritePrecision, favoritePrecisionReference,
} from './favorite-precision-utilities.mjs';

const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
function measured(plan, coverage = 4000, quality = .7) {
  return { id: 'sample', tags: ['city'], cohort: 'real', partition: 3,
    ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? coverage : Math.fround(quality)])) };
}
const scaleFor = encoding => encoding === 'rank18' ? 262143 : 134217727;
function reconstructed(digits) { return digits.reduce((sum, digit) => sum * 512 + digit, 0); }

test('base512 digits are exactly representable and obey utility rounding bounds including edges', () => {
  for (const encoding of ['rank18', 'rank27']) {
    const scale = scaleFor(encoding);
    const values = [0, 1, 2 ** -24, 1 - 2 ** -24, 1 / scale, .5 / scale, (scale - .5) / scale];
    for (let i = 0; i <= 10000; i++) values.push(i / 10000);
    for (const value of values) {
      const digits = favoritePrecisionDigits(value, encoding);
      assert.equal(digits.length, encoding === 'rank18' ? 2 : 3);
      for (const digit of digits) {
        assert.ok(Number.isInteger(digit) && digit >= 0 && digit <= 511);
        assert.equal(quantizeRankFeature(digit), digit);
      }
      assert.equal(reconstructed(digits), Math.round(value * scale));
      assert.ok(Math.abs(reconstructed(digits) / scale - value) <= .5 / scale + 2e-16);
    }
  }
  for (const value of [-.01, 1.01, NaN, Infinity]) assert.throws(() => favoritePrecisionDigits(value, 'rank18'));
  assert.throws(() => favoritePrecisionDigits(.5, 'rank8'));
});

test('precision variants retain preset constraints and label numeric approximation separately from retrieval', () => {
  assert.equal(FAVORITE_PRECISION_DEFINITION.version, 1);
  assert.deepEqual(FAVORITE_PRECISION_METHODS.map(method => method.id), ['favorite-utility-rank18', 'favorite-utility-rank27']);
  for (const method of FAVORITE_PRECISION_METHODS) {
    assert.equal(method.approximate, false);
    assert.equal(method.objectiveApproximation, true);
    assert.equal(supportsFavoritePrecision(method, red).supported, true);
    assert.equal(supportsFavoritePrecision(method, red, { parameters: { qualityInfluence: .7 } }).supported, false);
    assert.equal(supportsFavoritePrecision(method, { mode: 'proportions', targets: [{ color: '#ff0000', percent: 42 }] }).supported, false);
  }
  assert.throws(() => favoritePrecisionMethod('bad'));
});

test('one numeric utility pass feeds partitioned digits, preserving all metadata and omitting zeros', () => {
  const presets = [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
  const plan = createFavoriteUtilityPlan({ requests: presets.map(parameters => ({ query: red, parameters })) });
  for (const coverage of [0, 1, 9999, 10000]) {
    const measurement = measured(plan, coverage, 1);
    const numeric = toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] });
    const encoded = toFavoritePrecisionDocument(measurement, plan);
    assert.equal(encoded.utilities, undefined);
    for (const field of ['id', 'reference_id', 'cohort', 'partition', 'tags']) assert.deepEqual(encoded[field], numeric[field]);
    for (const encoding of ['rank18', 'rank27']) {
      let expectedCount = 0;
      for (const descriptor of plan.descriptors) {
        const group = encoded[favoritePrecisionRankField(encoding, descriptor.parameters)];
        const digits = favoritePrecisionDigits(numeric.utilities[descriptor.key], encoding);
        digits.forEach((digit, index) => {
          assert.equal(group[descriptor.key + '_d' + index] ?? 0, digit);
          if (digit) expectedCount++;
        });
      }
      assert.equal(favoritePrecisionEncodingValueCount(encoded, encoding), expectedCount);
      if (coverage === 0) assert.equal(expectedCount, 0);
    }
    assert.deepEqual(toFavoritePrecisionDocument(measurement, JSON.parse(JSON.stringify(plan))), encoded);
  }
  assert.throws(() => toFavoritePrecisionDocument({ id: 'incomplete' }, plan), /measurement/i);
});

test('mappings disable source by default and partition frequencies safely for a full preset bank', () => {
  const plan = createFavoriteUtilityPlan({ presets: [{}] });
  const mapping = favoritePrecisionMapping(plan);
  assert.equal(mapping.mappings._source.enabled, false);
  assert.equal(mapping.mappings.dynamic, 'strict');
  assert.equal(mapping.mappings.properties.utilities, undefined);
  const indexed = toFavoritePrecisionDocument(measured(plan), plan);
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, 511); const largestEncodedFrequency = view.getUint32(0) >>> 15;
  for (const encoding of ['rank18', 'rank27']) {
    const field = favoritePrecisionRankField(encoding);
    assert.deepEqual(mapping.mappings.properties[field], { type: 'rank_features', positive_score_impact: true });
    let total = 0;
    for (const value of Object.values(indexed[field])) { view.setFloat32(0, value); total += view.getUint32(0) >>> 15; }
    assert.ok(total < 2147483647);
    assert.ok(plan.utilityCount * (encoding === 'rank18' ? 2 : 3) * largestEncodedFrequency < 2147483647);
  }
  const one = favoritePrecisionMapping(plan, { source: true, encodings: ['rank27'] });
  assert.equal(one.mappings._source.enabled, true);
  assert.equal(one.mappings.properties[favoritePrecisionRankField('rank18')], undefined);
  for (const encodings of [[], ['bad'], ['rank18', 'rank18']]) assert.throws(() => favoritePrecisionMapping(plan, { encodings }));
});

test('queries retain native eligibility, zero scores and global sorting, with two or three terms per color', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }, { name: 'grayscale', percent: 60 }], subject: 'city' };
  const options = { query, limit: 50, eligibleIds: ['sample', 'b'], excludedIds: ['b'], filter: { term: { partition: 3 } } };
  const native = buildFavoriteUtilityQuery(options);
  for (const method of FAVORITE_PRECISION_METHODS) {
    const body = buildFavoritePrecisionQuery({ ...options, method });
    const { should: _old, ...expectedBool } = native.query.bool;
    const { should, ...actualBool } = body.query.bool;
    assert.deepEqual(actualBool, expectedBool);
    assert.deepEqual(body.sort, native.sort);
    assert.equal(body.size, 50);
    assert.equal(body._source, false);
    assert.equal(body.track_total_hits, false);
    assert.equal(should.length, (method.encoding === 'rank18' ? 2 : 3) * 2);
    for (const term of should) { assert.deepEqual(term.rank_feature.linear, {}); assert.ok(term.rank_feature.boost > 0); }
    assert.ok(!JSON.stringify(body).includes('rescore'));
    assert.ok(!JSON.stringify(body).includes('script_score'));
  }
});

test('query term arithmetic agrees with the encoding oracle for mixed targets and preset values', () => {
  const queries = [red,
    { mode: 'proportions', targets: [{ color: '#ff0000', percent: 0 }, { name: 'dark', percent: 40 }] },
    { mode: 'proportions', targets: ['#ff0000', '#ff8800', '#ffff00', '#00ff00', '#0000ff'].map(color => ({ color, percent: 20 })) }];
  for (const query of queries) for (const qualityInfluence of [0, .5, 1]) for (const cutoffBlendExponent of [0, 1, 3]) {
    const parameters = { qualityInfluence, cutoffBlendExponent };
    const plan = createFavoriteUtilityPlan({ requests: [{ query, parameters }] });
    const measurement = measured(plan);
    const document = toFavoritePrecisionDocument(measurement, plan);
    for (const method of FAVORITE_PRECISION_METHODS) {
      const body = buildFavoritePrecisionQuery({ method, query, parameters });
      let score = 0;
      for (const term of body.query.bool.should) {
        const { field, boost } = term.rank_feature;
        const value = field.split('.').reduce((value, key) => value?.[key], document) ?? 0;
        score += Math.fround(value * Math.fround(boost));
      }
      assert.equal(Math.fround(score), favoritePrecisionReference(measurement, query, { method, parameters }));
      const precise = favoriteUtilityReference(measurement, query, { parameters });
      assert.ok(Math.abs(Math.fround(score) - precise) <= .5 / scaleFor(method.encoding) + 2e-7);
    }
  }
});

test('zero and near-one complete utility scores remain bounded after float32 boost arithmetic', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  for (const coverage of [0, 1, 9999, 10000]) for (const quality of [0, .5, 1]) {
    const measurement = measured(plan, coverage, quality);
    const expected = favoriteUtilityReference(measurement, red);
    for (const method of FAVORITE_PRECISION_METHODS) {
      const score = favoritePrecisionReference(measurement, red, { method });
      assert.ok(Math.abs(score - expected) <= .5 / scaleFor(method.encoding) + 2e-7);
      if (coverage === 0) assert.equal(score, 0);
    }
  }
});
