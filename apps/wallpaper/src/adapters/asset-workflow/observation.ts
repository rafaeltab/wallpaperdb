import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Clock, Effect, Exit } from 'effect';
import { z } from 'zod';
const metadata = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  correlationid: z.string().optional(),
  causationid: z.string().optional(),
  causationsource: z.string().optional(),
  traceparent: z.string().optional(),
  tracestate: z.string().optional(),
  data: z
    .object({
      assetId: z.string().optional(),
      firstSourceId: z.string().optional(),
      sourceId: z.string().optional(),
      commandId: z.string().optional(),
    })
    .passthrough()
    .optional(),
});
/** One mechanism restores retained trace identity and records bounded workflow diagnostics. */
export function observeWorkflow<A extends string, E, R>(
  name: string,
  event: unknown,
  attributes: Readonly<Record<string, string | number>>,
  operation: Effect.Effect<A, E, R>
) {
  const parsed = metadata.safeParse(event);
  const value = parsed.success ? parsed.data : undefined;
  const diagnostics = {
    ...attributes,
    ...(value?.data?.assetId ? { 'asset.id': value.data.assetId } : {}),
    ...(value?.data?.firstSourceId ? { 'source.id': value.data.firstSourceId } : {}),
    ...(value?.data?.sourceId ? { 'source.id': value.data.sourceId } : {}),
    ...(value?.data?.commandId ? { 'command.id': value.data.commandId } : {}),
    ...(value
      ? {
          'event.id': value.id,
          'event.source': value.source,
          'event.type': value.type,
          ...(value.correlationid ? { 'event.correlation_id': value.correlationid } : {}),
          ...(value.causationid ? { 'event.causation_id': value.causationid } : {}),
          ...(value.causationsource ? { 'event.causation_source': value.causationsource } : {}),
        }
      : {}),
  };
  const observed = Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    yield* Effect.annotateCurrentSpan(diagnostics);
    return yield* operation.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const outcome = {
            'event.outcome': Exit.isSuccess(exit) ? exit.value : 'failed',
            'event.duration_ms': (yield* Clock.currentTimeMillis) - started,
          };
          yield* Effect.annotateCurrentSpan(outcome);
          yield* Effect.logInfo('Wallpaper durable workflow transition', outcome);
        })
      )
    );
  }).pipe(Effect.annotateLogs(diagnostics), Effect.withSpan(name));
  const parent = value
    ? trace.getSpanContext(
        propagation.extract(context.active(), {
          traceparent: value.traceparent,
          tracestate: value.tracestate,
        })
      )
    : undefined;
  return parent ? observed.pipe(OtelTracer.withSpanContext(parent)) : observed;
}
