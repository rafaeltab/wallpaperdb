import { createServer } from 'node:http';
import type { Socket } from 'node:net';
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

  it('owns log export through the configured collector instead of an implicit SDK transport', async () => {
    const requests: string[] = [];
    const collector = createServer((request, response) => {
      requests.push(request.url ?? '');
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
    vi.stubEnv('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'not a URL');
    try {
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Expected a TCP collector address');
      expect(
        await Effect.runPromise(
          Effect.gen(function* () {
            const status = yield* initializeOtel({
              otelServiceName: 'gateway-contract',
              otelEndpoint: `http://127.0.0.1:${address.port}`,
            });
            logs.getLogger('gateway-contract').emit({ body: 'collector ownership contract' });
            return status;
          }).pipe(Effect.scoped)
        )
      ).toEqual({ _tag: 'Started' });
      expect(requests).toContain('/v1/logs');
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
    'startup-failure',
    'streaming-response',
  ])('releases stalled collector transports before finishing scope cleanup: %s', async (outcome) => {
    const sockets = new Set<Socket>();
    const requests = new Set<string>();
    const collector = createServer((request, response) => {
      requests.add(request.url ?? '');
      request.resume();
      if (outcome === 'streaming-response') {
        response.writeHead(200);
        response.write(' ');
        const interval = setInterval(() => response.write(' '), 100);
        response.once('close', () => clearInterval(interval));
      }
    });
    collector.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      collector.once('error', reject);
      collector.listen(0, '127.0.0.1', resolve);
    });
    const address = collector.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP collector address');
    try {
      const startedAt = performance.now();
      const finished = await Effect.runPromiseExit(
        Effect.scoped(
          Effect.gen(function* () {
            const status = yield* initializeOtel({
              otelServiceName: 'gateway-contract',
              otelEndpoint: `http://127.0.0.1:${address.port}`,
            });
            expect(status).toEqual({ _tag: 'Started' });
            trace.getTracer('gateway-contract').startSpan('shutdown.contract').end();
            metrics.getMeter('gateway-contract').createCounter('shutdown.contract').add(1);
            logs.getLogger('gateway-contract').emit({ body: 'shutdown contract' });
            if (outcome === 'startup-failure')
              return yield* Effect.fail('controlled startup failure');
          })
        )
      );
      expect(performance.now() - startedAt).toBeLessThan(6000);
      expect(finished._tag).toBe(outcome === 'startup-failure' ? 'Failure' : 'Success');
      expect(requests).toEqual(new Set(['/v1/traces', '/v1/metrics', '/v1/logs']));
      // Allow the peer's close notification to arrive after local socket teardown.
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 500 });
    } finally {
      logs.disable();
      trace.disable();
      metrics.disable();
      context.disable();
      propagation.disable();
      for (const socket of sockets) socket.destroy();
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
