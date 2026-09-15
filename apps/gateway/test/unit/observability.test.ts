import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { createAdmission } from '../../src/admission/index.js';
import { createAvailability } from '../../src/availability/index.js';
import { runGatewayEffect } from '../../src/runtime.js';

describe('Effect OpenTelemetry bridge', () => {
  it('parents readiness and disabled-admission spans to the active transport span', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider();
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
    provider.register();
    try {
      const admission = createAdmission(
        { take: () => Effect.die('Disabled admission must not consume quota') },
        { enabled: false, limit: 10, windowMs: 1000 }
      );
      const availability = createAvailability({
        inspect: () => Effect.succeed({ nats: true, opensearch: true, otel: true }),
      });
      await trace.getTracer('gateway-contract').startActiveSpan('http.request', async (span) => {
        await runGatewayEffect(admission.admit('visitor'));
        await runGatewayEffect(availability.ready(false, true));
        span.end();
      });
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((span) => span.name === 'http.request');
      expect(parent).toBeDefined();
      for (const name of ['admission.admit', 'availability.ready']) {
        const span = spans.find((span) => span.name === name);
        expect(span).toBeDefined();
        expect(span?.parentSpanId).toBe(parent?.spanContext().spanId);
        expect(span?.spanContext().traceId).toBe(parent?.spanContext().traceId);
      }
    } finally {
      trace.disable();
      context.disable();
      propagation.disable();
      await provider.shutdown();
    }
  });
});
