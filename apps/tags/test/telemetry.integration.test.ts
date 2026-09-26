import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import { Effect, ManagedRuntime, Metric } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { tracingLayer } from '../src/runtime.js';

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe('Production telemetry mechanism', () => {
  it('exports SDK and Effect telemetry before its owning scope closes', async () => {
    const exported = new Map<string, string[]>();
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const path = request.url ?? '';
        exported.set(path, [...(exported.get(path) ?? []), Buffer.concat(chunks).toString()]);
        response.writeHead(200);
        response.end();
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Missing collector TCP address');
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* initializeOtel({
            otelServiceName: 'tags-contract',
            otelEndpoint: `http://127.0.0.1:${address.port}/`,
          });
          trace.getTracer('contract').startSpan('telemetry.sdk.contract').end();
          recordCounter('telemetry.sdk.contract', 1);
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() => ManagedRuntime.make(tracingLayer)),
            (runtime) => Effect.promise(() => runtime.dispose())
          );
          yield* Effect.promise(() => runtime.runPromise(
            Effect.logInfo('Telemetry contract').pipe(
              Effect.andThen(Metric.update(
                Metric.counter('telemetry.effect.contract', { incremental: true }), 7
              )),
              Effect.withSpan('telemetry.effect.contract')
            )
          ));
          return status;
        }).pipe(Effect.scoped)
      );
      expect(status).toEqual({ _tag: 'Started' });
      expect(exported.get('/v1/traces')?.join()).toContain('telemetry.sdk.contract');
      expect(exported.get('/v1/traces')?.join()).toContain('telemetry.effect.contract');
      expect(exported.get('/v1/metrics')?.join()).toContain('telemetry.sdk.contract');
      expect(exported.get('/v1/logs')?.join()).toContain('Telemetry contract');
      const exportedMetrics: unknown[] = [];
      for (const body of exported.get('/v1/metrics') ?? []) {
        JSON.parse(body, (key, value: unknown) => {
          if (key === 'metrics' && Array.isArray(value)) exportedMetrics.push(...value);
          return value;
        });
      }
      expect(exportedMetrics).toContainEqual(expect.objectContaining({
        name: 'telemetry.effect.contract',
        sum: expect.objectContaining({
          isMonotonic: true,
          dataPoints: expect.arrayContaining([expect.objectContaining({ asDouble: 7 })]),
        }),
      }));
    } finally {
      collector.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        collector.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
