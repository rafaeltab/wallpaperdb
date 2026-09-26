import { ProfileCreatedEventSchema, ProfileUpdatedEventSchema } from '@wallpaperdb/events/schemas';
import { resolveProfilePictureAsset } from '@wallpaperdb/core/assets';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import { context, propagation, trace } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';
import { Clock, Effect, Exit, Layer, Metric } from 'effect';
import { headers } from 'nats';
import { outboxEvents } from '../../db/schema.js';
import { MaintenanceFailure, ProfileEvents } from '../../maintenance/index.js';
import { Database, databaseDiagnostic } from '../database/index.js';
import { broker, EventsBroker } from './broker.js';

export interface ProfilePublisherOptions {
  readonly pictureBucket: string;
}

export const eventPublisherLayer = (options: ProfilePublisherOptions) =>
  Layer.effect(
    ProfileEvents,
    Effect.gen(function* () {
      const database = yield* Database;
      const service = yield* EventsBroker;
      return ProfileEvents.of({
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
            yield* Effect.try({
              try: () => {
                const location = resolveProfilePictureAsset(
                  reference,
                  event.profile.id,
                  options.pictureBucket
                );
                if (
                  'storageBucket' in asset &&
                  (asset.storageBucket !== location.bucket || asset.storageKey !== location.key)
                )
                  throw new Error('Picture asset does not match its recorded storage location');
              },
              catch: (cause) =>
                new MaintenanceFailure({ operation: 'validate-picture-asset', cause }),
            }).pipe(
              Effect.tapError((failure) =>
                Effect.logError('Profile picture address validation failed', {
                  operation: failure.operation,
                  cause: failure.cause,
                  'event.id': eventId,
                })
              )
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
      });
    })
  );
