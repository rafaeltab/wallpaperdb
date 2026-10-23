import { createHash } from 'node:crypto';
import { Cause, Effect, Fiber, Layer, Ref } from 'effect';
import { connect, type NatsConnection } from 'nats';
import {
  PictureAttachments,
  AttachmentDelivery,
  AttachmentFailure,
  AttachmentHealth,
} from '../../capabilities/picture-attachments/index.js';
import type { AttachmentConfig } from '../../attachment-config.js';
import { decodeConfirmation } from './translation.js';
import { observeWorkflow } from './observation.js';
interface Options extends AttachmentConfig {
  readonly natsUrl: string;
}
export function attachmentBrokerLayer(options: Options) {
  return Layer.effect(
    AttachmentHealth,
    Effect.gen(function* () {
      const attachments = yield* PictureAttachments;
      const delivery = yield* AttachmentDelivery;
      const attempt = <A>(operation: string, run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new AttachmentFailure({ operation, cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Picture attachment workflow transport unavailable', {
              operation,
              cause: error.cause,
            })
          ),
          Effect.withSpan(`user.workflow.${operation}`)
        );
      const protectedConnection = yield* Effect.acquireRelease(
        attempt('connect', () => {
          const url = new URL(options.natsUrl);
          url.username = '';
          url.password = '';
          return connect({
            servers: url.toString(),
            user: options.credential.user,
            pass: options.credential.password,
            inboxPrefix: '_ASSET_INBOX.user',
            name: 'user-picture-attachments',
            timeout: 2000,
            ...(url.protocol === 'tls:' ? { tls: {} } : {}),
          });
        }),
        (connection) =>
          attempt('drain', () => connection.drain()).pipe(
            Effect.interruptible,
            Effect.timeout(options.shutdownTimeoutMs),
            Effect.catchCause(() => Effect.promise(() => connection.close()))
          )
      );
      const consumer = yield* attempt('bind-results', () =>
        protectedConnection.jetstream().consumers.get('ASSET_RESULTS', 'results_user')
      );
      const accepting = yield* Ref.make(true);
      const sendingHealthy = yield* Ref.make(true);
      const receivingHealthy = yield* Ref.make(true);
      const alive = yield* Ref.make(2);
      const worker = (
        name: string,
        work: Effect.Effect<void, AttachmentFailure>,
        healthy: Ref.Ref<boolean>
      ) =>
        Effect.gen(function* () {
          while (yield* Ref.get(accepting)) {
            yield* work.pipe(
              Effect.tap(() => Ref.set(healthy, true)),
              Effect.catch((error) =>
                Effect.logError('Picture attachment workflow iteration failed', {
                  worker: name,
                  operation: error.operation,
                }).pipe(Effect.andThen(Ref.set(healthy, false)))
              )
            );
            yield* Effect.sleep(options.pollMs);
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.void
              : Effect.logError('Picture attachment workflow stopped', { worker: name, cause })
          ),
          Effect.ensuring(Ref.update(alive, (n) => n - 1)),
          Effect.forkScoped
        );
      const sending = yield* worker(
        'outbox',
        Effect.gen(function* () {
          for (const p of yield* delivery.claim()) {
            const connection: NatsConnection = protectedConnection;
            const subject =
              p.destination === 'asset-create'
                ? 'asset.commands.user.create'
                : 'asset.commands.user.delete';
            yield* observeWorkflow(
              'user.workflow.publish',
              p.event,
              {
                'attachment.id': p.attachmentId,
                'event.subject': subject,
                'event.consumer': 'user-workflow-outbox',
                'event.delivery_attempt': p.attempts + 1,
              },
              Effect.gen(function* () {
                const stored = yield* attempt('publish', () =>
                  connection.jetstream().publish(subject, JSON.stringify(p.event), {
                    msgID: `https://wallpaperdb/user#${p.id}`,
                    timeout: 2000,
                  })
                ).pipe(
                  Effect.as(true),
                  Effect.catch(() => Effect.succeed(false))
                );
                if (stored) yield* delivery.complete(p);
                else yield* delivery.failed(p);
                return stored ? 'published' : 'retry-recorded';
              })
            );
          }
          for (const alert of yield* delivery.alerts()) {
            const id = createHash('sha256').update(`user:${alert.scope}:${alert.id}`).digest('hex');
            yield* attempt('notify-operator', async () => {
              const response = await fetch(options.operatorNotification.url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${options.operatorNotification.token}`,
                },
                body: JSON.stringify({
                  id,
                  applicationId: 'user',
                  kind: 'user-workflow-quarantine',
                  subject: alert.scope === 'outbox' ? 'user.workflow.outbox' : 'asset.results.user',
                  reason: alert.reason,
                  recoveryId: alert.id,
                  recoveryScope: alert.scope,
                }),
                signal: AbortSignal.timeout(2000),
              });
              await response.body?.cancel();
              if (!response.ok) throw new Error('Operator destination rejected notification');
            });
            yield* delivery.alerted(alert.id, alert.scope);
          }
        }),
        sendingHealthy
      );
      const receiving = yield* worker(
        'confirmations',
        Effect.gen(function* () {
          const message = yield* attempt('fetch', () => consumer.next({ expires: 1000 }));
          if (!message) return;
          const identity = createHash('sha256').update(message.data).digest('hex');
          const decoded =
            message.subject === 'asset.results.user'
              ? decodeConfirmation(message.data)
              : { kind: 'invalid' as const };
          const operation =
            decoded.kind === 'result'
              ? attachments
                  .assetResult(decoded.result)
                  .pipe(
                    Effect.flatMap((outcome) =>
                      outcome === 'requires-attention'
                        ? delivery
                            .quarantine(
                              identity,
                              new TextDecoder().decode(message.data),
                              'rejected-confirmation',
                              { kind: 'intent', id: decoded.result.attachmentId }
                            )
                            .pipe(Effect.as('quarantined-rejection'))
                        : Effect.succeed(outcome)
                    )
                  )
              : decoded.kind === 'source'
                ? attachments.sourceAccepted(decoded.confirmation)
                : delivery.quarantine(
                    identity,
                    new TextDecoder().decode(message.data),
                    'invalid-confirmation'
                  );
          const processing =
            message.info.redeliveryCount >= options.maxAttempts
              ? delivery
                  .quarantine(
                    identity,
                    new TextDecoder().decode(message.data),
                    'confirmation-exhausted',
                    decoded.kind === 'result'
                      ? { kind: 'intent', id: decoded.result.attachmentId }
                      : decoded.kind === 'source'
                        ? { kind: 'asset', id: decoded.confirmation.assetId }
                        : undefined
                  )
                  .pipe(Effect.as('quarantined-exhausted'))
              : operation.pipe(Effect.map((outcome) => outcome ?? 'quarantined-invalid'));
          yield* observeWorkflow(
            'user.workflow.consume-confirmation',
            decoded.kind === 'invalid' ? undefined : decoded.context,
            {
              'event.subject': message.subject,
              'event.consumer': message.info.consumer,
              'event.delivery_attempt': message.info.deliveryCount,
              ...(decoded.kind === 'result'
                ? {
                    'attachment.id': decoded.result.attachmentId,
                    ...(decoded.result.assetId ? { 'asset.id': decoded.result.assetId } : {}),
                  }
                : decoded.kind === 'source'
                  ? {
                      'asset.id': decoded.confirmation.assetId,
                      'source.id': decoded.confirmation.sourceId,
                      'candidate.id': decoded.confirmation.candidateId,
                    }
                  : { 'quarantine.id': identity }),
            },
            processing
          ).pipe(
            Effect.tap(() => Effect.sync(() => message.ack())),
            Effect.tapError(() => Effect.sync(() => message.nak(options.retryDelayMs)))
          );
        }),
        receivingHealthy
      );
      yield* Effect.addFinalizer(() =>
        Ref.set(accepting, false).pipe(
          Effect.andThen(
            Effect.all([Fiber.await(sending), Fiber.await(receiving)], { concurrency: 2 })
          ),
          Effect.interruptible,
          Effect.timeoutOrElse({
            duration: options.shutdownTimeoutMs,
            orElse: () =>
              Effect.all([Fiber.interrupt(sending), Fiber.interrupt(receiving)], {
                concurrency: 2,
              }),
          }),
          Effect.asVoid
        )
      );
      return {
        check: () =>
          Effect.all([Ref.get(sendingHealthy), Ref.get(receivingHealthy), Ref.get(alive)]).pipe(
            Effect.map(([s, r, a]) => s && r && a === 2 && !protectedConnection.isClosed())
          ),
      };
    })
  );
}

export { decodeConfirmation } from './translation.js';
export { recoverConfirmation } from './recovery.js';

export { attachmentPostgresLayer } from './store.js';
