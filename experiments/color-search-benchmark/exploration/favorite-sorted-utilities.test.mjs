import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFavoriteSortedQuery, supportsFavoriteSorted, favoriteSortedMapping, toFavoriteSortedDocument,
  decodeFavoriteSortedResponse, searchFavoriteSortedUtilities } from './favorite-sorted-utilities.mjs';
import { buildFavoriteUtilityQuery, createFavoriteUtilityPlan, favoriteUtilityMapping, toFavoriteUtilityDocument } from './favorite-utilities.mjs';

const picked = { mode: 'vibe', targets: [{ color: '#ff2200' }] };
const portions = { mode: 'proportions', targets: [{ color: '#22cc44', percent: 40 }] };
const paired = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 50 }, { color: '#00ff00', percent: 50 }] };
const parameters = { bucketCount: 256, qualityInfluence: .5, cutoffBlendExponent: 1 };
const original = options => buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' });

test('single-target sort retains the numeric scoring query, filters, zeros and deterministic ties', () => {
  for (const query of [picked, portions, { mode: 'vibe', targets: [{ name: 'dark' }] }]) {
    const options = { query, parameters, limit: 37, eligibleIds: ['a', 'b'], excludedIds: ['fixture'], filter: { term: { tags: 'city' } } };
    const native = original(options), field = native.query.bool.should[0].function_score.field_value_factor.field;
    for (const [method, trackScores] of [['favorite-utility-sorted', false], ['favorite-utility-sorted-scored', true]]) {
      const actual = buildFavoriteSortedQuery({ ...options, method });
      assert.deepEqual(actual.query, native.query);
      assert.deepEqual(actual.sort, [{ [field]: { order: 'desc', missing: 0 } }, { id: 'asc' }]);
      assert.equal(actual.track_scores, trackScores);
      assert.equal(actual.track_total_hits, false);
      assert.equal(actual._source, false);
      assert.equal(actual.size, 37);
    }
  }
});

test('multiple targets use the exact existing numeric score query and score order', () => {
  for (const method of ['favorite-utility-sorted', 'favorite-utility-sorted-scored']) {
    assert.deepEqual(buildFavoriteSortedQuery({ query: paired, parameters, method }), original({ query: paired, parameters }));
  }
});

test('preset validation is inherited without silently changing unsupported settings', () => {
  for (const qualityInfluence of [0, .5, 1]) for (const cutoffBlendExponent of [0, 1, 3]) {
    assert.equal(supportsFavoriteSorted('favorite-utility-sorted', picked, { parameters: { ...parameters, qualityInfluence, cutoffBlendExponent } }).supported, true);
  }
  for (const patch of [{ qualityInfluence: .8 }, { cutoffBlendExponent: 2 }, { bucketCount: 1024 }]) {
    assert.equal(supportsFavoriteSorted('favorite-utility-sorted', picked, { parameters: { ...parameters, ...patch } }).supported, false);
    assert.throws(() => buildFavoriteSortedQuery({ query: picked, parameters: { ...parameters, ...patch } }));
  }
  assert.throws(() => buildFavoriteSortedQuery({ method: 'unknown', query: picked }));
});

test('new mapping indexes the same float utilities as points and doc values without changing the old mapping or measurements', () => {
  const plan = createFavoriteUtilityPlan({ requests: [{ query: picked, parameters }] });
  const native = favoriteUtilityMapping(plan, { encodings: ['numeric'] }), mapping = favoriteSortedMapping(plan);
  assert.deepEqual(mapping.mappings._source, { enabled: false });
  assert.equal(mapping.settings.number_of_replicas, 0);
  for (const field of Object.values(mapping.mappings.properties.utilities.properties)) assert.deepEqual(field, { type: 'float', index: true, doc_values: true });
  assert.ok(Object.values(native.mappings.properties.utilities.properties).every(field => field.index === false));
  const measurement = { id: 'zero', ...Object.fromEntries(plan.measurementFields.map(field => [field, 0])) };
  assert.deepEqual(toFavoriteSortedDocument(measurement, plan), toFavoriteUtilityDocument(measurement, plan, { encodings: ['numeric'] }));
  assert.ok(Object.values(toFavoriteSortedDocument(measurement, plan).utilities).every(value => value === 0));
});

test('sort-value decoding preserves server order and ties, including zero scores', () => {
  const response = { took: 2, hits: { hits: [
    { _id: 'b', _score: null, sort: [.8, 'b'] },
    { _id: 'c', _score: null, sort: [.8, 'c'] },
    { _id: 'a', _score: null, sort: [0, 'a'] },
  ] } };
  const saved = structuredClone(response);
  assert.deepEqual(decodeFavoriteSortedResponse(response), [{ id: 'b', score: .8 }, { id: 'c', score: .8 }, { id: 'a', score: 0 }]);
  assert.deepEqual(response, saved);
  for (const bad of [{ timed_out: true }, { _shards: { failed: 1 } }, { hits: { hits: [{ _id: 'x', sort: [null] }] } },
    { hits: { hits: [{ _id: 'x', sort: [.8] }, { _id: 'x', sort: [.7] }] } },
    { hits: { hits: [{ _id: 'x', sort: [1.1] }] } }]) assert.throws(() => decodeFavoriteSortedResponse({ ...response, ...bad }));
});

test('service search uses decoded server sort values only for the fast single-target path', async () => {
  const calls = [], controller = new AbortController();
  const dependencies = {
    request: async (route, options) => {
      calls.push({ route, ...options });
      return { wallMs: 5, body: { took: 3, hits: { hits: [{ _id: 'b', _score: null, sort: [.25, 'b'] }, { _id: 'a', _score: null, sort: [0, 'a'] }] } } };
    },
    search: async (index, body, options) => {
      calls.push({ index, body, ...options });
      return { hits: [{ id: 'original', score: .7 }], evidence: { serviceTookMs: 2 } };
    },
  };
  const options = { index: 'color-exploration-sort-test', query: picked, parameters, signal: controller.signal, timeoutMs: 1500, serviceTimeout: '950ms' };
  const fast = await searchFavoriteSortedUtilities(options, dependencies);
  assert.deepEqual(fast.hits, [{ id: 'b', score: .25 }, { id: 'a', score: 0 }]);
  assert.equal(fast.evidence.scoreSource, 'opensearch-sort-value');
  assert.equal(fast.evidence.httpMs, 5);
  assert.match(calls[0].route, /request_cache=false/);
  assert.equal(calls[0].body.track_scores, false);
  assert.equal(calls[0].body.timeout, '950ms');
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(calls[0].timeoutMs, 1500);
  const fallback = await searchFavoriteSortedUtilities({ ...options, query: paired }, dependencies);
  assert.deepEqual(fallback.hits, [{ id: 'original', score: .7 }]);
  assert.deepEqual(calls[1].body, { ...original({ query: paired, parameters }), timeout: '950ms' });
  const control = await searchFavoriteSortedUtilities({ ...options, method: 'favorite-utility-sorted-scored' }, dependencies);
  assert.equal(control.evidence.scoreSource, 'opensearch-score');
  assert.equal(calls[2].body.track_scores, true);
  assert.equal(calls[2].body.timeout, '950ms');
  await assert.rejects(searchFavoriteSortedUtilities({ ...options, index: 'production' }, dependencies), /Unsafe/);
});
