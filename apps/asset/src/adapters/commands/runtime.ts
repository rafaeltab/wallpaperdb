import { createHash } from 'node:crypto';
import { Cause, Context, Data, Effect, Fiber, Layer, Ref, Stream } from 'effect';
import { connect, type JsMsg, type NatsConnection } from 'nats';
import {
  Lifecycle,
  ResultOutbox,
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
  reason: 'invalid' | 'exhausted'
) {
  const id = createHash('sha256')
    .update(JSON.stringify([message.info.stream, message.info.streamSequence]))
    .digest('hex');
  const event = {
    specversion: '1.0',
    id,
    source: 'https://wallpaperdb/asset',
    type: 'asset.command.quarantined',
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    data: {
      subject: message.subject,
      stream: message.info.stream,
      sequence: message.info.streamSequence,
      consumer: message.info.consumer,
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
        JSON.stringify({ id, kind: 'command-quarantine', subject: message.subject, reason }),
        { msgID: `notification:${id}`, timeout: 5000 }
      )
  );
});
const processCommand = Effect.fn('asset.commands.consume')(function* (
  connection: NatsConnection,
  message: JsMsg,
  lifecycle: LifecyclePort,
  options: ProtectedCommandOptions,
  routes: readonly CommandRoute[]
) {
  const input = decodeAssetCommand(routes, message.subject, message.data);
  yield* Effect.annotateCurrentSpan({
    'event.subject': message.subject,
    'event.consumer': message.info.consumer,
    'event.delivery_attempt': message.info.deliveryCount,
  });
  if (input.kind !== 'command') {
    yield* quarantine(connection, message, 'invalid');
    message.ack();
    return;
  }
  if (message.info.deliveryCount > options.maxAttempts) {
    yield* quarantine(connection, message, 'exhausted');
    message.ack();
    return;
  }
  const succeeded = yield* lifecycle
    .command(input.applicationId, input.command, input.context)
    .pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false))
    );
  if (succeeded) {
    message.ack();
    return;
  }
  if (message.info.deliveryCount >= options.maxAttempts) {
    yield* quarantine(connection, message, 'exhausted');
    message.ack();
    return;
  }
  message.nak(Math.min(30000, options.retryDelayMs * 2 ** (message.info.deliveryCount - 1)));
});
const dispatch = Effect.fn('asset.commands.dispatch-results')(function* (
  connections: ReadonlyMap<string, NatsConnection>,
  outbox: ResultOutboxPort
) {
  const publications = yield* outbox.claim(1);
  let healthy = true;
  for (const publication of publications) {
    const succeeded = yield* Effect.gen(function* () {
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
    }).pipe(
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
        const consumer = yield* broker('get-consumer', () =>
          connection.jetstream().consumers.get('ASSET_COMMANDS', durable)
        );
        const messages = yield* Effect.acquireRelease(
          broker('consume', () => consumer.consume({ max_messages: 1, expires: 1000 })),
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
            Effect.forkScoped
          )
        );
      }
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
        }).pipe(Effect.forkScoped)
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
          Ref.get(publishingHealthy).pipe(
            Effect.map(
              (healthy) =>
                healthy && [...connections.values()].every((connection) => !connection.isClosed())
            )
          ),
      };
    })
  );
}
