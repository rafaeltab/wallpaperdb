import {
  Attributes,
  recordCounter,
  recordHistogram,
  withSpan,
} from '@wallpaperdb/core/telemetry';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../db/schema.js';

export type DbType = NodePgDatabase<typeof schema>;
export type TransactionType = Parameters<Parameters<DbType['transaction']>[0]>[0];

/**
 * Base class for reconciliation operations.
 * Implements the common pattern of:
 * 1. Loop until no more records to process
 * 2. For each record: start transaction with row-level locking (FOR UPDATE SKIP LOCKED)
 * 3. Process the record
 * 4. Commit transaction
 * 5. Handle errors gracefully
 *
 * This pattern ensures multi-instance safety through PostgreSQL's row-level locking.
 * The SKIP LOCKED clause prevents different instances from blocking each other.
 *
 * @template TRecord - The type of record being processed
 */
export abstract class BaseReconciliation<TRecord> {
  protected database: DbType;

  constructor(db: DbType) {
    this.database = db;
  }

  /**
   * Get the next batch of records to process.
   * Must use row-level locking: .for('update', { skipLocked: true })
   *
   * @param tx - Database transaction
   * @returns Array of records (typically single record with limit(1))
   */
  protected abstract getRecordsToProcess(tx: TransactionType): Promise<TRecord[]>;

  /**
   * Process a single record within the transaction.
   *
   * @param record - The record to process
   * @param tx - Database transaction
   */
  protected abstract processRecord(record: TRecord, tx: TransactionType): Promise<void>;

  /**
   * Get a human-readable name for this reconciliation operation (for logging).
   */
  protected abstract getOperationName(): string;

  /**
   * Run the reconciliation process.
   * Continues processing until no more records are found.
   *
   * @param database - Database connection
   */
  async reconcile(): Promise<void> {
    const operationName = this.getOperationName();

    return await withSpan(
      `reconciliation.${operationName}.cycle`,
      { [Attributes.RECONCILIATION_TYPE]: operationName },
      async (span) => {
        const startTime = Date.now();
        let recordsProcessed = 0;

        while (true) {
          const processed = await this.processNextBatch();
          if (!processed) break;
          recordsProcessed++;
        }

        const durationMs = Date.now() - startTime;

        span.setAttribute(Attributes.RECONCILIATION_RECORDS_PROCESSED, recordsProcessed);

        recordCounter('reconciliation.cycles.total', 1, {
          [Attributes.RECONCILIATION_TYPE]: operationName,
        });
        recordCounter('reconciliation.records_processed.total', recordsProcessed, {
          [Attributes.RECONCILIATION_TYPE]: operationName,
        });
        recordHistogram('reconciliation.cycle_duration_ms', durationMs, {
          [Attributes.RECONCILIATION_TYPE]: operationName,
        });
      }
    );
  }

  /**
   * Process the next batch of records.
   *
   * @param database - Database connection
   * @returns true if a record was processed, false if no records found
   */
  private async processNextBatch(): Promise<boolean> {
    try {
      return await this.database.transaction(async (tx) => {
        const records = await this.getRecordsToProcess(tx);

        if (records.length === 0) {
          return false;
        }

        // Process each record (typically just one with limit(1))
        for (const record of records) {
          await this.processRecord(record, tx);
        }

        return true;
      });
    } catch (error) {
      this.handleError(error);
      // Return false to stop processing on error
      // Each subclass can override this behavior if needed
      return false;
    }
  }

  /**
   * Handle errors during reconciliation.
   * Default behavior: log and continue.
   * Subclasses can override to implement custom error handling.
   *
   * @param error - The error that occurred
   */
  protected handleError(error: unknown): void {
    const operationName = this.getOperationName();
    const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

    recordCounter('reconciliation.errors.total', 1, {
      [Attributes.RECONCILIATION_TYPE]: operationName,
      [Attributes.ERROR_TYPE]: errorType,
    });

    console.error(`Error in ${operationName}:`, error);
  }
}
