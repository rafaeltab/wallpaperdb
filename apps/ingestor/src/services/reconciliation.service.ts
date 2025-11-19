import type { S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getDatabase } from '../connections/database.js';
import { getMinioClient } from '../connections/minio.js';
import type * as schema from '../db/schema.js';
import { StuckUploadsReconciliation } from './reconciliation/stuck-uploads-reconciliation.service.js';
import { MissingEventsReconciliation } from './reconciliation/missing-events-reconciliation.service.js';
import { OrphanedIntentsReconciliation } from './reconciliation/orphaned-intents-reconciliation.service.js';
import { OrphanedMinioReconciliation } from './reconciliation/orphaned-minio-reconciliation.service.js';

type DbType = NodePgDatabase<typeof schema>;

/**
 * Reconcile stuck uploads - Fix uploads stuck in 'uploading' state for >10 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param bucket - Storage bucket name (defaults to env S3_BUCKET or 'wallpapers')
 * @param db - Database connection (defaults to singleton)
 * @param s3Client - S3 client (defaults to singleton)
 */
export async function reconcileStuckUploads(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const minioClient = s3Client || getMinioClient();
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';

  const reconciliation = new StuckUploadsReconciliation(storageBucket, minioClient);
  await reconciliation.reconcile(database);
}

/**
 * Reconcile missing events - Republish NATS events for records stuck in 'stored' state for >5 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param db - Database connection (defaults to singleton)
 */
export async function reconcileMissingEvents(db?: DbType): Promise<void> {
  const database = db || getDatabase();

  const reconciliation = new MissingEventsReconciliation();
  await reconciliation.reconcile(database);
}

/**
 * Reconcile orphaned intents - Delete records in 'initiated' state older than 1 hour
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param db - Database connection (defaults to singleton)
 */
export async function reconcileOrphanedIntents(db?: DbType): Promise<void> {
  const database = db || getDatabase();

  const reconciliation = new OrphanedIntentsReconciliation();
  await reconciliation.reconcile(database);
}

/**
 * Reconcile orphaned MinIO objects - Delete MinIO files without valid DB records
 *
 * @param bucket - Storage bucket name (defaults to env S3_BUCKET or 'wallpapers')
 * @param db - Database connection (defaults to singleton)
 * @param s3Client - S3 client (defaults to singleton)
 */
export async function reconcileOrphanedMinioObjects(
  bucket?: string,
  db?: DbType,
  s3Client?: S3Client
): Promise<void> {
  const database = db || getDatabase();
  const minioClient = s3Client || getMinioClient();
  const storageBucket = bucket || process.env.S3_BUCKET || 'wallpapers';

  const reconciliation = new OrphanedMinioReconciliation(database, minioClient, storageBucket);
  await reconciliation.reconcile();
}
