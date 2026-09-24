import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_MULTIPLICITY_METHODS, groupFavoriteUtilityTerms, buildFavoriteMultiplicityQuery, searchFavoriteMultiplicity } from './favorite-multiplicity-utilities.mjs';
import { buildFavoriteDocvalueQuery } from './favorite-docvalue-fetch.mjs';
import { buildFavoriteBoundedQuery } from './favorite-bounded-utilities.mjs';
import { FIDELITY_QUERIES } from './favorite-optimization-fidelity.mjs';
import { favoriteWideQueries } from './favorite-wide-workload.mjs';
const index = 'color-exploration-multiplicity-proposal';
const duplicate = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#fe0000', percent: 50 }] };
const factors = body => body.query.bool.should.map(term => term.function_score.field_value_factor);
const parentBody = (method, options) => method.parentMethod === 'favorite-utility-bounded' ? buildFavoriteBoundedQuery(options)
  : buildFavoriteDocvalueQuery({ ...options, method: method.parentMethod });

test('duplicate red targets and nearby colors resolving to one anchor keep their full mean', () => {
  for (const query of [duplicate, { ...duplicate, targets: duplicate.targets.map(target => ({ ...target, color: '#ff0000' })) }]) {
    for (const method of FAVORITE_MULTIPLICITY_METHODS) {
      const parent = parentBody(method, { query }), before = JSON.stringify(parent), grouped = groupFavoriteUtilityTerms(parent);
      assert.equal(grouped.evidence.corrected, true); assert.equal(grouped.evidence.targetCount, 2);
      assert.equal(grouped.evidence.distinctUtilityCount, 1); assert.equal(factors(grouped.body)[0].factor, 1);
      assert.equal(JSON.stringify(parent), before);
      assert.deepEqual(buildFavoriteMultiplicityQuery({ method, query }), grouped.body);
    }
  }
});

test('mixed multiplicities retain original denominator and do not merge different requested amounts', () => {
  const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 20 }, { color: '#fe0000', percent: 20 }, { color: '#0000ff', percent: 20 }] };
  const body = buildFavoriteMultiplicityQuery({ query });
  assert.deepEqual(factors(body).map(term => term.factor), [2 / 3, 1 / 3]);
  const [red, blue] = factors(body);
  const serviceFormula = values => Math.fround(factors(body).reduce((sum, term) => sum + Math.fround(values[term.field] * Math.fround(term.factor)), 0));
  assert.ok(Math.abs(serviceFormula({ [red.field]: .9, [blue.field]: .3 }) - .7) < 1e-7);
  const unequal = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 20 }, { color: '#fe0000', percent: 40 }] };
  assert.equal(factors(buildFavoriteMultiplicityQuery({ query: unequal })).length, 2);
  assert.equal(factors(buildFavoriteMultiplicityQuery({ query: unequal }))[0].factor, .5);
});

test('all 144 existing fidelity query/preset bodies remain byte-identical for distinct utility keys', () => {
  for (const qualityInfluence of [0, .5, 1]) for (const cutoffBlendExponent of [0, 1, 3]) for (const { query } of FIDELITY_QUERIES) {
    for (const method of FAVORITE_MULTIPLICITY_METHODS) {
      const options = { query, parameters: { qualityInfluence, cutoffBlendExponent }, eligibleIds: ['a'], excludedIds: ['b'], limit: 20 };
      const parent = parentBody(method, options), grouped = groupFavoriteUtilityTerms(parent);
      assert.equal(grouped.evidence.corrected, false);
      assert.equal(grouped.body, parent);
      assert.equal(JSON.stringify(buildFavoriteMultiplicityQuery({ method, ...options })), JSON.stringify(parent));
    }
  }
});

test('every wide workload body preserves filters and sorts, and only duplicate resolved utilities change', () => {
  let changed = 0, unchanged = 0;
  for (const item of favoriteWideQueries()) {
    const parent = parentBody(FAVORITE_MULTIPLICITY_METHODS[0], item), { body, evidence } = groupFavoriteUtilityTerms(parent);
    assert.deepEqual(body.sort, parent.sort); assert.deepEqual(body.query.bool.filter, parent.query.bool.filter);
    if (evidence.corrected) {
      changed++;
      assert.equal(new Set(factors(body).map(term => term.field)).size, factors(body).length);
      assert.ok(Math.abs(factors(body).reduce((sum, term) => sum + term.factor, 0) - 1) < 1e-15);
    } else { unchanged++; assert.equal(JSON.stringify(body), JSON.stringify(parent)); }
  }
  assert.equal(changed + unchanged, 8184);
  console.log(JSON.stringify({ wideQueryBodies: 8184, changedDuplicateBodies: changed, byteIdenticalDistinctBodies: unchanged }));
});

test('unknown clause shapes fail closed instead of partially rewriting another scoring objective', () => {
  const body = parentBody(FAVORITE_MULTIPLICITY_METHODS[0], { query: duplicate });
  for (const mutate of [value => { value.query.bool.should[0].function_score.boost_mode = 'multiply'; },
    value => { value.query.bool.should[0].function_score.field_value_factor.factor = .1; },
    value => { value.query.bool.should.push({ rank_feature: { field: 'other' } }); }]) {
    const changed = structuredClone(body); mutate(changed); assert.throws(() => groupFavoriteUtilityTerms(changed), /Unsupported/);
  }
});

test('bounded duplicates use a globally complete corrected query while distinct targets delegate the frozen executor', async () => {
  const method = FAVORITE_MULTIPLICITY_METHODS[2], controller = new AbortController();
  let requests = 0, delegated = 0;
  const dependencies = {
    request: async (route, options) => {
      requests++; assert.equal(route, index + '/_search?request_cache=false');
      assert.equal(options.signal, controller.signal); assert.equal(options.timeoutMs, 1500); assert.equal(options.body.timeout, '950ms');
      assert.equal(factors(options.body)[0].factor, 1);
      assert.ok(!JSON.stringify(options.body).includes('"range"'));
      return { body: { hits: { hits: [{ fields: { id: ['b'] }, _score: .8 }, { fields: { id: ['a'] }, _score: .8 }] }, took: 3 }, wallMs: 4 };
    },
    boundedSearch: async options => { delegated++; assert.equal(options.request, dependencies.request); return { hits: [{ id: 'a', score: .5 }], evidence: { original: true } }; },
  };
  const result = await searchFavoriteMultiplicity({ index, method, query: duplicate, signal: controller.signal, timeoutMs: 1500, serviceTimeout: '950ms' }, dependencies);
  assert.deepEqual(result.hits, [{ id: 'b', score: .8 }, { id: 'a', score: .8 }]);
  assert.equal(result.evidence.globalBounds.fallback, 'duplicate-targets-global-query');
  assert.equal(requests, 1); assert.equal(delegated, 0);
  const distinct = await searchFavoriteMultiplicity({ index, method, query: { mode: 'vibe', targets: [{ color: '#ff0000' }] } }, dependencies);
  assert.equal(distinct.evidence.original, true); assert.equal(delegated, 1); assert.equal(requests, 1);
});
