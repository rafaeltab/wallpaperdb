import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { recordCounter, TelemetryExportTransport } from '@wallpaperdb/core/telemetry';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import { Effect, Layer, Metric } from 'effect';
import { connect } from 'nats';
import postgres from 'postgres';
import { afterEach, expect, it, vi } from 'vitest';
import { userLayer } from '../src/app.js';
import { Availability } from '../src/capabilities/availability/index.js';
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
  vi.restoreAllMocks();
});

it('exports production Effect traces, logs and metrics with incoming HTTP trace context through the owning SDK', async () => {
  const started = performance.now();
  const timeline: { elapsedMs: number; event: string; error?: string }[] = [];
  const record = (event: string, error?: string) => {
    timeline.push({ elapsedMs: Math.round(performance.now() - started), event, error });
  };
  const closeTransport = TelemetryExportTransport.prototype.close;
  vi.spyOn(TelemetryExportTransport.prototype, 'close').mockImplementation(async function (
    this: TelemetryExportTransport
  ) {
    record('transport.close.start');
    await closeTransport.call(this);
    record('transport.close.complete');
  });
  const shutdown = NodeSDK.prototype.shutdown;
  vi.spyOn(NodeSDK.prototype, 'shutdown').mockImplementation(async function (this: NodeSDK) {
    record('sdk.shutdown.start');
    try {
      await shutdown.call(this);
      record('sdk.shutdown.complete');
    } catch (error) {
      record('sdk.shutdown.failed', String(error));
      throw error;
    }
  });
  const tracesExport = OTLPTraceExporter.prototype.export;
  vi.spyOn(OTLPTraceExporter.prototype, 'export').mockImplementation(function (
    this: OTLPTraceExporter,
    items,
    callback
  ) {
    record('traces.export.start');
    return tracesExport.call(this, items, (result) => {
      record(`traces.export.result.${result.code}`, result.error?.message);
      callback(result);
    });
  });
  const tracesFlush = OTLPTraceExporter.prototype.forceFlush;
  vi.spyOn(OTLPTraceExporter.prototype, 'forceFlush').mockImplementation(async function (
    this: OTLPTraceExporter
  ) {
    record('traces.flush.start');
    try {
      await tracesFlush.call(this);
      record('traces.flush.complete');
    } catch (error) {
      record('traces.flush.failed', String(error));
      throw error;
    }
  });
  const logsExport = OTLPLogExporter.prototype.export;
  vi.spyOn(OTLPLogExporter.prototype, 'export').mockImplementation(function (
    this: OTLPLogExporter,
    items,
    callback
  ) {
    record('logs.export.start');
    return logsExport.call(this, items, (result) => {
      record(`logs.export.result.${result.code}`, result.error?.message);
      callback(result);
    });
  });
  const logsFlush = OTLPLogExporter.prototype.forceFlush;
  vi.spyOn(OTLPLogExporter.prototype, 'forceFlush').mockImplementation(async function (
    this: OTLPLogExporter
  ) {
    record('logs.flush.start');
    try {
      await logsFlush.call(this);
      record('logs.flush.complete');
    } catch (error) {
      record('logs.flush.failed', String(error));
      throw error;
    }
  });
  const metricsExport = OTLPMetricExporter.prototype.export;
  vi.spyOn(OTLPMetricExporter.prototype, 'export').mockImplementation(function (
    this: OTLPMetricExporter,
    items,
    callback
  ) {
    record('metrics.export.start');
    return metricsExport.call(this, items, (result) => {
      record(`metrics.export.result.${result.code}`, result.error?.message);
      callback(result);
    });
  });
  const metricsFlush = OTLPMetricExporter.prototype.forceFlush;
  vi.spyOn(OTLPMetricExporter.prototype, 'forceFlush').mockImplementation(async function (
    this: OTLPMetricExporter
  ) {
    record('metrics.flush.start');
    try {
      await metricsFlush.call(this);
      record('metrics.flush.complete');
    } catch (error) {
      record('metrics.flush.failed', String(error));
      throw error;
    }
  });
  const exported = new Map<string, string[]>();
  const collector = createServer((request, response) => {
    record(`collector.received.${request.url}`);
    response.once('finish', () => record(`collector.completed.${request.url}`));
    request.once('aborted', () => record(`collector.aborted.${request.url}`));
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
          (container) =>
            Effect.promise(async () => {
              record('postgres.stop.start');
              await container.stop();
              record('postgres.stop.complete');
            })
        );
        const nats = yield* Effect.acquireRelease(
          Effect.promise(() => createNatsContainer()),
          (container) =>
            Effect.promise(async () => {
              record('nats.stop.start');
              await container.stop();
              record('nats.stop.complete');
            })
        );
        const sql = yield* Effect.acquireRelease(
          Effect.sync(() => postgres(database.getConnectionUri())),
          (sql) =>
            Effect.promise(async () => {
              record('sql.end.start');
              await sql.end();
              record('sql.end.complete');
            })
        );
        const directory = new URL('../drizzle/', import.meta.url);
        for (const name of readdirSync(directory)
          .filter((name) => name.endsWith('.sql'))
          .sort())
          yield* Effect.promise(() => sql.unsafe(readFileSync(new URL(name, directory), 'utf8')));
        const connection = yield* Effect.acquireRelease(
          Effect.promise(() => connect({ servers: nats.getConnectionUrl() })),
          (connection) =>
            Effect.promise(async () => {
              record('connection.close.start');
              await connection.close();
              record('connection.close.complete');
            })
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
        // This fixture exercises telemetry with optional picture storage disabled.
        vi.stubEnv('S3_ENDPOINT', undefined);
        vi.stubEnv('S3_ACCESS_KEY_ID', undefined);
        vi.stubEnv('S3_SECRET_ACCESS_KEY', undefined);
        vi.stubEnv('USER_ASSET_WORKFLOW_FILE', undefined);
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
          (app) =>
            Effect.promise(async () => {
              record('app.close.start');
              await app.close();
              record('app.close.complete');
            })
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
    record('scope.complete');
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
      expect.objectContaining({ name: 'user.dependency.healthy' })
    );
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
    // Vitest retains this output on failure. Observe the real SDK without changing
    // its deadlines or treating successful shutdown as proof that export succeeded.
    console.info('User telemetry contract timeline', JSON.stringify(timeline));
    collector.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      collector.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
