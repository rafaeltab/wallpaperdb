import { SystemTimerService, type TimerService } from '@wallpaperdb/core/timer';
import {
  BaseEventPublisher,
  PROFILE_CREATED_SUBJECT,
  type ProfileCreatedEvent,
  ProfileCreatedEventSchema,
  PROFILE_UPDATED_SUBJECT,
  type ProfileUpdatedEvent,
  ProfileUpdatedEventSchema,
} from '@wallpaperdb/events';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { DatabaseConnection } from '../connections/database.js';
import type { NatsConnectionManager } from '../connections/nats.js';
import { outboxEvents } from '../db/schema.js';

const PUBLISH_INTERVAL_MS = 1_000;
const PUBLISH_BATCH_SIZE = 100;

export interface ProfileEventPublisher {
  publish(event: ProfileCreatedEvent | ProfileUpdatedEvent): Promise<void>;
}

interface OutboxLogger {
  error(bindings: object, message: string): void;
}

class NatsProfileCreatedEventPublisher extends BaseEventPublisher<
  typeof ProfileCreatedEventSchema
> {
  protected readonly schema = ProfileCreatedEventSchema;
  protected readonly subject = PROFILE_CREATED_SUBJECT;
  protected readonly eventType = PROFILE_CREATED_SUBJECT;
}

class NatsProfileUpdatedEventPublisher extends BaseEventPublisher<
  typeof ProfileUpdatedEventSchema
> {
  protected readonly schema = ProfileUpdatedEventSchema;
  protected readonly subject = PROFILE_UPDATED_SUBJECT;
  protected readonly eventType = PROFILE_UPDATED_SUBJECT;
}

export class NatsProfileEventPublisher implements ProfileEventPublisher {
  private readonly created: NatsProfileCreatedEventPublisher;
  private readonly updated: NatsProfileUpdatedEventPublisher;

  constructor(nats: NatsConnectionManager, config: Config) {
    const publisherConfig = {
      natsConnection: nats.getClient(),
      serviceName: config.otelServiceName,
    };
    this.created = new NatsProfileCreatedEventPublisher(publisherConfig);
    this.updated = new NatsProfileUpdatedEventPublisher(publisherConfig);
  }

  publish(event: ProfileCreatedEvent | ProfileUpdatedEvent): Promise<void> {
    return event.eventType === PROFILE_CREATED_SUBJECT
      ? this.created.publish(event)
      : this.updated.publish(event);
  }
}

export class ProfileOutboxPublisherWorker {
  private interval: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly database: DatabaseConnection,
    private readonly publisher: ProfileEventPublisher,
    private readonly logger: OutboxLogger,
    private readonly timer: TimerService = new SystemTimerService()
  ) {}

  start(): void {
    if (this.interval) return;

    const run = () =>
      this.publishPending().catch((error) => {
        this.logger.error({ err: error }, 'Profile outbox publication cycle failed');
      });
    void run();
    this.interval = this.timer.setInterval(run, PUBLISH_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.interval) {
      this.timer.clearInterval(this.interval);
      this.interval = null;
    }
    await this.inFlight;
  }

  publishPending(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.publishBatch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async publishBatch(): Promise<void> {
    const events = await this.database
      .getClient()
      .db.select()
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.subject, [PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT]),
          isNull(outboxEvents.publishedAt)
        )
      )
      .orderBy(asc(outboxEvents.createdAt), asc(outboxEvents.id))
      .limit(PUBLISH_BATCH_SIZE);

    for (const storedEvent of events) {
      try {
        const payload = storedEvent.payload as (ProfileCreatedEvent | ProfileUpdatedEvent) & {
          change?: { type: 'created' };
        };
        const event =
          storedEvent.subject === PROFILE_CREATED_SUBJECT
            ? ProfileCreatedEventSchema.parse({
                ...payload,
                change: payload.change ?? { type: 'created' },
              })
            : ProfileUpdatedEventSchema.parse(payload);
        await this.publisher.publish(event);
        await this.database
          .getClient()
          .db.update(outboxEvents)
          .set({ publishedAt: new Date() })
          .where(and(eq(outboxEvents.id, storedEvent.id), isNull(outboxEvents.publishedAt)));
      } catch (error) {
        this.logger.error(
          { err: error, eventId: storedEvent.id },
          'Profile outbox event publication failed'
        );
      }
    }
  }
}
