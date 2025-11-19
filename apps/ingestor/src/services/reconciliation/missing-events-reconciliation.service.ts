import { eq, and, lt } from 'drizzle-orm';
import { wallpapers } from '../../db/schema.js';
import { publishWallpaperUploadedEvent } from '../events.service.js';
import { ReconciliationConstants } from '../../constants/reconciliation.constants.js';
import {
  BaseReconciliation,
  type TransactionType,
} from './base-reconciliation.service.js';

type WallpaperRecord = typeof wallpapers.$inferSelect;

/**
 * Reconciles wallpapers stuck in 'stored' state without NATS events published.
 *
 * Recovery logic:
 * - Publish NATS event
 * - Transition to 'processing' state
 */
export class MissingEventsReconciliation extends BaseReconciliation<WallpaperRecord> {
  protected getOperationName(): string {
    return 'Missing Events Reconciliation';
  }

  protected async getRecordsToProcess(tx: TransactionType): Promise<WallpaperRecord[]> {
    const thresholdDate = new Date(
      Date.now() - ReconciliationConstants.MISSING_EVENT_THRESHOLD_MS
    );

    const records = await tx
      .select()
      .from(wallpapers)
      .where(
        and(
          eq(wallpapers.uploadState, 'stored'),
          lt(wallpapers.stateChangedAt, thresholdDate)
        )
      )
      .limit(1)
      .for('update', { skipLocked: true }); // CRITICAL for multi-instance safety

    return records;
  }

  protected async processRecord(record: WallpaperRecord, tx: TransactionType): Promise<void> {
    console.log(record);

    // Publish NATS event
    await publishWallpaperUploadedEvent(record);

    // Update state to 'processing'
    await tx
      .update(wallpapers)
      .set({
        uploadState: 'processing',
        stateChangedAt: new Date(),
      })
      .where(eq(wallpapers.id, record.id));

    console.log(`Republished event for wallpaper ${record.id}`);
  }

  /**
   * Override error handling to break on NATS publish failure.
   * This prevents infinite retry loop - next cycle will try again.
   */
  protected handleError(error: unknown): void {
    console.error('Failed to republish event:', error);
    // Transaction will rollback, leaving in 'stored' for retry
  }

  /**
   * Override to handle NATS publish failures - return false to break on error
   */
  async reconcile(database: Parameters<BaseReconciliation<WallpaperRecord>['reconcile']>[0]): Promise<void> {
    while (true) {
      try {
        const processed = await database.transaction(async (tx) => {
          const records = await this.getRecordsToProcess(tx);

          if (records.length === 0) {
            return false;
          }

          for (const record of records) {
            await this.processRecord(record, tx);
          }

          return true;
        });

        if (!processed) break;
      } catch (error) {
        this.handleError(error);
        // Break on error to avoid infinite retry loop
        break;
      }
    }
  }
}
