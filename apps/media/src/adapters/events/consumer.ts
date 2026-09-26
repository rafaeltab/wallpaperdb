import { inputAttributes } from './telemetry.js';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Cause, Clock, Context, Effect, Fiber, Layer, Metric, Ref, Schema, Stream } from 'effect';
import { AckPolicy, type JsMsg } from 'nats';
import { CatalogProjection, type CatalogProjectionPort } from '../../catalog/index.js';
import { broker, BrokerFailure, NatsBroker, type NatsEventsOptions } from './broker.js';
import { translateEvent } from './translation.js';
import { ensureQuarantine, quarantine } from './quarantine.js';
export interface ConsumerHealth {
  check(): Effect.Effect<boolean>;
}
export const ConsumerHealth = Context.Service<ConsumerHealth>('wallpaperdb/media/ConsumerHealth');
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));
function retryDelay(message: JsMsg, options: NatsEventsOptions) {
  return Math.min(
    30000,
    (options.retryDelayMs ?? 1000) * 2 ** Math.min(message.info.deliveryCount - 1, 5)
  );
}
const processMessage = Effect.fn('media.events.consume')(function* (
  message: JsMsg,
  service: NatsBroker,
  projection: CatalogProjectionPort,
  options: NatsEventsOptions
) {
  const input = translateEvent(message.subject, message.data, message.headers);
  const started = yield* Clock.currentTimeMillis;
  let status = 'error';
  let outcome = 'retry';
  const attributes = {
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': message.info.deliveryCount,
    ...inputAttributes(input),
  };
  yield* Effect.annotateCurrentSpan(attributes);
  yield* Effect.gen(function* () {
    yield* Effect.sleep('30 seconds').pipe(
      Effect.andThen(Effect.sync(() => message.working())),
      Effect.forever,
      Effect.forkScoped
    );
    if (!input) {
      yield* quarantine(service, message, 'Invalid', input);
      message.ack();
      outcome = 'quarantined_invalid';
      status = 'validation_error';
      return;
    }
    // Broker redelivery remains enabled so failures storing quarantine can recover even after processing is exhausted.
    if (message.info.deliveryCount > 3) {
      yield* quarantine(service, message, 'Exhausted', input);
      message.ack();
      outcome = 'quarantined_exhausted';
      return;
    }
    const succeeded = yield* projection
      .accept(input)
      .pipe(Effect.match({ onSuccess: () => true, onFailure: () => false }));
    if (succeeded) {
      message.ack();
      status = 'success';
      outcome = 'accepted';
      if (input.kind !== 'profile')
        yield* Metric.update(
          Metric.histogram(
            input.kind === 'wallpaper'
              ? 'media.consumer.upsert_duration_ms'
              : 'media.consumer.variant_insert_duration_ms',
            { boundaries: [1, 10, 100, 1000, 5000], attributes: { 'event.type': message.subject } }
          ),
          (yield* Clock.currentTimeMillis) - started
        );
      return;
    }
    if (message.info.deliveryCount >= 3) {
      yield* quarantine(service, message, 'Exhausted', input);
      message.ack();
      outcome = 'quarantined_exhausted';
      return;
    }
    message.nak(retryDelay(message, options));
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterrupts(cause)) return yield* Effect.failCause(cause);
        message.nak(retryDelay(message, options));
        yield* Effect.logError('Media delivery failed', cause);
      })
    ),
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        outcome = 'interrupted';
        message.nak(retryDelay(message, options));
      })
    ),
    Effect.ensuring(
      Effect.gen(function* () {
        const duration = (yield* Clock.currentTimeMillis) - started;
        yield* Effect.annotateCurrentSpan({
          'event.duration_ms': duration,
          'event.outcome': outcome,
        });
        yield* Effect.logInfo('Media event delivery finished', {
          'event.outcome': outcome,
          'event.duration_ms': duration,
        });
        yield* Metric.update(
          Metric.counter('events.consumed.total', {
            incremental: true,
            attributes: { 'event.type': message.subject, status },
          }),
          1
        );
        yield* Metric.update(
          Metric.histogram('events.consume_duration_ms', {
            boundaries: [10, 100, 1000, 30000, 120000],
            attributes: { 'event.type': message.subject },
          }),
          duration
        );
      })
    ),
    Effect.annotateLogs(attributes)
  );
});
function consumeMessage(
  message: JsMsg,
  service: NatsBroker,
  projection: CatalogProjectionPort,
  options: NatsEventsOptions
) {
  const carrier: Record<string, string> = {};
  for (const key of message.headers?.keys() ?? []) carrier[key] = message.headers?.get(key) ?? '';
  const parent = trace.getSpanContext(propagation.extract(context.active(), carrier));
  const effect = processMessage(message, service, projection, options);
  return parent ? effect.pipe(OtelTracer.withSpanContext(parent)) : effect;
}
const startWorker = Effect.fn('media.events.start-consumer')(function* (
  service: NatsBroker,
  projection: CatalogProjectionPort,
  options: NatsEventsOptions,
  stream: string,
  durable: string,
  subject: string
) {
  const { client, manager, connection } = service;
  const config = {
    durable_name: durable,
    ack_policy: AckPolicy.Explicit,
    ack_wait: 120_000_000_000,
    max_deliver: -1,
    filter_subject: subject,
    max_ack_pending: 1000,
  };
  yield* broker('inspect-consumer', () => manager.consumers.info(stream, durable)).pipe(
    Effect.flatMap((existing) => {
      // MaxDeliver removes exhausted deliveries from the pending queue. Increasing
      // its limit cannot revive them. Never rewrite this evidence before recovery.
      if ((existing.config.max_deliver ?? -1) > 0 && existing.num_redelivered > 0)
        return Effect.fail(
          new BrokerFailure({
            operation: 'migrate-legacy-consumer',
            cause: new Error(
              `Stop all media replicas, then recreate ${stream}/${durable} from stream sequence ${existing.ack_floor.stream_seq + 1} before upgrading. Retained redeliveries may have exhausted the legacy delivery limit.`
            ),
          })
        ).pipe(
          Effect.tapError((error) =>
            Effect.logError('Media consumer requires coordinated legacy recovery', {
              cause: error.cause,
            })
          )
        );
      return broker('update-consumer', () => manager.consumers.update(stream, durable, config));
    }),
    Effect.catchIf(
      (error) => notFound(error.cause),
      () => broker('create-consumer', () => manager.consumers.add(stream, config))
    )
  );
  const consumer = yield* broker('get-consumer', () => client.consumers.get(stream, durable));
  const messages = yield* Effect.acquireRelease(
    broker('consume-events', () => consumer.consume({ max_messages: 1 })),
    (messages) => Effect.sync(() => messages.stop())
  );
  const accepting = yield* Ref.make(true);
  const healthy = yield* Ref.make(true);
  const worker = yield* Stream.fromAsyncIterable(
    messages,
    (cause) => new BrokerFailure({ operation: 'read-events', cause })
  ).pipe(
    Stream.runForEach((message) =>
      Ref.get(accepting).pipe(
        Effect.flatMap((accept) =>
          accept ? consumeMessage(message, service, projection, options) : Effect.void
        )
      )
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause) ? Effect.void : Effect.logError('Media consumer stopped', cause)
    ),
    Effect.ensuring(Ref.set(healthy, false)),
    Effect.forkScoped
  );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Ref.set(healthy, false);
      yield* Ref.set(accepting, false);
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
  return () => Ref.get(healthy).pipe(Effect.map((value) => value && !connection.isClosed()));
});
export function natsConsumerLayer(
  options: NatsEventsOptions
): Layer.Layer<ConsumerHealth, BrokerFailure, CatalogProjection | NatsBroker> {
  return Layer.effect(
    ConsumerHealth,
    Effect.gen(function* () {
      const service = yield* NatsBroker;
      const projection = yield* CatalogProjection;
      yield* ensureQuarantine(service);
      const checks: Array<() => Effect.Effect<boolean>> = [];
      for (const [stream, durable, subject] of [
        [options.stream, 'media-wallpaper-uploaded-consumer', 'wallpaper.uploaded'],
        [options.stream, 'media-wallpaper-variant-uploaded-consumer', 'wallpaper.variant.uploaded'],
        ['PROFILE', 'media-profile-picture-snapshots', 'profile.*'],
      ]) {
        if (stream && durable && subject)
          checks.push(yield* startWorker(service, projection, options, stream, durable, subject));
      }
      return {
        check: () =>
          Effect.all(checks.map((check) => check())).pipe(
            Effect.map((results) => results.every(Boolean))
          ),
      };
    })
  );
}
