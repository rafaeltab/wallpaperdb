import { assetBrokerTransport } from '../nats.js';
import { createHash } from 'node:crypto';
import { Cause, Context, Effect, Fiber, Layer, Ref, Stream } from 'effect';
import { connect, type JsMsg, type NatsConnection } from 'nats';
import { z } from 'zod';
import type { CommandContext } from '../../capabilities/lifecycle/index.js';
import { CommandBrokerFailure, observeWorkflow } from './runtime.js';

const bounded = (bytes: number) =>
  z
    .string()
    .min(1)
    .refine((value) => Buffer.byteLength(value) <= bytes);
const noticeContext = z
  .object({
    occurrence: z.object({ id: bounded(128), source: bounded(256) }).strict(),
    correlationId: bounded(256).optional(),
    traceparent: bounded(128).optional(),
    tracestate: bounded(512).optional(),
  })
  .strict();
export const noticeSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    // Original outbox recovery target, separate from notice/deduplication identity.
    // Optional for retained legacy notices and synthetic notification proofs.
    resultId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sourceConfirmationId: z
      .string()
      .regex(/^source-accepted:source_[a-f0-9-]{36}$/)
      .optional(),
    kind: z.enum([
      'command-quarantine',
      'result-quarantine',
      'source-confirmation-quarantine',
      'cleanup-quarantine',
    ]),
    subject: z.string().min(1).max(256),
    reason: z.enum(['invalid', 'exhausted']),
    context: noticeContext.optional(),
  })
  .strict();
export class OperatorNotificationHealth extends Context.Service<
  OperatorNotificationHealth,
  { readonly check: () => Effect.Effect<boolean> }
>()('asset/commands/OperatorNotificationHealth') {}
interface NotificationOptions {
  readonly url: string;
  readonly credential: { readonly user: string; readonly password: string };
  readonly applications: Readonly<
    Record<string, { readonly id: string; readonly serviceUser: string }>
  >;
  readonly target: { readonly url: string; readonly token: string };
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly shutdownTimeoutMs: number;
}
const operation = <A>(name: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new CommandBrokerFailure({ operation: name, cause }),
  }).pipe(
    Effect.tapError(() =>
      Effect.logError('Operator notification operation failed', { operation: name })
    ),
    Effect.withSpan(`asset.notifications.${name}`)
  );
const quarantineNotice = (connection: NatsConnection, message: JsMsg, context?: CommandContext) =>
  operation('quarantine-notification', () =>
    connection.jetstream().publish(
      'asset.quarantine',
      JSON.stringify({
        specversion: '1.0',
        id: createHash('sha256')
          .update(`notification:${message.info.streamSequence}`)
          .digest('hex'),
        source: 'https://wallpaperdb/asset',
        type: 'asset.notification.quarantined',
        time: new Date().toISOString(),
        datacontenttype: 'application/json',
        ...(context?.traceparent ? { traceparent: context.traceparent } : {}),
        ...(context?.tracestate ? { tracestate: context.tracestate } : {}),
        ...(context?.correlationId ? { correlationid: context.correlationId } : {}),
        ...(context
          ? { causationid: context.occurrence.id, causationsource: context.occurrence.source }
          : {}),
        data: {
          subject: 'asset.operator.notifications',
          reason: 'exhausted',
          encoded: Buffer.from(message.data).toString('base64'),
        },
      }),
      { msgID: `notification-quarantine:${message.info.streamSequence}`, timeout: 5000 }
    )
  );
function deliver(
  connection: NatsConnection,
  message: JsMsg,
  applicationId: string,
  options: NotificationOptions
) {
  let raw: unknown;
  try {
    raw = JSON.parse(message.string());
  } catch {
    raw = null;
  }
  const parsed = noticeSchema.safeParse(raw);
  const context = parsed.success ? parsed.data.context : undefined;
  return observeWorkflow(
    'asset.notifications.deliver',
    context,
    {
      'event.source': 'https://wallpaperdb/asset',
      'event.subject': message.subject,
      'event.consumer': message.info.consumer,
      'event.delivery_attempt': message.info.deliveryCount,
      'application.id': applicationId,
      ...(parsed.success
        ? {
            'event.id': parsed.data.id,
            'notification.kind': parsed.data.kind,
            'notification.reason': parsed.data.reason,
          }
        : {}),
      ...(context
        ? {
            'event.causation_id': context.occurrence.id,
            'event.causation_source': context.occurrence.source,
          }
        : {}),
      ...(context?.correlationId ? { 'event.correlation_id': context.correlationId } : {}),
    },
    Effect.gen(function* () {
      if (!parsed.success || message.info.deliveryCount > options.maxAttempts) {
        yield* quarantineNotice(connection, message, context);
        message.ack();
        return 'quarantined';
      }
      const succeeded = yield* operation('deliver-webhook', async (signal) => {
        const response = await fetch(options.target.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.target.token}`,
            'content-type': 'application/json',
            'idempotency-key': `${applicationId}:${parsed.data.id}`,
          },
          body: JSON.stringify({ ...parsed.data, applicationId }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        });
        await response.body?.cancel();
        if (!response.ok) throw new Error(`Operator destination returned HTTP ${response.status}`);
      }).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
      );
      if (succeeded) {
        message.ack();
        return 'delivered';
      }
      if (message.info.deliveryCount >= options.maxAttempts) {
        yield* quarantineNotice(connection, message, context);
        message.ack();
        return 'quarantined';
      }
      message.nak(Math.min(30000, options.retryDelayMs * 2 ** (message.info.deliveryCount - 1)));
      return 'retry';
    })
  ).pipe(Effect.map((outcome) => outcome === 'delivered'));
}
/** Broker responsibility remains durable until HTTP acceptance or a confirmed
 * quarantine handoff. Exhaustion requires explicit operator replay. */
export function operatorWebhookLayer(options: NotificationOptions) {
  return Layer.effect(
    OperatorNotificationHealth,
    Effect.gen(function* () {
      const health: Array<Ref.Ref<boolean>> = [];
      const accepting = yield* Ref.make(true);
      const connections: NatsConnection[] = [];
      const stops: Array<() => void> = [];
      const workers: Array<Fiber.Fiber<void, unknown>> = [];
      for (const application of Object.values(options.applications)) {
        const connection = yield* Effect.acquireRelease(
          operation('connect-notifications', () =>
            connect({
              ...assetBrokerTransport(options.url),
              user: application.serviceUser,
              pass: options.credential.password,
              inboxPrefix: '_ASSET_INBOX.service',
              timeout: 5000,
            })
          ),
          (connection) =>
            operation('drain-notifications', () => connection.drain()).pipe(
              Effect.interruptible,
              Effect.timeout(options.shutdownTimeoutMs),
              Effect.catchCause(() => Effect.promise(() => connection.close()))
            )
        );
        connections.push(connection);
        const healthy = yield* Ref.make(true);
        const alive = yield* Ref.make(true);
        health.push(healthy, alive);
        const consumer = yield* operation('get-notification-consumer', () =>
          connection.jetstream().consumers.get('ASSET_OPERATIONS', 'operator_notifications')
        );
        const messages = yield* Effect.acquireRelease(
          operation('consume-notifications', () =>
            consumer.consume({ max_messages: 1, expires: 1000, abort_on_missing_resource: true })
          ),
          (messages) => Effect.sync(() => messages.stop())
        );
        stops.push(() => messages.stop());
        workers.push(
          yield* Stream.fromAsyncIterable(
            messages,
            (cause) => new CommandBrokerFailure({ operation: 'read-notifications', cause })
          ).pipe(
            Stream.runForEach((message) =>
              Ref.get(accepting).pipe(
                Effect.flatMap((active) =>
                  active
                    ? deliver(connection, message, application.id, options).pipe(
                        Effect.tap((value) => Ref.set(healthy, value)),
                        Effect.catch((error) =>
                          Effect.logError('Operator notification remains pending', {
                            operation: error.operation,
                          }).pipe(
                            Effect.andThen(Ref.set(healthy, false)),
                            Effect.andThen(Effect.sync(() => message.nak(options.retryDelayMs)))
                          )
                        )
                      )
                    : Effect.void
                )
              )
            ),
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause) ? Effect.void : Ref.set(healthy, false)
            ),
            Effect.ensuring(Ref.set(alive, false)),
            Effect.forkScoped
          )
        );
      }
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
          Effect.all(health.map(Ref.get)).pipe(
            Effect.map(
              (values) =>
                values.every(Boolean) && connections.every((connection) => !connection.isClosed())
            )
          ),
      };
    })
  );
}
