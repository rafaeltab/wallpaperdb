import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFavoriteUtilityQuery } from './favorite-utilities.mjs';
import { buildFavoritePrecisionQuery } from './favorite-precision-utilities.mjs';
import { buildFavoriteSortedQuery } from './favorite-sorted-utilities.mjs';
import { FAVORITE_DOCVALUE_FETCH_METHODS, supportsFavoriteDocvalueFetch, buildFavoriteDocvalueFetchQuery,
  decodeFavoriteDocvalueFetchResponse, searchFavoriteDocvalueFetch } from './favorite-docvalue-fetch.mjs';

const index = 'color-exploration-docvalue-fetch-test';
const single = { mode: 'vibe', targets: [{ color: '#ff0000' }] };
const multiple = { mode: 'proportions', targets: [{ name: 'grayscale', percent: 80 }, { color: '#ff2200', percent: 20 }] };
const parents = {
  'favorite-utility-numeric-docvalues': options => buildFavoriteUtilityQuery({ ...options, method: 'favorite-utility-numeric' }),
  'favorite-utility-rank27-docvalues': options => buildFavoritePrecisionQuery({ ...options, method: 'favorite-utility-rank27' }),
  'favorite-utility-sorted-docvalues': options => buildFavoriteSortedQuery({ ...options, method: 'favorite-utility-sorted' }),
};
const response = hits => ({ took: 3, timed_out: false, _shards: { total: 1, successful: 1, failed: 0 },
  hits: { total: { value: 523, relation: 'eq' }, hits } });
const scoredHit = (id, score) => ({ fields: { id: [id] }, _score: score });

test('all three fetch refinements preserve their parent score, metadata filters and sort at every offered preset', () => {
  assert.deepEqual(FAVORITE_DOCVALUE_FETCH_METHODS.map(method => method.id), Object.keys(parents));
  for (const method of FAVORITE_DOCVALUE_FETCH_METHODS) for (const query of [single, multiple])
    for (const qualityInfluence of [0, .5, 1]) for (const cutoffBlendExponent of [0, 1, 3]) {
      const options = { method: method.id, query, parameters: { qualityInfluence, cutoffBlendExponent, namedMode: 'named-families' },
        limit: 12, eligibleIds: ['first', 'second'], excludedIds: ['fixture'], filter: { term: { tags: 'city' } } };
      const before = structuredClone(options), parent = parents[method.id](options), actual = buildFavoriteDocvalueFetchQuery(options);
      assert.deepEqual(actual, { ...parent, stored_fields: '_none_', docvalue_fields: ['id'] });
      assert.deepEqual(options, before);
      assert.equal(supportsFavoriteDocvalueFetch(method, query, { parameters: options.parameters }).supported, true);
    }
  assert.equal(buildFavoriteDocvalueFetchQuery({ method: 'favorite-utility-sorted-docvalues', query: single }).track_scores, false);
  assert.equal(buildFavoriteDocvalueFetchQuery({ method: 'favorite-utility-sorted-docvalues', query: multiple }).track_scores, undefined);
  assert.equal(supportsFavoriteDocvalueFetch('favorite-utility-numeric-docvalues', single, { parameters: { qualityInfluence: .7 } }).supported, false);
  assert.throws(() => buildFavoriteDocvalueFetchQuery({ method: 'unknown', query: single }), /Unknown/);
});

test('decoder retains exact service scores, zero values and tie ordering without changing the response', () => {
  const body = response([scoredHit('z', .12345679104328156), scoredHit('a', .12345679104328156), scoredHit('zero', 0)]);
  const before = structuredClone(body);
  assert.deepEqual(decodeFavoriteDocvalueFetchResponse(body, { index }), [
    { id: 'z', score: .12345679104328156 }, { id: 'a', score: .12345679104328156 }, { id: 'zero', score: 0 },
  ]);
  assert.deepEqual(body, before);
  const sorted = response([{ fields: { id: ['b'] }, _score: null, sort: [.5000000596046448, 'b'] },
    { fields: { id: ['a'] }, _score: null, sort: [.5000000596046448, 'a'] }, { fields: { id: ['zero'] }, _score: null, sort: [0, 'zero'] }]);
  assert.deepEqual(decodeFavoriteDocvalueFetchResponse(sorted, { index, scoreSource: 'opensearch-sort-value' }), [
    { id: 'b', score: .5000000596046448 }, { id: 'a', score: .5000000596046448 }, { id: 'zero', score: 0 },
  ]);
  assert.equal(sorted.hits.hits[0]._score, null);
  assert.deepEqual(decodeFavoriteDocvalueFetchResponse(response([]), { index }), []);
});

test('decoder rejects partial results, ambiguous IDs, duplicate IDs and invalid scores', () => {
  const good = response([scoredHit('first', .5), scoredHit('second', .2)]);
  for (const mutate of [
    body => { body.timed_out = true; },
    body => { body._shards.failed = 1; },
    body => { delete body.hits; },
    body => { body.hits.hits[0] = { _id: 'first', _score: .5 }; },
    body => { body.hits.hits[0].fields.id = []; },
    body => { body.hits.hits[0].fields.id = ['first', 'other']; },
    body => { body.hits.hits[0].fields.id = ['']; },
    body => { body.hits.hits[0].fields.id = [123]; },
    body => { body.hits.hits[0]._id = 'different'; },
    body => { body.hits.hits[0]._index = 'different-index'; },
    body => { body.hits.hits[1].fields.id = ['first']; },
    body => { body.hits.hits[0]._score = NaN; },
    body => { body.hits.hits[0]._score = Infinity; },
    body => { body.hits.hits[0]._score = -.1; },
    body => { body.hits.hits[0]._score = null; },
  ]) { const changed = structuredClone(good); mutate(changed); assert.throws(() => decodeFavoriteDocvalueFetchResponse(changed, { index })); }
  for (const sort of [undefined, [], [NaN, 'first'], [-.1, 'first'], [1.1, 'first'], [.5, 'different'], [.5, 'first', 'extra']]) {
    const sorted = response([{ fields: { id: ['first'] }, _score: null, sort }]);
    assert.throws(() => decodeFavoriteDocvalueFetchResponse(sorted, { index, scoreSource: 'opensearch-sort-value' }));
  }
  assert.throws(() => decodeFavoriteDocvalueFetchResponse(good, { scoreSource: 'unknown' }));
});

test('executor forwards abort/client/service budgets and decodes each parent path without application ranking', async () => {
  const controller = new AbortController();
  for (const method of FAVORITE_DOCVALUE_FETCH_METHODS) for (const query of [single, multiple]) {
    let received;
    const body = buildFavoriteDocvalueFetchQuery({ method: method.id, query });
    const sorted = body.track_scores === false;
    const result = await searchFavoriteDocvalueFetch({ index, method: method.id, query, signal: controller.signal,
      timeoutMs: 1500, serviceTimeout: '950ms' }, { request: async (route, options) => {
      received = { route, options };
      return { wallMs: 5, body: response(sorted
        ? [{ fields: { id: ['a'] }, _score: null, sort: [.7, 'a'] }, { fields: { id: ['b'] }, _score: null, sort: [0, 'b'] }]
        : [scoredHit('a', .7), scoredHit('b', 0)]) };
    } });
    assert.equal(received.route, index + '/_search?request_cache=false');
    assert.deepEqual(received.options.body, { ...body, timeout: '950ms' });
    assert.equal(received.options.signal, controller.signal);
    assert.equal(received.options.timeoutMs, 1500);
    assert.deepEqual(result.hits, [{ id: 'a', score: .7 }, { id: 'b', score: 0 }]);
    assert.equal(result.totalEligible, 523);
    assert.equal(result.evidence.scoreSource, sorted ? 'opensearch-sort-value' : 'opensearch-score');
    assert.equal(result.evidence.serviceTookMs, 3);
    assert.equal(result.evidence.httpMs, 5);
    assert.equal(result.evidence.parentMethod, method.parentMethod);
  }
});

test('executor fails without a request on invalid index or pre-aborted signals and propagates service failures', async () => {
  const controller = new AbortController(); controller.abort();
  const noRequest = async () => assert.fail('Must not send this request');
  await assert.rejects(searchFavoriteDocvalueFetch({ index, query: single, signal: controller.signal }, { request: noRequest }), error => error.name === 'AbortError');
  await assert.rejects(searchFavoriteDocvalueFetch({ index: 'production', query: single }, { request: noRequest }), /Unsafe/);
  const failure = Error('OpenSearch503');
  await assert.rejects(searchFavoriteDocvalueFetch({ index, query: single }, { request: async () => { throw failure; } }), error => error === failure);
  await assert.rejects(searchFavoriteDocvalueFetch({ index, query: single }, { request: async () => ({ body: response([scoredHit('invalid', null)]) }) }), /score/);
});
