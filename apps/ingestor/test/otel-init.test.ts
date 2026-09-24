import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Effect, ManagedRuntime, Metric } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { ingestorTracingLayer } from '../src/runtime.js';

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe('ingestor telemetry ownership', () => {
  it('reports disabled or unavailable telemetry without preventing application startup', async () => {
    expect(
      await Effect.runPromise(initializeOtel({ otelServiceName: 'ingestor' }).pipe(Effect.scoped))
    ).toEqual({ _tag: 'Disabled' });
    expect(
      await Effect.runPromise(
        initializeOtel({ otelServiceName: 'ingestor', otelEndpoint: 'invalid URL' }).pipe(
          Effect.scoped
        )
      )
    ).toEqual({ _tag: 'Unavailable' });
  });
  it('closes stalled collector sockets after a failed application startup', async () => {
    const sockets = new Set<Socket>();
    const collector = createServer((request, response) => {
      request.resume();
      response.writeHead(200);
      response.write(' ');
      const interval = setInterval(() => response.write(' '), 100);
      response.once('close', () => clearInterval(interval));
    });
    collector.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected collector TCP address');
      const started = performance.now();
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          yield* initializeOtel({
            otelServiceName: 'ingestor-stalled',
            otelEndpoint: `http://127.0.0.1:${address.port}`,
          });
          trace.getTracer('ingestor-contract').startSpan('shutdown.contract').end();
          metrics.getMeter('ingestor-contract').createCounter('shutdown.contract').add(1);
          logs.getLogger('ingestor-contract').emit({ body: 'shutdown contract' });
          return yield* Effect.fail('application startup failed');
        }).pipe(Effect.scoped)
      );
      expect(exit._tag).toBe('Failure');
      expect(performance.now() - started).toBeLessThan(6000);
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 500 });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('exports logs, traces, and metrics before its owning scope finishes', async () => {
    const requests = new Set<string>();
    const metricBodies: string[] = [];
    const collector = createServer((request, response) => {
      requests.add(request.url ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/metrics') metricBodies.push(Buffer.concat(chunks).toString());
        response.writeHead(200);
        response.end();
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected collector TCP address');
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* initializeOtel({
            otelServiceName: 'ingestor-contract',
            otelEndpoint: `http://127.0.0.1:${address.port}/`,
          });
          trace.getTracer('ingestor-contract').startSpan('telemetry.contract').end();
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() => ManagedRuntime.make(ingestorTracingLayer)),
            (runtime) => Effect.promise(() => runtime.dispose())
          );
          yield* Effect.promise(() =>
            runtime.runPromise(
              Effect.logError('Effect diagnostic contract').pipe(
                Effect.andThen(
                  Metric.update(
                    Metric.counter('reconciliation.errors.total', {
                      incremental: true,
                      attributes: { 'reconciliation.type': 'uploads' },
                    }),
                    3
                  )
                )
              )
            )
          );
          return status;
        }).pipe(Effect.scoped)
      );
      expect(status).toEqual({ _tag: 'Started' });
      expect(requests).toEqual(new Set(['/v1/logs', '/v1/traces', '/v1/metrics']));
      expect(metricBodies.map((body) => JSON.parse(body))).toContainEqual(
        expect.objectContaining({
          resourceMetrics: expect.arrayContaining([
            expect.objectContaining({
              resource: expect.objectContaining({
                attributes: expect.arrayContaining([
                  { key: 'service.name', value: { stringValue: 'ingestor-contract' } },
                ]),
              }),
              scopeMetrics: expect.arrayContaining([
                expect.objectContaining({
                  metrics: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'reconciliation.errors.total',
                      sum: expect.objectContaining({
                        isMonotonic: true,
                        dataPoints: expect.arrayContaining([
                          expect.objectContaining({
                            asDouble: 3,
                            attributes: expect.arrayContaining([
                              { key: 'reconciliation.type', value: { stringValue: 'uploads' } },
                            ]),
                          }),
                        ]),
                      }),
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
        })
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
