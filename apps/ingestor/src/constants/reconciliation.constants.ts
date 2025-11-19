/**
 * Reconciliation timing constants
 * All values in milliseconds
 */
export const ReconciliationConstants = {
  /** Time threshold for considering an upload "stuck" in uploading state (10 minutes) */
  STUCK_UPLOAD_THRESHOLD_MS: 10 * 60 * 1000,

  /** Time threshold for considering a stored upload missing its NATS event (5 minutes) */
  MISSING_EVENT_THRESHOLD_MS: 5 * 60 * 1000,

  /** Time threshold for considering an initiated upload orphaned (1 hour) */
  ORPHANED_INTENT_THRESHOLD_MS: 60 * 60 * 1000,

  /** Maximum upload retry attempts before marking as failed */
  MAX_UPLOAD_RETRIES: 3,

  /** Batch size for processing MinIO objects during cleanup */
  MINIO_CLEANUP_BATCH_SIZE: 20,
} as const;
