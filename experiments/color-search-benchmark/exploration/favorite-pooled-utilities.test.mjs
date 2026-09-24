import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITE_POOLED_METHODS, buildFavoritePooledQuery, executeFavoritePooledUtilitySearch } from './favorite-pooled-utilities.mjs';
import { buildFavoriteBoundedQuery } from './favorite-bounded-utilities.mjs';

const query = { mode: 'vibe', targets: [{ color: '#ff0000' }] }, index = 'color-exploration-pooled-test';
test('both new method builders preserve the original numeric objective exactly', () => {
  assert.equal(FAVORITE_POOLED_METHODS.length, 2);
  for (const method of FAVORITE_POOLED_METHODS) assert.deepEqual(buildFavoritePooledQuery({ method: method.id, query }), buildFavoriteBoundedQuery({ query }));
});

test('actual parent execution and PIT rotation survive wrapping, with mandatory pooled cleanup witness', async () => {
  for (const method of FAVORITE_POOLED_METHODS) {
    const calls = []; let search = 0;
    const request = async (route, options) => {
      calls.push({ route, options });
      if (route.includes('point_in_time?')) return { body: { pit_id: 'one' } };
      if (options.method === 'DELETE') return { body: { pits: options.body.pit_id.map(pit_id => ({ pit_id, successful: true })) }, transport: { kind: 'favorite-pooled-pit-delete', version: 1, attempts: 1, reusedSocket: true } };
      search++;
      return { body: { pit_id: 'two', hits: { hits: [{ fields: { id: ['x'] }, _score: .8, sort: [.8, 'x'] }] } } };
    };
    const result = await executeFavoritePooledUtilitySearch({ method: method.id, index, query, limit: 1, request, timeoutMs: 1500, serviceTimeout: '950ms' });
    assert.equal(search, 3); assert.deepEqual(result.hits, [{ id: 'x', score: .8 }]);
    assert.deepEqual(calls.at(-1).options.body, { pit_id: ['one', 'two'] });
    assert.equal(result.evidence.transport.nativeDeleteRequests, 1); assert.equal(result.evidence.transport.nativeDeleteResponses, 1); assert.equal(result.evidence.transport.reusedConnections, 1);
    assert.equal(result.evidence.globalBounds.consistency, 'point-in-time'); assert.ok(calls.every(x => x.options.timeoutMs <= 1500));
  }
});

test('an injected raw-api cleanup cannot masquerade as the pooled variant', async () => {
  const request = async (route, options) => route.includes('point_in_time?') ? { body: { pit_id: 'one' } }
    : options.method === 'DELETE' ? { body: { pits: [{ pit_id: 'one', successful: true }] } }
      : { body: { hits: { hits: [] } } };
  await assert.rejects(executeFavoritePooledUtilitySearch({ method: FAVORITE_POOLED_METHODS[0].id, index, query, request }), /pooled DELETE witness/);
});
