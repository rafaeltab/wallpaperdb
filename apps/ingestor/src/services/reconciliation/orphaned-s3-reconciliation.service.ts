import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../../config.js';
import { DatabaseConnection } from '../../connections/database.js';
import { S3Connection } from '../../connections/s3.js';
import { ReconciliationConstants } from '../../constants/reconciliation.constants.js';
import { wallpapers } from '../../db/schema.js';
import { StorageService } from '../storage.service.js';

/**
 * Reconciles orphaned S3 objects - files that exist in storage but not in the database.
 *
 * This reconciliation is different from others - it iterates through S3 objects
 * rather than database records, so it doesn't use the BaseReconciliation pattern.
 *
 * Recovery logic:
 * - Delete S3 object if no DB record exists
 * - Delete S3 object if DB record has uploadState = 'failed'
 *
 * NOTE: This implementation does not currently support pagination.
 * TODO: Add pagination support for buckets with large numbers of objects.
 */
@singleton()
export class OrphanedS3Reconciliation {
  constructor(
    @inject(StorageService) private readonly storageService: StorageService,
    @inject(DatabaseConnection) private readonly databaseConnection: DatabaseConnection,
    @inject(S3Connection) private readonly s3Connection: S3Connection,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Run the reconciliation process.
   * Lists all objects in the bucket and checks for orphaned files.
   *
   * TODO: Implement pagination for large buckets to prevent memory exhaustion.
   * Current implementation loads all objects at once which could be problematic
   * for buckets with tens of thousands of objects.
   */
  async reconcile(): Promise<void> {
    try {
      // TODO: Add pagination support here
      // Current implementation: list all objects at once (potential memory issue)
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
      });
      const listResponse = await this.s3Connection.getClient().send(listCommand);

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return;
      }

      // Process in batches to avoid overwhelming the database
      const batchSize = ReconciliationConstants.S3_CLEANUP_BATCH_SIZE;
      for (let i = 0; i < listResponse.Contents.length; i += batchSize) {
        const batch = listResponse.Contents.slice(i, i + batchSize);

        for (const object of batch) {
          if (!object.Key) continue;

          try {
            await this.processObject(object.Key);
          } catch (error) {
            console.error(`Error processing S3 object ${object.Key}:`, error);
            // Continue processing other objects
          }
        }
      }
    } catch (error) {
      console.error('Error listing S3 objects:', error);
      throw error;
    }
  }

  /**
   * Process a single S3 object.
   * Deletes the object if it's orphaned (no DB record or failed upload).
   *
   * @param objectKey - The S3 object key (format: {wallpaperId}/original.{ext})
   */
  private async processObject(objectKey: string): Promise<void> {
    // Extract wallpaper ID from storage key
    const wallpaperId = objectKey.split('/')[0];

    // Query database for corresponding record
    const dbRecord = await this.databaseConnection.getClient().db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
    });

    // Delete if no DB record OR DB record has uploadState = 'failed'
    if (!dbRecord || dbRecord.uploadState === 'failed') {
      await this.storageService.delete(this.config.s3Bucket, objectKey);
      console.log(`Deleted orphaned S3 object: ${objectKey}`);
    }
  }
}
