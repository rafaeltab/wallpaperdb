import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { NatsConnection, JetStreamClient } from 'nats';
import { getTestConfig } from './setup.js';
import { createNatsConnection, closeNatsConnection } from '../src/connections/nats.js';
import { type NewWallpaper, wallpapers } from '../src/db/schema.js';
import { ulid } from 'ulid';
import {
  reconcileStuckUploads,
  reconcileMissingEvents,
  reconcileOrphanedIntents,
} from '../src/services/reconciliation.service.js';
import { createTestImage, generateContentHash } from './fixtures.js';
import * as schema from '../src/db/schema.js';

/**
 * Multi-Instance Safety Tests
 *
 * These tests verify that multiple service instances can run reconciliation
 * simultaneously without conflicts, race conditions, or duplicate processing.
 *
 * CRITICAL CHECKS:
 * 1. No records are processed more than once (detect duplicate work)
 * 2. No records are skipped (all records processed)
 * 3. No database constraint violations occur
 * 4. State machine consistency is maintained
 * 5. NATS events published exactly once per record
 * 6. Database updates happen exactly once per record
 */

describe('Multi-Instance Safety Tests', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
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
      // Bucket already exists, ignore
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
      // Stream might already exist, ignore
    }
  });

  afterAll(async () => {
    await closeNatsConnection();
    await pool.end();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await db.delete(wallpapers);

    // Clean up MinIO bucket
    try {
      const listResponse = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: config.s3Bucket,
        })
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
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
    } catch (error) {
      // Ignore cleanup errors
    }

    // Clean up NATS stream before each test
    try {
      const jsm = await natsClient.jetstreamManager();
      await jsm.streams.purge(config.natsStream);
    } catch (error) {
      // Stream might not exist, ignore
    }
  });

  it('should handle concurrent stuck upload recovery without duplicates', async () => {
    // Create 20 stuck uploads (in 'uploading' state for >10 minutes)
    const stuckUploads: string[] = [];
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    for (let i = 0; i < 20; i++) {
      const id = `wlpr_test_stuck_${i}_${ulid()}`;
      const storageKey = `${id}/original.jpg`;

      // Upload file to MinIO first
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: storageKey,
          Body: testImage,
          ContentType: 'image/jpeg',
        })
      );

      // Insert stuck upload record
      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'uploading',
        stateChangedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
        uploadAttempts: 0,
        contentHash: `${generateContentHash(testImage)}_${i}`, // Unique hash per record
      });

      stuckUploads.push(id);
    }

    // Simulate 3 instances running reconciliation concurrently
    const workers = [
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
    ];

    await Promise.all(workers);

    // Verify: All 20 records should be in 'stored' state
    const storedRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    expect(storedRecords.length).toBe(20);

    // Verify: No records left in 'uploading' state
    const uploadingRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'uploading'));

    expect(uploadingRecords.length).toBe(0);

    // Verify: All original IDs are accounted for
    const recoveredIds = storedRecords.map((r) => r.id).sort();
    const expectedIds = stuckUploads.sort();
    expect(recoveredIds).toEqual(expectedIds);
  });

  it('should handle concurrent missing event publishing without duplicates', async () => {
    // Create 30 records in 'stored' state (awaiting NATS publish)
    const storedRecords: string[] = [];

    for (let i = 0; i < 30; i++) {
      const id = `wlpr_test_stored_${i}_${ulid()}`;
      const storageKey = `${id}/original.jpg`;

      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'stored',
        stateChangedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        uploadAttempts: 0,
        contentHash: `hash_stored_${i}`,
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        storageKey,
        storageBucket: config.s3Bucket,
        originalFilename: `test_${i}.jpg`,
      });

      storedRecords.push(id);
    }

    // Simulate 3 instances running event publishing concurrently
    const workers = [
      reconcileMissingEvents(db),
      reconcileMissingEvents(db),
      reconcileMissingEvents(db),
    ];

    await Promise.all(workers);

    // Verify: All 30 records should be in 'processing' state
    const processingRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'processing'));

    expect(processingRecords.length).toBe(30);

    // Verify: No records left in 'stored' state
    const stillStoredRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    expect(stillStoredRecords.length).toBe(0);

    // Verify: All original IDs are accounted for
    const publishedIds = processingRecords.map((r) => r.id).sort();
    const expectedIds = storedRecords.sort();
    expect(publishedIds).toEqual(expectedIds);

    // CRITICAL: Check for duplicate NATS events
    // Give NATS a moment to process all messages
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get stream info to count total messages
    const jsm = await natsClient.jetstreamManager();
    const streamInfo = await jsm.streams.info(config.natsStream);
    const totalMessages = streamInfo.state.messages;

    // Should have exactly 30 messages, NOT 90 (30 * 3 workers)
    // This is the CRITICAL check for duplicate event publishing
    expect(totalMessages).toBe(30);
  });

  it('should handle concurrent orphaned intent cleanup without errors', async () => {
    // Create 15 orphaned intents (in 'initiated' state for >1 hour)
    const orphanedIntents: string[] = [];

    for (let i = 0; i < 15; i++) {
      const id = `wlpr_test_intent_${i}_${ulid()}`;

      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'initiated',
        stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        uploadAttempts: 0,
        contentHash: `hash_intent_${i}`,
      });

      orphanedIntents.push(id);
    }

    // Simulate 2 instances running cleanup concurrently
    const workers = [reconcileOrphanedIntents(db), reconcileOrphanedIntents(db)];

    await Promise.all(workers);

    // Verify: All intents deleted (no errors from double deletion)
    const remainingIntents = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'initiated'));

    expect(remainingIntents.length).toBe(0);

    // Verify: No records exist with the original IDs
    const totalRecords = await db.select().from(wallpapers);
    expect(totalRecords.length).toBe(0);
  });

  it('should handle race conditions with 5 concurrent workers (stress test)', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Create 50 stuck uploads (in 'uploading' state)
    const uploadingIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `wlpr_stress_uploading_${i}_${ulid()}`;
      const storageKey = `${id}/original.jpg`;

      // Upload file to MinIO
      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: storageKey,
          Body: testImage,
          ContentType: 'image/jpeg',
        })
      );

      // Insert stuck in 'uploading'
      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'uploading',
        stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_uploading_${i}`,
      });

      uploadingIds.push(id);
    }

    // Create 30 stuck in 'stored' state
    const storedIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `wlpr_stress_stored_${i}_${ulid()}`;
      const storageKey = `${id}/original.jpg`;

      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'stored',
        stateChangedAt: new Date(Date.now() - 10 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_stored_${i}`,
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 1024,
        width: 1920,
        height: 1080,
        storageKey,
        storageBucket: config.s3Bucket,
        originalFilename: `test_${i}.jpg`,
      });

      storedIds.push(id);
    }

    // Create 20 orphaned intents
    const intentIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `wlpr_stress_intent_${i}_${ulid()}`;

      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'initiated',
        stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_intent_${i}`,
      });

      intentIds.push(id);
    }

    // Simulate 5 workers running ALL reconciliation functions concurrently
    const workers: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      workers.push(
        (async () => {
          await reconcileStuckUploads(config.s3Bucket, db, s3Client);
          await reconcileMissingEvents(db);
          await reconcileOrphanedIntents(db);
        })()
      );
    }

    await Promise.all(workers);

    // Verify final states
    const storedRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'stored'));

    const processingRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'processing'));

    const initiatedRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'initiated'));

    const uploadingRecords = await db
      .select()
      .from(wallpapers)
      .where(eq(wallpapers.uploadState, 'uploading'));

    // 50 uploading → stored (awaiting NATS)
    expect(storedRecords.length).toBe(50);

    // 30 stored → processing (NATS published)
    expect(processingRecords.length).toBe(30);

    // 20 intents → deleted
    expect(initiatedRecords.length).toBe(0);

    // No uploads should remain in 'uploading'
    expect(uploadingRecords.length).toBe(0);

    // Total should be 80 (50 stored + 30 processing)
    const totalRecords = await db.select().from(wallpapers);
    expect(totalRecords.length).toBe(80);

    // Verify all IDs are accounted for (no duplicates, no missing)
    const allRecordIds = totalRecords.map((r) => r.id).sort();
    const expectedIds = [...uploadingIds, ...storedIds].sort();
    expect(allRecordIds).toEqual(expectedIds);

    // CRITICAL: Check for duplicate NATS events
    // 30 wallpapers moved to 'processing', so exactly 30 NATS events should exist
    // NOT 150 (30 * 5 workers)
    await new Promise((resolve) => setTimeout(resolve, 500));

    const jsm = await natsClient.jetstreamManager();
    const streamInfo = await jsm.streams.info(config.natsStream);
    const totalMessages = streamInfo.state.messages;

    // Should have exactly 30 messages, NOT 150 (30 * 5 workers)
    expect(totalMessages).toBe(30);
  });

  it('should not create duplicate records when multiple instances process same upload', async () => {
    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });

    // Create 10 stuck uploads
    for (let i = 0; i < 10; i++) {
      const id = `wlpr_test_dup_${i}_${ulid()}`;
      const storageKey = `${id}/original.jpg`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3Bucket,
          Key: storageKey,
          Body: testImage,
          ContentType: 'image/jpeg',
        })
      );

      await db.insert(wallpapers).values({
        id,
        userId: 'user_test',
        uploadState: 'uploading',
        stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
        uploadAttempts: 0,
        contentHash: `hash_${i}`,
      });
    }

    // Run 4 workers simultaneously (high concurrency)
    const workers = [
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
      reconcileStuckUploads(config.s3Bucket, db, s3Client),
    ];

    await Promise.all(workers);

    // Verify exactly 10 records (no duplicates created)
    const allRecords = await db.select().from(wallpapers);
    expect(allRecords.length).toBe(10);

    // Verify all are in 'stored' state
    expect(allRecords.every((r) => r.uploadState === 'stored')).toBe(true);
  });

  it('should maintain state machine consistency under concurrent updates', async () => {
    // Create records in various states
    const states = [
      { state: 'uploading' as const, count: 10, stateAge: 15 * 60 * 1000 },
      { state: 'stored' as const, count: 10, stateAge: 10 * 60 * 1000 },
      { state: 'initiated' as const, count: 10, stateAge: 2 * 60 * 60 * 1000 },
    ];

    const testImage = await createTestImage({ width: 1920, height: 1080, format: 'jpeg' });
    let recordCount = 0;

    for (const { state, count, stateAge } of states) {
      for (let i = 0; i < count; i++) {
        const id = `wlpr_consistency_${state}_${i}_${ulid()}`;
        const storageKey = `${id}/original.jpg`;

        if (state === 'uploading') {
          // Upload to MinIO for stuck uploads
          await s3Client.send(
            new PutObjectCommand({
              Bucket: config.s3Bucket,
              Key: storageKey,
              Body: testImage,
              ContentType: 'image/jpeg',
            })
          );
        }

        const values: NewWallpaper = {
          id,
          userId: 'user_test',
          uploadState: state,
          stateChangedAt: new Date(Date.now() - stateAge),
          uploadAttempts: 0,
          contentHash: `hash_${state}_${i}`,
        };

        // Add required fields for 'stored' state
        if (state === 'stored') {
          values.fileType = 'image';
          values.mimeType = 'image/jpeg';
          values.fileSizeBytes = 1024;
          values.width = 1920;
          values.height = 1080;
          values.storageKey = storageKey;
          values.storageBucket = config.s3Bucket;
          values.originalFilename = `test_${i}.jpg`;
        }

        await db.insert(wallpapers).values(values);
        recordCount++;
      }
    }

    // Run 3 workers doing all reconciliation tasks
    const workers: Promise<void>[] = [];
    for (let i = 0; i < 3; i++) {
      workers.push(
        (async () => {
          await reconcileStuckUploads(config.s3Bucket, db, s3Client);
          await reconcileMissingEvents(db);
          await reconcileOrphanedIntents(db);
        })()
      );
    }

    await Promise.all(workers);

    // Verify state transitions are valid
    const allRecords = await db.select().from(wallpapers);

    for (const record of allRecords) {
      // Valid end states after reconciliation
      const validStates = ['stored', 'processing'];
      expect(validStates).toContain(record.uploadState);

      // Verify required fields are populated for non-initial states
      if (record.uploadState === 'stored' || record.uploadState === 'processing') {
        expect(record.fileType).toBeDefined();
        expect(record.mimeType).toBeDefined();
        expect(record.storageKey).toBeDefined();
      }
    }

    // Verify final counts
    // 10 uploading → stored
    // 10 stored → processing
    // 10 initiated → deleted
    const storedCount = allRecords.filter((r) => r.uploadState === 'stored').length;
    const processingCount = allRecords.filter((r) => r.uploadState === 'processing').length;

    expect(storedCount).toBe(10);
    expect(processingCount).toBe(10);
    expect(allRecords.length).toBe(20); // 30 - 10 deleted intents
  });
});
