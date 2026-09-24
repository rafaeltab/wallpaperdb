import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createOverlapInspectorServer } from './overlap-inspector-server.mjs';

const query = { mode: 'proportions', targets: [{ color: '#ff0000', percent: 40 }] };
const methods = [{ id: 'overlap-quality-dense', label: 'Dense' }, { id: 'overlap-quality-hybrid', label: 'Hybrid' }];
async function fixture(t, overrides = {}) {
  const calls = [];
  const server = createOverlapInspectorServer({
    methods,
    corpus: [{ id: 'a', filename: '/unused.jpg', cohort: 'real' }, { id: 'b', filename: '/unused.svg', cohort: 'controlled-fixture' }],
    search: async request => { calls.push(['search', request]); return { hits: [{ id: 'b', score: .8 }, { id: 'a', score: .6 }] }; },
    inspect: async request => { calls.push(['inspect', request]); return { id: request.id, score: { actual: .8 }, regions: [{ index: 0, coverage: 1 }] }; },
    ...overrides,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { origin, post, calls };
}

test('search preserves service order, method selection, and the executed query', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/search', { methodId: methods[1].id, query, limit: 12, includeFixtures: true });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.hits.map(hit => hit.id), ['b', 'a']);
  assert.deepEqual(data.query, query);
  assert.equal(data.methodId, methods[1].id);
  assert.equal(data.hits[0].imageUrl, '/api/images/b');
  assert.equal(calls[0][1].method, methods[1].id);
  assert.equal(calls[0][1].includeFixtures, true);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});

test('inspection forwards the exact saved query, selected method, and registered wallpaper', async t => {
  const { post, calls } = await fixture(t);
  const response = await post('/api/inspect', { methodId: methods[1].id, id: 'a', query });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.score.actual, .8);
  assert.equal(data.regions[0].coverage, 1);
  assert.equal(data.imageUrl, '/api/images/a');
  assert.deepEqual(calls[0][1].query, query);
  assert.equal(calls[0][1].method, methods[1].id);
  assert.equal((await post('/api/inspect', { id: '../secret', query })).status, 404);
  assert.equal(calls.length, 1);
});

test('invalid controls and unknown methods never reach a search service', async t => {
  const { post, calls } = await fixture(t);
  for (const body of [
    { query, methodId: 'not-this-prototype' }, { query, limit: 101 }, { query, includeFixtures: 'yes' },
    { query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 120 }] } },
    { query: { ...query, unsupported: true } },
  ]) assert.equal((await post('/api/search', body)).status, 400);
  assert.equal(calls.length, 0);
});

test('configuration and static resources are isolated from other inspectors', async t => {
  const { origin } = await fixture(t);
  const data = await (await fetch(origin + '/api/config')).json();
  assert.deepEqual(data.methods, methods);
  assert.deepEqual(data.corpus, { total: 2, real: 1, fixtures: 1 });
  assert.ok(!JSON.stringify(data).includes('/unused'));
  assert.equal((await fetch(origin + '/api/images/unknown')).status, 404);
  assert.equal((await fetch(origin + '/assets/histogram-inspector.js')).status, 404);
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Overlapping color regions/);
});

test('invalid service results fail instead of being locally filtered', async t => {
  for (const hits of [[{ id: 'foreign', score: 1 }], [{ id: 'a', score: 1 }, { id: 'a', score: .5 }]]) {
    const { post } = await fixture(t, { search: async () => ({ hits }) });
    assert.equal((await post('/api/search', { query })).status, 502);
  }
});
