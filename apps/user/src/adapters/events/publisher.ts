import { ProfileCreatedEventSchema, ProfileUpdatedEventSchema } from '@wallpaperdb/events/schemas';
import { eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { headers } from 'nats';
import { outboxEvents } from '../../db/schema.js';
import { MaintenanceFailure, ProfileEvents } from '../../maintenance/index.js';
import { Database } from '../database/index.js';
import { broker, EventsBroker, type EventsOptions } from './broker.js';

export const eventPublisherLayer = (_options: EventsOptions) =>
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
            catch: (cause) => new MaintenanceFailure({ operation: 'read-event', cause }),
          });
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
            parsed.data.eventType !== stored?.subject
          )
            return yield* Effect.fail(
              new MaintenanceFailure({
                operation: 'decode-event',
                cause: new Error('Invalid recorded Profile event'),
              })
            );
          const event = parsed.data;
          const metadata = headers();
          for (const [key, value] of Object.entries({
            'content-type': 'application/json',
            'ce-specversion': '1.0',
            'ce-source': 'https://wallpaperdb/user',
            'ce-id': event.eventId,
            'ce-type': event.eventType,
            'ce-time': event.timestamp,
          }))
            metadata.set(key, value);
          yield* Effect.annotateCurrentSpan({
            'event.id': eventId,
            'event.source': 'https://wallpaperdb/user',
            'profile.id': event.profile.id,
          });
          yield* broker('publish-profile-event', () =>
            service.client.publish(event.eventType, JSON.stringify(event), {
              headers: metadata,
              msgID: eventId,
              expect: { streamName: 'PROFILE' },
              timeout: 5000,
            })
          );
        }),
      });
    })
  );
