import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFavoritePooledDeleteTransport } from './favorite-pooled-delete.mjs';

test('non-cleanup requests use the unchanged backend and cleanup pool persists across queries', async () => {
  let calls = 0; const seen = [], ports = [];
  const server = createServer(async (req, res) => { ports.push(req.socket.remotePort); const chunks = []; for await (const x of req) chunks.push(x); seen.push({ method: req.method, path: req.url, body: JSON.parse(Buffer.concat(chunks)) }); res.end('{"pits":[{"pit_id":"one","successful":true}]}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const transport = createFavoritePooledDeleteTransport({ base, request: async (route, options) => { calls++; assert.equal(route, 'index/_search'); assert.equal(options.base, base); return { body: { hits: [] } }; } });
  try {
    await transport.request('index/_search', { method: 'POST', body: {} });
    const options = { method: 'DELETE', body: { pit_id: ['one'] }, timeoutMs: 1000 };
    const first = await transport.request('_search/point_in_time', options), second = await transport.request('_search/point_in_time', options);
    assert.equal(calls, 1); assert.deepEqual(seen, Array.from({ length: 2 }, () => ({ method: 'DELETE', path: '/_search/point_in_time', body: options.body })));
    assert.equal(ports[0], ports[1]); assert.equal(first.transport.reusedSocket, false); assert.equal(second.transport.reusedSocket, true);
    assert.equal(second.transport.kind, 'favorite-pooled-pit-delete'); assert.equal(second.transport.attempts, 1);
    assert.equal(transport.snapshot().nativeDeleteCompleted, 2); assert.equal(transport.snapshot().reusedSockets, 1);
  } finally { await transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(transport.request('index/_search', {}), /closed/);
});

test('HTTP, body error, truncated response and abort failures settle without retry; close drains in-flight cleanup', async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    calls++; const chunks = []; for await (const x of req) chunks.push(x); const mode = JSON.parse(Buffer.concat(chunks)).pit_id[0];
    if (mode === 'timeout') return;
    if (mode === 'truncate') { res.writeHead(200); res.flushHeaders(); res.write('{'); setImmediate(() => res.destroy()); return; }
    if (mode === '500') res.statusCode = 500;
    res.end('{"error":{"type":"expected"}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = createFavoritePooledDeleteTransport({ base: 'http://127.0.0.1:' + server.address().port });
  const run = (mode, extra = {}) => transport.request('_search/point_in_time', { method: 'DELETE', body: { pit_id: [mode] }, timeoutMs: 1000, ...extra });
  try {
    for (const mode of ['500', 'body-error', 'truncate']) { const before = calls; await assert.rejects(run(mode), error => error.transport.kind === 'favorite-pooled-pit-delete'); assert.equal(calls, before + 1); }
    const before = calls, controller = new AbortController(), pending = run('timeout', { signal: controller.signal, timeoutMs: 30 });
    const rejected = assert.rejects(pending, error => error.code === 'ABORT_ERR' && error.transport.attempts === 1);
    await transport.close(); await rejected; assert.equal(calls, before + 1); assert.equal(transport.snapshot().inFlight, 0);
    assert.equal(transport.snapshot().nativeDeleteFailed, 4);
  } finally { await transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('already-aborted signals cannot create a successful cleanup or trigger fallback retry', async () => {
  let fallback = 0; const transport = createFavoritePooledDeleteTransport({ request: async () => { fallback++; } });
  const controller = new AbortController(); controller.abort(Error('cancelled'));
  try { await assert.rejects(transport.request('_search/point_in_time', { method: 'DELETE', body: { pit_id: ['one'] }, signal: controller.signal, timeoutMs: 100 })); assert.equal(fallback, 0); }
  finally { await transport.close(); }
});
