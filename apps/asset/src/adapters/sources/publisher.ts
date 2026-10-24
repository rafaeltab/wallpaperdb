import { createHash } from 'node:crypto';
import { Cause, Context, Effect, Fiber, Layer, Ref } from 'effect';
import { connect, type NatsConnection } from 'nats';
import {
  SourceAcceptanceOutbox,
  SourceFailure,
  type SourceConfirmation,
} from '../../capabilities/sources/index.js';
import { assetBrokerTransport } from '../nats.js';
import { observeWorkflow } from '../commands/index.js';
import { encodeSourceConfirmation } from './confirmation.js';
export class SourceConfirmationHealth extends Context.Service<
  SourceConfirmationHealth,
  { readonly check: () => Effect.Effect<boolean> }
>()('asset/sources/ConfirmationHealth') {}
interface Options {
  readonly url: string;
  readonly credential: { readonly password: string };
  readonly applications: Readonly<
    Record<string, { readonly id: string; readonly serviceUser: string }>
  >;
  readonly retryDelayMs: number;
  readonly pollMs: number;
  readonly shutdownTimeoutMs: number;
}
const broker = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new SourceFailure({ operation, cause }) }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Source confirmation transport failed', { operation, cause: error.cause })
    ),
    Effect.withSpan(`asset.sources.broker.${operation}`)
  );
function attributes(c: SourceConfirmation) {
  return {
    'event.id': c.id,
    'event.source': 'https://wallpaperdb/asset',
    'event.type': 'asset.source.accepted',
    'event.subject': `asset.results.${c.applicationId}`,
    'event.causation_id': c.context.occurrence.id,
    'event.causation_source': c.context.occurrence.source,
    'application.id': c.applicationId,
    'asset.id': c.assetId,
    'source.id': c.sourceId,
    'candidate.id': c.candidateId,
    'source_set.revision': c.sourceSetRevision,
    ...(c.context.correlationId ? { 'event.correlation_id': c.context.correlationId } : {}),
  };
}
export function sourceConfirmationsLayer(options: Options) {
  return Layer.effect(
    SourceConfirmationHealth,
    Effect.gen(function* () {
      const outbox = yield* SourceAcceptanceOutbox;
      const connections = new Map<string, NatsConnection>();
      for (const app of Object.values(options.applications)) {
        const connection = yield* Effect.acquireRelease(
          broker('connect', () =>
            connect({
              ...assetBrokerTransport(options.url),
              user: app.serviceUser,
              pass: options.credential.password,
              inboxPrefix: '_ASSET_INBOX.service',
              timeout: 5000,
              name: 'asset-source-confirmations',
            })
          ),
          (connection) =>
            broker('drain', () => connection.drain()).pipe(
              Effect.interruptible,
              Effect.timeout(options.shutdownTimeoutMs),
              Effect.catchCause(() => Effect.promise(() => connection.close()))
            )
        );
        connections.set(app.id, connection);
      }
      const accepting = yield* Ref.make(true);
      const healthy = yield* Ref.make(true);
      const alive = yield* Ref.make(true);
      const worker = yield* Effect.gen(function* () {
        while (yield* Ref.get(accepting)) {
          const successful = yield* Effect.gen(function* () {
            let successful = true;
            const pending = yield* outbox.claim(10);
            for (const publication of pending) {
              const confirmation = publication.confirmation;
              const connection = connections.get(confirmation.applicationId);
              yield* observeWorkflow(
                'asset.sources.publish-confirmation',
                confirmation.context,
                { ...attributes(confirmation), 'event.delivery_attempt': publication.attempts },
                Effect.gen(function* () {
                  const sent = connection
                    ? yield* broker('publish-confirmation', () => {
                        const message = encodeSourceConfirmation(publication);
                        return connection
                          .jetstream()
                          .publish(message.subject, JSON.stringify(message.event), {
                            msgID: publication.id,
                            timeout: 5000,
                          });
                      }).pipe(
                        Effect.as(true),
                        Effect.catch(() => Effect.succeed(false))
                      )
                    : false;
                  if (sent) {
                    yield* outbox.published(publication);
                    return 'published';
                  }
                  successful = false;
                  yield* outbox.failed(publication);
                  return 'retry-recorded';
                })
              );
            }
            for (const confirmation of yield* outbox.pendingAlerts()) {
              const connection = connections.get(confirmation.applicationId);
              if (!connection) {
                successful = false;
                continue;
              }
              yield* observeWorkflow(
                'asset.sources.notify-quarantine',
                confirmation.context,
                attributes(confirmation),
                Effect.gen(function* () {
                  const id = createHash('sha256')
                    .update(JSON.stringify([confirmation.id, confirmation.quarantineId]))
                    .digest('hex');
                  yield* broker('notify-quarantine', () =>
                    connection.jetstream().publish(
                      'asset.operator.notifications',
                      JSON.stringify({
                        id,
                        sourceConfirmationId: confirmation.id,
                        kind: 'source-confirmation-quarantine',
                        subject: `asset.results.${confirmation.applicationId}`,
                        reason: 'exhausted',
                        context: confirmation.context,
                      }),
                      { msgID: `source-notification:${id}`, timeout: 5000 }
                    )
                  );
                  yield* outbox.alerted(confirmation);
                  return 'notified';
                })
              );
            }
            return successful;
          }).pipe(
            Effect.catch((error) =>
              Effect.logError('Source confirmation dispatcher unavailable', {
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
            : Effect.logError('Source confirmation dispatcher stopped', cause)
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
              (checks) =>
                checks.every(Boolean) && [...connections.values()].every((c) => !c.isClosed())
            )
          ),
      };
    })
  );
}
