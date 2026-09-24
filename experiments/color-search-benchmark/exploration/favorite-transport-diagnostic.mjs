// THROWAWAY transport diagnosis. Original scorers and service.api stay unchanged.
// Undici observation follows its public diagnostics-channel interface:
// https://github.com/nodejs/undici/blob/v6.24.1/docs/docs/api/DiagnosticsChannel.md
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { Agent, request as httpRequest } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, hash } from './service.mjs';
import { FAVORITE_PARAMETERS } from './favorite-scale-corpus.mjs';
import { favoriteSourceSnapshot } from './favorite-scale.mjs';
import { executeFavoriteBoundedUtilitySearch } from './favorite-bounded-utilities.mjs';
import { executeFavoriteMaximaBoundedUtilitySearch } from './favorite-maxima-bounded-utilities.mjs';

const INDEX = 'color-exploration-favorite-points-full-1m-v1';
const BASE = 'http://127.0.0.1:19217';
const REPOSITORY = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const RECEIPT = '/home/rafaeltab/.local/share/wallpaperdb/color-evaluation/exploration/favorite-optimization/2026-09-23/points-full-1m-v1/index.json';
const atomicJson = async (file, value) => { await writeFile(file + '.tmp', JSON.stringify(value, null, 2)); await rename(file + '.tmp', file); };
const exec = promisify(execFile);

export function transportDiagnosticConfiguration(args = []) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--directory', '--method', '--transport', '--concurrency', '--duration-seconds', '--maximum-requests', '--stop-errors', '--tcp'].includes(key)
      || values[key] !== undefined || args[i + 1] === undefined) throw Error('Unknown, duplicate or missing diagnostic option: ' + key);
    values[key] = args[++i];
  }
  const directory = values['--directory'] && path.resolve(values['--directory']);
  if (!directory || directory === '/' || directory === REPOSITORY || directory.startsWith(REPOSITORY + path.sep)) throw Error('Use a new external --directory.');
  const method = values['--method'] ?? 'maxima', transport = values['--transport'] ?? 'fetch';
  const concurrency = Number(values['--concurrency'] ?? 16), durationMs = Number(values['--duration-seconds'] ?? 30) * 1000;
  const maximumRequests = Number(values['--maximum-requests'] ?? 100000), stopErrors = Number(values['--stop-errors'] ?? 32);
  if (!['bounded', 'maxima'].includes(method) || !['fetch', 'pooled-delete'].includes(transport)) throw Error('Use bounded|maxima and fetch|pooled-delete.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 || !Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 300000
    || !Number.isSafeInteger(maximumRequests) || maximumRequests < 1 || maximumRequests > 100000 || !Number.isSafeInteger(stopErrors) || stopErrors < 1 || stopErrors > 100000) throw Error('Invalid bounded diagnostic workload.');
  if (values['--tcp'] !== undefined && !['true', 'false'].includes(values['--tcp'])) throw Error('Use --tcp true|false.');
  return { directory, method, transport, concurrency, durationMs, maximumRequests, stopErrors, tcp: values['--tcp'] !== 'false',
    base: BASE, index: INDEX, receipt: RECEIPT, sampleIntervalMs: 1000 };
}

export function serializeTransportError(error, seen = new Set(), depth = 0) {
  if (error == null || typeof error !== 'object') return { message: String(error) };
  if (seen.has(error)) return { circular: true };
  if (depth > 12) return { truncated: true, message: String(error.message ?? error) };
  seen.add(error); const out = {};
  for (const key of ['name', 'message', 'stack', 'code', 'errno', 'syscall', 'address', 'port']) if (error[key] !== undefined) out[key] = error[key];
  if (error.cause !== undefined) out.cause = serializeTransportError(error.cause, seen, depth + 1);
  if (Array.isArray(error.errors)) out.errors = error.errors.map(value => serializeTransportError(value, seen, depth + 1));
  if (error.socket) out.socket = Object.fromEntries(['localAddress', 'localPort', 'remoteAddress', 'remotePort', 'bytesWritten', 'bytesRead'].filter(key => error.socket[key] !== undefined).map(key => [key, error.socket[key]]));
  return out;
}

export function transportStage(route, options = {}) {
  if (route.includes('/_search/point_in_time?')) return 'pit-open';
  if (options.method === 'DELETE') return 'pit-close';
  if (options.body?.track_scores === false) return 'seed';
  if (options.body?.query?.bool?.filter?.some(value => value.ids)) return 'seed-score';
  return 'global-final';
}

function connectionHeaders(value) {
  let pairs;
  if (typeof value === 'string') pairs = value.split('\r\n').map(line => { const i = line.indexOf(':'); return i < 0 ? [] : [line.slice(0, i), line.slice(i + 1).trim()]; });
  else if (Array.isArray(value)) pairs = Array.from({ length: Math.floor(value.length / 2) }, (_, i) => [String(value[i * 2]), String(value[i * 2 + 1])]);
  else pairs = Object.entries(value ?? {});
  return Object.fromEntries(pairs.filter(([key]) => key && ['connection', 'keep-alive', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())).map(([key, val]) => [key.toLowerCase(), String(val)]));
}

export function createTransportObserver({ base = BASE } = {}) {
  const context = new AsyncLocalStorage(), requests = new WeakMap(), sockets = new WeakMap(), listeners = new Map(), subscriptions = [];
  const totals = { requestCreates: 0, headerSends: 0, responseHeaders: 0, requestErrors: 0, observedSockets: 0, reusedSends: 0, socketCloses: 0, socketErrorCloses: 0, observerErrors: 0 };
  const nativeTotals = { sends: 0, responseHeaders: 0 };
  const headerCounts = { requestConnection: {}, responseConnection: {} }, phaseSends = {};
  const noteHeaders = (kind, headers, phase) => {
    const value = headers.connection ?? '(absent)', key = (phase ?? 'unknown') + ':' + value;
    headerCounts[kind][key] = (headerCounts[kind][key] ?? 0) + 1;
  };
  const observeSocket = socket => {
    let entry = sockets.get(socket);
    if (!entry) {
      entry = { id: ++totals.observedSockets, sends: 0 }; sockets.set(socket, entry);
      const close = hadError => { totals.socketCloses++; if (hadError) totals.socketErrorCloses++; listeners.delete(socket); };
      listeners.set(socket, close); socket.once('close', close);
    }
    const reused = entry.sends++ > 0; if (reused) totals.reusedSends++;
    return { id: entry.id, reused, localPort: socket.localPort, remotePort: socket.remotePort };
  };
  const subscribe = (name, fn) => {
    const callback = message => { try { fn(message); } catch { totals.observerErrors++; } };
    channel(name).subscribe(callback); subscriptions.push([name, callback]);
  };
  subscribe('undici:request:create', ({ request }) => {
    if (String(request.origin) !== base) return; const row = context.getStore(); if (!row) return;
    requests.set(request, row); row.transportObservation ??= {}; totals.requestCreates++;
  });
  subscribe('undici:client:sendHeaders', ({ request, headers, socket }) => {
    const row = requests.get(request); if (!row) return; totals.headerSends++;
    Object.assign(row.transportObservation, { requestHeaders: connectionHeaders(headers), socket: observeSocket(socket) });
    phaseSends[row.phase ?? 'unknown'] = (phaseSends[row.phase ?? 'unknown'] ?? 0) + 1;
    noteHeaders('requestConnection', row.transportObservation.requestHeaders, row.phase);
  });
  subscribe('undici:request:headers', ({ request, response }) => {
    const row = requests.get(request); if (!row) return; totals.responseHeaders++;
    Object.assign(row.transportObservation, { status: response.statusCode, responseHeaders: connectionHeaders(response.headers) });
    noteHeaders('responseConnection', row.transportObservation.responseHeaders, row.phase);
  });
  subscribe('undici:request:error', ({ request, error }) => {
    const row = requests.get(request); if (!row) return; totals.requestErrors++; row.transportObservation.error = serializeTransportError(error);
  });
  return {
    run: (row, fn) => context.run(row, fn),
    nativeSocket: socket => { try { const row = context.getStore(); if (row) { nativeTotals.sends++; row.transportObservation = { ...row.transportObservation, native: true, socket: observeSocket(socket) }; phaseSends[row.phase] = (phaseSends[row.phase] ?? 0) + 1; } } catch { totals.observerErrors++; } },
    nativeResponse: response => { try { const row = context.getStore(); if (row) { nativeTotals.responseHeaders++; row.transportObservation = { ...row.transportObservation, status: response.statusCode, responseHeaders: connectionHeaders(response.headers) }; noteHeaders('responseConnection', row.transportObservation.responseHeaders, row.phase); } } catch { totals.observerErrors++; } },
    snapshot: () => ({ ...totals, native: { ...nativeTotals }, headerCounts: structuredClone(headerCounts), phaseSends: { ...phaseSends } }),
    close: () => { for (const [name, callback] of subscriptions) channel(name).unsubscribe(callback); for (const [socket, listener] of listeners) socket.off('close', listener); listeners.clear(); },
  };
}

async function nativeJsonRequest(route, { method = 'GET', body, signal, timeoutMs = 120000 } = {}, { base = BASE, agent, requestImpl = httpRequest, observer } = {}) {
  const start = performance.now(), payload = body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const req = requestImpl(new URL(route.replace(/^\//, ''), base + '/'), { method, agent, signal: combined,
      headers: { 'content-type': typeof body === 'string' ? 'application/x-ndjson' : 'application/json', ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }) } }, response => {
      observer?.nativeResponse(response); const chunks = []; let ended = false;
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('error', reject); response.on('aborted', () => reject(Object.assign(Error('HTTP response aborted'), { code: 'ECONNRESET' })));
      response.on('close', () => { if (!ended) reject(Object.assign(Error('HTTP response closed before completion'), { code: 'ECONNRESET' })); });
      response.on('end', () => {
        ended = true;
        try { const data = JSON.parse(Buffer.concat(chunks).toString());
          if (response.statusCode < 200 || response.statusCode >= 300 || data.error) throw Error(`OpenSearch ${response.statusCode}: ${JSON.stringify(data.error ?? data).slice(0, 1800)}`);
          resolve({ body: data, wallMs: performance.now() - start });
        } catch (error) { reject(error); }
      });
    });
    req.on('socket', socket => observer?.nativeSocket(socket)); req.on('error', reject); req.end(payload);
  });
}

export async function pooledDeleteRequest(route, options, dependencies) {
  if (route !== '_search/point_in_time' || options.method !== 'DELETE') throw Error('Pooled variant changes only PIT DELETE transport.');
  return nativeJsonRequest(route, options, dependencies);
}

export function captureTransportRequest({ trialId, rows, request = api, observer, now = () => performance.now() }) {
  return async (route, options = {}) => {
    const started = now(), row = { trialId, ordinal: rows.length, at: new Date().toISOString(), phase: transportStage(route, options),
      route, method: options.method ?? 'GET', timeoutMs: options.timeoutMs, bodyHash: options.body === undefined ? null : hash(options.body),
      bodyBytes: options.body === undefined ? 0 : Buffer.byteLength(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) };
    rows.push(row);
    try { const response = await (observer ? observer.run(row, () => request(route, options)) : request(route, options)); row.success = true; row.serviceTookMs = response.body?.took; return response; }
    catch (error) { row.success = false; row.error = serializeTransportError(error); throw error; }
    finally { row.elapsedMs = now() - started; }
  };
}

export async function runTransportTrials({ durationMs, concurrency, maximumRequests, stopErrors = 32, executor, options, request, observer, record, now = () => performance.now() }) {
  const started = now(), deadline = started + durationMs;
  const result = { submitted: 0, completed: 0, errors: 0, overOneSecond: 0, strictFailures: 0, serviceRequests: 0, serviceErrors: 0, phaseCounts: {}, phaseErrors: {},
    tracing: { firstSuccessfulQueries: 32, everyNthSuccessfulQuery: 1000, everyFailedQuery: true, retainedQueries: 0, retainedServiceRequests: 0 } };
  let recordingFailure;
  const worker = async () => {
    while (!recordingFailure && result.errors < stopErrors && result.submitted < maximumRequests && deadline - now() >= 10) {
      const id = result.submitted++, start = now(), requests = [];
      // Stop admitting work at the run boundary; every admitted request retains
      // the original1500ms deadline and100ms cleanup reserve. Drain, never cancel
      // healthy work merely because the diagnostic observation interval ended.
      const trial = { id, at: new Date().toISOString(), timeoutMs: 1500 };
      try {
        const response = await executor({ ...options, timeoutMs: trial.timeoutMs, serviceTimeout: '950ms', request: captureTransportRequest({ trialId: id, rows: requests, request, observer, now }) });
        if (options.limit && response.hits.length !== options.limit) throw Error('Unexpected diagnostic result count.');
        trial.hitsHash = hash(response.hits); trial.executionEvidence = response.evidence;
        if (!result.hitsHash) { result.hitsHash = trial.hitsHash; result.hits = response.hits; }
        else if (result.hitsHash !== trial.hitsHash) throw Error('Repeated fixed query returned different hits/scores.');
      } catch (error) { trial.error = serializeTransportError(error); trial.executionEvidence = error.evidence; result.errors++; }
      trial.elapsedMs = now() - start; trial.overOneSecond = trial.elapsedMs >= 1000;
      if (trial.overOneSecond) result.overOneSecond++;
      if (trial.error || trial.overOneSecond) result.strictFailures++;
      for (const row of requests) {
        result.serviceRequests++; result.phaseCounts[row.phase] = (result.phaseCounts[row.phase] ?? 0) + 1;
        if (!row.success) { result.serviceErrors++; result.phaseErrors[row.phase] = (result.phaseErrors[row.phase] ?? 0) + 1; }
      }
      result.completed++;
      const retained = Boolean(trial.error) || trial.overOneSecond || id < 32 || id % 1000 === 0;
      trial.retainedStageTrace = retained;
      try {
        if (retained) { result.tracing.retainedQueries++; result.tracing.retainedServiceRequests += requests.length; for (const row of requests) await record('requests', row); }
        else delete trial.executionEvidence;
        await record('trials', trial);
      }
      catch (error) { recordingFailure ??= error; }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  result.elapsedMs = now() - started;
  result.requestsPerSecond = result.completed / (result.elapsedMs / 1000);
  result.serviceRequestsPerSecond = result.serviceRequests / (result.elapsedMs / 1000);
  result.drainPastDurationMs = Math.max(0, result.elapsedMs - durationMs);
  result.perQueryTimeoutMs = 1500;
  result.stopReason = recordingFailure ? 'recording-error' : result.errors >= stopErrors ? 'error-budget' : result.submitted >= maximumRequests ? 'maximum-requests' : 'duration';
  if (recordingFailure) { recordingFailure.partialResult = result; throw recordingFailure; }
  return result;
}

async function tcpSnapshot() {
  try {
    const { stdout } = await exec('ss', ['-Htan', '( sport = :19217 or dport = :19217 )'], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 });
    const states = {}; for (const line of stdout.trim().split('\n').filter(Boolean)) { const state = line.trim().split(/\s+/)[0]; states[state] = (states[state] ?? 0) + 1; }
    return { at: new Date().toISOString(), states, endpointRows: Object.values(states).reduce((a, b) => a + b, 0), note: 'Host namespace only; counts endpoints, not unique connections or hidden Docker/NAT entries.' };
  } catch (error) { return { at: new Date().toISOString(), unavailable: true, error: serializeTransportError(error) }; }
}

export async function runFavoriteTransportDiagnostic(config) {
  await mkdir(path.dirname(config.directory), { recursive: true }); await mkdir(config.directory);
  const result = { schemaVersion: 1, experiment: 'favorite-transport-diagnostic', configuration: config, startedAt: new Date().toISOString(),
    runtime: { node: process.version, undici: process.versions.undici },
    query: { mode: 'vibe', targets: [{ color: '#ff0000' }] }, parameters: { ...FAVORITE_PARAMETERS, bucketCount: 256 },
    limitations: ['Instrumented diagnosis, not a capacity measurement. No retries or scoring changes.', 'Global fetch/API unchanged. Pooled-delete changes only PIT cleanup HTTP transport; control observations always use a separate native keep-alive agent.',
      'HTTP counters include control requests/background traffic. Socket-reuse counters describe observed executor sends, not lifetime history. Native DELETE request Connection headers are not wire-instrumented.',
      'All trial results/errors are saved; successful stage traces are sampled while counters cover all sends. Instrumentation can reduce achieved connection creation rate.',
      'Initial/final UUID and count are checked; no index writes are performed.', 'Failed requests and cleanup failures remain strict failures; errors drain before exit.'] };
  const file = path.join(config.directory, 'diagnostic.json'), save = () => atomicJson(file, result);
  await save();
  const controlAgent = new Agent({ keepAlive: true, maxSockets: 1 }), deleteAgent = new Agent({ keepAlive: true });
  const observer = createTransportObserver({ base: config.base }); let timer, pendingSample = Promise.resolve(), sampling = false, stopped = false, writeChain = Promise.resolve(), writeError;
  const buffers = new Map();
  const flush = kind => {
    const buffer = buffers.get(kind); if (!buffer?.bytes) return writeChain;
    const text = buffer.lines.join(''); buffers.delete(kind);
    const work = writeChain.then(() => appendFile(path.join(config.directory, kind + '.jsonl'), text));
    writeChain = work.catch(error => { writeError ??= error; }); return work;
  };
  const record = async (kind, row) => {
    if (writeError) throw writeError;
    let buffer = buffers.get(kind); if (!buffer) buffers.set(kind, buffer = { lines: [], bytes: 0 });
    const text = JSON.stringify(row) + '\n'; buffer.lines.push(text); buffer.bytes += Buffer.byteLength(text);
    if (buffer.bytes >= 65536 || kind === 'resources') await flush(kind);
  };
  const control = (route, options = {}) => nativeJsonRequest(route, { ...options, timeoutMs: 3000 }, { base: config.base, agent: controlAgent });
  const fingerprint = async () => ({ settings: (await control(config.index + '/_settings')).body[config.index].settings.index, count: (await control(config.index + '/_count')).body.count });
  const sample = async phase => {
    const row = { at: new Date().toISOString(), phase, observer: observer.snapshot() };
    try { row.nodes = (await control('_nodes/stats/http,process,jvm,indices,thread_pool?filter_path=nodes.*.http,nodes.*.process,nodes.*.jvm.mem,nodes.*.indices.search,nodes.*.thread_pool.search')).body.nodes; }
    catch (error) { row.error = serializeTransportError(error); }
    if (config.tcp) row.tcp = await tcpSnapshot();
    await record('resources', row); return row;
  };
  try {
    const source = await favoriteSourceSnapshot(import.meta.url), sourceHash = hash(source), receiptBytes = await readFile(config.receipt), receipt = JSON.parse(receiptBytes);
    result.sourceHash = sourceHash; result.receiptHash = hash(receiptBytes);
    await writeFile(path.join(config.directory, 'source-snapshot.json'), JSON.stringify(source)); await save();
    if (!receipt.finishedAt || receipt.error || receipt.index !== config.index || receipt.uuid == null || receipt.count !== 1000000 || receipt.indexed !== 1000000
      || receipt.utilities !== 6138 || receipt.configuration.scope !== 'full' || !receipt.configuration.numericPoints) throw Error('Require the complete full-million numeric-point receipt.');
    result.indexBefore = await fingerprint();
    if (result.indexBefore.settings.uuid !== receipt.uuid || result.indexBefore.count !== 1000000) throw Error('Live diagnostic index differs from the saved million-record receipt.');
    result.before = await sample('before'); await save();
    const request = (route, options) => config.transport === 'pooled-delete' && options.method === 'DELETE'
      ? pooledDeleteRequest(route, options, { base: config.base, agent: deleteAgent, observer }) : api(route, { ...options, base: config.base });
    timer = setInterval(() => { if (sampling || stopped) return; sampling = true; pendingSample = sample('during').catch(error => { writeError ??= error; }).finally(() => { sampling = false; }); }, config.sampleIntervalMs);
    result.trials = await runTransportTrials({ ...config, executor: config.method === 'maxima' ? executeFavoriteMaximaBoundedUtilitySearch : executeFavoriteBoundedUtilitySearch,
      options: { index: config.index, query: result.query, parameters: result.parameters, limit: 20 }, request, observer, record });
    stopped = true; clearInterval(timer); await pendingSample;
    result.after = await sample('after-work'); deleteAgent.destroy();
    result.indexAfter = await fingerprint();
    if (result.indexAfter.settings.uuid !== result.indexBefore.settings.uuid || result.indexAfter.count !== result.indexBefore.count) throw Error('Index UUID/count changed during diagnosis.');
    result.httpDeltas = Object.fromEntries(Object.entries(result.before.nodes ?? {}).map(([id, before]) => [id, { totalOpened: (result.after.nodes?.[id]?.http?.total_opened ?? NaN) - before.http.total_opened,
      currentOpenBefore: before.http.current_open, currentOpenAfter: result.after.nodes?.[id]?.http?.current_open }]));
    result.httpEvidenceComplete = Boolean(Object.keys(result.httpDeltas).length) && Object.values(result.httpDeltas).every(value => Number.isFinite(value.totalOpened) && value.totalOpened >= 0);
    result.httpObservationWindowMs = Date.parse(result.after.at) - Date.parse(result.before.at);
    if (result.httpEvidenceComplete) result.openedConnectionsPerSecond = Object.values(result.httpDeltas).reduce((sum, row) => sum + row.totalOpened, 0) / (result.httpObservationWindowMs / 1000);
    result.observer = observer.snapshot();
    if (hash(await favoriteSourceSnapshot(import.meta.url)) !== sourceHash) throw Error('Diagnostic/scorer sources changed during execution.');
    for (const kind of [...buffers.keys()]) await flush(kind); await writeChain; if (writeError) throw writeError;
    result.completed = true; result.strictPassed = result.trials.strictFailures === 0; result.finishedAt = new Date().toISOString();
  } catch (error) { result.error = serializeTransportError(error); if (error.partialResult) result.trials = error.partialResult; result.interruptedAt = new Date().toISOString(); }
  finally { stopped = true; clearInterval(timer); await pendingSample;
    try { for (const kind of [...buffers.keys()]) await flush(kind); await writeChain; } catch (error) { result.recordingError = serializeTransportError(error); result.completed = false; }
    if (writeError) { result.recordingError = serializeTransportError(writeError); result.completed = false; }
    result.observer ??= observer.snapshot(); observer.close(); deleteAgent.destroy(); controlAgent.destroy(); await save(); }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFavoriteTransportDiagnostic(transportDiagnosticConfiguration(process.argv.slice(2)));
  console.log(JSON.stringify({ directory: result.configuration.directory, completed: result.completed, strictPassed: result.strictPassed,
    trials: result.trials, httpDeltas: result.httpDeltas, observer: result.observer, error: result.error }, null, 2));
  process.exitCode = result.completed && result.strictPassed ? 0 : 1;
}
