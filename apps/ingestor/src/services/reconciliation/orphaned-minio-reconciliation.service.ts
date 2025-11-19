import { eq } from 'drizzle-orm';
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { wallpapers } from '../../db/schema.js';
import { deleteFromStorage } from '../storage.service.js';
import { ReconciliationConstants } from '../../constants/reconciliation.constants.js';
import type { DbType } from './base-reconciliation.service.js';

/**
 * Reconciles orphaned MinIO objects - files that exist in storage but not in the database.
 *
 * This reconciliation is different from others - it iterates through MinIO objects
 * rather than database records, so it doesn't use the BaseReconciliation pattern.
 *
 * Recovery logic:
 * - Delete MinIO object if no DB record exists
 * - Delete MinIO object if DB record has uploadState = 'failed'
 *
 * NOTE: This implementation does not currently support pagination.
 * TODO: Add pagination support for buckets with large numbers of objects.
 */
export class OrphanedMinioReconciliation {
  constructor(
    private readonly database: DbType,
    private readonly s3Client: S3Client,
    private readonly storageBucket: string
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
        Bucket: this.storageBucket,
      });
      const listResponse = await this.s3Client.send(listCommand);

      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return;
      }

      // Process in batches to avoid overwhelming the database
      const batchSize = ReconciliationConstants.MINIO_CLEANUP_BATCH_SIZE;
      for (let i = 0; i < listResponse.Contents.length; i += batchSize) {
        const batch = listResponse.Contents.slice(i, i + batchSize);

        for (const object of batch) {
          if (!object.Key) continue;

          try {
            await this.processObject(object.Key);
          } catch (error) {
            console.error(`Error processing MinIO object ${object.Key}:`, error);
            // Continue processing other objects
          }
        }
      }
    } catch (error) {
      console.error('Error listing MinIO objects:', error);
      throw error;
    }
  }

  /**
   * Process a single MinIO object.
   * Deletes the object if it's orphaned (no DB record or failed upload).
   *
   * @param objectKey - The S3 object key (format: {wallpaperId}/original.{ext})
   */
  private async processObject(objectKey: string): Promise<void> {
    // Extract wallpaper ID from storage key
    const wallpaperId = objectKey.split('/')[0];

    // Query database for corresponding record
    const dbRecord = await this.database.query.wallpapers.findFirst({
      where: eq(wallpapers.id, wallpaperId),
    });

    // Delete if no DB record OR DB record has uploadState = 'failed'
    if (!dbRecord || dbRecord.uploadState === 'failed') {
      await deleteFromStorage(this.storageBucket, objectKey, this.s3Client);
      console.log(`Deleted orphaned MinIO object: ${objectKey}`);
    }
  }
}
