import { eq, and, lt } from 'drizzle-orm';
import { wallpapers } from '../../db/schema.js';
import { ReconciliationConstants } from '../../constants/reconciliation.constants.js';
import {
  BaseReconciliation,
  type TransactionType,
} from './base-reconciliation.service.js';
import { inject, singleton } from 'tsyringe';
import { DatabaseConnection } from '../../connections/database.js';

type WallpaperRecord = typeof wallpapers.$inferSelect;

/**
 * Reconciles wallpapers stuck in 'initiated' state for longer than threshold.
 *
 * These are orphaned intent records where the upload was never completed.
 * Recovery logic: Delete the record
 */
@singleton()
export class OrphanedIntentsReconciliation extends BaseReconciliation<WallpaperRecord> {
    constructor(
        @inject(DatabaseConnection) databaseConnection: DatabaseConnection,
    ) {
        super(databaseConnection.getClient().db);
    }

  protected getOperationName(): string {
    return 'Orphaned Intents Reconciliation';
  }

  protected async getRecordsToProcess(tx: TransactionType): Promise<WallpaperRecord[]> {
    const thresholdDate = new Date(
      Date.now() - ReconciliationConstants.ORPHANED_INTENT_THRESHOLD_MS
    );

    const records = await tx
      .select()
      .from(wallpapers)
      .where(
        and(
          eq(wallpapers.uploadState, 'initiated'),
          lt(wallpapers.stateChangedAt, thresholdDate)
        )
      )
      .limit(1)
      .for('update', { skipLocked: true }); // CRITICAL for multi-instance safety

    return records;
  }

  protected async processRecord(record: WallpaperRecord, tx: TransactionType): Promise<void> {
    // Delete the orphaned intent
    await tx.delete(wallpapers).where(eq(wallpapers.id, record.id));

    console.log(`Deleted orphaned intent ${record.id}`);
  }
}
