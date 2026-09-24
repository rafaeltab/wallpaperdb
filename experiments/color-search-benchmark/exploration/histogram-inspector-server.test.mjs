import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createHistogramInspectorServer } from './histogram-inspector-server.mjs';

const query = { mode: 'proportions', targets: [{ name: 'green', color: '#25a34a', percent: 40 }], unspecifiedRemainderPercent: 60 };
async function fixture(t, overrides = {}) {
  const calls = [];
  const server = createHistogramInspectorServer({
    method: { id: 'histogram-intent-balanced', label: 'Fine histogram' },
    corpus: [{ id: 'a', filename: '/unused.jpg', cohort: 'real' }, { id: 'b', filename: '/unused.svg', cohort: 'controlled-fixture' }],
    search: async request => { calls.push(['search', request]); return { hits: [{ id: 'b', score: .8 }, { id: 'a', score: .6 }] }; },
    inspect: async request => { calls.push(['inspect', request]); return { id: request.id, serviceScore: .8, bins: [{ id: 0, count: 1 }] }; },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { origin, post, calls };
}

test('separate inspector preserves service result order and the executed query', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/search', { query, limit: 12, includeFixtures: true });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.hits.map(hit => hit.id), ['b', 'a']);
  assert.deepEqual(data.query, query);
  assert.equal(data.hits[0].imageUrl, '/api/images/b');
  assert.equal(calls[0][1].limit, 12);
  assert.equal(calls[0][1].includeFixtures, true);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test('inspection forwards the exact query and registered wallpaper ID', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/inspect', { id: 'a', query });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.serviceScore, .8);
  assert.equal(data.bins[0].count, 1);
  assert.equal(data.imageUrl, '/api/images/a');
  assert.deepEqual(calls[0][1].query, query);
  assert.equal(calls[0][1].id, 'a');
  assert.equal((await post('/api/inspect', { id: '../secret', query })).status, 404);
  assert.equal(calls.length, 1);
});

test('invalid queries and unknown controls never reach a search service', async t => {
  const { post, calls } = await fixture(t);
  for (const body of [
    { query, limit: 101 }, { query, includeFixtures: 'yes' },
    { query: { mode: 'proportions', targets: [{ name: 'green', percent: 120 }] } },
    { query: { ...query, unsupported: true } },
  ]) assert.equal((await post('/api/search', body)).status, 400);
  assert.equal(calls.length, 0);
});

test('configuration reports corpus cohorts without exposing file paths', async t => {
  const { origin } = await fixture(t);
  const response = await fetch(origin + '/api/config');
  const data = await response.json();
  assert.equal(data.method.id, 'histogram-intent-balanced');
  assert.deepEqual(data.corpus, { total: 2, real: 1, fixtures: 1 });
  assert.equal(data.namedColors.red, '#ef2020');
  assert.ok(data.presets.length > 0);
  assert.ok(!JSON.stringify(data).includes('/unused'));
  assert.equal((await fetch(origin + '/api/images/unknown')).status, 404);
  assert.equal((await fetch(origin + '/assets/../histogram-inspector-server.mjs')).status, 404);
});

test('foreign results and duplicate IDs fail instead of being locally filtered', async t => {
  for (const hits of [[{ id: 'foreign', score: 1 }], [{ id: 'a', score: 1 }, { id: 'a', score: .5 }]]) {
    const { post } = await fixture(t, { search: async () => ({ hits }) });
    assert.equal((await post('/api/search', { query })).status, 502);
  }
});
