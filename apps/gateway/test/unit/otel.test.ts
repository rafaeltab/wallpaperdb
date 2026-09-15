import { createServer } from 'node:http';
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import { initializeOtel } from '../../src/otel-init.js';

describe('Gateway telemetry bootstrap', () => {
  it('keeps telemetry disabled when no collector is configured', () => {
    expect(initializeOtel({ otelServiceName: 'gateway' })).toBeNull();
  });

  it('contains invalid exporter configuration without preventing service startup', () => {
    expect(initializeOtel({ otelServiceName: 'gateway', otelEndpoint: 'not a URL' })).toBeNull();
  });

  it('exports spans to a real collector and releases the SDK on shutdown', async () => {
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
    const address = collector.address();
    if (!address || typeof address === 'string')
      throw new Error('Expected a TCP collector address');
    const sdk = initializeOtel({
      otelServiceName: 'gateway-contract',
      otelEndpoint: `http://127.0.0.1:${address.port}/`,
    });
    try {
      if (!sdk) throw new Error('SDK should initialize with a valid collector');
      trace.getTracer('gateway-contract').startSpan('gateway.bootstrap.contract').end();
      await sdk.shutdown();
      expect(requests).toContain('/v1/traces');
    } finally {
      await sdk?.shutdown();
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
