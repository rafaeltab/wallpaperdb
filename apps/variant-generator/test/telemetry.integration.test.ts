import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { recordCounter } from '@wallpaperdb/core/telemetry';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
} from '@wallpaperdb/test-utils';
import { Effect, Layer, Metric } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { variantGeneratorLayer } from '../src/app.js';
import { Availability } from '../src/availability/index.js';
import { createHttpApp } from '../src/http/index.js';
import type { Config } from '../src/config.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
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
  it('exports traces, logs, shared core metrics and Effect metrics before its owning scope closes', async () => {
    const tester = new Tester()
      .withS3()
      .withS3Bucket('wallpapers').withS3Bucket('asset-references')
      .withNats((nats) => nats.withJetstream())
      .withStream('WALLPAPER');
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
            otelServiceName: 'variant-generator-contract',
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
            nodeEnv: 'test', port: 0, jpegQuality: 90, webpQuality: 90, pngCompressionLevel: 6,
            s3Endpoint: s3.endpoints.fromHost, s3Region: 'us-east-1', s3Bucket: 'wallpapers', assetReferenceBucket: 'asset-references',
            s3AccessKeyId: s3.options.accessKey, s3SecretAccessKey: s3.options.secretKey,
            natsUrl: tester.getNats().endpoints.fromHost, natsStream: 'WALLPAPER',
            otelServiceName: 'variant-generator-contract',
          };
          // Decorate the public port while retaining the production dependencies and tracer.
          // Only this test-owned span name is part of the telemetry contract.
          const services = Layer.effect(Availability, Effect.gen(function* () {
            const actual = yield* Availability;
            return Availability.of({
              health: (shuttingDown) => Effect.logInfo('Telemetry contract').pipe(
                Effect.andThen(Metric.update(
                  Metric.counter('telemetry.effect.contract', { incremental: true }), 7
                )),
                Effect.andThen(actual.health(shuttingDown)),
                Effect.withSpan('telemetry.http.contract')
              ),
              ready: (shuttingDown, initialized) => actual.ready(shuttingDown, initialized),
            });
          })).pipe(Layer.provideMerge(variantGeneratorLayer(config, { otelHealthy: true })));
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
      expect(exportedMetrics).toContainEqual(expect.objectContaining({
        name: 'telemetry.effect.contract',
        sum: expect.objectContaining({
          isMonotonic: true,
          dataPoints: expect.arrayContaining([expect.objectContaining({ asDouble: 7 })]),
        }),
      }));
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
