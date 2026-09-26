import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { WallpaperVariantAvailableEventSchema } from '@wallpaperdb/events/schemas';
import { Cause, Clock, Context, Effect, Exit, Fiber, Layer, Metric, Ref } from 'effect';
import { headers } from 'nats';
import { CatalogOutbox, type AvailableNotification } from '../../catalog/index.js';
import { broker, BrokerFailure, NatsBroker, type NatsEventsOptions } from './broker.js';
export interface OutboxHealth {
  check(): Effect.Effect<boolean>;
}
export const OutboxHealth = Context.Service<OutboxHealth>('wallpaperdb/media/OutboxHealth');
const publish = Effect.fn('media.events.publish')(function* (
  service: NatsBroker,
  options: NatsEventsOptions,
  notification: AvailableNotification
) {
  const { id, timestamp, variant } = notification;
  const parsed = WallpaperVariantAvailableEventSchema.safeParse({
    eventId: id,
    eventType: 'wallpaper.variant.available',
    timestamp,
    variant: { ...variant, aspectRatio: variant.width / variant.height },
  });
  if (!parsed.success)
    return yield* Effect.fail(
      new BrokerFailure({ operation: 'encode-availability', cause: parsed.error })
    ).pipe(
      Effect.tapError((error) =>
        Effect.logError('Invalid media notification', { cause: error.cause })
      )
    );
  const metadata = headers();
  for (const [key, value] of Object.entries({
    'content-type': 'application/json',
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/media',
    'ce-id': id,
    'ce-type': 'wallpaper.variant.available',
    'ce-time': timestamp,
    'ce-causationid': notification.causationId,
    'ce-causationsource': notification.causationSource,
    ...(notification.correlationId ? { 'ce-correlationid': notification.correlationId } : {}),
    ...(notification.traceparent ? { traceparent: notification.traceparent } : {}),
    ...(notification.tracestate ? { tracestate: notification.tracestate } : {}),
  }))
    metadata.set(key, value);
  yield* broker('publish-availability', () =>
    service.client.publish('wallpaper.variant.available', JSON.stringify(parsed.data), {
      headers: metadata,
      msgID: JSON.stringify(['https://wallpaperdb/media', id]),
      expect: { streamName: options.stream },
      timeout: 5000,
    })
  );
});
function publishNotification(
  service: NatsBroker,
  options: NatsEventsOptions,
  notification: AvailableNotification
) {
  const parent = trace.getSpanContext(
    propagation.extract(context.active(), {
      traceparent: notification.traceparent,
      tracestate: notification.tracestate,
    })
  );
  const effect = Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    return yield* publish(service, options, notification).pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          yield* Metric.update(
            Metric.counter('events.published.total', {
              incremental: true,
              attributes: {
                'event.type': 'wallpaper.variant.available',
                status: Exit.isSuccess(exit) ? 'success' : 'error',
              },
            }),
            1
          );
          yield* Metric.update(
            Metric.histogram('events.publish_duration_ms', {
              boundaries: [1, 10, 100, 1000, 5000],
              attributes: { 'event.type': 'wallpaper.variant.available' },
            }),
            (yield* Clock.currentTimeMillis) - started
          );
        })
      )
    );
  });
  return parent ? effect.pipe(OtelTracer.withSpanContext(parent)) : effect;
}
export function natsOutboxLayer(
  options: NatsEventsOptions
): Layer.Layer<OutboxHealth, never, NatsBroker | CatalogOutbox> {
  return Layer.effect(
    OutboxHealth,
    Effect.gen(function* () {
      const service = yield* NatsBroker;
      const outbox = yield* CatalogOutbox;
      const accepting = yield* Ref.make(true);
      const healthy = yield* Ref.make(false);
      const dispatch = Effect.gen(function* () {
        const rows = yield* outbox.listPending(16);
        let succeeded = true;
        for (const row of rows) {
          if (!(yield* Ref.get(accepting))) return false;
          const published = yield* publishNotification(service, options, row).pipe(
            Effect.andThen(() => outbox.markPublished(row.id)),
            Effect.as(true),
            Effect.catch((error) =>
              Effect.logError('Media outbox publication remains pending', {
                operation: error.operation,
                cause: error.cause,
                eventId: row.id,
              }).pipe(Effect.as(false))
            )
          );
          succeeded = succeeded && published;
        }
        return succeeded;
      });
      const worker = yield* Effect.gen(function* () {
        while (yield* Ref.get(accepting)) {
          const succeeded = yield* dispatch.pipe(
            Effect.catch((error) =>
              Effect.logError('Media outbox unavailable', {
                operation: error.operation,
                cause: error.cause,
              }).pipe(Effect.as(false))
            )
          );
          yield* Ref.set(healthy, succeeded);
          yield* Effect.sleep(options.outboxPollMs ?? 1000);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause) ? Effect.void : Effect.logError('Media outbox stopped', cause)
        ),
        Effect.ensuring(Ref.set(healthy, false)),
        Effect.forkScoped
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(healthy, false);
          yield* Ref.set(accepting, false);
          yield* Fiber.await(worker).pipe(
            Effect.interruptible,
            Effect.timeoutOrElse({
              duration: options.shutdownTimeoutMs ?? 5000,
              orElse: () => Fiber.interrupt(worker),
            })
          );
        })
      );
      return {
        check: () =>
          Effect.all([Ref.get(healthy), Ref.get(accepting)]).pipe(
            Effect.map(
              ([healthy, accepting]) => healthy && accepting && !service.connection.isClosed()
            )
          ),
      };
    })
  );
}
