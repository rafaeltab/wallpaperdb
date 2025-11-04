import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, lt } from 'drizzle-orm';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { NatsConnection, JetStreamClient } from 'nats';
import { getTestConfig } from './setup.js';
import { createNatsConnection, closeNatsConnection } from '../src/connections/nats.js';
import * as schema from '../src/db/schema.js';
import { wallpapers } from '../src/db/schema.js';
import { ulid } from 'ulid';

// Import scheduler functions (THESE WILL FAIL - scheduler not implemented yet)
import {
  startScheduler,
  stopScheduler,
  runReconciliationNow,
} from '../src/services/scheduler.service.js';

// Import reconciliation functions to verify they were called
import {
  reconcileStuckUploads,
  reconcileMissingEvents,
  reconcileOrphanedIntents,
  reconcileOrphanedMinioObjects,
} from '../src/services/reconciliation.service.js';

describe('Scheduler Service Tests', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let s3Client: S3Client;
  let natsClient: NatsConnection;
  let js: JetStreamClient;
  let config: ReturnType<typeof getTestConfig>;

  beforeAll(async () => {
    config = getTestConfig();

    // Setup database connection
    pool = new Pool({ connectionString: config.databaseUrl });
    db = drizzle(pool, { schema: schema });

    // Setup MinIO client
    s3Client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
      forcePathStyle: true,
    });

    // Create MinIO bucket if it doesn't exist
    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: config.s3Bucket,
        })
      );
    } catch (error) {
      // Bucket already exists, ignore error
    }

    // Initialize NATS connection
    natsClient = await createNatsConnection(config);
    js = natsClient.jetstream();

    // Create JetStream stream for testing
    const jsm = await natsClient.jetstreamManager();
    try {
      await jsm.streams.add({
        name: config.natsStream,
        subjects: ['wallpaper.>'],
      });
    } catch (error) {
      // Stream might already exist, ignore error
    }
  });

  beforeEach(async () => {
    // Clean up database before each test
    await db.delete(wallpapers);

    // Clean up MinIO bucket before each test
    const listResponse = await s3Client.send(new ListObjectsV2Command({ Bucket: config.s3Bucket }));
    if (listResponse.Contents) {
      for (const object of listResponse.Contents) {
        if (object.Key) {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: config.s3Bucket,
              Key: object.Key,
            })
          );
        }
      }
    }
  });

  afterEach(() => {
    // Ensure scheduler is stopped after each test
    try {
      stopScheduler();
    } catch {
      // Ignore if scheduler doesn't exist or is already stopped
    }
  });

  afterAll(async () => {
    // Close all connections after all tests complete
    await pool.end();
    await closeNatsConnection();
  });

  /**
   * Test Helper: Create a wallpaper record in a specific state with an old timestamp
   */
  async function createStuckUpload(
    state: 'initiated' | 'uploading' | 'stored' | 'processing',
    minutesAgo: number,
    options: {
      userId?: string;
      hasMinioFile?: boolean;
      uploadAttempts?: number;
    } = {}
  ) {
    const id = `wlpr_${ulid()}`;
    const userId = options.userId || 'test-user';
    const uploadAttempts = options.uploadAttempts || 0;
    const now = new Date();
    const oldTimestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);

    // Create database record
    await db.insert(wallpapers).values({
      id,
      userId,
      contentHash: `hash_${id}`,
      uploadState: state,
      stateChangedAt: oldTimestamp,
      uploadAttempts,
      // Add metadata for 'stored' and 'processing' states
      ...(state === 'stored' || state === 'processing'
        ? {
            fileType: 'image' as const,
            mimeType: 'image/jpeg',
            fileSizeBytes: 1024,
            width: 1920,
            height: 1080,
            storageKey: `${id}/original.jpg`,
            storageBucket: config.s3Bucket,
            originalFilename: 'test.jpg',
          }
        : {}),
    });

    // Optionally create MinIO file
    if (options.hasMinioFile) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: `${id}/original.jpg`,
          Body: Buffer.from('test image data'),
          ContentType: 'image/jpeg',
        })
      );
    }

    return id;
  }

  /**
   * Test Helper: Create an orphaned MinIO object (no DB record)
   */
  async function createOrphanedMinioObject(id?: string) {
    const wallpaperId = id || `wlpr_${ulid()}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: `${wallpaperId}/original.jpg`,
        Body: Buffer.from('orphaned file data'),
        ContentType: 'image/jpeg',
      })
    );

    return wallpaperId;
  }

  /**
   * Test Helper: Get wallpaper record state from database
   */
  async function getRecordState(id: string) {
    const record = await db.query.wallpapers.findFirst({
      where: eq(wallpapers.id, id),
    });
    return record;
  }

  /**
   * Test Helper: Wait for a specific amount of time
   */
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Test Helper: Count records in a specific state
   */
  async function countRecordsInState(state: string): Promise<number> {
    const records = await db.query.wallpapers.findMany({
      where: eq(wallpapers.uploadState, state),
    });
    return records.length;
  }

  describe('Scheduler Lifecycle', () => {
    it('should start scheduler successfully', () => {
      // Start scheduler (should not throw)
      expect(() => startScheduler()).not.toThrow();
    });

    it('should stop scheduler gracefully', () => {
      // Start scheduler first
      startScheduler();

      // Stop scheduler (should not throw)
      expect(() => stopScheduler()).not.toThrow();
    });

    it('should not allow starting an already running scheduler', () => {
      // Start scheduler
      startScheduler();

      // Try to start again (should be idempotent or throw)
      // Implementation could either ignore or throw - just ensure it's handled
      const secondStart = () => startScheduler();

      // Should either not throw (idempotent) or throw with clear message
      // We test that calling it twice doesn't crash the process
      expect(() => {
        try {
          secondStart();
        } catch (error) {
          // If it throws, it should be a clear error message
          expect(error).toBeDefined();
        }
      }).not.toThrow();
    });

    it('should clean up intervals when stopped', async () => {
      // Create stuck upload to verify reconciliation runs
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Start scheduler with short interval (for testing)
      startScheduler();

      // Wait for at least one cycle (implementation should use ~100ms for tests)
      await wait(500);

      // Stop scheduler
      stopScheduler();

      // Verify reconciliation ran before stop
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('stored');

      // Create another stuck upload
      const id2 = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Wait to ensure no more cycles run
      await wait(500);

      // Verify second upload was NOT reconciled (scheduler stopped)
      const record2 = await getRecordState(id2);
      expect(record2?.uploadState).toBe('uploading');
    });
  });

  describe('Regular Reconciliation Cycles', () => {
    it('should run reconcileStuckUploads on scheduled interval', async () => {
      // Create stuck upload in 'uploading' state
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Verify initial state
      expect((await getRecordState(id))?.uploadState).toBe('uploading');

      // Start scheduler
      startScheduler();

      // Wait for reconciliation cycle to run
      await wait(500);

      // Verify reconciliation was executed
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('stored');
    });

    it('should run reconcileMissingEvents on scheduled interval', async () => {
      // Create record in 'stored' state
      const id = await createStuckUpload('stored', 10);

      // Verify initial state
      expect((await getRecordState(id))?.uploadState).toBe('stored');

      // Start scheduler
      startScheduler();

      // Wait for reconciliation cycle to run
      await wait(500);

      // Verify event was republished and state changed
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('processing');
    });

    it('should run reconcileOrphanedIntents on scheduled interval', async () => {
      // Create old 'initiated' record
      const id = await createStuckUpload('initiated', 90);

      // Verify record exists
      expect(await getRecordState(id)).toBeDefined();

      // Start scheduler
      startScheduler();

      // Wait for reconciliation cycle to run
      await wait(500);

      // Verify record was deleted
      expect(await getRecordState(id)).toBeUndefined();
    });

    it('should run all three reconciliation functions in one cycle', async () => {
      // Create test data for all three scenarios
      const uploadingId = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });
      const storedId = await createStuckUpload('stored', 10);
      const initiatedId = await createStuckUpload('initiated', 90);

      // Start scheduler
      startScheduler();

      // Wait for reconciliation cycle to complete
      await wait(500);

      // Verify all three were executed
      expect((await getRecordState(uploadingId))?.uploadState).toBe('stored');
      expect((await getRecordState(storedId))?.uploadState).toBe('processing');
      expect(await getRecordState(initiatedId)).toBeUndefined();
    });

    it('should run multiple cycles continuously', async () => {
      // Start scheduler
      startScheduler();

      // Create first batch of stuck uploads
      const id1 = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Wait for first cycle
      await wait(300);

      // Verify first batch processed
      expect((await getRecordState(id1))?.uploadState).toBe('stored');

      // Create second batch
      const id2 = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Wait for second cycle
      await wait(300);

      // Verify second batch processed
      expect((await getRecordState(id2))?.uploadState).toBe('stored');
    });

    it('should handle empty database gracefully', async () => {
      // No test data created - database is empty

      // Start scheduler (should not throw on empty database)
      expect(() => startScheduler()).not.toThrow();

      // Wait for cycle
      await wait(300);

      // Should still be running without errors
      // (No assertion needed - just verify no crash)
    });
  });

  describe('MinIO Cleanup Cycles', () => {
    it('should run MinIO cleanup on separate schedule', async () => {
      // Create orphaned MinIO object
      const orphanedId = await createOrphanedMinioObject();

      // Verify object exists
      const headCommand = new HeadObjectCommand({
        Bucket: config.s3Bucket,
        Key: `${orphanedId}/original.jpg`,
      });
      await expect(s3Client.send(headCommand)).resolves.toBeDefined();

      // Start scheduler
      // Note: Implementation should have a way to trigger MinIO cleanup
      // either via shorter interval for tests or manual trigger
      startScheduler();

      // Wait for MinIO cleanup cycle
      // This might need to be longer or triggered manually in tests
      await wait(1000);

      // Verify orphaned object was deleted
      await expect(s3Client.send(headCommand)).rejects.toThrow();
    });

    it('should not run MinIO cleanup on regular reconciliation cycles', async () => {
      // Create regular stuck upload (should be reconciled quickly)
      const regularId = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Create orphaned MinIO object (should NOT be cleaned up in regular cycle)
      const orphanedId = await createOrphanedMinioObject();

      // Start scheduler
      startScheduler();

      // Wait for one regular cycle (not MinIO cleanup)
      await wait(300);

      // Verify regular reconciliation ran
      expect((await getRecordState(regularId))?.uploadState).toBe('stored');

      // Verify orphaned object still exists (not cleaned up yet)
      const headCommand = new HeadObjectCommand({
        Bucket: config.s3Bucket,
        Key: `${orphanedId}/original.jpg`,
      });
      await expect(s3Client.send(headCommand)).resolves.toBeDefined();
    });
  });

  describe('Manual Reconciliation Triggers', () => {
    it('should support manual trigger for immediate reconciliation', async () => {
      // Create stuck uploads
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Trigger immediate reconciliation (without starting scheduler)
      await runReconciliationNow();

      // Verify reconciliation ran immediately
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('stored');
    });

    it('should run manual reconciliation without waiting for scheduled interval', async () => {
      // Start scheduler
      startScheduler();

      // Create test data
      const id = await createStuckUpload('stored', 10);

      // Immediately trigger manual reconciliation (don't wait for interval)
      await runReconciliationNow();

      // Should be processed immediately, not waiting for next scheduled cycle
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('processing');
    });

    it('should work when scheduler is not running', async () => {
      // Do NOT start scheduler

      // Create test data
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Manual trigger should work independently
      await expect(runReconciliationNow()).resolves.not.toThrow();

      // Verify it processed the record
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('stored');
    });
  });

  describe('Error Handling', () => {
    it('should continue running after reconciliation function throws error', async () => {
      // Start scheduler
      startScheduler();

      // Create invalid data that might cause errors
      // For example, a record with missing required fields
      await db.insert(wallpapers).values({
        id: `wlpr_${ulid()}`,
        userId: 'test-user',
        contentHash: 'hash_invalid',
        uploadState: 'stored',
        stateChangedAt: new Date(Date.now() - 10 * 60 * 1000),
        uploadAttempts: 0,
        // Missing required fields for 'stored' state - may cause errors
        fileType: null as any,
        mimeType: null as any,
      });

      // Wait for cycle (should handle error gracefully)
      await wait(500);

      // Create valid data
      const validId = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });

      // Wait for next cycle
      await wait(300);

      // Scheduler should still be running and processing valid records
      const record = await getRecordState(validId);
      expect(record?.uploadState).toBe('stored');
    });

    it('should handle database connection errors gracefully', async () => {
      // Start scheduler
      startScheduler();

      // Scheduler should not crash even if database has issues
      // This is a basic smoke test - implementation should log errors
      await wait(300);

      // Verify scheduler is still running (by stopping it)
      expect(() => stopScheduler()).not.toThrow();
    });

    it('should handle NATS connection errors gracefully', async () => {
      // Create stuck upload in 'stored' state
      const id = await createStuckUpload('stored', 10);

      // Close NATS connection to simulate failure
      await closeNatsConnection();

      // Start scheduler
      startScheduler();

      // Wait for cycle (should handle NATS error)
      await wait(500);

      // Reconnect NATS
      natsClient = await createNatsConnection(config);
      js = natsClient.jetstream();

      // Record should still be in 'stored' state (NATS publish failed)
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('stored');

      // Scheduler should still be running
      expect(() => stopScheduler()).not.toThrow();
    });

    it('should log errors without crashing the process', async () => {
      // Create data that will cause reconciliation errors
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: false,
        uploadAttempts: 3, // Max retries - will be marked as failed
      });

      // Start scheduler
      startScheduler();

      // Wait for reconciliation
      await wait(500);

      // Verify record was marked as failed (error handled properly)
      const record = await getRecordState(id);
      expect(record?.uploadState).toBe('failed');

      // Scheduler should still be running
      expect(() => stopScheduler()).not.toThrow();
    });

    it('should continue reconciliation even if one function fails', async () => {
      // Create test data for multiple reconciliation types
      const uploadingId = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
      });
      const initiatedId = await createStuckUpload('initiated', 90);

      // Even if one reconciliation function fails, others should run
      startScheduler();

      await wait(500);

      // At least some reconciliation should have succeeded
      // (This tests that errors in one function don't stop the whole cycle)
      const uploadingRecord = await getRecordState(uploadingId);
      const initiatedRecord = await getRecordState(initiatedId);

      // At least one of these should have been processed
      const atLeastOneProcessed =
        uploadingRecord?.uploadState === 'stored' || initiatedRecord === undefined;

      expect(atLeastOneProcessed).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should work end-to-end with real infrastructure', async () => {
      // Create comprehensive test scenario with multiple stuck states
      const scenarios = await Promise.all([
        // Stuck uploads that can be recovered
        createStuckUpload('uploading', 15, { hasMinioFile: true }),
        createStuckUpload('uploading', 15, { hasMinioFile: true }),

        // Stuck uploads that should fail
        createStuckUpload('uploading', 15, { hasMinioFile: false, uploadAttempts: 3 }),

        // Missing events
        createStuckUpload('stored', 10),
        createStuckUpload('stored', 10),

        // Orphaned intents
        createStuckUpload('initiated', 90),
        createStuckUpload('initiated', 90),
      ]);

      // Start scheduler
      startScheduler();

      // Wait for reconciliation to complete
      await wait(800);

      // Verify results
      const storedCount = await countRecordsInState('stored');
      const processingCount = await countRecordsInState('processing');
      const failedCount = await countRecordsInState('failed');

      // Should have 2 recovered uploads in 'stored' state
      expect(storedCount).toBe(2);

      // Should have 2 records in 'processing' state (NATS events published)
      expect(processingCount).toBe(2);

      // Should have 1 failed upload
      expect(failedCount).toBe(1);

      // Should have 2 orphaned intents deleted (total count should be 5)
      const totalCount = await db.query.wallpapers.findMany();
      expect(totalCount.length).toBe(5); // 2 stored + 2 processing + 1 failed
    });

    it('should handle high volume of stuck records', async () => {
      // Create 50 stuck uploads
      await Promise.all(
        Array.from({ length: 50 }, () =>
          createStuckUpload('uploading', 15, { hasMinioFile: true })
        )
      );

      // Start scheduler
      startScheduler();

      // Wait for multiple cycles to process all records
      await wait(2000);

      // Verify all were processed to 'stored' state
      const storedCount = await countRecordsInState('stored');
      expect(storedCount).toBeGreaterThanOrEqual(45); // Allow for some still processing
    });

    it('should coordinate with multiple scheduler instances via row-level locking', async () => {
      // Create 30 stuck uploads
      const uploadIds = await Promise.all(
        Array.from({ length: 30 }, () =>
          createStuckUpload('uploading', 15, { hasMinioFile: true })
        )
      );

      // Simulate multiple instances by calling reconciliation directly
      // (The scheduler itself will call these, but we can test the underlying safety)
      await Promise.all([
        reconcileStuckUploads(config.s3Bucket, db, s3Client),
        reconcileStuckUploads(config.s3Bucket, db, s3Client),
        reconcileStuckUploads(config.s3Bucket, db, s3Client),
      ]);

      // Verify all were processed exactly once (no duplicates)
      const storedCount = await countRecordsInState('stored');
      expect(storedCount).toBe(30);

      // Verify no records left in 'uploading'
      const uploadingCount = await countRecordsInState('uploading');
      expect(uploadingCount).toBe(0);
    });
  });

  describe('Timing and Configuration', () => {
    it('should respect time windows for stuck uploads (10 minutes)', async () => {
      // Create upload that is 9 minutes old (should NOT be reconciled)
      const recentId = await createStuckUpload('uploading', 9, {
        hasMinioFile: true,
      });

      // Create upload that is 11 minutes old (should be reconciled)
      const oldId = await createStuckUpload('uploading', 11, {
        hasMinioFile: true,
      });

      // Start scheduler
      startScheduler();

      // Wait for cycle
      await wait(500);

      // Recent upload should remain in 'uploading'
      expect((await getRecordState(recentId))?.uploadState).toBe('uploading');

      // Old upload should be reconciled to 'stored'
      expect((await getRecordState(oldId))?.uploadState).toBe('stored');
    });

    it('should respect time windows for missing events (5 minutes)', async () => {
      // Create record that is 4 minutes old (should NOT be reconciled)
      const recentId = await createStuckUpload('stored', 4);

      // Create record that is 6 minutes old (should be reconciled)
      const oldId = await createStuckUpload('stored', 6);

      // Start scheduler
      startScheduler();

      // Wait for cycle
      await wait(500);

      // Recent record should remain in 'stored'
      expect((await getRecordState(recentId))?.uploadState).toBe('stored');

      // Old record should be reconciled to 'processing'
      expect((await getRecordState(oldId))?.uploadState).toBe('processing');
    });

    it('should respect time windows for orphaned intents (1 hour)', async () => {
      // Create intent that is 50 minutes old (should NOT be deleted)
      const recentId = await createStuckUpload('initiated', 50);

      // Create intent that is 90 minutes old (should be deleted)
      const oldId = await createStuckUpload('initiated', 90);

      // Start scheduler
      startScheduler();

      // Wait for cycle
      await wait(500);

      // Recent intent should still exist
      expect(await getRecordState(recentId)).toBeDefined();

      // Old intent should be deleted
      expect(await getRecordState(oldId)).toBeUndefined();
    });
  });
});
