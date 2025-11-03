import { eq, and, lt, sql } from 'drizzle-orm';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDatabase } from '../connections/database.js';
import { getMinioClient } from '../connections/minio.js';
import { wallpapers, type Wallpaper } from '../db/schema.js';
import { objectExists, deleteFromStorage } from './storage.service.js';
import { publishWallpaperUploadedEvent } from './events.service.js';
import * as schema from '../db/schema.js';

type DbType = NodePgDatabase<typeof schema>;

/**
 * Reconcile stuck uploads - Fix uploads stuck in 'uploading' state for >10 minutes
 */
export async function reconcileStuckUploads(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';

  // Query for uploads stuck in 'uploading' state for more than 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const stuckUploads = await database
    .select()
    .from(wallpapers)
    .where(
      and(
        eq(wallpapers.uploadState, 'uploading'),
        lt(wallpapers.stateChangedAt, tenMinutesAgo)
      )
    );

  for (const upload of stuckUploads) {
    try {
      // Construct storage key from wallpaper ID (format: {wallpaperId}/original.{ext})
      // For reconciliation, we try with .jpg as a default since we don't have the extension stored yet
      const storageKey = `${upload.id}/original.jpg`;

      // Check if the file exists in MinIO
      const fileExists = await objectExists(storageBucket, storageKey, s3Client);

      if (fileExists) {
        // File exists - recover to 'stored' state
        await database
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
          await database
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
          await database
            .update(wallpapers)
            .set({
              uploadAttempts: upload.uploadAttempts + 1,
              stateChangedAt: new Date(),
            })
            .where(eq(wallpapers.id, upload.id));

          console.log(`Incremented retry attempts for upload ${upload.id} (${upload.uploadAttempts + 1}/3)`);
        }
      }
    } catch (error) {
      console.error(`Error reconciling stuck upload ${upload.id}:`, error);
      // Continue processing other uploads
    }
  }
}

/**
 * Reconcile missing events - Republish NATS events for records stuck in 'stored' state for >5 minutes
 */
export async function reconcileMissingEvents(db?: DbType): Promise<void> {
  const database = db || getDatabase();

  // Query for records stuck in 'stored' state for more than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const stuckRecords = await database
    .select()
    .from(wallpapers)
    .where(
      and(
        eq(wallpapers.uploadState, 'stored'),
        lt(wallpapers.stateChangedAt, fiveMinutesAgo)
      )
    );

  // Process in batches of 10
  const batchSize = 10;
  for (let i = 0; i < stuckRecords.length; i += batchSize) {
    const batch = stuckRecords.slice(i, i + batchSize);

    for (const record of batch) {
      try {
        // Try to publish the event
        await publishWallpaperUploadedEvent(record);

        // If successful, update state to 'processing'
        await database
          .update(wallpapers)
          .set({
            uploadState: 'processing',
            stateChangedAt: new Date(),
          })
          .where(eq(wallpapers.id, record.id));

        console.log(`Republished event for wallpaper ${record.id}`);
      } catch (error) {
        // NATS publish failed - leave in 'stored' state for next cycle
        console.error(`Failed to republish event for wallpaper ${record.id}:`, error);
        // Don't throw - continue processing other records
      }
    }
  }
}

/**
 * Reconcile orphaned intents - Delete records in 'initiated' state older than 1 hour
 */
export async function reconcileOrphanedIntents(db?: DbType): Promise<void> {
  const database = db || getDatabase();

  // Query for records in 'initiated' state older than 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const orphanedIntents = await database
    .select()
    .from(wallpapers)
    .where(
      and(
        eq(wallpapers.uploadState, 'initiated'),
        lt(wallpapers.stateChangedAt, oneHourAgo)
      )
    );

  // Delete orphaned intents
  for (const intent of orphanedIntents) {
    try {
      await database
        .delete(wallpapers)
        .where(eq(wallpapers.id, intent.id));

      console.log(`Deleted orphaned intent ${intent.id}`);
    } catch (error) {
      console.error(`Error deleting orphaned intent ${intent.id}:`, error);
      // Continue processing other intents
    }
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
