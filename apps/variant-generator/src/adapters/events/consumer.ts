import { createHash } from 'node:crypto';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { Cause, Clock, Context, Effect, Fiber, Layer, Metric, Ref, Schema, Stream } from 'effect';
import { AckPolicy, DiscardPolicy, headers, StorageType, type JsMsg } from 'nats';
import { GenerateVariants, GenerationUnavailable } from '../../generation/index.js';
import { broker, NatsBroker, type NatsEventsOptions } from './broker.js';
import { translateUpload } from './translation.js';

export interface ConsumerHealth {
  check(): Effect.Effect<boolean>;
}
export const ConsumerHealth = Context.Service<ConsumerHealth>(
  'wallpaperdb/variant-generator/ConsumerHealth'
);
const durable = 'variant-generator-wallpaper-uploaded-consumer';
const quarantineStream = 'VARIANT_GENERATOR_QUARANTINE';
const quarantineSubject = 'variant-generator.quarantine';
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));

function retryDelay(message: JsMsg, options: NatsEventsOptions) {
  return Math.min(
    30_000,
    (options.retryDelayMs ?? 1000) * 2 ** Math.min(message.info.deliveryCount - 1, 5)
  );
}

function quarantine(brokerService: NatsBroker, message: JsMsg, reason: string) {
  const info = message.info;
  const id = createHash('sha256')
    .update(
      JSON.stringify([
        info.domain,
        info.account_hash,
        info.stream,
        info.consumer,
        info.streamSequence,
        info.timestampNanos,
      ])
    )
    .update(message.data)
    .digest('hex');
  const metadata = headers();
  metadata.set('ce-specversion', '1.0');
  metadata.set('ce-source', 'https://wallpaperdb/variant-generator');
  metadata.set('ce-id', id);
  metadata.set('ce-type', 'variant-generator.upload.quarantined');
  metadata.set('ce-time', new Date(info.timestampNanos / 1_000_000).toISOString());
  metadata.set('ce-reason', reason);
  metadata.set('ce-originalsubject', message.subject);
  metadata.set('ce-consumer', info.consumer);
  for (const key of ['traceparent', 'tracestate']) {
    const value = message.headers?.get(key);
    if (value && value.length <= 512) metadata.set(key, value);
  }
  // Preserve exact bytes without base64 expansion. A failed quarantine publication leaves
  // the original unacknowledged and retries the durable handoff without rerunning generation.
  return broker('quarantine-upload', () =>
    brokerService.client.publish(quarantineSubject, message.data, {
      headers: metadata,
      msgID: id,
      expect: { streamName: quarantineStream },
      timeout: 5000,
    })
  );
}

const processMessage = Effect.fn('variants.events.consume')(function* (
  message: JsMsg,
  brokerService: NatsBroker,
  generator: GenerateVariants,
  options: NatsEventsOptions
) {
  const input = translateUpload(message.data);
  const started = yield* Clock.currentTimeMillis;
  let status = 'error';
  const attributes = {
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': message.info.deliveryCount,
    ...(input
      ? {
          'event.source': input.occurrence.source,
          'event.id': input.occurrence.id,
          'wallpaper.id': input.wallpaperId,
          ...(input.correlationId ? { 'event.correlation_id': input.correlationId } : {}),
          ...(input.causationId ? { 'event.causation_id': input.causationId } : {}),
        }
      : {}),
  };
  yield* Effect.annotateCurrentSpan(attributes);
  yield* Effect.gen(function* () {
    // A scoped heartbeat prevents the fixed 120-second ack deadline from racing legitimate work.
    yield* Effect.sleep('30 seconds').pipe(
      Effect.andThen(Effect.sync(() => message.working())),
      Effect.forever,
      Effect.forkScoped
    );
    if (!input) {
      yield* quarantine(brokerService, message, 'Invalid');
      message.ack();
      status = 'validation_error';
      return;
    }
    if (message.info.deliveryCount > 3) {
      yield* quarantine(brokerService, message, 'Exhausted');
      message.ack();
      return;
    }
    const outcome = yield* generator.generate(input).pipe(
      Effect.match({
        onSuccess: (value) => value,
        onFailure: () => ({ _tag: 'Failed' as const }),
      })
    );
    yield* Effect.annotateCurrentSpan('event.outcome', outcome._tag);
    if (outcome._tag !== 'Failed') {
      message.ack();
      status = 'success';
      if (outcome._tag === 'Generated') {
        const duration = (yield* Clock.currentTimeMillis) - started;
        yield* Metric.update(
          Metric.histogram('variant_generator.consumer.process_duration_ms', {
            boundaries: [100, 1000, 5000, 30000, 120000],
            attributes: {
              'event.type': 'wallpaper.uploaded',
              variants_generated: outcome.variants.length.toString(),
            },
          }),
          duration
        );
      }
      return;
    }
    if (message.info.deliveryCount >= 3) {
      yield* quarantine(brokerService, message, 'Exhausted');
      message.ack();
      return;
    }
    message.nak(retryDelay(message, options));
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterrupts(cause)) return yield* Effect.failCause(cause);
        message.nak(retryDelay(message, options));
        yield* Effect.logError('Variant generation delivery failed', cause);
      })
    ),
    Effect.onInterrupt(() => Effect.sync(() => message.nak(retryDelay(message, options)))),
    Effect.ensuring(
      Effect.gen(function* () {
        const duration = (yield* Clock.currentTimeMillis) - started;
        yield* Effect.annotateCurrentSpan('event.duration_ms', duration);
        yield* Metric.update(
          Metric.counter('events.consumed.total', {
            attributes: { 'event.type': message.subject, status },
          }),
          1
        );
        yield* Metric.update(
          Metric.histogram('events.consume_duration_ms', {
            boundaries: [100, 1000, 5000, 30000, 120000],
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
  brokerService: NatsBroker,
  generator: GenerateVariants,
  options: NatsEventsOptions
) {
  const carrier: Record<string, string> = {};
  for (const key of message.headers?.keys() ?? []) carrier[key] = message.headers?.get(key) ?? '';
  const parent = trace.getSpanContext(propagation.extract(context.active(), carrier));
  const effect = processMessage(message, brokerService, generator, options);
  return parent ? effect.pipe(OtelTracer.withSpanContext(parent)) : effect;
}

export function natsConsumerLayer(
  options: NatsEventsOptions
): Layer.Layer<ConsumerHealth, GenerationUnavailable, GenerateVariants | NatsBroker> {
  return Layer.effect(
    ConsumerHealth,
    Effect.gen(function* () {
      const brokerService = yield* NatsBroker;
      const { client, manager, connection } = brokerService;
      const generator = yield* GenerateVariants;
      yield* broker('inspect-quarantine', () => manager.streams.info(quarantineStream)).pipe(
        Effect.catchIf(
          (error) => notFound(error.cause),
          () =>
            broker('create-quarantine', () =>
              manager.streams.add({
                name: quarantineStream,
                subjects: [quarantineSubject],
                storage: StorageType.File,
                discard: DiscardPolicy.New,
              })
            )
        )
      );
      const config = {
        durable_name: durable,
        ack_policy: AckPolicy.Explicit,
        ack_wait: 120_000_000_000,
        max_deliver: -1,
        filter_subject: 'wallpaper.uploaded',
        max_ack_pending: 1000,
      };
      yield* broker('inspect-consumer', () => manager.consumers.info(options.stream, durable)).pipe(
        Effect.andThen(() =>
          broker('update-consumer', () => manager.consumers.update(options.stream, durable, config))
        ),
        Effect.catchIf(
          (error) => notFound(error.cause),
          () => broker('create-consumer', () => manager.consumers.add(options.stream, config))
        )
      );
      const consumer = yield* broker('get-consumer', () =>
        client.consumers.get(options.stream, durable)
      );
      const messages = yield* Effect.acquireRelease(
        broker('consume-uploads', () => consumer.consume({ max_messages: 1 })),
        (messages) => Effect.sync(() => messages.stop())
      );
      const accepting = yield* Ref.make(true);
      const healthy = yield* Ref.make(true);
      const worker = yield* Stream.fromAsyncIterable(
        messages,
        (cause) => new GenerationUnavailable({ operation: 'read-uploads', cause })
      ).pipe(
        Stream.runForEach((message) =>
          Ref.get(accepting).pipe(
            Effect.flatMap((accept) =>
              accept ? consumeMessage(message, brokerService, generator, options) : Effect.void
            )
          )
        ),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (!Cause.hasInterrupts(cause))
              yield* Effect.logError('Variant generation consumer stopped', cause);
          })
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
      return {
        check: () => Ref.get(healthy).pipe(Effect.map((value) => value && !connection.isClosed())),
      };
    })
  );
}
