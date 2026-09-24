import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCutoffQuery } from './methods-cutoff.mjs';
import { compileFavoriteScorePlan, favoriteOptimizedParameters, scoreFavoriteReference } from './favorite-optimized-scoring.mjs';
import { api, searchIndex } from './service.mjs';
import { FAVORITE_TYPED_METHODS, buildFavoriteTypedQuery, supportsFavoriteTyped, compileFavoriteTypedScript } from './favorite-typed-scoring.mjs';

const original = 'cutoff-shade-hue-all-levels';
const vibe = { targets: [{ color: '#ff0000' }] };
const portions = { mode: 'proportions', targets: [{ color: '#ff2200', percent: 0 }, { name: 'dark', percent: 40 }] };

// This executes the generated arithmetic with JS doubles and explicit float
// casts. It checks generation/masks/parameter binding against the independent
// component oracle; the opt-in integration below validates actual Painless.
function executeGenerated(script, document) {
  const js = script.source.replace(/\b(?:double|boolean)\s+/g, 'let ')
    .replace(/\((?:double|boolean|String)\)/g, '')
    .replace(/\(float\)\(([^;]+)\)/g, 'Math.fround($1)')
    .replace('return (float)total;', 'return Math.fround(total);');
  const doc = new Proxy({}, { get: (_, field) => {
    if (!Object.hasOwn(document, field)) throw Error('Missing measurement ' + field);
    return { value: document[field] };
  } });
  return new Function('doc', 'params', js)(doc, script.params);
}

function measurements(plan, area, quality) {
  return Object.fromEntries(plan.components.flatMap((component, i) => [
    [component.coverageField, Math.round(Math.max(0, Math.min(1, area + (i % 3 - 1) * .017)) * 10000)],
    [component.qualityField, Math.fround(Math.max(0, Math.min(1, quality + (i % 3 - 1) * .013)))],
  ]));
}

test('typed method keeps defaults, limits and unsupported query behavior', () => {
  assert.equal(FAVORITE_TYPED_METHODS[0].id, 'favorite-typed-script');
  assert.equal(supportsFavoriteTyped('favorite-typed-script', vibe).supported, true);
  assert.equal(supportsFavoriteTyped('favorite-typed-script', { targets: [{ color: '#ff0000', distance: .1 }] }).supported, false);
  assert.throws(() => buildFavoriteTypedQuery({ method: 'unknown', query: vibe }), /Unknown/);
  assert.throws(() => buildFavoriteTypedQuery({ query: vibe, parameters: { qualityInfluence: 4 } }), /qualityInfluence/);
  assert.throws(() => buildFavoriteTypedQuery({ query: { targets: Array.from({ length: 11 }, () => ({ color: '#ff0000' })) } }), /ten/);
});

test('global script retains native eligibility, sorting and pagination envelope', () => {
  const options = { query: { ...vibe, subject: 'city' }, parameters: favoriteOptimizedParameters(), limit: 27,
    eligibleIds: ['a', 'b'], excludedIds: ['b'], filter: { term: { partition: 1 } } };
  const native = buildCutoffQuery({ method: original, ...options }), typed = buildFavoriteTypedQuery(options);
  assert.deepEqual(typed.query.script_score.query.bool.filter, native.query.bool.filter);
  const { query: _native, ...expected } = native, { query: _typed, ...actual } = typed;
  assert.deepEqual(actual, expected);
  assert.ok(!JSON.stringify(typed).includes('rescore'));
  assert.ok(!JSON.stringify(typed).includes('terminate_after'));
});

test('same structural shape reuses source across colors, fields, amounts, gates and numeric controls', () => {
  const a = buildFavoriteTypedQuery({ query: portions, parameters: { cutoffBlendExponent: 0, qualityInfluence: .5, minimumQuality: 0 } });
  const b = buildFavoriteTypedQuery({ query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 60 }, { name: 'light', percent: 20 }] },
    parameters: { bucketCount: 1024, cutoffBlendExponent: 4, qualityInfluence: 3, minimumQuality: .7, excessPenalty: 2.3 } });
  assert.equal(a.query.script_score.script.source, b.query.script_score.script.source);
  assert.notDeepEqual(a.query.script_score.script.params, b.query.script_score.script.params);
  const text = a.query.script_score.script.source;
  assert.ok(!text.includes('cov_'));
  assert.ok(!text.includes('qual_'));
  assert.ok(!text.includes('params.coverageFields'));
  assert.ok(!text.includes('qualityKind'));
  assert.ok(!text.includes('for ('));
});

test('generated typed arithmetic retains component float casts across all quality kinds and area modes', () => {
  for (const query of [vibe, portions, { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#22cc44', percent: 50 }] }]) {
    for (const qualityCurve of ['linear', 'power']) for (const qualityInfluence of [0, .5, 1, 3]) for (const minimumQuality of [0, .7]) for (const areaPower of [.5, 1]) {
      const options = { query, parameters: { qualityCurve, qualityInfluence, minimumQuality, areaPower, excessPenalty: 2.3, cutoffBlendExponent: 1.7 } };
      const plan = compileFavoriteScorePlan(options), script = compileFavoriteTypedScript(plan);
      for (const area of [0, .01, .4, .5, .9, 1]) for (const quality of [0, .1, .7, .9, 1]) {
        const document = measurements(plan, area, quality);
        assert.equal(executeGenerated(script, document), scoreFavoriteReference(document, plan), JSON.stringify({ query, qualityCurve, qualityInfluence, minimumQuality, areaPower, area, quality }));
      }
    }
  }
});

test('zero targets do not access quality; gates zero components without removing document eligibility', () => {
  const options = { query: portions, parameters: { qualityInfluence: 3, qualityCurve: 'power', minimumQuality: .9 } };
  const plan = compileFavoriteScorePlan(options), document = measurements(plan, .2, .8);
  for (const component of plan.components.filter(c => !c.qualityRequired)) delete document[component.qualityField];
  assert.ok(executeGenerated(compileFavoriteTypedScript(plan), document) > 0);
  assert.equal(executeGenerated(compileFavoriteTypedScript(plan), document), scoreFavoriteReference(document, plan));
  const needed = plan.components.find(c => c.qualityRequired).qualityField;
  delete document[needed];
  assert.throws(() => executeGenerated(compileFavoriteTypedScript(plan), document), /Missing/);
});

test('maximum supported target count stays below the default 65535-byte script size', () => {
  const query = { targets: Array.from({ length: 10 }, (_, i) => ({ color: `#${(0x100000 + i * 0x12345).toString(16)}` })) };
  const plan = compileFavoriteScorePlan({ query, parameters: { qualityCurve: 'power', qualityInfluence: 3 } });
  assert.equal(plan.components.length, 50);
  assert.ok(Buffer.byteLength(compileFavoriteTypedScript(plan).source) < 65535);
});

test('real OpenSearch typed scores and complete ordering match the original native query', { skip: process.env.COLOR_FAVORITE_TYPED_VERIFY !== '1' }, async () => {
  const index = 'color-exploration-shade-hue-256-real-v1';
  const count = (await api(`${index}/_count`)).body.count;
  assert.ok(count >= 523 && count <= 1000, 'integration is bounded to the retained real corpus');
  const combinations = [
    { query: vibe }, { query: portions },
    { query: { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] } },
    { query: { mode: 'proportions', targets: ['#ff2200', '#ff8800', '#ffff00', '#22cc44', '#2266ff'].map(color => ({ color, percent: 20 })) } },
    ...[0, .5, 1, 3].flatMap(qualityInfluence => ['linear', 'power'].map(qualityCurve => ({ query: vibe, parameters: { qualityInfluence, qualityCurve, minimumQuality: .7 } }))),
    { query: portions, parameters: { qualityInfluence: 3, qualityCurve: 'power', minimumQuality: .7, excessPenalty: 2.3 } },
    { query: portions, parameters: { qualityInfluence: 0, minimumQuality: .7 } },
    { query: { targets: [{ name: 'dark' }] }, parameters: { areaPower: 1 } },
  ];
  for (const options of combinations) {
    const parameters = favoriteOptimizedParameters(options.parameters), settings = { ...options, parameters, limit: count };
    const native = await searchIndex(index, buildCutoffQuery({ ...settings, method: original }));
    const typed = await searchIndex(index, buildFavoriteTypedQuery(settings));
    assert.equal(native.hits.length, count);
    assert.deepEqual(typed.hits.map(hit => [hit.id, Math.fround(hit.score)]), native.hits.map(hit => [hit.id, Math.fround(hit.score)]), JSON.stringify(options));
  }
});
