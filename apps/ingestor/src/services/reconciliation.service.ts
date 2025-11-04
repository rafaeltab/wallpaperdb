import { eq, and, lt } from 'drizzle-orm';
import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDatabase } from '../connections/database.js';
import { getMinioClient } from '../connections/minio.js';
import { wallpapers } from '../db/schema.js';
import { objectExists, deleteFromStorage } from './storage.service.js';
import { publishWallpaperUploadedEvent } from './events.service.js';
import type * as schema from '../db/schema.js';

type DbType = NodePgDatabase<typeof schema>;

/**
 * Reconcile stuck uploads - Fix uploads stuck in 'uploading' state for >10 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 */
export async function reconcileStuckUploads(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  // Process records one at a time with row-level locking
  while (true) {
    let processed = false;

    try {
      await database.transaction(async (tx) => {
        // Lock next available stuck upload (skip locked rows)
        const [upload] = await tx
          .select()
          .from(wallpapers)
          .where(
            and(
              eq(wallpapers.uploadState, 'uploading'),
              lt(wallpapers.stateChangedAt, tenMinutesAgo)
            )
          )
          .limit(1)
          .for('update', { skipLocked: true }); // CRITICAL for multi-instance

        if (!upload) return;

        processed = true;

        // Construct storage key from wallpaper ID (format: {wallpaperId}/original.{ext})
        // For reconciliation, we try with .jpg as a default since we don't have the extension stored yet
        const storageKey = `${upload.id}/original.jpg`;

        // Check if the file exists in MinIO
        const fileExists = await objectExists(storageBucket, storageKey, s3Client);

        if (fileExists) {
          // File exists - recover to 'stored' state
          await tx
            .update(wallpapers)
            .set({
              uploadState: 'stored',
              stateChangedAt: new Date(),
            })
            .where(eq(wallpapers.id, upload.id));

          console.log(`Recovered stuck upload ${upload.id} to 'stored' state`);
        } else {
          // File missing - check retry attempts
          if (upload.uploadAttempts >= 3) {
            // Max retries exceeded - mark as failed
            await tx
              .update(wallpapers)
              .set({
                uploadState: 'failed',
                processingError: 'Max retries exceeded',
                stateChangedAt: new Date(),
              })
              .where(eq(wallpapers.id, upload.id));

            console.log(`Marked upload ${upload.id} as failed (max retries exceeded)`);
          } else {
            // Increment retry attempts
            await tx
              .update(wallpapers)
              .set({
                uploadAttempts: upload.uploadAttempts + 1,
                stateChangedAt: new Date(),
              })
              .where(eq(wallpapers.id, upload.id));

            console.log(
              `Incremented retry attempts for upload ${upload.id} (${upload.uploadAttempts + 1}/3)`
            );
          }
        }
      });
    } catch (error) {
      console.error('Error reconciling stuck upload:', error);
      // Continue to next record
    }

    // Exit loop if no records found
    if (!processed) break;
  }
}

/**
 * Reconcile missing events - Republish NATS events for records stuck in 'stored' state for >5 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 */
export async function reconcileMissingEvents(db?: DbType): Promise<void> {
  const database = db || getDatabase();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // Process records one at a time with row-level locking
  while (true) {
    let recordFound = false;

    try {
      await database.transaction(async (tx) => {
        // Lock next available stuck record
        const [record] = await tx
          .select()
          .from(wallpapers)
          .where(
            and(
              eq(wallpapers.uploadState, 'stored'),
              lt(wallpapers.stateChangedAt, fiveMinutesAgo)
            )
          )
          .limit(1)
          .for('update', { skipLocked: true }); // CRITICAL for multi-instance

        if (!record) return;

        recordFound = true;

        // Publish event
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
      });
    } catch (error) {
      console.error('Failed to republish event:', error);
      // Transaction will rollback, leaving in 'stored' for retry
      // Break to avoid infinite retry loop (next cycle will try again)
      break;
    }

    // Exit if no more records
    if (!recordFound) break;
  }
}

/**
 * Reconcile orphaned intents - Delete records in 'initiated' state older than 1 hour
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 */
export async function reconcileOrphanedIntents(db?: DbType): Promise<void> {
  const database = db || getDatabase();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Process records one at a time with row-level locking
  while (true) {
    let processed = false;

    try {
      await database.transaction(async (tx) => {
        // Lock next orphaned intent
        const [intent] = await tx
          .select()
          .from(wallpapers)
          .where(
            and(
              eq(wallpapers.uploadState, 'initiated'),
              lt(wallpapers.stateChangedAt, oneHourAgo)
            )
          )
          .limit(1)
          .for('update', { skipLocked: true }); // CRITICAL for multi-instance

        if (!intent) return;

        processed = true;

        // Delete the orphaned intent
        await tx.delete(wallpapers).where(eq(wallpapers.id, intent.id));

        console.log(`Deleted orphaned intent ${intent.id}`);
      });
    } catch (error) {
      console.error('Error deleting orphaned intent:', error);
      // Continue to next record
    }

    if (!processed) break;
  }
}

/**
 * Reconcile orphaned MinIO objects - Delete MinIO files without valid DB records
 */
export async function reconcileOrphanedMinioObjects(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const minioClient = s3Client || getMinioClient();

  // Get bucket name from parameter, environment, or use default
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';

  try {
    // List all objects in the bucket
    const listCommand = new ListObjectsV2Command({ Bucket: storageBucket });
    const listResponse = await minioClient.send(listCommand);

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      return;
    }

    // Process in batches of 20
    const batchSize = 20;
    for (let i = 0; i < listResponse.Contents.length; i += batchSize) {
      const batch = listResponse.Contents.slice(i, i + batchSize);

      for (const object of batch) {
        if (!object.Key) continue;

        try {
          // Extract wallpaper ID from storage key (format: {wallpaperId}/original.{ext})
          const wallpaperId = object.Key.split('/')[0];

          // Query database for corresponding record
          const dbRecord = await database.query.wallpapers.findFirst({
            where: eq(wallpapers.id, wallpaperId),
          });

          // Delete if no DB record OR DB record has uploadState = 'failed'
          if (!dbRecord || dbRecord.uploadState === 'failed') {
            await deleteFromStorage(storageBucket, object.Key, minioClient);
            console.log(`Deleted orphaned MinIO object: ${object.Key}`);
          }
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
