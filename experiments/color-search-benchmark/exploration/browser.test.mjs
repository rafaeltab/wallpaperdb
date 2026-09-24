import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowserServer } from './browser.mjs';

async function fixture(t, search, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'color-browser-'));
  const filename = path.join(directory, 'test.svg');
  await writeFile(filename, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const calls = [];
  const server = createBrowserServer({
    methods: [{ id: 'real-method', label: 'Real method', execution: { kind: 'opensearch' } }],
    corpus: [{ id: 'a', filename }, { id: 'b', filename }],
    search: async (request) => {
      calls.push(request);
      return search ? search(request) : { hits: [{ id: 'b', score: 0.9 }, { id: 'a', score: 0.7 }], totalEligible: 2, evidence: { took: 12 } };
    },
    ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}

const request = {
  methodId: 'real-method',
  query: { mode: 'proportions', targets: [{ name: 'green', color: '#00ff00', percent: 40, space: 'hsl', tolerance: { h: 0.2, s: 0.5, l: 0.4 }, edgeWeight: 0.5 }], unspecifiedRemainderPercent: 60 },
  limit: 24,
};
const post = (origin, body) => fetch(`${origin}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('forwards the complete query to the service and preserves its result order', async (t) => {
  const { origin, calls } = await fixture(t);
  const response = await post(origin, request);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.hits.map((hit) => hit.id), ['b', 'a']);
  assert.deepEqual(calls[0].query, request.query);
  assert.equal(calls[0].limit, 24);
  assert.equal(calls[0].methodId, 'real-method');
  assert.equal(calls[0].includeFixtures, false);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(body.evidence.took, 12);
  assert.equal(body.hits[0].imageUrl, '/api/images/b');
  assert.ok(body.elapsedMs >= 0);
});

test('forwards fixture inclusion as a service filter control without changing hits', async (t) => {
  const { origin, calls } = await fixture(t);
  const response = await post(origin, { ...request, includeFixtures: true });
  assert.equal(response.status, 200);
  assert.equal(calls[0].includeFixtures, true);
  assert.deepEqual((await response.json()).hits.map((hit) => hit.id), ['b', 'a']);
  assert.equal((await post(origin, { ...request, includeFixtures: 'yes' })).status, 400);
});

test('rejects invalid controls before searching', async (t) => {
  const { origin, calls } = await fixture(t);
  for (const body of [
    { ...request, methodId: 'unknown' },
    { ...request, limit: 5000 },
    { ...request, query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 110 }] } },
    { ...request, query: { mode: 'proportions', targets: [{ color: '#ff0000', percent: 60 }, { color: '#00ff00', percent: 60 }] } },
    { ...request, query: { mode: 'vibe', targets: [{ color: 'nope' }] } },
  ]) assert.equal((await post(origin, body)).status, 400);
  assert.equal(calls.length, 0);
});

test('serves only registered assets and static UI files', async (t) => {
  const { origin } = await fixture(t);
  assert.match(await (await fetch(origin)).text(), /Color query lab/);
  const metadata = await (await fetch(`${origin}/api/meta`)).json();
  assert.equal(metadata.corpusCount, 2);
  assert.equal(metadata.methods[0].id, 'real-method');
  assert.deepEqual(metadata.presets.find((preset) => preset.label === 'Picked orange-red · method defaults')?.query,
    { mode: 'vibe', targets: [{ color: '#ff2200' }] });
  assert.equal((await fetch(`${origin}/api/images/a`)).status, 200);
  assert.equal((await fetch(`${origin}/api/images/unknown`)).status, 404);
  assert.equal((await fetch(`${origin}/api/images/%2e%2e%2fMakefile`)).status, 404);
  assert.equal((await fetch(`${origin}/assets/../browser.mjs`)).status, 404);
  const image = await fetch(`${origin}/api/images/a`);
  assert.match(image.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await fetch(`${origin}/api/images/a`, { method: 'DELETE' })).status, 405);
});

test('fails rather than silently filtering service results outside the corpus', async (t) => {
  const { origin } = await fixture(t, async () => ({ hits: [{ id: 'not-registered', score: 1 }] }));
  const response = await post(origin, request);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /unregistered/i);
});

test('keeps unsupported method responses explicit', async (t) => {
  const { origin } = await fixture(t, async () => ({ supported: false, reason: 'Ranges are unsupported', hits: [] }));
  const response = await post(origin, request);
  const body = await response.json();
  assert.equal(body.supported, false);
  assert.equal(body.reason, 'Ranges are unsupported');
});

test('serves generated findings only through the fixed read-only route', async (t) => {
  const html = '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>Saved findings</h1></body></html>';
  const { origin } = await fixture(t, undefined, { findingsUrl: '/findings', getFindingsHtml: async () => html });
  const response = await fetch(`${origin}/findings`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(await response.text(), html);
  assert.match(response.headers.get('content-security-policy'), /script-src 'none'/);
  const head = await fetch(`${origin}/findings`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${origin}/findings`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/findings/private.html`)).status, 404);
  assert.equal((await (await fetch(`${origin}/api/meta`)).json()).findingsUrl, '/findings');
});
