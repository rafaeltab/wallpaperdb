import type { S3Client } from '@aws-sdk/client-s3';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { loadConfig } from '../config.js';
import {
  getDatabase,
  createDatabaseConnection,
  closeDatabaseConnection,
} from '../connections/database.js';
import {
  getMinioClient,
  createMinioConnection,
  closeMinioConnection,
} from '../connections/minio.js';
import type * as schema from '../db/schema.js';
import {
  reconcileStuckUploads,
  reconcileMissingEvents,
  reconcileOrphanedIntents,
  reconcileOrphanedMinioObjects,
} from './reconciliation.service.js';

type DbType = NodePgDatabase<typeof schema>;

// Interval timers
let reconciliationInterval: NodeJS.Timeout | null = null;
let minioCleanupInterval: NodeJS.Timeout | null = null;

// Track if scheduler is running
let isRunning = false;

// Track if a reconciliation cycle is currently executing (prevent concurrent runs)
let isReconciling = false;

// Track if scheduler created its own connections (so we can clean them up)
let schedulerCreatedConnections = false;

/**
 * Get interval configuration based on environment
 * Test environment uses shorter intervals for faster test execution
 */
function getIntervalConfig() {
  const config = loadConfig();

  if (config.nodeEnv === 'test') {
    return {
      reconciliationInterval: 100, // 100ms for tests
      minioCleanupInterval: 500, // 500ms for tests
    };
  }

  // Production/development intervals
  return {
    reconciliationInterval: 5 * 60 * 1000, // 5 minutes
    minioCleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
  };
}

/**
 * Execute a single reconciliation cycle
 * Runs all three main reconciliation functions sequentially
 */
async function runReconciliationCycle(): Promise<void> {
  // Prevent concurrent reconciliation cycles
  if (isReconciling) {
    console.log('Reconciliation cycle already in progress, skipping...');
    return;
  }

  isReconciling = true;

  try {
    const config = loadConfig();

    // Initialize connections if not already initialized
    // This is needed for tests where singletons aren't pre-initialized
    let db: DbType;
    let s3Client: S3Client;

    try {
      db = getDatabase();
    } catch {
      // Database not initialized, create connection
      const { db: dbInstance } = createDatabaseConnection(config);
      db = dbInstance;
      schedulerCreatedConnections = true;
    }

    try {
      s3Client = getMinioClient();
    } catch {
      // MinIO not initialized, create connection
      s3Client = createMinioConnection(config);
      schedulerCreatedConnections = true;
    }

    console.log('Starting reconciliation cycle...');

    // Run all three reconciliation functions sequentially
    // Each function handles its own errors internally, but we catch any unexpected ones

    try {
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);
    } catch (error) {
      console.error('Error in reconcileStuckUploads:', error);
      // Continue to next reconciliation function
    }

    try {
      await reconcileMissingEvents(db);
    } catch (error) {
      console.error('Error in reconcileMissingEvents:', error);
      // Continue to next reconciliation function
    }

    try {
      await reconcileOrphanedIntents(db);
    } catch (error) {
      console.error('Error in reconcileOrphanedIntents:', error);
      // Continue (no more functions, but we don't crash)
    }

    console.log('Reconciliation cycle complete');
  } catch (error) {
    console.error('Unexpected error in reconciliation cycle:', error);
    // Don't throw - scheduler should continue running
  } finally {
    isReconciling = false;
  }
}

/**
 * Execute MinIO cleanup cycle
 * Removes orphaned objects from MinIO storage
 */
async function runMinioCleanupCycle(): Promise<void> {
  try {
    const config = loadConfig();

    // Initialize connections if not already initialized
    let db: DbType;
    let s3Client: S3Client;

    try {
      db = getDatabase();
    } catch {
      const { db: dbInstance } = createDatabaseConnection(config);
      db = dbInstance;
      schedulerCreatedConnections = true;
    }

    try {
      s3Client = getMinioClient();
    } catch {
      s3Client = createMinioConnection(config);
      schedulerCreatedConnections = true;
    }

    console.log('Starting MinIO orphaned object cleanup...');

    await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

    console.log('MinIO cleanup complete');
  } catch (error) {
    console.error('Error in MinIO cleanup cycle:', error);
    // Don't throw - scheduler should continue running
  }
}

/**
 * Start the reconciliation scheduler
 * Runs reconciliation every 5 minutes (or 100ms in test mode)
 * Runs MinIO cleanup every 24 hours (or 500ms in test mode)
 */
export function startScheduler(): void {
  if (isRunning) {
    console.log('Scheduler already running, ignoring start request');
    return;
  }

  console.log('Starting reconciliation scheduler...');

  const intervals = getIntervalConfig();

  // Run reconciliation on regular interval
  reconciliationInterval = setInterval(() => {
    runReconciliationCycle().catch((error) => {
      console.error('Fatal error in reconciliation interval:', error);
      // Interval continues even if there's an error
    });
  }, intervals.reconciliationInterval);

  // Run MinIO cleanup on separate interval
  minioCleanupInterval = setInterval(() => {
    runMinioCleanupCycle().catch((error) => {
      console.error('Fatal error in MinIO cleanup interval:', error);
      // Interval continues even if there's an error
    });
  }, intervals.minioCleanupInterval);

  isRunning = true;
  console.log(
    `Scheduler started (reconciliation: ${intervals.reconciliationInterval}ms, MinIO cleanup: ${intervals.minioCleanupInterval}ms)`
  );
}

/**
 * Stop the reconciliation scheduler
 * Called during graceful shutdown
 *
 * Note: Connection cleanup happens asynchronously.
 * Call stopSchedulerAndWait() if you need to wait for cleanup to complete.
 */
export function stopScheduler(): void {
  if (!isRunning) {
    console.log('Scheduler not running, nothing to stop');
    return;
  }

  console.log('Stopping reconciliation scheduler...');

  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }

  if (minioCleanupInterval) {
    clearInterval(minioCleanupInterval);
    minioCleanupInterval = null;
  }

  isRunning = false;

  // Clean up connections if scheduler created them
  // This runs asynchronously but we don't block the caller
  if (schedulerCreatedConnections) {
    (async () => {
      try {
        await closeDatabaseConnection();
        closeMinioConnection();
        schedulerCreatedConnections = false;
      } catch (error) {
        // Silently ignore connection termination errors (happens during test teardown)
        if (error && !String(error).includes('terminating connection')) {
          console.error('Error closing scheduler connections:', error);
        }
      }
    })();
  }

  console.log('Scheduler stopped');
}

/**
 * Stop the scheduler and wait for connection cleanup to complete
 * Use this in tests or when you need to ensure connections are fully closed
 */
export async function stopSchedulerAndWait(): Promise<void> {
  if (!isRunning) {
    console.log('Scheduler not running, nothing to stop');
    return;
  }

  console.log('Stopping reconciliation scheduler...');

  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }

  if (minioCleanupInterval) {
    clearInterval(minioCleanupInterval);
    minioCleanupInterval = null;
  }

  isRunning = false;

  // Clean up connections if scheduler created them
  if (schedulerCreatedConnections) {
    try {
      await closeDatabaseConnection();
      closeMinioConnection();
      schedulerCreatedConnections = false;
    } catch (error) {
      // Silently ignore connection termination errors (happens during test teardown)
      if (error && !String(error).includes('terminating connection')) {
        console.error('Error closing scheduler connections:', error);
      }
    }
  }

  console.log('Scheduler stopped');
}

/**
 * Run reconciliation immediately (for testing or admin trigger)
 * This can be called independently of the scheduler
 */
export async function runReconciliationNow(): Promise<void> {
  console.log('Running manual reconciliation...');
  await runReconciliationCycle();
  console.log('Manual reconciliation complete');
}
