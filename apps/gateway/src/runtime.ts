import * as OtelTracer from '@effect/opentelemetry/Tracer';
import { context, trace } from '@opentelemetry/api';
import { Effect } from 'effect';

/** Each driving adapter enters Effect with the active transport trace. The SDK
 * is initialized before importing adapters, so instrumented clients stay linked. */
export function traceGatewayEffect<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> {
  const parent = trace.getSpan(context.active())?.spanContext();
  return Effect.gen(function* () {
    const tracer = yield* OtelTracer.make.pipe(
      Effect.provideService(OtelTracer.OtelTracer, trace.getTracer('wallpaperdb.gateway'))
    );
    const traced = effect.pipe(Effect.withTracer(tracer));
    return yield* parent ? OtelTracer.withSpanContext(traced, parent) : traced;
  });
}
export function runGatewayEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(traceGatewayEffect(effect));
}
