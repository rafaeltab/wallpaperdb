import { createHash } from 'node:crypto';
import { Cause, Context, Effect, Fiber, Layer, Ref } from 'effect';
import { connect } from 'nats';
import { Cleanup, CleanupFailure, CleanupStore } from '../../capabilities/cleanup/index.js';

export class CleanupHealth extends Context.Service<
  CleanupHealth,
  {
    readonly check: () => Effect.Effect<boolean>;
  }
>()('asset/cleanup/Health') {}
interface Options {
  readonly url: string;
  readonly credential: { readonly password: string };
  readonly applications: Readonly<
    Record<string, { readonly id: string; readonly serviceUser: string }>
  >;
  readonly pollMs: number;
  readonly shutdownTimeoutMs: number;
}
const broker = <A>(operation: string, work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (cause) => new CleanupFailure({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Cleanup operator transport failed', { operation, cause: error.cause })
    ),
    Effect.withSpan(`asset.cleanup.broker.${operation}`)
  );

export function cleanupWorkerLayer(options: Options) {
  return Layer.effect(
    CleanupHealth,
    Effect.gen(function* () {
      const cleanup = yield* Cleanup;
      const store = yield* CleanupStore;
      const connections = new Map<string, Awaited<ReturnType<typeof connect>>>();
      for (const application of Object.values(options.applications)) {
        const connection = yield* Effect.acquireRelease(
          broker('connect', () =>
            connect({
              servers: options.url,
              user: application.serviceUser,
              pass: options.credential.password,
              inboxPrefix: '_ASSET_INBOX.service',
              timeout: 5000,
              name: 'asset-source-cleanup',
            })
          ),
          (connection) =>
            broker('drain', () => connection.drain()).pipe(
              Effect.interruptible,
              Effect.timeout(options.shutdownTimeoutMs),
              Effect.catchCause(() => Effect.promise(() => connection.close()))
            )
        );
        connections.set(application.id, connection);
      }
      const accepting = yield* Ref.make(true),
        alive = yield* Ref.make(true),
        healthy = yield* Ref.make(true);
      const worker = yield* Effect.gen(function* () {
        while (yield* Ref.get(accepting)) {
          const successful = yield* Effect.gen(function* () {
            const progress = yield* cleanup.run(10);
            for (const alert of yield* store.pendingAlerts()) {
              const connection = connections.get(alert.applicationId);
              if (!connection) return false;
              const id = createHash('sha256').update(`cleanup:${alert.id}`).digest('hex');
              yield* broker('notify-quarantine', () =>
                connection
                  .jetstream()
                  .publish(
                    'asset.operator.notifications',
                    JSON.stringify({
                      id,
                      kind: 'cleanup-quarantine',
                      subject: 'asset.cleanup',
                      reason: 'exhausted',
                    }),
                    { msgID: `cleanup-notification:${id}`, timeout: 5000 }
                  )
              );
              yield* store.alerted(alert.id);
            }
            return progress.failed === 0;
          }).pipe(
            Effect.catch((error) =>
              Effect.logError('Cleanup remains durable while a dependency is unavailable', {
                operation: error.operation,
              }).pipe(Effect.as(false))
            )
          );
          yield* Ref.set(healthy, successful);
          yield* Effect.sleep(options.pollMs);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.void
            : Effect.logError('Cleanup worker stopped', cause)
        ),
        Effect.ensuring(Ref.set(alive, false)),
        Effect.forkScoped
      );
      yield* Effect.addFinalizer(() =>
        Ref.set(accepting, false).pipe(
          Effect.andThen(
            Fiber.await(worker).pipe(
              Effect.interruptible,
              Effect.timeoutOrElse({
                duration: options.shutdownTimeoutMs,
                orElse: () => Fiber.interrupt(worker),
              })
            )
          )
        )
      );
      return {
        check: () =>
          Effect.all([Ref.get(healthy), Ref.get(alive)]).pipe(
            Effect.map(
              (values) =>
                values.every(Boolean) &&
                [...connections.values()].every((connection) => !connection.isClosed())
            )
          ),
      };
    })
  );
}
