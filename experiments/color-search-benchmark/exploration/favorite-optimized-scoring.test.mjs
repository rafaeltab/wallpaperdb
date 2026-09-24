import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCutoffQuery, resolveCutoffTargets } from './methods-cutoff.mjs';
import { api, searchIndex } from './service.mjs';
import {
  FAVORITE_OPTIMIZED_METHODS, favoriteOptimizedParameters, supportsFavoriteOptimized,
  compileFavoriteScorePlan, buildFavoriteOptimizedQuery, scoreFavoriteReference,
} from './favorite-optimized-scoring.mjs';

const original = 'cutoff-shade-hue-all-levels';
const vibe = { targets: [{ color: '#ff0000' }] };
const portions = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'dark', percent: 40 }] };

// Independent interpreter of the existing native query, for correctness only.
// It models OpenSearch 2.11's float weight/factor and component rounding.
function nativeReference(body, doc) {
  let sum = 0;
  for (const { function_score: clause } of body.query.bool.should) {
    let product = 1;
    for (const fn of clause.functions) {
      if (fn.filter?.range) {
        const [[field, range]] = Object.entries(fn.filter.range), value = doc[field];
        if (range.lt != null && !(value < range.lt)) continue;
        if (range.lte != null && !(value <= range.lte)) continue;
        if (range.gt != null && !(value > range.gt)) continue;
      }
      if (fn.weight != null) product *= Math.fround(fn.weight);
      if (fn.field_value_factor) {
        const { field, factor = 1, modifier } = fn.field_value_factor;
        const value = doc[field] * Math.fround(factor);
        product *= modifier === 'sqrt' ? Math.sqrt(value) : value;
      }
      if (fn.linear) {
        const [[field, { scale, decay, origin, offset }]] = Object.entries(fn.linear);
        const distance = Math.max(0, Math.abs(doc[field] - origin) - offset);
        const processed = scale / (1 - decay);
        product *= Math.max(0, (processed - distance) / processed);
      }
      if (fn.script_score) {
        const { field, penalty, exponent } = fn.script_score.script.params;
        product *= Math.pow(Math.max(0, Math.min(1, 1 - penalty * (1 - doc[field]))), exponent);
      }
    }
    sum += Math.fround(product);
  }
  return Math.fround(sum);
}

function measurements(plan, fraction = .4, quality = .8) {
  return Object.fromEntries(plan.components.flatMap(component => [
    [component.coverageField, Math.round(fraction * 10000)],
    [component.qualityField, Math.fround(quality)],
  ]));
}

test('fused execution preserves the saved defaults, validation and unsupported cases', () => {
  const parameters = favoriteOptimizedParameters();
  assert.equal(parameters.bucketCount, 256);
  assert.equal(parameters.cutoffBlendExponent, 1);
  assert.equal(parameters.qualityInfluence, .5);
  assert.equal(parameters.qualityCurve, 'linear');
  assert.equal(parameters.minimumQuality, 0);
  assert.equal(parameters.pixelCutoff, 0);
  assert.equal(FAVORITE_OPTIMIZED_METHODS[0].id, 'favorite-fused-script');
  assert.equal(supportsFavoriteOptimized('favorite-fused-script', vibe).supported, true);
  assert.equal(supportsFavoriteOptimized('favorite-fused-script', { text: 'grayscale red' }).supported, false);
  assert.equal(supportsFavoriteOptimized('favorite-fused-script', { targets: [{ color: '#ff0000', distance: .1 }] }).supported, false);
  assert.throws(() => favoriteOptimizedParameters({ qualityInfluence: 4 }), /qualityInfluence/);
  assert.throws(() => favoriteOptimizedParameters({ invalid: 1 }), /Unsupported/);
  assert.throws(() => buildFavoriteOptimizedQuery({ method: 'unknown', query: vibe }), /Unknown/);
});

test('query delegates global scoring to one parameterized script and keeps metadata eligibility and tie sorting', () => {
  const parameters = favoriteOptimizedParameters();
  const options = { query: { ...vibe, subject: 'city' }, parameters, limit: 17, excludedIds: ['synthetic'], filter: { term: { cohort: 'test' } } };
  const expected = buildCutoffQuery({ method: original, ...options });
  const actual = buildFavoriteOptimizedQuery(options);
  assert.deepEqual(actual.query.script_score.query.bool.filter, expected.query.bool.filter);
  assert.equal(actual.size, 17);
  assert.deepEqual(actual.sort, expected.sort);
  assert.equal(actual._source, false);
  assert.equal(actual.track_total_hits, false);
  assert.equal(actual.query.script_score.script.params.coverageFields.length, 5);
  assert.ok(!JSON.stringify(actual).includes('rescore'));
  assert.ok(!JSON.stringify(actual).includes('terminate_after'));
  const other = buildFavoriteOptimizedQuery({ query: portions, parameters: { qualityCurve: 'power', qualityInfluence: 3, minimumQuality: .7, cutoffBlendExponent: 5 } });
  assert.equal(actual.query.script_score.script.source, other.query.script_score.script.source);
});

test('all five layers and named terms retain anchor resolution, weights and target semantics', () => {
  const parameters = favoriteOptimizedParameters({ bucketCount: 256, cutoffBlendExponent: 2 });
  const plan = compileFavoriteScorePlan({ query: portions, parameters });
  const expected = resolveCutoffTargets(original, portions, { parameters });
  assert.deepEqual(plan.targets, expected.targets);
  assert.equal(plan.components.length, 6);
  assert.deepEqual(plan.components.slice(0, 5).map(component => component.weight), expected.targets[0].components.map(component => Math.fround(component.componentWeight / 2)));
  assert.equal(plan.components[5].weight, .5);
  assert.equal(plan.components[5].origin, 4000);
  assert.equal(plan.components[0].qualityRequired, false);
});

test('fused pure reference agrees with independently interpreted native scores across controls and measurements', () => {
  for (const query of [vibe, portions, { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] }]) {
    for (const qualityCurve of ['linear', 'power']) for (const qualityInfluence of [0, .5, 1, 3]) for (const minimumQuality of [0, .7]) {
      const parameters = favoriteOptimizedParameters({ qualityCurve, qualityInfluence, minimumQuality, cutoffBlendExponent: 1.7, excessPenalty: 2.3 });
      const options = { query, parameters }, plan = compileFavoriteScorePlan(options);
      const native = buildCutoffQuery({ method: original, ...options });
      for (const fraction of [0, .002, .2, .4, .5, .7, 1]) for (const quality of [0, .1, .699, .7, .9, 1]) {
        const doc = measurements(plan, fraction, quality);
        assert.equal(scoreFavoriteReference(doc, plan), nativeReference(native, doc), JSON.stringify({ query, qualityCurve, qualityInfluence, minimumQuality, fraction, quality }));
      }
    }
  }
});

test('minimum quality zeros individual terms without dropping documents or changing the denominator', () => {
  const options = { query: vibe, parameters: { minimumQuality: .7, qualityInfluence: 0 } };
  const plan = compileFavoriteScorePlan(options), doc = measurements(plan, .4, .7);
  const allPass = scoreFavoriteReference(doc, plan);
  doc[plan.components[2].qualityField] = Math.fround(.699);
  const partial = scoreFavoriteReference(doc, plan);
  assert.ok(partial > 0 && partial < allPass);
  assert.equal(partial, nativeReference(buildCutoffQuery({ method: original, query: vibe, parameters: plan.parameters }), doc));
  for (const component of plan.components) doc[component.qualityField] = .6;
  assert.equal(scoreFavoriteReference(doc, plan), 0);
  assert.ok(!buildFavoriteOptimizedQuery(options).query.script_score.query.bool.filter.some(filter => filter.range));
});

test('zero target bypasses quality and absent unused quality fields while missing required measurements fail explicitly', () => {
  const plan = compileFavoriteScorePlan({ query: portions, parameters: { minimumQuality: .9, qualityInfluence: 3 } });
  const doc = measurements(plan, 0, 0);
  for (const component of plan.components.slice(0, 5)) delete doc[component.qualityField];
  assert.ok(scoreFavoriteReference(doc, plan) > 0);
  delete doc[plan.components[5].coverageField];
  assert.throws(() => scoreFavoriteReference(doc, plan), /Missing/);
});

test('real OpenSearch fused scores and complete ordering match native scoring', { skip: process.env.COLOR_FAVORITE_FUSED_VERIFY !== '1' }, async () => {
  const index = 'color-exploration-shade-hue-256-real-v1';
  const count = (await api(`${index}/_count`)).body.count;
  assert.ok(count >= 523 && count <= 1000, 'read-only integration is bounded to the retained real corpus');
  const combinations = [
    { query: vibe },
    { query: portions },
    { query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] } },
    { query: { mode: 'proportions', targets: [{ color: '#ff2200', percent: 50 }, { color: '#22cc44', percent: 50 }] } },
    { query: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) } },
    { query: vibe, parameters: { qualityInfluence: 3, qualityCurve: 'linear', minimumQuality: .7, cutoffBlendExponent: 4 } },
    { query: vibe, parameters: { qualityInfluence: 3, qualityCurve: 'power', cutoffBlendExponent: 0 } },
    { query: portions, parameters: { qualityInfluence: 3, qualityCurve: 'power', minimumQuality: .7, excessPenalty: 2.3 } },
    { query: portions, parameters: { qualityInfluence: 0, minimumQuality: .7 } },
    { query: { targets: [{ name: 'dark' }] }, parameters: { areaPower: 1 } },
  ];
  for (const options of combinations) {
    const plan = compileFavoriteScorePlan(options), settings = { ...options, parameters: plan.parameters, limit: count };
    const baseline = await searchIndex(index, buildCutoffQuery({ ...settings, method: original }));
    const fused = await searchIndex(index, buildFavoriteOptimizedQuery(settings));
    assert.equal(baseline.hits.length, count);
    assert.deepEqual(fused.hits.map(hit => hit.id), baseline.hits.map(hit => hit.id), JSON.stringify(options));
    const fields = [...new Set(plan.components.flatMap(component => [component.coverageField, ...(component.qualityRequired ? [component.qualityField] : [])]))];
    const values = (await api(`${index}/_search?request_cache=false`, { method: 'POST', body: {
      size: count, _source: false, query: { match_all: {} }, sort: [{ id: 'asc' }], docvalue_fields: fields,
    } })).body;
    const documents = new Map(values.hits.hits.map(hit => [hit._id, Object.fromEntries(Object.entries(hit.fields).map(([field, value]) => [field, value[0]]))]));
    for (let i = 0; i < count; i++) {
      const expected = Math.fround(baseline.hits[i].score), actual = Math.fround(fused.hits[i].score);
      assert.equal(actual, expected, `service score ${baseline.hits[i].id}: ${JSON.stringify(options)}`);
      assert.equal(scoreFavoriteReference(documents.get(baseline.hits[i].id), plan), expected, `pure reference ${baseline.hits[i].id}: ${JSON.stringify(options)}`);
    }
  }
});
