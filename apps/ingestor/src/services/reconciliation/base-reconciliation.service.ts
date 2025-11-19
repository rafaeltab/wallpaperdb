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
  async reconcile(database: DbType): Promise<void> {
    while (true) {
      const processed = await this.processNextBatch(database);
      if (!processed) break;
    }
  }

  /**
   * Process the next batch of records.
   *
   * @param database - Database connection
   * @returns true if a record was processed, false if no records found
   */
  private async processNextBatch(database: DbType): Promise<boolean> {
    try {
      return await database.transaction(async (tx) => {
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
    console.error(`Error in ${this.getOperationName()}:`, error);
  }
}
