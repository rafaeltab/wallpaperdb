import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { ingestorTracingLayer } from '../src/runtime.js';
import { Ingestion, IngestionUnavailable } from '../src/ingestion/index.js';
import { fixture, uploadInput } from './helpers/ingestion.js';

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
    const logRecords: unknown[] = [];
    const spans: unknown[] = [];
    const collector = createServer((request, response) => {
      requests.add(request.url ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (request.url === '/v1/metrics') metricBodies.push(body);
        JSON.parse(body, (key, value) => {
          if (key === 'logRecords') logRecords.push(...value);
          if (key === 'spans') spans.push(...value);
          return value;
        });
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
          const controlled = fixture({
            events: {
              publish: () =>
                Effect.logError('Controlled broker unavailable').pipe(
                  Effect.andThen(
                    Effect.fail(
                      new IngestionUnavailable({
                        operation: 'publish-upload-event',
                        cause: 'offline',
                      })
                    )
                  )
                ),
            },
          });
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() =>
              ManagedRuntime.make(controlled.layer.pipe(Layer.provideMerge(ingestorTracingLayer)))
            ),
            (runtime) => Effect.promise(() => runtime.dispose())
          );
          yield* Effect.promise(() =>
            runtime.runPromise(
              Effect.gen(function* () {
                const ingestion = yield* Ingestion;
                yield* ingestion.upload(uploadInput);
                yield* controlled.advance();
                yield* ingestion.reconcile();
              })
            )
          );
          return status;
        }).pipe(Effect.scoped)
      );
      expect(status).toEqual({ _tag: 'Started' });
      expect(requests).toEqual(new Set(['/v1/logs', '/v1/traces', '/v1/metrics']));
      const occurrenceAttributes = [
        { key: 'event.source', value: { stringValue: 'urn:wallpaperdb:ingestor' } },
        { key: 'event.id', value: { stringValue: 'event-1' } },
        { key: 'event.type', value: { stringValue: 'wallpaper.uploaded' } },
        { key: 'event.correlation_id', value: { stringValue: 'workflow-1' } },
        { key: 'event.causation_id', value: { stringValue: 'command-1' } },
        { key: 'wallpaper.id', value: { stringValue: 'wlpr_1' } },
        { key: 'event.delivery_attempt', value: { intValue: 2 } },
      ];
      expect(logRecords).toContainEqual(
        expect.objectContaining({
          body: { stringValue: 'Controlled broker unavailable' },
          attributes: expect.arrayContaining(occurrenceAttributes),
          traceId: expect.any(String),
        })
      );
      const completion = expect.objectContaining({
        attributes: expect.arrayContaining([
          ...occurrenceAttributes,
          { key: 'event.outcome', value: { stringValue: 'Deferred' } },
          { key: 'event.duration_ms', value: { intValue: 0 } },
        ]),
      });
      expect(logRecords).toContainEqual(completion);
      expect(spans).toContainEqual(completion);
      expect(JSON.stringify({ logRecords, spans })).not.toContain(uploadInput.principal.profileId);
      expect(JSON.stringify({ logRecords, spans })).not.toContain(uploadInput.filename);
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
                            asDouble: 1,
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
