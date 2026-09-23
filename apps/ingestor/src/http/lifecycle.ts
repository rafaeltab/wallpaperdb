import type { Socket } from 'node:net';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Effect, Latch, Option } from 'effect';
import { problem } from './problems.js';
export function installRequestLifecycle(app: FastifyInstance) {
  const active = new Set<AbortController>();
  const connections = new Set<Socket>();
  app.server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  const completions = new WeakMap<FastifyRequest, () => void>();
  const empty = Latch.makeUnsafe(true);
  let closing = false;
  app.decorateRequest('ingestorSignal');
  app.addHook('onRequest', async (request, reply) => {
    if (closing) {
      return reply
        .code(503)
        .type('application/problem+json')
        .send(problem(503, 'service-unavailable', 'Service unavailable'));
    }
    const controller = new AbortController();
    request.ingestorSignal = controller.signal;
    active.add(controller);
    empty.closeUnsafe();
    const complete = () => {
      request.raw.removeListener('aborted', abandon);
      reply.raw.removeListener('close', abandon);
      completions.delete(request);
      active.delete(controller);
      if (active.size === 0) {
        empty.openUnsafe();
        if (closing) for (const socket of connections) socket.end();
      }
    };
    const abandon = () => {
      if (!reply.raw.writableFinished) controller.abort();
      complete();
    };
    completions.set(request, complete);
    request.raw.once('aborted', abandon);
    reply.raw.once('close', abandon);
  });
  app.addHook('onResponse', async (request) => {
    completions.get(request)?.();
  });
  return {
    drain: Effect.fn('http.requests.drain')(function* (timeoutMs: number) {
      closing = true;
      const listenerClosed = Latch.makeUnsafe(!app.server.listening);
      if (app.server.listening) app.server.close(() => listenerClosed.openUnsafe());
      if (active.size === 0) for (const socket of connections) socket.end();
      const completed = yield* Effect.all([empty.await, listenerClosed.await], {
        concurrency: 'unbounded',
      }).pipe(Effect.timeoutOption(timeoutMs));
      if (Option.isNone(completed)) {
        for (const controller of active) controller.abort();
        app.server.closeAllConnections();
      }
    }),
  };
}
