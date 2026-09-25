import { Context, Data, Effect, Layer } from 'effect';
import { connect, type JetStreamClient, type JetStreamManager, type NatsConnection } from 'nats';
export interface NatsEventsOptions {
  readonly url: string;
  readonly stream: string;
  readonly serviceName: string;
  readonly retryDelayMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly outboxPollMs?: number;
}
export class BrokerFailure extends Data.TaggedError('BrokerFailure')<{
  readonly operation: string;
  readonly cause: unknown;
}> {}
export interface EventsHealth {
  check(): Effect.Effect<boolean>;
}
export const EventsHealth = Context.Service<EventsHealth>('wallpaperdb/media/EventsHealth');
export interface NatsBroker {
  readonly connection: NatsConnection;
  readonly client: JetStreamClient;
  readonly manager: JetStreamManager;
}
export const NatsBroker = Context.Service<NatsBroker>('wallpaperdb/media/NatsBroker');
export function broker<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new BrokerFailure({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Media broker operation failed', { operation, cause: error.cause })
    )
  );
}
export function natsEventsLayer(
  options: NatsEventsOptions
): Layer.Layer<NatsBroker | EventsHealth, BrokerFailure> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        broker('connect-events', () =>
          connect({ servers: options.url, name: options.serviceName, timeout: 5000 })
        ),
        (connection) =>
          broker('drain-events', () => connection.drain()).pipe(
            Effect.interruptible,
            Effect.timeout(options.shutdownTimeoutMs ?? 5000),
            Effect.catchCause(() => Effect.promise(() => connection.close()))
          )
      );
      const manager = yield* broker('create-event-manager', () =>
        connection.jetstreamManager({ timeout: 5000 })
      );
      yield* broker('inspect-event-stream', () => manager.streams.info(options.stream));
      const client = connection.jetstream({ timeout: 5000 });
      return Context.make(NatsBroker, { connection, client, manager }).pipe(
        Context.add(EventsHealth, {
          check: () =>
            connection.isClosed()
              ? Effect.succeed(false)
              : broker('check-events', () => manager.streams.info(options.stream)).pipe(
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
        })
      );
    })
  );
}
