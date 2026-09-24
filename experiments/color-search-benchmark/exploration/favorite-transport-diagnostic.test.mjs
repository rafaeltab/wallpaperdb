import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { channel } from 'node:diagnostics_channel';
import { createServer, Agent } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { transportDiagnosticConfiguration, serializeTransportError, transportStage,
  createTransportObserver, captureTransportRequest, runTransportTrials, pooledDeleteRequest, runFavoriteTransportDiagnostic } from './favorite-transport-diagnostic.mjs';

test('configuration allows only bounded diagnostics on the isolated full-million index', () => {
  const config = transportDiagnosticConfiguration(['--directory', '/tmp/transport-new']);
  assert.equal(config.method, 'maxima'); assert.equal(config.transport, 'fetch'); assert.equal(config.concurrency, 16);
  assert.equal(config.durationMs, 30000); assert.equal(config.maximumRequests, 100000);
  for (const args of [[], ['--directory', process.cwd()], ['--directory', '/tmp/x', '--transport', 'retry'],
    ['--directory', '/tmp/x', '--duration-seconds', '301'], ['--directory', '/tmp/x', '--concurrency', '128']]) assert.throws(() => transportDiagnosticConfiguration(args));
});

test('nested network causes, AggregateError members and cycles remain serializable', () => {
  const socket = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', errno: -104, syscall: 'read' });
  const error = new TypeError('fetch failed', { cause: new AggregateError([socket], 'connections') });
  socket.cause = error;
  const result = serializeTransportError(error);
  assert.equal(result.cause.errors[0].code, 'ECONNRESET'); assert.equal(result.cause.errors[0].syscall, 'read');
  assert.equal(result.cause.errors[0].cause.circular, true); assert.doesNotThrow(() => JSON.stringify(result));
});

test('stage classification separates bodyless PIT create, seed, seed-score, final and cleanup', () => {
  assert.equal(transportStage('index/_search/point_in_time?keep_alive=60s', { method: 'POST' }), 'pit-open');
  assert.equal(transportStage('_search/point_in_time', { method: 'DELETE' }), 'pit-close');
  assert.equal(transportStage('_search', { body: { track_scores: false } }), 'seed');
  assert.equal(transportStage('_search', { body: { query: { bool: { filter: [{ ids: { values: ['a'] } }] } } } }), 'seed-score');
  assert.equal(transportStage('_search', { body: {} }), 'global-final');
});

test('wrapped API records exact failure stage/cause once and rethrows the original error', async () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
  const rows = []; let calls = 0;
  const request = captureTransportRequest({ trialId: 7, rows, request: async () => { calls++; throw error; } });
  await assert.rejects(request('_search/point_in_time', { method: 'DELETE', body: { pit_id: ['secret-pit'] }, timeoutMs: 100 }), actual => actual === error);
  assert.equal(calls, 1); assert.equal(rows.length, 1); assert.equal(rows[0].phase, 'pit-close');
  assert.equal(rows[0].error.cause.code, 'ECONNRESET'); assert.ok(!JSON.stringify(rows).includes('secret-pit'));
});

test('Undici observation records headers, socket reuse and closure without mutating requests', async () => {
  const observer = createTransportObserver({ base: 'http://127.0.0.1:19217' });
  const socket = Object.assign(new EventEmitter(), { localPort: 43210, remotePort: 19217 });
  const first = {}, second = {}; const request = { origin: 'http://127.0.0.1:19217', method: 'DELETE' };
  try {
    observer.run(first, () => {
      channel('undici:request:create').publish({ request });
      channel('undici:client:sendHeaders').publish({ request, headers: 'DELETE /x HTTP/1.1\r\nconnection: close\r\n', socket });
      channel('undici:request:headers').publish({ request, response: { statusCode: 200, headers: [Buffer.from('connection'), Buffer.from('close')] } });
    });
    observer.run(second, () => { const next = { ...request }; channel('undici:request:create').publish({ request: next }); channel('undici:client:sendHeaders').publish({ request: next, headers: '', socket }); });
    assert.equal(first.transportObservation.requestHeaders.connection, 'close'); assert.equal(first.transportObservation.responseHeaders.connection, 'close');
    assert.equal(first.transportObservation.socket.reused, false); assert.equal(second.transportObservation.socket.reused, true);
    socket.emit('close', false); assert.equal(observer.snapshot().socketCloses, 1);
  } finally { observer.close(); }
});

test('trial loop keeps strict failures, bounded request count and executor evidence', async () => {
  let clock = 0, called = 0; const trials = [], requests = [];
  const result = await runTransportTrials({ durationMs: 5000, concurrency: 1, maximumRequests: 2,
    executor: async () => { called++; clock += 1100; if (called === 2) { const error = new Error('bad'); error.evidence = { stages: [{ phase: 'pit-close-error' }] }; throw error; } return { hits: [{ id: 'x', score: 1 }], evidence: { stages: [{ phase: 'pit-close' }] } }; },
    options: {}, request: async () => ({}), now: () => clock, record: async (kind, row) => (kind === 'trials' ? trials : requests).push(row) });
  assert.equal(called, 2); assert.equal(result.strictFailures, 2); assert.equal(result.errors, 1);
  assert.equal(trials[1].executionEvidence.stages[0].phase, 'pit-close-error'); assert.equal(result.completed, 2);
});

test('trial loop stops at deadline without launching extra work and drains known failures', async () => {
  let clock = 0, calls = 0;
  const result = await runTransportTrials({ durationMs: 20, concurrency: 1, maximumRequests: 100,
    executor: async options => { calls++; assert.equal(options.timeoutMs, 1500); clock += 21; throw new Error('deadline'); },
    options: {}, request: async () => ({}), now: () => clock, record: async () => {} });
  assert.equal(calls, 1); assert.equal(result.completed, 1); assert.equal(result.errors, 1);
});

test('early error budget stops admissions and drains already admitted requests', async () => {
  let calls = 0; const rows = [];
  const result = await runTransportTrials({ durationMs: 60000, concurrency: 2, maximumRequests: 10000, stopErrors: 3,
    executor: async () => { calls++; await Promise.resolve(); throw new Error('transport'); }, options: {}, request: async () => ({}), record: async (kind, row) => rows.push(row) });
  assert.equal(result.stopReason, 'error-budget'); assert.ok(calls >= 3 && calls <= 4); assert.equal(result.completed, calls);
  assert.equal(rows.length, calls); assert.equal(result.strictFailures, calls);
});

test('success traces are bounded while every failure and every trial remains recorded', async () => {
  let call = 0, clock = 0; const rows = { requests: [], trials: [] };
  const result = await runTransportTrials({ durationMs: 60000, concurrency: 1, maximumRequests: 41, stopErrors: 32,
    executor: async ({ request }) => { await request('_search', { method: 'POST', body: {}, timeoutMs: 1500 }); return { hits: [{ id: 'x', score: 1 }], evidence: {} }; },
    options: {}, now: () => clock, request: async () => { if (++call === 41) throw Error('last failure'); if (call === 40) clock += 1100; return { body: {} }; }, record: async (kind, row) => rows[kind].push(row) });
  assert.equal(rows.trials.length, 41); assert.equal(rows.requests.length, 34); assert.equal(result.serviceRequests, 41);
  assert.equal(rows.requests.at(-1).trialId, 40); assert.equal(rows.requests.at(-1).success, false);
  assert.equal(rows.trials[38].retainedStageTrace, false); assert.equal(rows.trials[39].retainedStageTrace, true); assert.equal(rows.trials[39].overOneSecond, true); assert.equal(rows.trials[40].retainedStageTrace, true);
});

test('native cleanup reuses a real local socket and never retries HTTP/errors/aborted/deadline failures', async () => {
  let attempts = 0; const ports = [];
  const server = createServer(async (req, res) => {
    attempts++; ports.push(req.socket.remotePort); const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const mode = JSON.parse(Buffer.concat(chunks).toString()).pit_id[0];
    if (mode === 'timeout') return;
    if (mode === 'aborted') { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); res.write('{'); setImmediate(() => res.destroy()); return; }
    if (mode === '500') { res.statusCode = 500; res.end('{"error":{"type":"test"}}'); return; }
    if (mode === 'body-error') { res.end('{"error":{"type":"test"}}'); return; }
    res.end('{"pits":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const agent = new Agent({ keepAlive: true }), base = 'http://127.0.0.1:' + server.address().port;
  const request = (mode, timeoutMs = 1000) => pooledDeleteRequest('_search/point_in_time', { method: 'DELETE', body: { pit_id: [mode] }, timeoutMs }, { base, agent });
  try {
    await request('ok'); await request('ok'); assert.equal(ports[0], ports[1]);
    for (const mode of ['500', 'body-error', 'aborted']) { const before = attempts; await assert.rejects(request(mode)); assert.equal(attempts, before + 1); }
    const before = attempts, started = performance.now(); await assert.rejects(request('timeout', 30), error => error.code === 'ABORT_ERR');
    assert.equal(attempts, before + 1); assert.ok(performance.now() - started < 1000);
  } finally { agent.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('preflight failure is saved to a new output directory; existing artifacts cannot be overwritten', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'favorite-transport-output-'));
  try {
    const config = { ...transportDiagnosticConfiguration(['--directory', path.join(dir, 'run')]), receipt: path.join(dir, 'missing.json') };
    const result = await runFavoriteTransportDiagnostic(config); assert.ok(result.error); assert.ok(result.interruptedAt);
    const saved = JSON.parse(await readFile(path.join(config.directory, 'diagnostic.json'), 'utf8')); assert.equal(saved.error.code, 'ENOENT');
    await assert.rejects(runFavoriteTransportDiagnostic(config), error => error.code === 'EEXIST');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('pooled DELETE preserves JSON body, timeout signal and rejects failed responses without retry', async () => {
  let calls = 0, captured, payload;
  const requestImpl = (url, options, callback) => {
    calls++; captured = { url, options }; const req = new EventEmitter();
    req.end = body => { payload = body; queueMicrotask(() => { const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { connection: 'keep-alive' } }); callback(response); response.emit('data', Buffer.from('{"pits":[]}')); response.emit('end'); }); };
    return req;
  };
  const body = { pit_id: ['one', 'two'] }, agent = {};
  const result = await pooledDeleteRequest('_search/point_in_time', { method: 'DELETE', body, timeoutMs: 100 }, { base: 'http://127.0.0.1:19217', agent, requestImpl });
  assert.deepEqual(result.body, { pits: [] }); assert.equal(payload, JSON.stringify(body)); assert.equal(captured.options.agent, agent);
  assert.equal(captured.options.method, 'DELETE'); assert.equal(captured.options.headers['content-length'], Buffer.byteLength(payload));
  assert.ok(captured.options.signal instanceof AbortSignal); assert.equal(calls, 1);
  await assert.rejects(pooledDeleteRequest('_search', { method: 'POST', body }, { base: 'http://127.0.0.1:19217', agent, requestImpl }), /only PIT DELETE/);
});
