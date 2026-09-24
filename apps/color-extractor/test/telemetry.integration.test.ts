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
import { Effect, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeOtel } from '../src/otel-init.js';
import { tracingLayer } from '../src/runtime.js';
import { InProcessColorExtractorTesterBuilder } from './builders/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .with(InProcessColorExtractorTesterBuilder)
  .build();

afterEach(() => {
  logs.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  propagation.disable();
});

describe('Production telemetry composition', () => {
  it('exports traces, logs and shared core metrics before its owning scope closes', async () => {
    const tester = new Tester()
      .withS3()
      .withS3Bucket('wallpapers')
      .withNats((nats) => nats.withJetstream())
      .withStream('WALLPAPER')
      .withInProcessApp();
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
            otelServiceName: 'color-extractor-contract',
            otelEndpoint: `http://127.0.0.1:${address.port}/`,
          });
          trace.getTracer('contract').startSpan('extraction.contract').end();
          recordCounter('extraction.contract', 1);
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() => ManagedRuntime.make(tracingLayer)),
            (runtime) => Effect.promise(() => runtime.dispose())
          );
          yield* Effect.promise(() =>
            runtime.runPromise(
              Effect.logInfo('Extraction completed').pipe(Effect.withSpan('effect.contract'))
            )
          );
          yield* Effect.acquireRelease(Effect.succeed(tester), () =>
            Effect.promise(() => tester.destroy())
          );
          yield* Effect.tryPromise(() => tester.setup());
          const app = tester.getApp();
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
      expect(exported.get('/v1/traces')?.join()).toContain('extraction.contract');
      expect(exported.get('/v1/traces')?.join()).toContain('effect.contract');
      expect(exported.get('/v1/metrics')?.join()).toContain('extraction.contract');
      expect(exported.get('/v1/logs')?.join()).toContain('Extraction completed');
      const spans: unknown[] = [];
      for (const body of exported.get('/v1/traces') ?? []) {
        JSON.parse(body, (key, value: unknown) => {
          if (key === 'spans' && Array.isArray(value)) spans.push(...value);
          return value;
        });
      }
      expect(spans).toContainEqual(
        expect.objectContaining({
          name: 'availability.health',
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
