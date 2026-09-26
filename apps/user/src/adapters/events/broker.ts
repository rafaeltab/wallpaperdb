import { Context, Effect, Layer } from 'effect';
import { connect, type JetStreamClient, type JetStreamManager, type NatsConnection } from 'nats';
import { MaintenanceFailure } from '../../maintenance/index.js';

export interface EventsOptions {
  readonly url: string;
  readonly stream: string;
  readonly serviceName: string;
  readonly retryDelayMs?: number;
  readonly shutdownTimeoutMs?: number;
}
export interface EventsBroker {
  readonly connection: NatsConnection;
  readonly client: JetStreamClient;
  readonly manager: JetStreamManager;
}
export const EventsBroker = Context.Service<EventsBroker>('wallpaperdb.user.adapters.EventsBroker');
export interface EventsHealth {
  check(): Effect.Effect<boolean>;
}
export const EventsHealth = Context.Service<EventsHealth>('wallpaperdb.user.adapters.EventsHealth');
export function broker<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new MaintenanceFailure({ operation, cause }),
  }).pipe(
    Effect.tapError((failure) =>
      Effect.logError('Profile event broker unavailable', { operation, cause: failure.cause })
    )
  );
}
export const brokerLayer = (options: EventsOptions) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        broker('connect', () =>
          connect({ servers: options.url, name: options.serviceName, timeout: 5000 })
        ),
        (connection) =>
          broker('drain', () => connection.drain()).pipe(
            Effect.interruptible,
            Effect.timeout(options.shutdownTimeoutMs ?? 5000),
            Effect.catchCause(() => Effect.promise(() => connection.close()))
          )
      );
      const manager = yield* broker('create-manager', () =>
        connection.jetstreamManager({ timeout: 5000 })
      );
      yield* broker('inspect-wallpaper-stream', () => manager.streams.info(options.stream));
      const client = connection.jetstream({ timeout: 5000 });
      return Context.make(EventsBroker, { connection, client, manager }).pipe(
        Context.add(EventsHealth, {
          check: () =>
            connection.isClosed()
              ? Effect.succeed(false)
              : broker('health', () => manager.streams.info(options.stream)).pipe(
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                ),
        })
      );
    })
  );
