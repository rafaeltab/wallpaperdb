import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import type { FactoryV2Changes, FactoryV2Delta, FactoryV2Problem } from './contract.js';
import { fakeState } from './fake-state.js';
import {
  changesQuery,
  commandSchema,
  entityParams,
  eventsQuery,
  matches,
  problem,
  receiptParams,
  searchQuery,
} from './protocol.js';

export interface FakeV2Options {
  readonly epoch?: string;
  readonly now?: () => number;
  readonly historyLimit?: number;
  readonly heartbeatMs?: number;
  readonly maxFrameBytes?: number;
}

/** Runnable mock transport only. No execution, GitHub/T3, or persistence ports. */
export function fakeV2Server(options: FakeV2Options = {}) {
  const config = z
    .object({
      epoch: z.string().min(1).max(128),
      historyLimit: z.number().int().min(1).max(256),
      heartbeatMs: z.number().int().min(1).max(60000),
      maxFrameBytes: z.number().int().min(64).max(1048576),
    })
    .parse({
      epoch: options.epoch ?? randomUUID(),
      historyLimit: options.historyLimit ?? 64,
      heartbeatMs: options.heartbeatMs ?? 15000,
      maxFrameBytes: options.maxFrameBytes ?? 65536,
    });
  const data = fakeState(config.epoch, options.now ?? Date.now, config.historyLimit);
  const app = Fastify({ bodyLimit: 131072, forceCloseConnections: 'idle' });
  registerV2Routes(app, data, config, 'fake');
  app.get('/health', () => ({ status: 'ok', apiVersion: 2, dataMode: 'fake' }));
  return app;
}
export type V2Data = Omit<ReturnType<typeof fakeState>, 'submit'> & {
  submit(
    command: import('./contract.js').FactoryV2Command
  ):
    | ReturnType<ReturnType<typeof fakeState>['submit']>
    | Promise<ReturnType<ReturnType<typeof fakeState>['submit']>>;
};
export function registerV2Routes(
  app: FastifyInstance,
  data: V2Data,
  config = { heartbeatMs: 15000, maxFrameBytes: 65536 },
  mode: 'fake' | 'live' = 'live'
) {
  const waiting = new Set<() => void>();
  let closing = false;
  const sendProblem = (reply: FastifyReply, value: FactoryV2Problem) =>
    reply.code(value.status).type('application/problem+json').send(value);
  const sendChanges = (reply: FastifyReply, value: FactoryV2Changes | FactoryV2Problem) =>
    'code' in value
      ? sendProblem(reply, value)
      : reply.code(value.kind === 'resync-required' ? 409 : 200).send(value);
  const invalid = (reply: FastifyReply, detail = 'Invalid request.') =>
    sendProblem(reply, problem(400, 'invalid-request', detail));
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-factory-data', mode).header('cache-control', 'private, no-cache');
    if (closing)
      return sendProblem(reply, problem(503, 'unavailable', 'The v2 server is closing.'));
    const origin = request.headers.origin;
    if (
      request.method === 'POST' &&
      origin &&
      origin !== `${request.protocol}://${request.headers.host}`
    )
      return sendProblem(reply, problem(403, 'origin-rejected', 'Request origin rejected.'));
  });
  app.setErrorHandler((error, _request, reply) => {
    const status = z.object({ statusCode: z.number() }).safeParse(error);
    const code =
      status.success && [400, 413, 415].includes(status.data.statusCode)
        ? status.data.statusCode
        : 500;
    return sendProblem(
      reply,
      problem(
        code,
        code === 415 ? 'unsupported' : code === 500 ? 'unavailable' : 'invalid-request',
        code === 500 ? 'Unexpected v2 server failure.' : 'Invalid or unsupported request.'
      )
    );
  });
  app.setNotFoundHandler((_request, reply) =>
    sendProblem(reply, problem(404, 'not-found', 'Unknown resource.'))
  );
  app.addHook('preClose', async () => {
    closing = true;
    for (const stop of [...waiting]) stop();
    data.close();
  });
  app.get('/api/v2/board', (request, reply) => {
    const snapshot = data.snapshot();
    const etag = `"${snapshot.cursor}"`;
    reply.header('etag', etag);
    return matches(request.headers['if-none-match'], etag, true)
      ? reply.code(304).send()
      : snapshot;
  });
  app.get('/api/v2/board/changes', async (request, reply) => {
    const parsed = changesQuery.safeParse(request.query);
    if (!parsed.success) return invalid(reply);
    const { after, waitMs } = parsed.data;
    const initial = data.changes(after);
    if ('code' in initial || initial.kind !== 'unchanged' || waitMs === 0)
      return sendChanges(reply, initial);
    if (waiting.size >= 64)
      return sendProblem(reply, problem(503, 'unavailable', 'Too many sample update connections.'));
    await new Promise<void>((resolve) => {
      let done = false;
      let unsubscribe = () => {};
      const timer = setTimeout(() => finish(), waitMs);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        waiting.delete(finish);
        reply.raw.off('close', finish);
        resolve();
      }
      waiting.add(finish);
      reply.raw.on('close', finish);
      unsubscribe = data.subscribe(finish);
      // Subscribe before re-reading to close the initial-read/registration gap.
      const current = data.changes(after);
      if ('code' in current || current.kind !== 'unchanged') finish();
    });
    if (reply.raw.destroyed) return reply;
    return closing
      ? sendProblem(reply, problem(503, 'unavailable', 'The v2 server is closing.'))
      : sendChanges(reply, data.changes(after));
  });
  app.get('/api/v2/board/events', (request, reply) => {
    const parsed = eventsQuery.safeParse(request.query);
    if (!parsed.success) return invalid(reply);
    const header = request.headers['last-event-id'];
    const after = typeof header === 'string' && header.trim() ? header.trim() : parsed.data.after;
    if (!after || after.length > 512)
      return invalid(reply, 'An initial cursor or Last-Event-ID is required.');
    const initial = data.changes(after);
    if ('code' in initial || initial.kind === 'resync-required') return sendChanges(reply, initial);
    if (waiting.size >= 64)
      return sendProblem(reply, problem(503, 'unavailable', 'Too many sample update connections.'));
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-factory-data': mode,
    });
    let position = after,
      stopped = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    function stop() {
      if (stopped) return;
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      waiting.delete(stop);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
    function resync(reason: Extract<FactoryV2Changes, { kind: 'resync-required' }>['reason']) {
      if (!reply.raw.destroyed && !reply.raw.writableEnded)
        reply.raw.end(
          `event: resync-required\ndata: ${JSON.stringify({ kind: 'resync-required', reason })}\n\n`
        );
      stop();
    }
    function write(frame: string): boolean {
      if (stopped || reply.raw.destroyed || reply.raw.writableEnded) {
        stop();
        return false;
      }
      if (Buffer.byteLength(frame) > config.maxFrameBytes) {
        resync('slow-consumer');
        return false;
      }
      try {
        if (reply.raw.write(frame)) return true;
        resync('slow-consumer');
      } catch {
        stop();
      }
      return false;
    }
    function change(batch: FactoryV2Delta) {
      if (!write(`event: change\nid: ${batch.toCursor}\ndata: ${JSON.stringify(batch)}\n\n`))
        return false;
      position = batch.toCursor;
      return true;
    }
    function send() {
      if (stopped) return;
      let more = true;
      while (more && !stopped) {
        const result = data.changes(position);
        if ('code' in result) {
          resync('reset');
          return;
        }
        if (result.kind === 'resync-required') {
          resync(result.reason);
          return;
        }
        if (result.kind === 'unchanged') return;
        for (const batch of result.batches) if (!change(batch)) return;
        more = result.hasMore;
      }
    }
    waiting.add(stop);
    reply.raw.on('close', stop);
    reply.raw.on('error', stop);
    unsubscribe = data.subscribe(send);
    write(': connected\n\n');
    send();
    if (!stopped) {
      heartbeat = setInterval(() => {
        write(': heartbeat\n\n');
      }, config.heartbeatMs);
      heartbeat.unref();
    }
    return reply;
  });
  app.get('/api/v2/issues/search', (request, reply) => {
    const parsed = searchQuery.safeParse(request.query);
    if (!parsed.success) return invalid(reply);
    const result = data.search(parsed.data.q, parsed.data.limit, parsed.data.pageToken);
    return 'code' in result ? sendProblem(reply, result) : result;
  });
  app.get('/api/v2/items/:id', (request, reply) => {
    const parsed = entityParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    const result = data.details(parsed.data.id);
    if (!result) return sendProblem(reply, problem(404, 'not-found', 'Unknown item.'));
    if (!request.headers['if-match'])
      return invalid(reply, 'If-Match with the item version is required.');
    const etag = `"${result.itemVersion}"`;
    if (!matches(request.headers['if-match'], etag, false))
      return sendProblem(
        reply,
        problem(412, 'stale-action', 'Item details changed. Refresh the board.')
      );
    return reply.header('etag', etag).send(result);
  });
  app.get('/api/v2/plans/:id', (request, reply) => {
    const parsed = entityParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    const result = data.plan(parsed.data.id);
    return result ?? sendProblem(reply, problem(404, 'not-found', 'Unknown plan.'));
  });
  app.get('/api/v2/commands/:id', (request, reply) => {
    const parsed = receiptParams.safeParse(request.params);
    if (!parsed.success) return invalid(reply);
    return (
      data.receipt(parsed.data.id) ??
      sendProblem(reply, problem(404, 'not-found', 'Unknown command.'))
    );
  });
  app.post('/api/v2/commands', async (request, reply) => {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json'))
      return sendProblem(reply, problem(415, 'unsupported', 'JSON required.'));
    const parsed = commandSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, 'Invalid command payload.');
    const result = await data.submit(parsed.data);
    return 'code' in result
      ? sendProblem(reply, result)
      : reply
          .code(result.status)
          .header('location', `/api/v2/commands/${result.receipt.commandId}`)
          .send(result.receipt);
  });
  return app;
}
