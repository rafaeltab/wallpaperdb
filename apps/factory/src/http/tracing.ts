import { Effect } from 'effect';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const propagator = new W3CTraceContextPropagator();
export type RequestHeaders = Record<string, string | string[] | undefined>;
export function requestOperation<A, E>(
  headers: RequestHeaders,
  name: string,
  operation: Effect.Effect<A, E>
) {
  const parent = trace.getSpanContext(
    propagator.extract(ROOT_CONTEXT, headers, {
      keys: Object.keys,
      get: (values, key) => values[key],
    })
  );
  const observed = operation.pipe(Effect.withSpan(name));
  return parent ? observed.pipe(OtelTracer.withSpanContext(parent)) : observed;
}
