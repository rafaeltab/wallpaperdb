import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe('Telemetry SDK ownership', () => {
  it('allows startup when disabled or when configuration cannot initialize telemetry', async () => {
    expect(
      await Effect.runPromise(
        initializeOtel({ otelServiceName: 'color-extractor' }).pipe(Effect.scoped)
      )
    ).toEqual({ _tag: 'Disabled' });
    expect(
      await Effect.runPromise(
        initializeOtel({
          otelServiceName: 'color-extractor',
          otelEndpoint: 'invalid URL',
        }).pipe(Effect.scoped)
      )
    ).toEqual({ _tag: 'Unavailable' });
  });

  it('closes stalled collector sockets when later application startup fails', async () => {
    const sockets = new Set<Socket>();
    const collector = createServer((request, response) => {
      request.resume();
      response.writeHead(200);
      response.write(' ');
      const interval = setInterval(() => response.write(' '), 50);
      response.once('close', () => clearInterval(interval));
    });
    collector.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      collector.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Missing collector TCP address');
      const started = performance.now();
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const status = yield* initializeOtel({
            otelServiceName: 'color-extractor-stalled',
            otelEndpoint: `http://127.0.0.1:${address.port}`,
          });
          expect(status).toEqual({ _tag: 'Started' });
          trace.getTracer('contract').startSpan('shutdown.contract').end();
          recordCounter('shutdown.contract', 1);
          logs.getLogger('contract').emit({ body: 'Shutdown contract' });
          return yield* Effect.fail('application startup failed');
        }).pipe(Effect.scoped)
      );
      expect(exit._tag).toBe('Failure');
      expect(performance.now() - started).toBeLessThan(6000);
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 1000 });
    } finally {
      for (const socket of sockets) socket.destroy();
      collector.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        collector.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
