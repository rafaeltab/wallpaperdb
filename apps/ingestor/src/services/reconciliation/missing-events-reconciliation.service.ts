import { and, eq, lt } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import { DatabaseConnection } from '../../connections/database.js';
import { ReconciliationConstants } from '../../constants/reconciliation.constants.js';
import { wallpapers } from '../../db/schema.js';
import { EventsService } from '../events.service.js';
import { BaseReconciliation, type TransactionType } from './base-reconciliation.service.js';

type WallpaperRecord = typeof wallpapers.$inferSelect;

/**
 * Reconciles wallpapers stuck in 'stored' state without NATS events published.
 *
 * Recovery logic:
 * - Publish NATS event
 * - Transition to 'processing' state
 */
@singleton()
export class MissingEventsReconciliation extends BaseReconciliation<WallpaperRecord> {
  constructor(
    @inject(EventsService) private readonly eventsService: EventsService,
    @inject(DatabaseConnection) databaseConnection: DatabaseConnection
  ) {
    super(databaseConnection.getClient().db);
  }

  protected getOperationName(): string {
    return 'Missing Events Reconciliation';
  }

  protected async getRecordsToProcess(tx: TransactionType): Promise<WallpaperRecord[]> {
    const thresholdDate = new Date(Date.now() - ReconciliationConstants.MISSING_EVENT_THRESHOLD_MS);

    const records = await tx
      .select()
      .from(wallpapers)
      .where(
        and(eq(wallpapers.uploadState, 'stored'), lt(wallpapers.stateChangedAt, thresholdDate))
      )
      .limit(1)
      .for('update', { skipLocked: true }); // CRITICAL for multi-instance safety

    return records;
  }

  protected async processRecord(record: WallpaperRecord, tx: TransactionType): Promise<void> {
    console.log(record);

    // Publish NATS event
    await this.eventsService.publishUploadedEvent(record);

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
   * Override error handling to log NATS publish failures.
   * The transaction rolls back, leaving the record in 'stored' for retry.
   */
  protected handleError(error: unknown): void {
    console.error('Failed to republish event:', error);
    // Transaction will rollback, leaving in 'stored' for retry
  }

  /**
   * Override to handle NATS publish failures resiliently.
   *
   * A single transient NATS error increments a consecutive-error counter and
   * the loop continues with the next record (the transaction rolls back, leaving
   * the failed record in 'stored' for retry in the next scheduled cycle).
   *
   * Only after MAX_CONSECUTIVE_ERRORS back-to-back failures (indicating NATS is
   * structurally unavailable) does the loop exit early to avoid a busy-loop.
   */
  async reconcile(): Promise<void> {
    const MAX_CONSECUTIVE_ERRORS = 3;
    let consecutiveErrors = 0;

    while (true) {
      try {
        const processed = await this.database.transaction(async (tx) => {
          const records = await this.getRecordsToProcess(tx);

          if (records.length === 0) {
            return false;
          }

          for (const record of records) {
            await this.processRecord(record, tx);
          }

          return true;
        });

        consecutiveErrors = 0; // reset streak on success
        if (!processed) break; // no more records — normal exit
      } catch (error) {
        this.handleError(error);
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          // NATS is likely structurally unavailable; stop to avoid an
          // infinite retry storm. The next scheduled cycle will retry.
          break;
        }
        // A single transient failure — the transaction rolled back, the
        // record stays in 'stored', and we continue to the next record.
      }
    }
  }
}
