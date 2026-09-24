import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCutoffTargets } from './methods-cutoff.mjs';
import { FAVORITE_METHOD, FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import {
  FAVORITE_UTILITY_METHODS, favoriteUtilityParameters, supportsFavoriteUtilities,
  createFavoriteUtilityPlan, favoriteUtilityMapping, toFavoriteUtilityDocument,
  buildFavoriteUtilityQuery, favoriteUtilityReference, quantizeRankFeature,
  favoriteUtilityRankField, favoriteUtilityEncodingValueCount,
} from './favorite-utilities.mjs';

const red = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const params = { ...FAVORITE_PARAMETERS, bucketCount: 256 };
function measurement(query = red, observations = [[.4, .6]], parameters = params) {
  const doc = { id: 'a', tags: ['city'], cohort: 'real', partition: 3 };
  for (const target of resolveCutoffTargets(FAVORITE_METHOD, query, { parameters }).targets) {
    target.components.forEach((component, i) => {
      const [coverage, quality] = observations[i % observations.length];
      doc[component.coverageField] = Math.round(coverage * 10000);
      doc[component.qualityField] = Math.fround(quality);
    });
  }
  return doc;
}
const near = (actual, expected, tolerance = 2e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} versus ${expected}`);

test('defaults preserve favorite256 and unsupported controls or off-grid targets are explicit', () => {
  assert.deepEqual(favoriteUtilityParameters(), params);
  for (const parameters of [{ bucketCount: 1024 }, { qualityInfluence: .7 }, { cutoffBlendExponent: 2 }, { minimumQuality: .1 }, { qualityCurve: 'power' }, { areaPower: 1 }, { bogus: 1 }]) {
    assert.throws(() => favoriteUtilityParameters(parameters));
  }
  for (const method of FAVORITE_UTILITY_METHODS) {
    assert.equal(supportsFavoriteUtilities(method.id, red).supported, true);
    const offGrid = supportsFavoriteUtilities(method.id, { mode: 'proportions', targets: [{ color: '#ff0000', percent: 42 }] });
    assert.equal(offGrid.supported, false);
    assert.match(offGrid.reason, /5%/);
    assert.equal(supportsFavoriteUtilities(method.id, { targets: [{ color: '#ff0000', distance: .12 }] }).supported, false);
  }
});

test('utility plans resolve arbitrary hex and names to unchanged anchors and deduplicate reused observations', () => {
  const query = { mode: 'proportions', targets: [{ color: '#fa0102', percent: 40 }, { name: 'grayscale', percent: 60 }] };
  const expected = resolveCutoffTargets(FAVORITE_METHOD, query, { parameters: params });
  const plan = createFavoriteUtilityPlan({ requests: [{ query }, { query }] });
  assert.equal(plan.descriptors.length, 2);
  for (const descriptor of plan.descriptors) {
    const target = expected.targets.find(t => t.kind === descriptor.kind && t.regionIndex === descriptor.regionIndex && t.name === descriptor.name);
    assert.ok(target);
    assert.deepEqual(descriptor.components, target.components);
  }
  assert.equal(new Set(plan.measurementFields).size, 12);
});

test('full plan includes every256 anchor and23 named features with all requested presets and target grid', () => {
  const plan = createFavoriteUtilityPlan({ presets: [{ qualityInfluence: .5, cutoffBlendExponent: 1 }, { qualityInfluence: 1, cutoffBlendExponent: 3 }] });
  assert.equal(plan.descriptors.length, (256 + 23) * 22 * 2);
  assert.equal(new Set(plan.descriptors.map(d => d.key)).size, plan.descriptors.length);
  assert.equal(new Set(plan.measurementFields).size, 2560 + 46);
});

test('numeric precomputation retains each cutoff contribution rather than scoring averaged measurements', () => {
  const observations = [[1, .1], [.8, .4], [.5, .7], [.3, .9], [.1, .97]];
  const doc = measurement(red, observations), plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const indexed = toFavoriteUtilityDocument(doc, plan, { encodings: ['numeric'] });
  const components = resolveCutoffTargets(FAVORITE_METHOD, red, { parameters: params }).targets[0].components;
  const expected = components.reduce((sum, component, i) => sum + component.componentWeight * Math.sqrt(observations[i][0]) * (.5 + .5 * Math.fround(observations[i][1])), 0);
  near(indexed.utilities[plan.descriptors[0].key], expected);
  near(favoriteUtilityReference(doc, red, { method: 'favorite-utility-numeric' }), expected);
  const averageArea = components.reduce((sum, c, i) => sum + c.componentWeight * observations[i][0], 0);
  const averageQuality = components.reduce((sum, c, i) => sum + c.componentWeight * observations[i][1], 0);
  assert.ok(Math.abs(expected - Math.sqrt(averageArea) * (.5 + .5 * averageQuality)) > .01);
});

test('proportions preserve asymmetric excess penalty, conditional quality and zero-target bypass', () => {
  for (const actual of [.1, .4, .8]) {
    const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }] };
    const doc = measurement(query, [[actual, .6]]);
    const expected = Math.max(0, 1 - Math.abs(actual - .4) * (actual > .4 ? 1.5 : 1)) * (1 - .35 * .5 * (1 - Math.fround(.6)));
    near(favoriteUtilityReference(doc, query), expected);
  }
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 0 }, { name: 'grayscale', percent: 100 }] };
  const doc = measurement(query, [[0, 0]]);
  near(favoriteUtilityReference(doc, query), .5);
});

test('rank8 and split rank16 utilities have bounded errors and positive exactly representable terms', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  for (let i = 0; i <= 100; i++) {
    const doc = measurement(red, [[i / 100, .71]]), indexed = toFavoriteUtilityDocument(doc, plan);
    const precise = favoriteUtilityReference(doc, red);
    near(favoriteUtilityReference(doc, red, { method: 'favorite-utility-rank8' }), precise, 1 / 510 + 2e-7);
    near(favoriteUtilityReference(doc, red, { method: 'favorite-utility-rank16' }), precise, 1 / 131070 + 2e-7);
    for (const object of [indexed[favoriteUtilityRankField('rank8', params)], indexed[favoriteUtilityRankField('rank16', params)]]) for (const value of Object.values(object)) {
      assert.ok(Number.isInteger(value) && value >= 1 && value <= 255);
      assert.equal(quantizeRankFeature(value), value);
    }
  }
  assert.equal(quantizeRankFeature(0), 0);
  near(quantizeRankFeature(.7), .69921875, 0);
  assert.throws(() => quantizeRankFeature(-1));
  assert.throws(() => quantizeRankFeature(Infinity));
});

test('query builders rank globally with numeric or linear feature terms and preserve zero-score eligible docs', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }, { name: 'grayscale', percent: 60 }], subject: 'city' };
  for (const method of FAVORITE_UTILITY_METHODS) {
    const body = buildFavoriteUtilityQuery({ method: method.id, query, limit: 20, excludedIds: ['x'], filter: { term: { cohort: 'real' } } });
    assert.deepEqual(body.sort, [{ _score: 'desc' }, { id: 'asc' }]);
    assert.equal(body.track_total_hits, false);
    assert.equal(body.query.bool.minimum_should_match, 0);
    assert.deepEqual(body.query.bool.must, [{ constant_score: { filter: { match_all: {} }, boost: 0 } }]);
    assert.equal(body.query.bool.should.length, method.encoding === 'rank16' ? 4 : 2);
    const serialized = JSON.stringify(body);
    assert.ok(serialized.includes('city') && serialized.includes('cohort') && serialized.includes('"x"'));
    assert.ok(!serialized.includes('script_score') && !serialized.includes('rescore') && !serialized.includes('terminate_after'));
    if (method.encoding !== 'numeric') for (const term of body.query.bool.should) assert.deepEqual(term.rank_feature.linear, {});
  }
  const doc = measurement(red, [[0, 0]]), plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const indexed = toFavoriteUtilityDocument(doc, plan);
  assert.deepEqual(indexed[favoriteUtilityRankField('rank8', params)], {});
  assert.deepEqual(indexed[favoriteUtilityRankField('rank16', params)], {});
  assert.deepEqual(indexed[favoriteUtilityRankField('rankfloat', params)], {});
  for (const method of FAVORITE_UTILITY_METHODS) assert.equal(favoriteUtilityReference(doc, red, { method }), 0);
});

test('projection mappings and documents expose only selected encodings and reject missing measurement data', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: red }] });
  const mapping = favoriteUtilityMapping(plan, { source: false, encodings: ['rank16'] });
  assert.equal(mapping.mappings._source.enabled, false);
  assert.equal(mapping.mappings.dynamic, 'strict');
  assert.equal(mapping.mappings.properties[favoriteUtilityRankField('rank16', params)].type, 'rank_features');
  assert.equal(mapping.mappings.properties.utilities, undefined);
  const doc = toFavoriteUtilityDocument(measurement(), plan, { encodings: ['rank16'] });
  assert.equal(doc.utilities, undefined);
  assert.equal(doc.utility_rank8, undefined);
  assert.deepEqual(doc.tags, ['city']);
  assert.throws(() => toFavoriteUtilityDocument({ id: 'incomplete' }, plan), /measurement/i);
  assert.throws(() => favoriteUtilityMapping(plan, { encodings: ['bad'] }), /encoding/i);
});

test('full nine-preset bank partitions rank features below Lucene per-field frequency overflow', () => {
  const presets = [0, .5, 1].flatMap(qualityInfluence => [0, 1, 3].map(cutoffBlendExponent => ({ qualityInfluence, cutoffBlendExponent })));
  const plan = createFavoriteUtilityPlan({ presets });
  assert.equal(plan.utilityCount, 55242);
  const document = { id: 'overflow-regression', ...Object.fromEntries(plan.measurementFields.map(field => [field, field.startsWith('cov_') ? 4000 : Math.fround(.8)])) };
  const indexed = toFavoriteUtilityDocument(document, plan, { encodings: ['rank8', 'rank16', 'rankfloat'] });
  const mapping = favoriteUtilityMapping(plan, { encodings: ['rank8', 'rank16', 'rankfloat'] });
  const fields = Object.keys(mapping.mappings.properties).filter(field => field.startsWith('utility_'));
  assert.equal(fields.length, 27);
  const data = new DataView(new ArrayBuffer(4));
  let legacyRank16Total = 0;
  for (const field of fields) {
    assert.equal(mapping.mappings.properties[field].type, 'rank_features');
    let sum = 0;
    for (const value of Object.values(indexed[field])) {
      data.setFloat32(0, value);
      sum += data.getUint32(0) >>> 15;
    }
    assert.ok(sum < 2147483647, `${field}: encoded term-frequency sum ${sum}`);
    if (field.startsWith('utility_rank16_')) legacyRank16Total += sum;
    const expectedMaximumTerms = field.startsWith('utility_rank16_') ? 12276 : 6138;
    // A per-preset worst-case bound, independent of this sample's values.
    assert.ok(expectedMaximumTerms * 34558 < 2147483647);
  }
  assert.ok(legacyRank16Total > 2147483647, 'this fixture reproduces the old unsplit field overflow');
  for (const parameters of presets) for (const method of FAVORITE_UTILITY_METHODS.filter(method => method.encoding !== 'numeric')) {
    const body = buildFavoriteUtilityQuery({ method, query: red, parameters });
    for (const clause of body.query.bool.should) assert.ok(clause.rank_feature.field.startsWith(favoriteUtilityRankField(method.encoding, parameters) + '.'));
  }
});

test('index receipts count values across preset partitions without counting metadata', () => {
  const document = { id: 'x', utilities: { a: .1, b: .2 }, utility_rank16_q000_w0: { a_hi: 1, a_lo: 2 },
    utility_rank16_q050_w1: { b_hi: 3 }, utility_rank8_q050_w1: { b: 4 }, utility_rankfloat_q050_w1: {} };
  assert.equal(favoriteUtilityEncodingValueCount(document, 'numeric'), 2);
  assert.equal(favoriteUtilityEncodingValueCount(document, 'rank16'), 3);
  assert.equal(favoriteUtilityEncodingValueCount(document, 'rank8'), 1);
  assert.equal(favoriteUtilityEncodingValueCount(document, 'rankfloat'), 0);
});

test('persisted plans reproduce all encodings and every native query term matches its indexed utility', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 40 }, { name: 'dark', percent: 20 }, { color: '#22cc44', percent: 40 }] };
  const plan = createFavoriteUtilityPlan({ requests: [{ query }] });
  const doc = measurement(query, [[.25, .77], [.15, .89], [.04, .94]]);
  const stored = toFavoriteUtilityDocument(doc, plan);
  assert.deepEqual(toFavoriteUtilityDocument(doc, JSON.parse(JSON.stringify(plan))), stored);
  const fieldValue = field => field.split('.').reduce((value, key) => value?.[key], stored) ?? 0;
  for (const method of FAVORITE_UTILITY_METHODS) {
    const body = buildFavoriteUtilityQuery({ method, query });
    let sum = 0;
    for (const clause of body.query.bool.should) {
      if (clause.function_score) {
        const { field, factor } = clause.function_score.field_value_factor;
        sum += Math.fround(fieldValue(field) * Math.fround(factor));
      } else {
        const { field, boost } = clause.rank_feature;
        sum += Math.fround(quantizeRankFeature(fieldValue(field)) * Math.fround(boost));
      }
    }
    assert.equal(Math.fround(sum), favoriteUtilityReference(doc, query, { method }));
  }
});
