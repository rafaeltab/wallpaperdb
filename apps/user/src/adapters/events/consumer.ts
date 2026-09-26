import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Cause, Context, Effect, Fiber, Layer, Ref, Schema, Stream } from 'effect';
import { AckPolicy, type JsMsg } from 'nats';
import { Maintenance, MaintenanceFailure } from '../../maintenance/index.js';
import { broker, EventsBroker, type EventsOptions } from './broker.js';
import { translateOwnership } from './translation.js';
import { ensureQuarantine, quarantine } from './quarantine.js';

export interface ConsumerHealth {
  check(): Effect.Effect<boolean>;
}
export const ConsumerHealth = Context.Service<ConsumerHealth>(
  'wallpaperdb.user.adapters.ConsumerHealth'
);
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));
const durable = 'user-wallpaper-ownership';
const retryDelay = (message: JsMsg, options: EventsOptions) =>
  Math.min(
    30_000,
    (options.retryDelayMs ?? 1000) * 2 ** Math.min(message.info.deliveryCount - 1, 5)
  );

const processMessage = Effect.fn('profiles.events.consume')(function* (
  message: JsMsg,
  service: EventsBroker,
  maintenance: Maintenance,
  options: EventsOptions,
  pendingFailures: Set<number>
) {
  const input = translateOwnership(message.subject, message.data, message.headers);
  yield* Effect.annotateCurrentSpan({
    'event.subject': message.subject,
    'event.consumer': durable,
    'event.delivery_attempt': message.info.deliveryCount,
    ...input?.attributes,
  });
  if (!input) {
    yield* quarantine(service, message, 'invalid');
    message.ack();
    pendingFailures.delete(message.info.streamSequence);
    return;
  }
  if (message.info.deliveryCount > 3) {
    yield* quarantine(service, message, 'exhausted');
    message.ack();
    pendingFailures.delete(message.info.streamSequence);
    return;
  }
  const completed = yield* maintenance
    .recordWallpaperOwnership(input.ownership)
    .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
  if (!completed) {
    pendingFailures.add(message.info.streamSequence);
    if (message.info.deliveryCount < 3) {
      message.nak(retryDelay(message, options));
      return;
    }
    yield* quarantine(service, message, 'exhausted');
  }
  message.ack();
  pendingFailures.delete(message.info.streamSequence);
});
function consumeMessage(
  message: JsMsg,
  service: EventsBroker,
  maintenance: Maintenance,
  options: EventsOptions,
  pendingFailures: Set<number>
) {
  const carrier: Record<string, string> = {};
  for (const key of ['traceparent', 'tracestate']) {
    const value = message.headers?.get(key);
    if (value) carrier[key] = value;
  }
  const parent = trace.getSpanContext(propagation.extract(context.active(), carrier));
  const effect = Effect.gen(function* () {
    yield* Effect.sleep('10 seconds').pipe(
      Effect.andThen(Effect.sync(() => message.working())),
      Effect.forever,
      Effect.forkScoped
    );
    yield* processMessage(message, service, maintenance, options, pendingFailures);
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      pendingFailures.add(message.info.streamSequence);
      message.nak(retryDelay(message, options));
      return Effect.logError('Wallpaper ownership delivery failed', cause);
    }),
    Effect.onInterrupt(() => Effect.sync(() => message.nak(retryDelay(message, options))))
  );
  return parent ? effect.pipe(OtelTracer.withSpanContext(parent)) : effect;
}
export const ownershipConsumerLayer = (options: EventsOptions) =>
  Layer.effect(
    ConsumerHealth,
    Effect.gen(function* () {
      const service = yield* EventsBroker;
      const maintenance = yield* Maintenance;
      yield* ensureQuarantine(service);
      const pendingFailures = new Set<number>();
      const configuration = {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        ack_wait: 30_000_000_000,
        max_deliver: -1,
        filter_subject: 'wallpaper.uploaded',
        max_ack_pending: 1000,
      };
      yield* broker('inspect-ownership-consumer', () =>
        service.manager.consumers.info(options.stream, durable)
      ).pipe(
        Effect.flatMap((existing) => {
          if ((existing.config.max_deliver ?? -1) > 0 && existing.num_redelivered > 0)
            return Effect.fail(
              new MaintenanceFailure({
                operation: 'legacy-consumer-recovery',
                cause: new Error(
                  `Recreate ${options.stream}/${durable} from sequence ${existing.ack_floor.stream_seq + 1} after stopping replicas; legacy deliveries may have exhausted their limit`
                ),
              })
            );
          return broker('update-ownership-consumer', () =>
            service.manager.consumers.update(options.stream, durable, configuration)
          );
        }),
        Effect.catchIf(
          (failure) => notFound(failure.cause),
          () =>
            broker('create-ownership-consumer', () =>
              service.manager.consumers.add(options.stream, configuration)
            )
        )
      );
      const consumer = yield* broker('get-ownership-consumer', () =>
        service.client.consumers.get(options.stream, durable)
      );
      const messages = yield* Effect.acquireRelease(
        broker('consume-ownership', () => consumer.consume({ max_messages: 1 })),
        (messages) => Effect.sync(() => messages.stop())
      );
      const accepting = yield* Ref.make(true);
      const healthy = yield* Ref.make(true);
      const worker = yield* Stream.fromAsyncIterable(
        messages,
        (cause) => new MaintenanceFailure({ operation: 'read-ownership', cause })
      ).pipe(
        Stream.runForEach((message) =>
          Ref.get(accepting).pipe(
            Effect.flatMap((accept) =>
              accept
                ? consumeMessage(message, service, maintenance, options, pendingFailures)
                : Effect.void
            )
          )
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.void
            : Effect.logError('Ownership consumer stopped', cause)
        ),
        Effect.ensuring(Ref.set(healthy, false)),
        Effect.forkScoped
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(accepting, false);
          yield* Ref.set(healthy, false);
          messages.stop();
          yield* Fiber.await(worker).pipe(
            Effect.interruptible,
            Effect.timeoutOrElse({
              duration: options.shutdownTimeoutMs ?? 5000,
              orElse: () => Fiber.interrupt(worker),
            })
          );
        })
      );
      return ConsumerHealth.of({
        check: () =>
          Ref.get(healthy).pipe(
            Effect.map(
              (running) => running && pendingFailures.size === 0 && !service.connection.isClosed()
            )
          ),
      });
    })
  );
