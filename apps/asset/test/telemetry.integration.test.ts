import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  PostgresTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, Metric } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { assetLayer } from '../src/app.js';
import { Availability } from '../src/capabilities/availability/index.js';
import { AssetDelivery } from '../src/capabilities/delivery/index.js';
import { Lifecycle } from '../src/capabilities/lifecycle/index.js';
import {
  AuthorAuthentication,
  AuthorAuthenticationFailure,
} from '../src/adapters/authors/index.js';
import { createHttpApp } from '../src/http/index.js';
import { tracingLayer } from '../src/runtime.js';
import { AssetMigrationsTesterBuilder } from './builders/AssetMigrationsBuilder.js';
import type { Config } from '../src/config.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(AssetMigrationsTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .build();

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe('Production telemetry composition', () => {
  it('exports author work through the shared HTTP telemetry mechanism', async () => {
    const exporter = new InMemorySpanExporter();
    const sdk = new NodeSDK({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    sdk.start();
    trace.getTracer('contract').startSpan('telemetry.sdk.author.contract').end();
    const services = Layer.merge(
      Layer.succeed(AssetDelivery, {
        wallpaper: () => Effect.die('Unused delivery route'),
        picture: () => Effect.die('Unused delivery route'),
      }),
      Layer.succeed(Availability, {
        health: () => Effect.die('Unused health route'),
        ready: () => Effect.die('Unused readiness route'),
      })
    ).pipe(Layer.provideMerge(tracingLayer));
    const authorServices = Layer.merge(
      Layer.succeed(AuthorAuthentication, {
        verify: () =>
          Effect.fail(
            new AuthorAuthenticationFailure({
              cause: new Error('Contract identity dependency failure'),
            })
          ).pipe(Effect.withSpan('telemetry.author.contract')),
      }),
      Layer.succeed(Lifecycle, {
        command: () => Effect.die('No HTTP creation route'),
        inspect: () => Effect.die('Authentication failure cannot inspect Assets'),
      })
    );
    try {
      const app = await createHttpApp({ nodeEnv: 'test', port: 0 }, services, { authorServices });
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/assets/asset_contract/sources',
          headers: {
            authorization: 'Bearer private-contract-token',
            traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
          },
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({
          type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/service-unavailable.md',
          title: 'Service unavailable',
          status: 503,
        });
      } finally {
        await app.close();
      }
      const spans = exporter.getFinishedSpans();
      // This test-owned span qualifies the mechanism, not production instrumentation details.
      expect(spans).toContainEqual(
        expect.objectContaining({ name: 'telemetry.sdk.author.contract' })
      );
      expect(spans).toContainEqual(
        expect.objectContaining({
          name: 'telemetry.author.contract',
          parentSpanContext: expect.objectContaining({
            traceId: '0123456789abcdef0123456789abcdef',
            spanId: '0123456789abcdef',
          }),
        })
      );
      expect(
        JSON.stringify(spans.map(({ attributes, events }) => ({ attributes, events })))
      ).not.toContain('private-contract-token');
    } finally {
      await sdk.shutdown();
    }
  });

  it('exports traces, logs, shared core metrics and Effect metrics before its owning scope closes', async () => {
    const tester = new Tester()
      .withPostgres((builder) => builder.withDatabase('asset_telemetry'))
      .withMigrations()
      .withS3()
      .withS3Bucket('wallpapers')
      .withNats((nats) => nats.withJetstream())
      .withStream('WALLPAPER')
      .withStream('PROFILE');
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
    await new Promise<void>((resolve) => {
      collector.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Missing collector TCP address');
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* initializeOtel({
            otelServiceName: 'asset-contract',
            otelEndpoint: `http://127.0.0.1:${address.port}/`,
          });
          trace.getTracer('contract').startSpan('telemetry.sdk.contract').end();
          recordCounter('telemetry.sdk.contract', 1);
          yield* Effect.acquireRelease(Effect.succeed(tester), () =>
            Effect.promise(() => tester.destroy())
          );
          yield* Effect.tryPromise(() => tester.setup());
          const s3 = tester.getS3();
          const config: Config = {
            nodeEnv: 'test',
            port: 0,
            maxResizeWidth: 7680,
            maxResizeHeight: 4320,
            databaseUrl: tester.getPostgres().connectionStrings.fromHost,
            s3Endpoint: s3.endpoints.fromHost,
            s3Region: 'us-east-1',
            s3Bucket: 'wallpapers',
            profilePictureBucket: 'profile-pictures',
            s3AccessKeyId: s3.options.accessKey,
            s3SecretAccessKey: s3.options.secretKey,
            natsUrl: tester.getNats().endpoints.fromHost,
            natsStream: 'WALLPAPER',
            otelServiceName: 'asset-contract',
          };
          // Decorate the public port while retaining the production dependencies and tracer.
          // Only this test-owned span name is part of the telemetry contract.
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
          ).pipe(Layer.provideMerge(assetLayer(config, { otelHealthy: true })));
          const app = yield* Effect.acquireRelease(
            Effect.tryPromise(() => createHttpApp({ nodeEnv: 'test', port: 0 }, services)),
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
      expect(exported.get('/v1/traces')?.join()).toContain('telemetry.http.contract');
      expect(exported.get('/v1/metrics')?.join()).toContain('telemetry.sdk.contract');
      expect(exported.get('/v1/logs')?.join()).toContain('Telemetry contract');
      const exportedMetrics: unknown[] = [];
      for (const body of exported.get('/v1/metrics') ?? []) {
        JSON.parse(body, (key, value: unknown) => {
          if (key === 'metrics' && Array.isArray(value)) exportedMetrics.push(...value);
          return value;
        });
      }
      expect(exportedMetrics).toContainEqual(
        expect.objectContaining({
          name: 'telemetry.effect.contract',
          sum: expect.objectContaining({
            isMonotonic: true,
            dataPoints: expect.arrayContaining([expect.objectContaining({ asDouble: 7 })]),
          }),
        })
      );
      expect(exportedMetrics).toContainEqual(
        expect.objectContaining({
          name: 'asset.dependency.healthy',
          gauge: expect.objectContaining({ dataPoints: expect.any(Array) }),
        })
      );
      expect(exportedMetrics).toContainEqual(
        expect.objectContaining({
          name: 'asset.dependency.observed_at_seconds',
        })
      );
      const spans: unknown[] = [];
      for (const body of exported.get('/v1/traces') ?? []) {
        JSON.parse(body, (key, value: unknown) => {
          if (key === 'spans' && Array.isArray(value)) spans.push(...value);
          return value;
        });
      }
      expect(spans).toContainEqual(
        expect.objectContaining({
          name: 'telemetry.http.contract',
          traceId: '0123456789abcdef0123456789abcdef',
          parentSpanId: '0123456789abcdef',
        })
      );
    } finally {
      collector.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        collector.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
