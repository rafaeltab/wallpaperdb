import { PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT } from '@wallpaperdb/events';
import { and, eq, gt, inArray, isNotNull, lte, or } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { DatabaseConnection } from '../connections/database.js';
import { outboxEvents } from '../db/schema.js';
import { profileEvidenceRetentionMs } from './profile-retention-policy.js';

export class ProfileEventRetentionService {
  private cursor: { createdAt: Date; id: string } | undefined;
  constructor(
    private readonly database: DatabaseConnection,
    private readonly config: Config,
    private readonly logger: { error(bindings: object, message: string): void }
  ) {}

  async cleanupExpired(
    now: Date,
    isStopping = () => false
  ): Promise<{ deleted: number; failed: number }> {
    const db = this.database.getClient().db;
    const eligible = and(
      inArray(outboxEvents.subject, [PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT]),
      isNotNull(outboxEvents.publishedAt),
      lte(outboxEvents.createdAt, new Date(now.getTime() - profileEvidenceRetentionMs(this.config)))
    );
    const events = await db
      .select({ id: outboxEvents.id, createdAt: outboxEvents.createdAt })
      .from(outboxEvents)
      .where(
        and(
          eligible,
          this.cursor
            ? or(
                gt(outboxEvents.createdAt, this.cursor.createdAt),
                and(
                  eq(outboxEvents.createdAt, this.cursor.createdAt),
                  gt(outboxEvents.id, this.cursor.id)
                )
              )
            : undefined
        )
      )
      .orderBy(outboxEvents.createdAt, outboxEvents.id)
      .limit(100);
    let deleted = 0;
    let failed = 0;
    for (const event of events) {
      if (isStopping()) break;
      try {
        const removed = await db
          .delete(outboxEvents)
          .where(and(eligible, eq(outboxEvents.id, event.id)))
          .returning({ id: outboxEvents.id });
        deleted += removed.length;
      } catch (error) {
        this.logger.error(
          { err: error, eventId: event.id },
          'Profile event cleanup failed; will retry'
        );
        failed++;
      }
    }
    // Advance over failures too; retry them after the bounded scan wraps.
    this.cursor = events.length === 100 ? events.at(-1) : undefined;
    return { deleted, failed };
  }
}
