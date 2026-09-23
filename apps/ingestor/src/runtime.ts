import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, trace } from '@opentelemetry/api';
import { Context, Effect, FiberSet, Layer } from 'effect';
import type { Admission } from './admission/index.js';
import type { Availability } from './availability/index.js';
import type { Ingestion } from './ingestion/index.js';

export type HttpServices = Ingestion | Admission | Availability;

/** Built once with the application, after the process has initialized the SDK. */
export const ingestorTracingLayer = OtelTracer.layerWithoutOtelTracer.pipe(
  Layer.provide(Layer.sync(OtelTracer.OtelTracer, () => trace.getTracer('wallpaperdb.ingestor')))
);

/** Bind the current transport context at the foreign-framework invocation. */
export function traceIngestorEffect<A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  const parent = trace.getSpan(context.active())?.spanContext();
  return parent ? OtelTracer.withSpanContext(effect, parent) : effect;
}

export class HttpExecution extends Context.Service<
  HttpExecution,
  {
    run<A, E>(effect: Effect.Effect<A, E, HttpServices>, options?: Effect.RunOptions): Promise<A>;
    drain(timeoutMs: number): Effect.Effect<void>;
  }
>()('wallpaperdb.ingestor/http/Execution') {}

/** Requests share services and remain owned by the application's resource scope. */
export const httpExecutionLayer = Layer.effect(
  HttpExecution,
  Effect.gen(function* () {
    const requests = yield* FiberSet.make();
    const run = yield* FiberSet.runtimePromise(requests)<HttpServices>();
    let draining = false;
    return HttpExecution.of({
      run: (effect, options) =>
        run(draining ? Effect.interrupt : traceIngestorEffect(effect), options),
      drain: Effect.fn('http.drain')(function* (timeoutMs: number) {
        draining = true;
        yield* FiberSet.awaitEmpty(requests).pipe(Effect.timeoutOption(timeoutMs));
        yield* FiberSet.clear(requests);
      }),
    });
  })
).pipe(Layer.provide(ingestorTracingLayer));
