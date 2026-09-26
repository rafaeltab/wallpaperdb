import { createHash } from 'node:crypto';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import {
  Cause,
  Clock,
  Context,
  DateTime,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
} from 'effect';
import {
  AckPolicy,
  connect,
  DiscardPolicy,
  ErrorCode,
  headers,
  StorageType,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
  type MsgHdrs,
  type NatsConnection,
} from 'nats';
import { ProjectCatalogue, type ProjectionOutcome } from '../../projection/index.js';
import { StartupDiagnostic } from '../../startup-diagnostics.js';
import { ensureMessageBudgets, quarantineMessageBytes } from './message-budget.js';
import { translate, type TranslatedEvent } from './translation.js';

export interface ProjectionDelivery {
  readonly subject: string;
  readonly payload: Uint8Array;
  readonly attempt: number;
  readonly headers?: MsgHdrs;
}
export type DeliveryDecision =
  | ProjectionOutcome
  | { readonly _tag: 'Retry' }
  | { readonly _tag: 'Invalid' }
  | { readonly _tag: 'Exhausted' };

/** The broker owner durably quarantines Invalid, Rejected and Exhausted outcomes. */
export const deliverProjection = Effect.fn('catalogue.delivery')(function* (
  delivery: ProjectionDelivery
): Effect.fn.Return<DeliveryDecision, never, ProjectCatalogue> {
  const translated = translate(delivery.subject, delivery.payload, delivery.headers);
  if (translated._tag === 'Invalid') return { _tag: 'Invalid' };
  if (delivery.attempt > 4) return { _tag: 'Exhausted' };
  const attributes = {
    ...projectionAttributes(translated),
    'event.subject': delivery.subject,
    'event.delivery_attempt': delivery.attempt,
  };
  yield* Effect.annotateCurrentSpan(attributes);
  const project = yield* ProjectCatalogue;
  return yield* project.record(translated.change).pipe(
    Effect.catchTag('ProjectionUnavailable', (error) =>
      Effect.gen(function* () {
        const outcome: DeliveryDecision = { _tag: delivery.attempt >= 4 ? 'Exhausted' : 'Retry' };
        yield* Effect.logWarning('Projection unavailable', {
          error: error._tag,
          outcome: outcome._tag,
          attempt: delivery.attempt,
        });
        return outcome;
      })
    ),
    Effect.annotateLogs(attributes)
  );
});

function projectionAttributes(event: TranslatedEvent) {
  if (event._tag === 'Invalid') return {};
  return {
    'event.source': event.change.occurrence.source,
    'event.id': event.change.occurrence.id,
    ...(event.correlationId ? { 'event.correlation_id': event.correlationId } : {}),
    ...(event.causationId ? { 'event.causation_id': event.causationId } : {}),
    'catalogue.subject_id':
      event.change._tag === 'ProfilePublished' ? event.change.profile.id : event.change.wallpaperId,
  };
}

export interface NatsProjectionOptions {
  readonly url: string;
  readonly wallpaperStream?: string;
  readonly serviceName?: string;
  readonly quarantineStream?: string;
  readonly quarantineSubject?: string;
  readonly retryDelayMs?: number;
  readonly shutdownTimeoutMs?: number;
}
export interface NatsProjectionConsumer {
  check(): Effect.Effect<boolean>;
}
export const NatsProjectionConsumer = Context.Service<NatsProjectionConsumer>(
  'wallpaperdb/gateway/adapters/events/NatsProjectionConsumer'
);

export class NatsProjectionStartupError extends Schema.TaggedError<NatsProjectionStartupError>()(
  'NatsProjectionStartupError',
  { cause: Schema.Defect() }
) {}

class BrokerError extends Schema.TaggedError<BrokerError>()('BrokerError', {
  operation: Schema.String,
  diagnostic: StartupDiagnostic,
  cause: Schema.Defect(),
}) {}

const decodeBrokerCode = Schema.decodeUnknownOption(
  Schema.Struct({
    code: Schema.Union([
      Schema.Enum(ErrorCode),
      Schema.Literals([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'EPIPE',
      ]),
    ]),
  })
);

function brokerError(operation: string, cause: unknown): BrokerError {
  return new BrokerError({
    operation,
    cause,
    diagnostic: {
      dependency: 'nats',
      operation,
      code: Option.match(decodeBrokerCode(cause), {
        onNone: () => 'UnknownError',
        onSome: ({ code }) => code,
      }),
    },
  });
}

const subscriptions = [
  { stream: 'WALLPAPER', subject: 'wallpaper.uploaded', durable: 'gateway-wallpaper-uploaded' },
  {
    stream: 'WALLPAPER',
    subject: 'wallpaper.variant.available',
    durable: 'gateway-wallpaper-variant-available',
  },
  {
    stream: 'WALLPAPER',
    subject: 'wallpaper.colors.extracted',
    durable: 'gateway-wallpaper-colors-extracted',
  },
  { stream: 'PROFILE', subject: 'profile.created', durable: 'gateway-profile-created' },
  { stream: 'PROFILE', subject: 'profile.updated', durable: 'gateway-profile-updated' },
];
const notFound = Schema.is(Schema.Struct({ code: Schema.Literal('404') }));

function broker<A>(operation: string, run: () => Promise<A>): Effect.Effect<A, BrokerError> {
  return Effect.tryPromise({ try: run, catch: (cause) => brokerError(operation, cause) });
}

const ensureQuarantine = Effect.fn('catalogue.events.ensureQuarantine')(function* (
  manager: JetStreamManager,
  options: NatsProjectionOptions
) {
  const name = options.quarantineStream ?? 'GATEWAY_QUARANTINE';
  yield* broker('inspect quarantine', () => manager.streams.info(name)).pipe(
    Effect.catchIf(
      (error) => notFound(error.cause),
      () =>
        broker('create quarantine', () =>
          manager.streams.add({
            name,
            subjects: [options.quarantineSubject ?? 'gateway.quarantine'],
            storage: StorageType.File,
            discard: DiscardPolicy.New,
            max_msg_size: quarantineMessageBytes,
          })
        )
    )
  );
});

const subscribe = Effect.fn('catalogue.events.subscribe')(function* (
  manager: JetStreamManager,
  js: JetStreamClient,
  subscription: (typeof subscriptions)[number],
  options: NatsProjectionOptions
) {
  const stream =
    subscription.stream === 'WALLPAPER'
      ? (options.wallpaperStream ?? 'WALLPAPER')
      : subscription.stream;
  const config = {
    durable_name: subscription.durable,
    ack_policy: AckPolicy.Explicit,
    ack_wait: 30_000_000_000,
    max_deliver: -1,
    filter_subject: subscription.subject,
    // Shared across replicas; retain NATS's default budget while each iterator handles one at a time.
    max_ack_pending: 1000,
  };
  yield* broker('inspect subscription', () =>
    manager.consumers.info(stream, subscription.durable)
  ).pipe(
    Effect.andThen(() =>
      broker('update subscription', () =>
        manager.consumers.update(stream, subscription.durable, config)
      )
    ),
    Effect.catchIf(
      (error) => notFound(error.cause),
      () => broker('create subscription', () => manager.consumers.add(stream, config))
    )
  );
  const consumer = yield* broker('get subscription', () =>
    js.consumers.get(stream, subscription.durable)
  );
  return yield* Effect.acquireRelease(
    broker('consume subscription', () => consumer.consume({ max_messages: 1 })),
    (messages) => Effect.sync(() => messages.stop())
  );
});

const quarantine = Effect.fn('catalogue.events.quarantine')(function* (
  js: JetStreamClient,
  message: JsMsg,
  outcome: string,
  options: NatsProjectionOptions
) {
  const info = message.info;
  const identity = createHash('sha256')
    .update(
      JSON.stringify([
        'gateway-quarantine-v2',
        info.domain,
        info.account_hash,
        info.stream,
        info.consumer,
        message.subject,
        info.streamSequence,
        info.timestampNanos,
      ])
    )
    .update(message.data)
    .digest('hex');
  const original = translate(message.subject, message.data, message.headers);
  const span = yield* OtelTracer.currentOtelSpan.pipe(Effect.option);
  const traceCarrier: Record<string, string> = {};
  propagation.inject(
    Option.isSome(span) ? trace.setSpan(context.active(), span.value) : context.active(),
    traceCarrier
  );
  const traceHeaders = headers();
  for (const [key, value] of Object.entries(traceCarrier)) traceHeaders.set(key, value);
  traceHeaders.set('Nats-Msg-Id', identity);
  const replay = {
    specversion: '1.0',
    source: 'wallpaperdb/gateway/projection',
    id: identity,
    type: 'gateway.projection.quarantined',
    time: DateTime.formatIso(DateTime.makeUnsafe(message.info.timestampNanos / 1_000_000)),
    data: {
      subject: message.subject,
      original: Buffer.from(message.data).toString('base64'),
      ...(message.headers
        ? { originalHeaders: Buffer.from(message.headers.toString()).toString('base64') }
        : {}),
      consumer: message.info.consumer,
      outcome,
    },
  };
  const diagnostic = JSON.stringify({
    ...replay,
    ...(original._tag === 'Translated'
      ? {
          causationid: original.change.occurrence.id,
          causationsource: original.change.occurrence.source,
          ...(original.correlationId ? { correlationid: original.correlationId } : {}),
        }
      : {}),
  });
  // Binary header values can expand sixfold when copied into JSON. The complete
  // original headers stay in the bounded base64 replay record even if duplicated
  // diagnostic extensions would exceed the quarantine message budget.
  const payload =
    Buffer.byteLength(diagnostic) + Buffer.byteLength(traceHeaders.toString()) <=
    quarantineMessageBytes
      ? diagnostic
      : JSON.stringify(replay);
  yield* broker('publish quarantine', () =>
    js.publish(options.quarantineSubject ?? 'gateway.quarantine', payload, {
      msgID: identity,
      headers: traceHeaders,
    })
  );
});

function retryDelay(attempt: number, options: NatsProjectionOptions): number {
  return Math.min(30_000, (options.retryDelayMs ?? 1000) * 2 ** Math.min(attempt - 1, 5));
}

const processMessage = Effect.fn('catalogue.events.consume')(function* (
  message: JsMsg,
  js: JetStreamClient,
  options: NatsProjectionOptions
) {
  const attempt = message.info.deliveryCount;
  const started = yield* Clock.currentTimeMillis;
  let status = 'error';
  const attributes = {
    ...projectionAttributes(translate(message.subject, message.data, message.headers)),
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': attempt,
  };
  yield* Effect.annotateCurrentSpan(attributes);
  yield* Effect.gen(function* () {
    const outcome = yield* deliverProjection({
      subject: message.subject,
      payload: message.data,
      headers: message.headers,
      attempt,
    });
    yield* Effect.annotateCurrentSpan('event.outcome', outcome._tag);
    switch (outcome._tag) {
      case 'Completed':
      case 'Ignored':
        message.ack();
        status = 'success';
        return;
      case 'Retry':
        message.nak(retryDelay(attempt, options));
        return;
      case 'Invalid':
      case 'Rejected':
      case 'Exhausted':
        yield* quarantine(js, message, outcome._tag, options);
        message.ack();
        return;
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterrupts(cause)) return yield* Effect.failCause(cause);
        message.nak(retryDelay(attempt, options));
        yield* Effect.logError('Projection delivery failed', cause);
        yield* Effect.annotateCurrentSpan('event.outcome', 'Retry');
      })
    ),
    Effect.onInterrupt(() => Effect.sync(() => message.nak(retryDelay(attempt, options)))),
    Effect.ensuring(
      Effect.gen(function* () {
        const duration = (yield* Clock.currentTimeMillis) - started;
        yield* Effect.annotateCurrentSpan('event.duration_ms', duration);
        yield* Effect.sync(() => {
          recordCounter('events.consumed.total', 1, { 'event.type': message.subject, status });
          recordHistogram('events.consume_duration_ms', duration, {
            'event.type': message.subject,
          });
        }).pipe(Effect.catchCause(() => Effect.void));
      })
    ),
    Effect.annotateLogs(attributes)
  );
});

function consumeMessage(message: JsMsg, js: JetStreamClient, options: NatsProjectionOptions) {
  const carrier: Record<string, string> = {};
  for (const key of message.headers?.keys() ?? []) carrier[key] = message.headers?.get(key) ?? '';
  const parent = trace.getSpanContext(propagation.extract(context.active(), carrier));
  const effect = processMessage(message, js, options);
  return parent ? effect.pipe(OtelTracer.withSpanContext(parent)) : effect;
}

const closeConnection = Effect.fn('catalogue.events.close')(function* (
  connection: NatsConnection,
  timeout: number
) {
  yield* broker('drain connection', () => connection.drain()).pipe(
    Effect.interruptible,
    Effect.timeout(timeout),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning('Projection connection drain failed; closing connection', cause);
        yield* Effect.promise(() => connection.close());
      })
    )
  );
});

export function natsProjectionLayer(
  options: NatsProjectionOptions
): Layer.Layer<NatsProjectionConsumer, NatsProjectionStartupError, ProjectCatalogue> {
  return Layer.effect(
    NatsProjectionConsumer,
    Effect.gen(function* () {
      const timeout = options.shutdownTimeoutMs ?? 5000;
      const connection = yield* Effect.acquireRelease(
        broker('connect', () =>
          connect({ servers: options.url, name: options.serviceName ?? 'gateway', timeout: 5000 })
        ),
        (connection) => closeConnection(connection, timeout)
      );
      const manager = yield* broker('get manager', () =>
        connection.jetstreamManager({ timeout: 5000 })
      );
      yield* ensureQuarantine(manager, options);
      yield* ensureMessageBudgets(
        connection,
        manager,
        connection.info?.max_payload,
        [options.wallpaperStream ?? 'WALLPAPER', 'PROFILE'],
        options.quarantineStream ?? 'GATEWAY_QUARANTINE'
      );
      const js = connection.jetstream({ timeout: 5000 });
      const healthy = yield* Ref.make(true);
      const accepting = yield* Ref.make(true);
      const messages: ConsumerMessages[] = [];
      const workers: Fiber.Fiber<void, never>[] = [];
      for (const subscription of subscriptions) {
        const subscriptionMessages = yield* subscribe(manager, js, subscription, options);
        messages.push(subscriptionMessages);
        const worker = yield* Stream.fromAsyncIterable(subscriptionMessages, (cause) =>
          brokerError('read subscription', cause)
        ).pipe(
          Stream.runForEach((message) =>
            Effect.gen(function* () {
              if (yield* Ref.get(accepting)) yield* consumeMessage(message, js, options);
            })
          ),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Ref.set(healthy, false);
              if (!Cause.hasInterrupts(cause))
                yield* Effect.logError('Projection subscription stopped', cause);
            })
          ),
          Effect.forkScoped
        );
        workers.push(worker);
        // Async-iterator teardown waits for stop; unblock it before forkScoped joins the fiber,
        // including when a later subscription fails during layer acquisition.
        yield* Effect.addFinalizer(() => Effect.sync(() => subscriptionMessages.stop()));
      }
      // This finalizer runs before the scoped fibers and subscriptions are released.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(healthy, false);
          yield* Ref.set(accepting, false);
          for (const subscription of messages) subscription.stop();
          yield* Fiber.awaitAll(workers).pipe(
            Effect.interruptible,
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Fiber.interruptAll(workers) })
          );
        })
      );
      return NatsProjectionConsumer.of({
        check: () =>
          Ref.get(healthy).pipe(Effect.map((healthy) => healthy && !connection.isClosed())),
      });
    }).pipe(Effect.mapError((cause) => new NatsProjectionStartupError({ cause })))
  );
}
