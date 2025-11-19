import { container } from "tsyringe";
import { MissingEventsReconciliation } from "./reconciliation/missing-events-reconciliation.service.js";
import { OrphanedIntentsReconciliation } from "./reconciliation/orphaned-intents-reconciliation.service.js";
import { OrphanedMinioReconciliation } from "./reconciliation/orphaned-minio-reconciliation.service.js";
import { StuckUploadsReconciliation } from "./reconciliation/stuck-uploads-reconciliation.service.js";

/**
 * Reconcile stuck uploads - Fix uploads stuck in 'uploading' state for >10 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param bucket - Storage bucket name (defaults to env S3_BUCKET or 'wallpapers')
 * @param db - Database connection (defaults to singleton)
 * @param s3Client - S3 client (defaults to singleton)
 */
export async function reconcileStuckUploads(): Promise<void> {
    const reconciliation = container.resolve(StuckUploadsReconciliation);
    await reconciliation.reconcile();
}

/**
 * Reconcile missing events - Republish NATS events for records stuck in 'stored' state for >5 minutes
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param db - Database connection (defaults to singleton)
 */
export async function reconcileMissingEvents(): Promise<void> {
    const reconciliation = container.resolve(MissingEventsReconciliation);
    await reconciliation.reconcile();
}

/**
 * Reconcile orphaned intents - Delete records in 'initiated' state older than 1 hour
 * Uses row-level locking (FOR UPDATE SKIP LOCKED) for multi-instance safety
 *
 * @param db - Database connection (defaults to singleton)
 */
export async function reconcileOrphanedIntents(): Promise<void> {
    const reconciliation = container.resolve(OrphanedIntentsReconciliation);
    await reconciliation.reconcile();
}

/**
 * Reconcile orphaned MinIO objects - Delete MinIO files without valid DB records
 *
 * @param bucket - Storage bucket name (defaults to env S3_BUCKET or 'wallpapers')
 * @param db - Database connection (defaults to singleton)
 * @param s3Client - S3 client (defaults to singleton)
 */
export async function reconcileOrphanedMinioObjects(): Promise<void> {
    const reconciliation = container.resolve(OrphanedMinioReconciliation);
    await reconciliation.reconcile();
}
