import { PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT } from '@wallpaperdb/events';
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { DatabaseConnection } from '../connections/database.js';
import { outboxEvents } from '../db/schema.js';
import { profileEvidenceRetentionMs } from './profile-retention-policy.js';

export class ProfileEventRetentionService {
  constructor(
    private readonly database: DatabaseConnection,
    private readonly config: Config,
    private readonly logger: { error(bindings: object, message: string): void }
  ) {}

  async cleanupExpired(now: Date): Promise<{ deleted: number; failed: number }> {
    const db = this.database.getClient().db;
    const eligible = and(
      inArray(outboxEvents.subject, [PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT]),
      isNotNull(outboxEvents.publishedAt),
      lte(outboxEvents.createdAt, new Date(now.getTime() - profileEvidenceRetentionMs(this.config)))
    );
    const events = await db.select({ id: outboxEvents.id }).from(outboxEvents)
      .where(eligible).orderBy(outboxEvents.createdAt, outboxEvents.id).limit(100);
    let deleted = 0;
    for (const event of events) {
      try {
        const removed = await db.delete(outboxEvents)
          .where(and(eligible, eq(outboxEvents.id, event.id))).returning({ id: outboxEvents.id });
        deleted += removed.length;
      } catch (error) {
        this.logger.error({ err: error, eventId: event.id }, 'Profile event cleanup failed; will retry');
        throw error;
      }
    }
    return { deleted, failed: 0 };
  }
}
