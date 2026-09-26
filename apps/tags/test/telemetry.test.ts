import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Effect, Logger } from 'effect';
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
  it('allows startup when telemetry is disabled or cannot initialize', async () => {
    expect(
      await Effect.runPromise(initializeOtel({ otelServiceName: 'tags' }).pipe(Effect.scoped))
    ).toEqual({ _tag: 'Disabled' });
    expect(
      await Effect.runPromise(
        initializeOtel({ otelServiceName: 'tags', otelEndpoint: 'invalid URL' }).pipe(Effect.scoped)
      )
    ).toEqual({ _tag: 'Unavailable' });
  });

  it('records the initialization error category without its credential-bearing URL input', async () => {
    const entries: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      entries.push(message);
    });
    const endpoint = 'http://operator:initialization-private-marker@';
    expect(() => new URL(endpoint)).toThrowError(expect.objectContaining({ input: endpoint }));
    const status = await Effect.runPromise(
      initializeOtel({
        otelServiceName: 'tags-invalid-telemetry',
        otelEndpoint: endpoint,
      }).pipe(Effect.scoped, Effect.provide(Logger.layer([logger])))
    );
    expect(status).toEqual({ _tag: 'Unavailable' });
    expect(entries).toContainEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cause: expect.objectContaining({
            name: 'TypeError',
            code: 'ERR_INVALID_URL',
            message: 'Invalid URL',
          }),
        }),
      ])
    );
    expect(JSON.stringify(entries)).not.toContain('initialization-private-marker');
    expect(JSON.stringify(entries)).not.toContain(endpoint);
  });

  it('records collector rejection diagnostics while redacting endpoint credentials', async () => {
    const entries: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      entries.push(message);
    });
    let endpoint = '';
    let attemptedExport = false;
    const collector = createServer((request, response) => {
      attemptedExport = true;
      request.resume();
      response.writeHead(
        400,
        `Export rejected collector-user shutdown-private-marker ${endpoint}/v1/traces ${'detail '.repeat(200)}`
      );
      response.end('private collector response body');
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Missing collector TCP address');
      endpoint = `http://collector-user:%73hutdown-private-marker@127.0.0.1:${address.port}`;
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* initializeOtel({
            otelServiceName: 'tags-rejected-export',
            otelEndpoint: endpoint,
          });
          trace.getTracer('contract').startSpan('telemetry.shutdown.contract').end();
        }).pipe(Effect.scoped, Effect.provide(Logger.layer([logger])))
      );
      expect(attemptedExport).toBe(true);
      expect(entries).toContainEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cause: expect.objectContaining({
              name: 'OTLPExporterError',
              code: 400,
              message: expect.stringContaining('Export rejected'),
            }),
          }),
        ])
      );
      const serialized = JSON.stringify(entries);
      expect(serialized.length).toBeLessThan(800);
      expect(serialized).not.toContain('collector-user');
      expect(serialized).not.toContain('shutdown-private-marker');
      expect(serialized).not.toContain('%73hutdown-private-marker');
      expect(serialized).not.toContain(endpoint);
      expect(serialized).not.toContain('private collector response body');
    } finally {
      collector.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it('closes stalled collector sockets when later application startup fails', async () => {
    const entries: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      entries.push(message);
    });
    const sockets = new Set<Socket>();
    const requests = new Set<string>();
    const collector = createServer((request, response) => {
      requests.add(request.url ?? '');
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
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Missing collector TCP address');
      const started = performance.now();
      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* initializeOtel({
            otelServiceName: 'tags-stalled',
            otelEndpoint: `http://127.0.0.1:${address.port}`,
          });
          expect(status).toEqual({ _tag: 'Started' });
          trace.getTracer('contract').startSpan('telemetry.shutdown.contract').end();
          recordCounter('telemetry.shutdown.contract', 1);
          logs.getLogger('contract').emit({ body: 'Shutdown contract' });
          return yield* Effect.fail('application startup failed');
        }).pipe(Effect.scoped, Effect.catch(Effect.succeed), Effect.provide(Logger.layer([logger])))
      );
      expect(outcome).toBe('application startup failed');
      expect(entries).toContainEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cause: expect.objectContaining({ name: 'TimeoutError' }),
          }),
        ])
      );
      expect(performance.now() - started).toBeLessThan(6000);
      expect(requests).toEqual(new Set(['/v1/traces', '/v1/logs', '/v1/metrics']));
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
