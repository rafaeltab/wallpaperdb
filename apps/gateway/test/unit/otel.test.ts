import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { initializeOtel } from '../../src/otel-init.js';

describe('Gateway telemetry bootstrap', () => {
  it('keeps telemetry disabled when no collector is configured', async () => {
    expect(
      await Effect.runPromise(initializeOtel({ otelServiceName: 'gateway' }).pipe(Effect.scoped))
    ).toEqual({ _tag: 'Disabled' });
  });

  it('reports invalid exporter configuration as unavailable', async () => {
    expect(
      await Effect.runPromise(
        initializeOtel({ otelServiceName: 'gateway', otelEndpoint: 'not a URL' }).pipe(
          Effect.scoped
        )
      )
    ).toEqual({ _tag: 'Unavailable' });
  });

  it('reports a partially initialized SDK as unavailable when the log exporter configuration fails', async () => {
    const collector = createServer((request, response) => {
      request.resume();
      response.writeHead(200);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject);
      collector.listen(0, '127.0.0.1', resolve);
    });
    vi.stubEnv('OTEL_LOGS_EXPORTER', 'otlp');
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_PROTOCOL', 'grpc');
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_HEADERS', 'invalid header=private-collector-token');
    try {
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected a TCP collector address');
      expect(
        await Effect.runPromise(
          initializeOtel({
            otelServiceName: 'gateway-contract',
            otelEndpoint: `http://127.0.0.1:${address.port}`,
          }).pipe(Effect.scoped)
        )
      ).toEqual({ _tag: 'Unavailable' });
    } finally {
      vi.unstubAllEnvs();
      logs.disable();
      trace.disable();
      metrics.disable();
      context.disable();
      propagation.disable();
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it.each([
    'success',
    'import-failure',
    'cleanup-failure',
    'collector-unavailable',
  ])('finishes telemetry cleanup when the bootstrap scope exits: %s', async (outcome) => {
    const requests: string[] = [];
    const collector = createServer((request, response) => {
      requests.push(request.url ?? '');
      request.resume();
      response.writeHead(outcome === 'collector-unavailable' ? 503 : 200);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject);
      collector.listen(0, '127.0.0.1', resolve);
    });
    const address = collector.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP collector address');
    try {
      const finished = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const status = yield* initializeOtel({
              otelServiceName: 'gateway-contract',
              otelEndpoint: `http://127.0.0.1:${address.port}/`,
            });
            expect(status).toEqual({ _tag: 'Started' });
            trace.getTracer('gateway-contract').startSpan('gateway.bootstrap.contract').end();
            if (outcome === 'cleanup-failure')
              yield* Effect.addFinalizer(() => Effect.die('controlled cleanup failure'));
            if (outcome === 'import-failure') {
              const missingAdapter = new URL('../missing-adapter.mjs', import.meta.url).href;
              yield* Effect.tryPromise(() => import(missingAdapter));
            }
          })
        )
      );
      expect(finished._tag).toBe(
        outcome === 'success' || outcome === 'collector-unavailable' ? 'Success' : 'Failure'
      );
      expect(requests).toContain('/v1/traces');
    } finally {
      logs.disable();
      trace.disable();
      metrics.disable();
      context.disable();
      propagation.disable();
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
