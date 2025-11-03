import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
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

// Import reconciliation functions (will fail - not implemented yet)
import {
  reconcileStuckUploads,
  reconcileMissingEvents,
  reconcileOrphanedIntents,
  reconcileOrphanedMinioObjects,
} from '../src/services/reconciliation.service.js';

// Type for NATS wallpaper.uploaded event
interface WallpaperUploadedEvent {
  eventId: string;
  eventType: 'wallpaper.uploaded';
  timestamp: string;
  wallpaper: {
    id: string;
    userId: string;
    fileType: 'image' | 'video';
    mimeType: string;
    fileSizeBytes: number;
    width: number;
    height: number;
    aspectRatio: number;
    storageKey: string;
    storageBucket: string;
    originalFilename: string;
    uploadedAt: string;
  };
}

describe('Reconciliation Service Tests', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let s3Client: S3Client;
  let natsClient: NatsConnection;
  let js: JetStreamClient;
  let config: ReturnType<typeof getTestConfig>;

  beforeAll(async () => {
    config = getTestConfig();

    // Setup database connection (reused across all tests)
    pool = new Pool({ connectionString: config.databaseUrl });
    db = drizzle(pool, { schema: schema });

    // Setup MinIO client (reused across all tests)
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

    // Initialize global NATS connection (used by reconciliation service)
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
            storageBucket: 'wallpapers-test',
            originalFilename: 'test.jpg',
          }
        : {}),
    });

    // Optionally create MinIO file
    if (options.hasMinioFile) {
      const config = getTestConfig();
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
    const config = getTestConfig();

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
   * Test Helper: Check if MinIO object exists
   */
  async function minioObjectExists(wallpaperId: string): Promise<boolean> {
    try {
      const config = getTestConfig();
      await s3Client.send(
        new HeadObjectCommand({
          Bucket: config.s3Bucket,
          Key: `${wallpaperId}/original.jpg`,
        })
      );
      return true;
    } catch {
      return false;
    }
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
   * Test Helper: Wait for NATS event on a subject
   */
  async function waitForNatsEvent(subject: string, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`Timeout waiting for event on ${subject}`));
      }, timeoutMs);

      const sub = natsClient.subscribe(subject);

      (async () => {
        for await (const msg of sub) {
          clearTimeout(timeout);
          sub.unsubscribe();
          const data = JSON.parse(new TextDecoder().decode(msg.data));
          resolve(data);
          return;
        }
      })();
    });
  }

  describe('Stuck Uploading State Recovery', () => {
    it('should mark upload as failed when MinIO upload failed and file does not exist', async () => {
      // Create stuck upload in 'uploading' state (>10 minutes ago)
      // MinIO file does NOT exist, and max retries reached
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: false,
        uploadAttempts: 3,
      });

      // Run reconciliation
      const config = getTestConfig();
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);

      // Verify: Record should be marked as 'failed'
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('failed');
      expect(record?.processingError).toContain('Max retries exceeded');
    });

    it('should recover upload to stored when file exists in MinIO', async () => {
      // Create stuck upload in 'uploading' state (>10 minutes ago)
      // MinIO file DOES exist
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: true,
        uploadAttempts: 0,
      });

      // Run reconciliation
      const config = getTestConfig();
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);

      // Verify: Record should be moved to 'stored' state
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('stored');
    });

    it('should retry upload when attempts < 3', async () => {
      // Create stuck upload with 2 retry attempts
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: false,
        uploadAttempts: 2,
      });

      // Run reconciliation
      const config = getTestConfig();
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);

      // Verify: Upload attempts should be incremented
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadAttempts).toBe(3);
      // State might remain 'uploading' or move to retry state
      expect(record?.uploadState).toMatch(/uploading|initiated/);
    });

    it('should mark as failed when retry attempts >= 3', async () => {
      // Create stuck upload with 3 retry attempts
      const id = await createStuckUpload('uploading', 15, {
        hasMinioFile: false,
        uploadAttempts: 3,
      });

      // Run reconciliation
      const config = getTestConfig();
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);

      // Verify: Record should be marked as 'failed'
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('failed');
      expect(record?.processingError).toContain('Max retries exceeded');
    });

    it('should not touch recent uploads in uploading state', async () => {
      // Create recent upload (< 10 minutes ago)
      const id = await createStuckUpload('uploading', 5, {
        hasMinioFile: false,
      });

      // Run reconciliation
      const config = getTestConfig();
      await reconcileStuckUploads(config.s3Bucket, db, s3Client);

      // Verify: Record should remain unchanged
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('uploading');
    });
  });

  describe('Missing NATS Events Republishing', () => {
    it('should publish NATS event for records stuck in stored state', async () => {
      // Create record in 'stored' state (>5 minutes ago)
      const id = await createStuckUpload('stored', 10);

      // Listen for NATS event
      const eventPromise = waitForNatsEvent('wallpaper.uploaded');

      // Run reconciliation
      await reconcileMissingEvents(db);

      // Verify: NATS event was published
      const event = (await eventPromise) as WallpaperUploadedEvent;
      expect(event).toBeDefined();
      expect(event).toHaveProperty('wallpaper');
      expect(event.wallpaper.id).toBe(id);

      // Verify: Record state moved to 'processing'
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('processing');
    });

    it('should process multiple stuck records in batches', async () => {
      // Create 5 records in 'stored' state
      const ids = await Promise.all([
        createStuckUpload('stored', 10),
        createStuckUpload('stored', 10),
        createStuckUpload('stored', 10),
        createStuckUpload('stored', 10),
        createStuckUpload('stored', 10),
      ]);

      // Run reconciliation
      await reconcileMissingEvents(db);

      // Verify: All records moved to 'processing'
      for (const id of ids) {
        const record = await getRecordState(id);
        expect(record?.uploadState).toBe('processing');
      }
    });

    it('should leave record in stored state if NATS publish fails', async () => {
      // Create record in 'stored' state
      const id = await createStuckUpload('stored', 10);

      // Simulate NATS failure by closing the global connection
      await closeNatsConnection();

      // Run reconciliation (should handle NATS error gracefully)
      await reconcileMissingEvents(db);

      // Reconnect for subsequent tests (restore shared connection)
      natsClient = await createNatsConnection(config);
      js = natsClient.jetstream();

      // Verify: Record remains in 'stored' state for next reconciliation cycle
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('stored');
    });

    it('should not touch recent stored records (< 5 minutes)', async () => {
      // Create recent record in 'stored' state (< 5 minutes)
      const id = await createStuckUpload('stored', 3);

      // Run reconciliation
      await reconcileMissingEvents(db);

      // Verify: Record remains in 'stored' state
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('stored');
    });
  });

  describe('Orphaned Intent Cleanup', () => {
    it('should delete records in initiated state older than 1 hour', async () => {
      // Create old record in 'initiated' state (>1 hour)
      const id = await createStuckUpload('initiated', 90); // 90 minutes

      // Run reconciliation
      await reconcileOrphanedIntents(db);

      // Verify: Record should be deleted
      const record = await getRecordState(id);
      expect(record).toBeUndefined();
    });

    it('should not delete recent initiated records (< 1 hour)', async () => {
      // Create recent record in 'initiated' state (< 1 hour)
      const id = await createStuckUpload('initiated', 30); // 30 minutes

      // Run reconciliation
      await reconcileOrphanedIntents(db);

      // Verify: Record should still exist
      const record = await getRecordState(id);
      expect(record).toBeDefined();
      expect(record?.uploadState).toBe('initiated');
    });

    it('should only delete initiated records, not other states', async () => {
      // Create old records in various states
      const initiatedId = await createStuckUpload('initiated', 90);
      const uploadingId = await createStuckUpload('uploading', 90);
      const storedId = await createStuckUpload('stored', 90);

      // Run reconciliation
      await reconcileOrphanedIntents(db);

      // Verify: Only initiated record deleted
      expect(await getRecordState(initiatedId)).toBeUndefined();
      expect(await getRecordState(uploadingId)).toBeDefined();
      expect(await getRecordState(storedId)).toBeDefined();
    });

    it('should handle cleanup of multiple orphaned intents', async () => {
      // Create 10 old initiated records
      const ids = await Promise.all(
        Array.from({ length: 10 }, () => createStuckUpload('initiated', 90))
      );

      // Run reconciliation
      await reconcileOrphanedIntents(db);

      // Verify: All records deleted
      for (const id of ids) {
        const record = await getRecordState(id);
        expect(record).toBeUndefined();
      }
    });
  });

  describe('Orphaned MinIO Object Cleanup', () => {
    it('should delete MinIO objects without database records', async () => {
      // Create orphaned MinIO object (no DB record)
      const id = await createOrphanedMinioObject();

      // Verify file exists before cleanup
      expect(await minioObjectExists(id)).toBe(true);

      // Run reconciliation
      const config = getTestConfig();
      await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

      // Verify: MinIO object should be deleted
      expect(await minioObjectExists(id)).toBe(false);
    });

    it('should delete MinIO objects with failed database records', async () => {
      // Create MinIO object
      const id = await createOrphanedMinioObject();

      // Create corresponding 'failed' DB record
      await db.insert(wallpapers).values({
        id,
        userId: 'test-user',
        contentHash: `hash_${id}`,
        uploadState: 'failed',
        stateChangedAt: new Date(),
        uploadAttempts: 3,
        processingError: 'Upload failed',
      });

      // Verify file exists before cleanup
      expect(await minioObjectExists(id)).toBe(true);

      // Run reconciliation
      const config = getTestConfig();
      await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

      // Verify: MinIO object should be deleted
      expect(await minioObjectExists(id)).toBe(false);
    });

    it('should preserve MinIO objects with valid database records', async () => {
      // Create record with MinIO file
      const id = await createStuckUpload('stored', 5, {
        hasMinioFile: true,
      });

      // Verify file exists before cleanup
      expect(await minioObjectExists(id)).toBe(true);

      // Run reconciliation
      const config = getTestConfig();
      await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

      // Verify: MinIO object should still exist
      expect(await minioObjectExists(id)).toBe(true);
    });

    it('should handle batching for large number of objects', async () => {
      // Create 20 orphaned MinIO objects
      const ids = await Promise.all(Array.from({ length: 20 }, () => createOrphanedMinioObject()));

      // Run reconciliation
      const config = getTestConfig();
      await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

      // Verify: All orphaned objects deleted
      for (const id of ids) {
        expect(await minioObjectExists(id)).toBe(false);
      }
    });

    it('should handle mixed scenario with valid and orphaned objects', async () => {
      // Create valid upload with MinIO file
      const validId = await createStuckUpload('processing', 5, {
        hasMinioFile: true,
      });

      // Create orphaned MinIO objects
      const orphanedIds = await Promise.all([
        createOrphanedMinioObject(),
        createOrphanedMinioObject(),
        createOrphanedMinioObject(),
      ]);

      // Run reconciliation
      const config = getTestConfig();
      await reconcileOrphanedMinioObjects(config.s3Bucket, db, s3Client);

      // Verify: Valid object preserved
      expect(await minioObjectExists(validId)).toBe(true);

      // Verify: Orphaned objects deleted
      for (const id of orphanedIds) {
        expect(await minioObjectExists(id)).toBe(false);
      }
    });
  });
});
