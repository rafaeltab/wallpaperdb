import { createHash } from 'node:crypto';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context as otelContext, propagation, trace } from '@opentelemetry/api';
import { Cause, Clock, Context, Data, Effect, Exit, Fiber, Layer, Ref, Stream } from 'effect';
import { connect, type JsMsg, type NatsConnection } from 'nats';
import {
  Lifecycle,
  ResultOutbox,
  type CommandContext,
  type LifecyclePort,
  type ResultOutboxPort,
} from '../../capabilities/lifecycle/index.js';
import { decodeAssetCommand, encodeAssetResult, type CommandRoute } from './transport.js';

export class CommandBrokerFailure extends Data.TaggedError('CommandBrokerFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export class ProtectedCommandHealth extends Context.Service<
  ProtectedCommandHealth,
  { readonly check: () => Effect.Effect<boolean> }
>()('asset/commands/Health') {}
export interface ProtectedCommandOptions {
  readonly url: string;
  readonly credential: { readonly user: string; readonly password: string };
  readonly applications: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly createSubject: string;
        readonly deleteSubject: string;
        readonly resultSubject: string;
        readonly serviceUser: string;
      }
    >
  >;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly pollMs: number;
  readonly shutdownTimeoutMs: number;
  readonly maxAckPending: number;
}
function broker<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new CommandBrokerFailure({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Protected Asset broker operation failed', { operation, cause: error.cause })
    ),
    Effect.withSpan(`asset.commands.broker.${operation}`)
  );
}
const routesFor = (options: ProtectedCommandOptions): readonly CommandRoute[] =>
  Object.values(options.applications).flatMap((application) => [
    {
      subject: application.createSubject,
      applicationId: application.id,
      operation: 'create' as const,
    },
    {
      subject: application.deleteSubject,
      applicationId: application.id,
      operation: 'delete' as const,
    },
  ]);
const quarantine = Effect.fn('asset.commands.quarantine')(function* (
  connection: NatsConnection,
  message: JsMsg,
  reason: 'invalid' | 'exhausted',
  context?: CommandContext
) {
  const id = createHash('sha256')
    .update(JSON.stringify([message.info.stream, message.info.streamSequence]))
    .digest('hex');
  const event = {
    specversion: '1.0',
    id,
    source: 'https://wallpaperdb/asset',
    type: 'asset.command.quarantined',
    time: new Date(message.info.timestampNanos / 1_000_000).toISOString(),
    datacontenttype: 'application/json',
    ...(context?.traceparent ? { traceparent: context.traceparent } : {}),
    ...(context?.tracestate ? { tracestate: context.tracestate } : {}),
    ...(context?.correlationId ? { correlationid: context.correlationId } : {}),
    ...(context
      ? { causationid: context.occurrence.id, causationsource: context.occurrence.source }
      : {}),
    data: {
      subject: message.subject,
      stream: message.info.stream,
      sequence: message.info.streamSequence,
      consumer: message.info.consumer,
      attempts: message.info.deliveryCount,
      reason,
      encoded: Buffer.from(message.data).toString('base64'),
    },
  };
  yield* broker('store-quarantine', () =>
    connection.jetstream().publish('asset.quarantine', JSON.stringify(event), {
      msgID: `quarantine:${id}`,
      timeout: 5000,
    })
  );
  yield* broker('notify-quarantine', () =>
    connection
      .jetstream()
      .publish(
        'asset.operator.notifications',
        JSON.stringify({
          id,
          kind: 'command-quarantine',
          subject: message.subject,
          reason,
          ...(context ? { context } : {}),
        }),
        { msgID: `notification:${id}`, timeout: 5000 }
      )
  );
});
export function observeWorkflow<A extends string, E, R>(
  name: string,
  context: CommandContext | undefined,
  attributes: Readonly<Record<string, string | number>>,
  effect: Effect.Effect<A, E, R>
) {
  const observed = Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    yield* Effect.annotateCurrentSpan(attributes);
    return yield* effect.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const diagnostic = {
            'event.outcome': Exit.isSuccess(exit) ? exit.value : 'failed',
            'event.duration_ms': (yield* Clock.currentTimeMillis) - started,
          };
          yield* Effect.annotateCurrentSpan(diagnostic);
          yield* Effect.logInfo('Asset durable workflow transition', diagnostic);
        })
      )
    );
  }).pipe(Effect.annotateLogs(attributes), Effect.withSpan(name));
  const parent =
    context &&
    trace.getSpanContext(
      propagation.extract(otelContext.active(), {
        traceparent: context.traceparent,
        tracestate: context.tracestate,
      })
    );
  return parent ? observed.pipe(OtelTracer.withSpanContext(parent)) : observed;
}
function processCommand(
  connection: NatsConnection,
  message: JsMsg,
  lifecycle: LifecyclePort,
  options: ProtectedCommandOptions,
  routes: readonly CommandRoute[]
) {
  // Guard before decoding so even an unexpected decoder defect has a finite handoff.
  if (message.info.deliveryCount > options.maxAttempts)
    return quarantine(connection, message, 'exhausted').pipe(
      Effect.tap(() => Effect.sync(() => message.ack())),
      Effect.as('quarantined')
    );
  const input = decodeAssetCommand(routes, message.subject, message.data);
  const attributes = {
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': message.info.deliveryCount,
    ...(input.kind === 'command'
      ? {
          'event.id': input.context.occurrence.id,
          'event.source': input.context.occurrence.source,
          'event.type': `asset.command.${input.command.operation}`,
          'application.id': input.applicationId,
          'command.id': input.command.commandId,
          ...(input.context.correlationId
            ? { 'event.correlation_id': input.context.correlationId }
            : {}),
          ...('assetType' in input.command ? { 'asset.type': input.command.assetType } : {}),
        }
      : {}),
  };
  return observeWorkflow(
    'asset.commands.consume',
    input.kind === 'command' ? input.context : undefined,
    attributes,
    Effect.gen(function* () {
      if (input.kind !== 'command') {
        yield* quarantine(connection, message, 'invalid');
        message.ack();
        return 'quarantined';
      }
      const result = yield* lifecycle
        .command(input.applicationId, input.command, input.context)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (result) {
        yield* Effect.annotateCurrentSpan({
          'command.outcome': result.outcome,
          ...(result.assetId ? { 'asset.id': result.assetId } : {}),
          ...('reason' in result ? { 'command.rejection_reason': result.reason } : {}),
        });
        message.ack();
        return result.outcome;
      }
      if (message.info.deliveryCount >= options.maxAttempts) {
        yield* quarantine(connection, message, 'exhausted', input.context);
        message.ack();
        return 'quarantined';
      }
      message.nak(Math.min(30000, options.retryDelayMs * 2 ** (message.info.deliveryCount - 1)));
      return 'retry';
    })
  );
}
const dispatch = Effect.fn('asset.commands.dispatch-results')(function* (
  connections: ReadonlyMap<string, NatsConnection>,
  outbox: ResultOutboxPort
) {
  const publications = yield* outbox.claim(1);
  let healthy = true;
  for (const publication of publications) {
    const succeeded = yield* observeWorkflow(
      'asset.commands.publish-result',
      publication.context,
      {
        'event.id': publication.id,
        'event.source': 'https://wallpaperdb/asset',
        'event.type': 'asset.command.result',
        'event.causation_id': publication.context.occurrence.id,
        'event.causation_source': publication.context.occurrence.source,
        'event.delivery_attempt': publication.attempts,
        'application.id': publication.applicationId,
        'command.id': publication.result.commandId,
        'command.outcome': publication.result.outcome,
        ...(publication.result.assetId ? { 'asset.id': publication.result.assetId } : {}),
        ...(publication.context.correlationId
          ? { 'event.correlation_id': publication.context.correlationId }
          : {}),
      },
      Effect.gen(function* () {
        const connection = connections.get(publication.applicationId);
        if (!connection)
          return yield* Effect.fail(
            new CommandBrokerFailure({
              operation: 'route-result',
              cause: new Error('No configured application connection'),
            })
          );
        const encoded = encodeAssetResult(publication);
        yield* broker('publish-result', () =>
          connection.jetstream().publish(encoded.subject, JSON.stringify(encoded.event), {
            msgID: publication.id,
            expect: { streamName: 'ASSET_RESULTS' },
            timeout: 5000,
          })
        );
        yield* outbox.published(publication);
        return 'published';
      })
    ).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        Effect.logError('Asset command result remains durable', {
          id: publication.id,
          operation: error.operation,
        }).pipe(Effect.andThen(outbox.failed(publication)), Effect.as(false))
      )
    );
    healthy = healthy && succeeded;
  }
  const alerts = yield* outbox.pendingAlerts(1);
  for (const alert of alerts) {
    const connection = connections.get(alert.applicationId);
    if (!connection) return false;
    yield* observeWorkflow(
      'asset.commands.notify-result-quarantine',
      alert.context,
      {
        'event.id': alert.id,
        'event.causation_id': alert.context.occurrence.id,
        'event.causation_source': alert.context.occurrence.source,
        'application.id': alert.applicationId,
        ...(alert.context.correlationId
          ? { 'event.correlation_id': alert.context.correlationId }
          : {}),
      },
      Effect.gen(function* () {
        yield* broker('notify-result-quarantine', () =>
          connection.jetstream().publish(
            'asset.operator.notifications',
            JSON.stringify({
              id: alert.id,
              kind: 'result-quarantine',
              subject: `asset.results.${alert.applicationId}`,
              reason: 'exhausted',
              context: alert.context,
            }),
            { msgID: `result-notification:${alert.id}`, timeout: 5000 }
          )
        );
        yield* outbox.alerted(alert.id);
        return 'notified';
      })
    );
  }
  return healthy;
});
export function protectedCommandsLayer(
  options: ProtectedCommandOptions
): Layer.Layer<ProtectedCommandHealth, CommandBrokerFailure, Lifecycle | ResultOutbox> {
  return Layer.effect(
    ProtectedCommandHealth,
    Effect.gen(function* () {
      const lifecycle = yield* Lifecycle;
      const outbox = yield* ResultOutbox;
      const accepting = yield* Ref.make(true);
      const publishingHealthy = yield* Ref.make(true);
      const liveness: Array<Ref.Ref<boolean>> = [];
      const workers: Array<Fiber.Fiber<void, unknown>> = [];
      const stops: Array<() => void> = [];
      const connections = new Map<string, NatsConnection>();
      for (const application of Object.values(options.applications)) {
        const connection = yield* Effect.acquireRelease(
          broker('connect', () =>
            connect({
              servers: options.url,
              user: application.serviceUser,
              pass: options.credential.password,
              inboxPrefix: '_ASSET_INBOX.service',
              timeout: 5000,
              name: 'asset-authority',
            })
          ),
          (connection) =>
            broker('drain', () => connection.drain()).pipe(
              Effect.interruptible,
              Effect.timeout(options.shutdownTimeoutMs),
              Effect.catchCause(() => Effect.promise(() => connection.close()))
            )
        );
        const manager = yield* broker('manager', () =>
          connection.jetstreamManager({ timeout: 5000 })
        );
        const stream = yield* broker('verify-stream', () => manager.streams.info('ASSET_COMMANDS'));
        const routes = routesFor({ ...options, applications: { [application.id]: application } });
        const expected = routes.map((route) => route.subject).sort();
        if (
          JSON.stringify([...stream.config.subjects].sort()) !== JSON.stringify(expected) ||
          stream.config.subject_transform ||
          stream.config.sources?.length ||
          stream.config.mirror
        )
          return yield* Effect.fail(
            new CommandBrokerFailure({
              operation: 'verify-ingress',
              cause: new Error('Protected command stream does not match configured routes'),
            })
          );

        connections.set(application.id, connection);

        const durable = `commands_${application.id}`;
        const info = yield* broker('verify-consumer', () =>
          manager.consumers.info('ASSET_COMMANDS', durable)
        );
        if (
          info.config.filter_subject !== `asset.commands.${application.id}.*` ||
          info.config.filter_subjects?.length ||
          info.config.deliver_subject ||
          info.config.max_deliver !== -1
        )
          return yield* Effect.fail(
            new CommandBrokerFailure({
              operation: 'verify-consumer',
              cause: new Error('Protected consumer does not match configured ingress'),
            })
          );
        const alive = yield* Ref.make(true);
        liveness.push(alive);
        const consumer = yield* broker('get-consumer', () =>
          connection.jetstream().consumers.get('ASSET_COMMANDS', durable)
        );
        const messages = yield* Effect.acquireRelease(
          broker('consume', () =>
            consumer.consume({ max_messages: 1, expires: 1000, abort_on_missing_resource: true })
          ),
          (messages) => Effect.sync(() => messages.stop())
        );
        stops.push(() => messages.stop());
        workers.push(
          yield* Stream.fromAsyncIterable(
            messages,
            (cause) => new CommandBrokerFailure({ operation: 'read-commands', cause })
          ).pipe(
            Stream.runForEach((message) =>
              Ref.get(accepting).pipe(
                Effect.flatMap((active) =>
                  active
                    ? processCommand(connection, message, lifecycle, options, routes).pipe(
                        Effect.catchCause((cause) =>
                          Cause.hasInterrupts(cause)
                            ? Effect.void
                            : Effect.logError('Protected Asset command handoff failed', cause).pipe(
                                Effect.andThen(Effect.sync(() => message.nak(options.retryDelayMs)))
                              )
                        )
                      )
                    : Effect.void
                )
              )
            ),
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.void
                : Effect.logError('Protected Asset command consumer stopped', cause)
            ),
            Effect.ensuring(Ref.set(alive, false)),
            Effect.forkScoped
          )
        );
      }
      const dispatcherAlive = yield* Ref.make(true);
      liveness.push(dispatcherAlive);
      workers.push(
        yield* Effect.gen(function* () {
          while (yield* Ref.get(accepting)) {
            const healthy = yield* dispatch(connections, outbox).pipe(
              Effect.catch((error) =>
                Effect.logError('Asset result dispatcher unavailable', {
                  operation: error.operation,
                }).pipe(Effect.as(false))
              )
            );
            yield* Ref.set(publishingHealthy, healthy);
            yield* Effect.sleep(options.pollMs);
          }
        }).pipe(Effect.ensuring(Ref.set(dispatcherAlive, false)), Effect.forkScoped)
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Ref.set(accepting, false);
          for (const stop of stops) stop();
          yield* Effect.all(
            workers.map((worker) =>
              Fiber.await(worker).pipe(
                Effect.interruptible,
                Effect.timeoutOrElse({
                  duration: options.shutdownTimeoutMs,
                  orElse: () => Fiber.interrupt(worker),
                })
              )
            ),
            { concurrency: 'unbounded' }
          );
        })
      );
      return {
        check: () =>
          Effect.all([Ref.get(publishingHealthy), ...liveness.map(Ref.get)]).pipe(
            Effect.map(
              (health) =>
                health.every(Boolean) &&
                [...connections.values()].every((connection) => !connection.isClosed())
            )
          ),
      };
    })
  );
}
