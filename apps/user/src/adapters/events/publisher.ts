import { ProfileCreatedEventSchema, ProfileUpdatedEventSchema } from '@wallpaperdb/events/schemas';
import { HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { registerAssetReference, resolveAssetReference } from '@wallpaperdb/core/assets';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, Exit, Layer, Metric } from 'effect';
import { headers } from 'nats';
import { outboxEvents } from '../../db/schema.js';
import { MaintenanceFailure, ProfileEvents } from '../../maintenance/index.js';
import { Database, databaseDiagnostic } from '../database/index.js';
import { broker, EventsBroker } from './broker.js';

export interface ProfilePublisherAssets {
  readonly endpoint?: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly assetReferenceBucket: string;
}

export interface ProfilePublicationHealth {
  check(): Effect.Effect<boolean>;
}
export const ProfilePublicationHealth = Context.Service<ProfilePublicationHealth>(
  'wallpaperdb.user.adapters.ProfilePublicationHealth'
);

function storageDiagnostic(cause: unknown) {
  return {
    name: cause instanceof Error ? cause.name : 'UnknownStorageFailure',
    ...(cause instanceof S3ServiceException
      ? { status: cause.$metadata.httpStatusCode, requestId: cause.$metadata.requestId }
      : {}),
  };
}

export const eventPublisherLayer = (options: ProfilePublisherAssets) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const database = yield* Database;
      const service = yield* EventsBroker;
      const assets = yield* Effect.acquireRelease(
        Effect.sync(() =>
          options.endpoint && options.accessKeyId && options.secretAccessKey
            ? new S3Client({
                endpoint: options.endpoint,
                region: options.region,
                credentials: {
                  accessKeyId: options.accessKeyId,
                  secretAccessKey: options.secretAccessKey,
                },
                forcePathStyle: true,
                maxAttempts: 1,
              })
            : null
        ),
        (client) => Effect.sync(() => client?.destroy())
      );
      return Context.make(ProfileEvents, {
        publish: Effect.fn('profiles.events.publish')(function* (eventId: string) {
          const stored = yield* Effect.tryPromise({
            try: (signal) =>
              database.run(
                (db) => db.query.outboxEvents.findFirst({ where: eq(outboxEvents.id, eventId) }),
                signal
              ),
            catch: (cause) =>
              new MaintenanceFailure({ operation: 'read-event', cause: databaseDiagnostic(cause) }),
          }).pipe(
            Effect.tapError((failure) =>
              Effect.logError('Profile outbox read failed', {
                operation: failure.operation,
                cause: failure.cause,
                'event.id': eventId,
              })
            )
          );
          const parsed =
            stored?.subject === 'profile.created'
              ? ProfileCreatedEventSchema.safeParse({
                  ...stored.payload,
                  change: stored.payload.change ?? { type: 'created' },
                })
              : ProfileUpdatedEventSchema.safeParse(stored?.payload);
          if (
            !parsed.success ||
            parsed.data.eventId !== eventId ||
            parsed.data.eventType !== stored?.subject ||
            parsed.data.profile.id !== stored.aggregateId
          )
            return yield* Effect.fail(
              new MaintenanceFailure({
                operation: 'decode-event',
                cause: new Error('Invalid recorded Profile event'),
              })
            ).pipe(
              Effect.tapError(() =>
                Effect.logError('Recorded Profile event is invalid', { 'event.id': eventId })
              )
            );
          let event = parsed.data;
          if (
            event.eventType === 'profile.updated' &&
            event.change.type === 'picture-changed' &&
            event.change.asset
          ) {
            const asset = event.change.asset;
            const reference = { owner: 'user' as const, id: asset.id };
            yield* Effect.tryPromise({
              try: async (signal) => {
                if (!assets) throw new Error('Picture reference storage is not configured');
                const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
                if ('storageBucket' in asset)
                  await registerAssetReference(
                    assets,
                    options.assetReferenceBucket,
                    reference,
                    { bucket: asset.storageBucket, key: asset.storageKey },
                    { abortSignal }
                  );
                else
                  await resolveAssetReference(
                    assets,
                    options.assetReferenceBucket,
                    asset.reference,
                    { abortSignal }
                  );
              },
              catch: (cause) =>
                new MaintenanceFailure({
                  operation: 'register-picture-asset',
                  cause: storageDiagnostic(cause),
                }),
            }).pipe(
              Effect.tapError((failure) =>
                Effect.logError('Profile picture reference registration failed', {
                  operation: failure.operation,
                  cause: failure.cause,
                  'event.id': eventId,
                })
              ),
              Effect.withSpan('profiles.events.register-picture-asset')
            );
            event = {
              ...event,
              change: {
                ...event.change,
                asset: {
                  id: asset.id,
                  reference,
                  mimeType: asset.mimeType,
                  width: asset.width,
                  height: asset.height,
                  fileSizeBytes: asset.fileSizeBytes,
                },
              },
            };
          }
          const metadata = headers();
          for (const [key, value] of Object.entries({
            'content-type': 'application/json',
            'ce-specversion': '1.0',
            'ce-source': 'https://wallpaperdb/user',
            'ce-id': event.eventId,
            'ce-type': event.eventType,
            'ce-time': event.timestamp,
            ...(stored.traceParent ? { traceparent: stored.traceParent } : {}),
            ...(stored.traceState ? { tracestate: stored.traceState } : {}),
          }))
            metadata.set(key, value);
          yield* Effect.annotateCurrentSpan({
            'event.id': eventId,
            'event.source': 'https://wallpaperdb/user',
            'profile.id': event.profile.id,
          });
          const parent = trace.getSpanContext(
            propagation.extract(context.active(), {
              traceparent: stored.traceParent,
              tracestate: stored.traceState,
            })
          );
          const started = yield* Clock.currentTimeMillis;
          const publish = broker('publish-profile-event', () =>
            service.client.publish(event.eventType, JSON.stringify(event), {
              headers: metadata,
              msgID: JSON.stringify(['https://wallpaperdb/user', eventId]),
              expect: { streamName: 'PROFILE' },
              timeout: 5000,
            })
          ).pipe(
            Effect.onExit((exit) =>
              Effect.gen(function* () {
                const duration = (yield* Clock.currentTimeMillis) - started;
                const status = Exit.isSuccess(exit) ? 'success' : 'error';
                yield* Effect.annotateCurrentSpan({
                  'event.duration_ms': duration,
                  'event.outcome': status,
                });
                yield* Effect.logInfo('Profile event publication finished', {
                  'event.id': eventId,
                  'event.outcome': status,
                  'event.duration_ms': duration,
                });
                yield* Metric.update(
                  Metric.counter('events.published.total', {
                    incremental: true,
                    attributes: { 'event.type': event.eventType, status },
                  }),
                  1
                );
                yield* Metric.update(
                  Metric.histogram('events.publish_duration_ms', {
                    boundaries: [1, 10, 100, 1000, 5000],
                    attributes: { 'event.type': event.eventType },
                  }),
                  duration
                );
              })
            ),
            Effect.withSpan('profiles.events.publish-recorded')
          );
          yield* parent ? publish.pipe(OtelTracer.withSpanContext(parent)) : publish;
        }),
      }).pipe(
        Context.add(ProfilePublicationHealth, {
          check: () =>
            assets
              ? Effect.tryPromise({
                  try: (signal) =>
                    assets.send(new HeadBucketCommand({ Bucket: options.assetReferenceBucket }), {
                      abortSignal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
                    }),
                  catch: (cause) =>
                    new MaintenanceFailure({
                      operation: 'check-picture-reference-storage',
                      cause: storageDiagnostic(cause),
                    }),
                }).pipe(
                  Effect.tapError((failure) =>
                    Effect.logError('Profile publication storage unavailable', {
                      operation: failure.operation,
                      cause: failure.cause,
                    })
                  ),
                  Effect.withSpan('profiles.events.check-picture-reference-storage'),
                  Effect.match({ onSuccess: () => true, onFailure: () => false })
                )
              : Effect.succeed(true),
        })
      );
    })
  );
