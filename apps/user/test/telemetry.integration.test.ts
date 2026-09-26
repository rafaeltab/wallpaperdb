import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import { Effect, Layer, Metric } from 'effect';
import { connect } from 'nats';
import postgres from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';
import { userLayer } from '../src/app.js';
import { Availability } from '../src/availability/index.js';
import { loadConfig } from '../src/config.js';
import { createHttpApp } from '../src/http/index.js';
import { initializeOtel } from '../src/otel-init.js';

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
  vi.unstubAllEnvs();
});

it('exports production Effect traces, logs and metrics with incoming HTTP trace context through the owning SDK', async () => {
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
    if (!address || typeof address === 'string') throw new Error('Missing collector address');
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const endpoint = `http://127.0.0.1:${address.port}`;
        const status = yield* initializeOtel({
          otelServiceName: 'user-telemetry-contract',
          otelEndpoint: endpoint,
        });
        trace.getTracer('contract').startSpan('telemetry.sdk.contract').end();
        recordCounter('telemetry.sdk.contract', 1);
        const database = yield* Effect.acquireRelease(
          Effect.promise(() => new PostgreSqlContainer('postgres:16-alpine').start()),
          (container) => Effect.promise(() => container.stop())
        );
        const nats = yield* Effect.acquireRelease(
          Effect.promise(() => createNatsContainer()),
          (container) => Effect.promise(() => container.stop())
        );
        const sql = yield* Effect.acquireRelease(
          Effect.sync(() => postgres(database.getConnectionUri())),
          (sql) => Effect.promise(() => sql.end())
        );
        const directory = new URL('../drizzle/', import.meta.url);
        for (const name of readdirSync(directory)
          .filter((name) => name.endsWith('.sql'))
          .sort())
          yield* Effect.promise(() => sql.unsafe(readFileSync(new URL(name, directory), 'utf8')));
        const connection = yield* Effect.acquireRelease(
          Effect.promise(() => connect({ servers: nats.getConnectionUrl() })),
          (connection) => Effect.promise(() => connection.close())
        );
        const manager = yield* Effect.promise(() => connection.jetstreamManager());
        yield* Effect.promise(() =>
          manager.streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] })
        );
        yield* Effect.promise(() =>
          manager.streams.add({ name: 'PROFILE', subjects: ['profile.>'] })
        );
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('DATABASE_URL', database.getConnectionUri());
        vi.stubEnv('NATS_URL', nats.getConnectionUrl());
        vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', endpoint);
        const config = { ...loadConfig(), port: 0 };
        const services = Layer.effect(
          Availability,
          Effect.gen(function* () {
            const actual = yield* Availability;
            return Availability.of({
              health: (shuttingDown) =>
                Effect.logInfo('Telemetry contract').pipe(
                  Effect.andThen(
                    Metric.update(
                      Metric.counter('telemetry.effect.contract', { incremental: true }),
                      7
                    )
                  ),
                  Effect.andThen(actual.health(shuttingDown)),
                  Effect.withSpan('telemetry.http.contract')
                ),
              ready: (shuttingDown, initialized) => actual.ready(shuttingDown, initialized),
            });
          })
        ).pipe(Layer.provideMerge(userLayer(config, { workers: false, otelHealthy: true })));
        const app = yield* Effect.acquireRelease(
          Effect.promise(() => createHttpApp(config, services)),
          (app) => Effect.promise(() => app.close())
        );
        const response = yield* Effect.promise(() =>
          app.inject({
            method: 'GET',
            url: '/health',
            headers: { traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' },
          })
        );
        expect(response.statusCode).toBe(200);
        return status;
      }).pipe(Effect.scoped)
    );
    expect(status).toEqual({ _tag: 'Started' });
    expect(exported.get('/v1/traces')?.join()).toContain('telemetry.sdk.contract');
    expect(exported.get('/v1/logs')?.join()).toContain('Telemetry contract');
    expect(exported.get('/v1/metrics')?.join()).toContain('telemetry.sdk.contract');
    const exportedMetrics: unknown[] = [];
    const spans: unknown[] = [];
    for (const body of exported.get('/v1/metrics') ?? [])
      JSON.parse(body, (key, value: unknown) => {
        if (key === 'metrics' && Array.isArray(value)) exportedMetrics.push(...value);
        return value;
      });
    for (const body of exported.get('/v1/traces') ?? [])
      JSON.parse(body, (key, value: unknown) => {
        if (key === 'spans' && Array.isArray(value)) spans.push(...value);
        return value;
      });
    expect(exportedMetrics).toContainEqual(
      expect.objectContaining({
        name: 'telemetry.effect.contract',
        sum: expect.objectContaining({
          isMonotonic: true,
          dataPoints: expect.arrayContaining([expect.objectContaining({ asDouble: 7 })]),
        }),
      })
    );
    expect(spans).toContainEqual(
      expect.objectContaining({
        name: 'telemetry.http.contract',
        traceId: '0123456789abcdef0123456789abcdef',
        parentSpanId: '0123456789abcdef',
      })
    );
  } finally {
    collector.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      collector.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
