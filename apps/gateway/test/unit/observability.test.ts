import { context, propagation, trace } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';
import { Admission } from '../../src/admission/index.js';
import { Availability } from '../../src/availability/index.js';
import { HttpExecution, httpExecutionLayer } from '../../src/runtime.js';
import { httpTestLayer } from './http-fixture.js';

describe('Effect OpenTelemetry bridge', () => {
  it('parents application spans to the active transport span', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    const runtime = ManagedRuntime.make(httpExecutionLayer.pipe(Layer.provide(httpTestLayer())));
    try {
      const execution = await runtime.runPromise(HttpExecution);
      await trace.getTracer('gateway-contract').startActiveSpan('http.request', async (span) => {
        await execution.run(Admission.use((admission) => admission.admit('visitor')));
        await execution.run(Availability.use((availability) => availability.ready(false, true)));
        span.end();
      });
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const parent = spans.find((span) => span.name === 'http.request');
      expect(parent).toBeDefined();
      for (const name of ['admission.admit', 'availability.ready']) {
        const span = spans.find((span) => span.name === name);
        expect(span).toBeDefined();
        expect(span?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
        expect(span?.spanContext().traceId).toBe(parent?.spanContext().traceId);
      }
    } finally {
      await runtime.dispose();
      trace.disable();
      context.disable();
      propagation.disable();
      await provider.shutdown();
    }
  });
});
