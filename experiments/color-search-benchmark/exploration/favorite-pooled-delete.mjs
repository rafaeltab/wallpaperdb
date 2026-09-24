// Experimental transport refinement only. Keep one pool across many queries.
// Original service.api, request body, PIT algorithm and scoring remain unchanged.
import { Agent, request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import { api, BASE } from './service.mjs';

export const FAVORITE_POOLED_DELETE_DEFINITION = Object.freeze({
  version: 1, kind: 'favorite-pooled-pit-delete',
  changedRequest: 'DELETE _search/point_in_time only; same JSON body and response validation',
  transport: 'Native node:http Agent({keepAlive:true}) shared across queries',
  deadline: 'Original executor signal and remaining timeout, combined as in service.api',
  retries: 0, otherRequests: 'Delegate to the existing service.api without transport changes',
});

export function createFavoritePooledDeleteTransport({ base = BASE, request = api, requestImpl = httpRequest, agent = new Agent({ keepAlive: true }) } = {}) {
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    agent.destroy(); throw Error('Use an isolated loopback HTTP service.');
  }
  const pending = new Set(); let closed = false;
  const totals = { nativeDeleteAttempts: 0, nativeDeleteCompleted: 0, nativeDeleteFailed: 0, reusedSockets: 0 };
  const snapshot = () => ({ ...totals, inFlight: pending.size, closed,
    activeSockets: Object.values(agent.sockets ?? {}).reduce((sum, sockets) => sum + sockets.length, 0),
    idleSockets: Object.values(agent.freeSockets ?? {}).reduce((sum, sockets) => sum + sockets.length, 0) });
  const cleanup = async (route, { method, body, signal, timeoutMs = 120000 }) => {
    const started = performance.now(), payload = body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const witness = { kind: FAVORITE_POOLED_DELETE_DEFINITION.kind, version: 1, attempts: 1, reusedSocket: false };
    totals.nativeDeleteAttempts++;
    try {
      const response = await new Promise((resolve, reject) => {
        const req = requestImpl(new URL(route, origin), { method, agent, signal: combined,
          headers: { 'content-type': typeof body === 'string' ? 'application/x-ndjson' : 'application/json',
            ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }) } }, incoming => {
          witness.reusedSocket = Boolean(req.reusedSocket); const chunks = []; let ended = false;
          incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
          incoming.on('error', reject);
          incoming.on('aborted', () => reject(Object.assign(Error('HTTP cleanup response aborted'), { code: 'ECONNRESET' })));
          incoming.on('close', () => { if (!ended) reject(Object.assign(Error('HTTP cleanup response closed before completion'), { code: 'ECONNRESET' })); });
          incoming.on('end', () => {
            ended = true;
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (incoming.statusCode < 200 || incoming.statusCode >= 300 || data.error) throw Error(`OpenSearch ${incoming.statusCode}: ${JSON.stringify(data.error ?? data).slice(0, 1800)}`);
              resolve({ body: data, wallMs: performance.now() - started, transport: { ...witness } });
            } catch (error) { reject(error); }
          });
        });
        req.on('error', reject); req.end(payload);
      });
      totals.nativeDeleteCompleted++; if (witness.reusedSocket) totals.reusedSockets++;
      return response;
    } catch (error) { totals.nativeDeleteFailed++; error.transport = { ...witness }; throw error; }
  };
  return {
    definition: FAVORITE_POOLED_DELETE_DEFINITION, snapshot,
    async request(route, options = {}) {
      if (closed) throw Error('Pooled DELETE transport is closed.');
      if (route !== '_search/point_in_time' || options.method !== 'DELETE') return request(route, { ...options, base: origin.origin });
      const promise = cleanup(route, options); pending.add(promise);
      try { return await promise; } finally { pending.delete(promise); }
    },
    async close() { closed = true; await Promise.allSettled([...pending]); agent.destroy(); },
  };
}
