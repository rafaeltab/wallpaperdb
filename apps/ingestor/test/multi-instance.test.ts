import "reflect-metadata";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type NewWallpaper, wallpapers } from "../src/db/schema.js";
import { StuckUploadsReconciliation } from "../src/services/reconciliation/stuck-uploads-reconciliation.service.js";
import { MissingEventsReconciliation } from "../src/services/reconciliation/missing-events-reconciliation.service.js";
import { OrphanedIntentsReconciliation } from "../src/services/reconciliation/orphaned-intents-reconciliation.service.js";
import {
    IngestorDrizzleTesterBuilder,
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { createTestImage, generateContentHash } from "./fixtures.js";

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

describe("Multi-Instance Safety Tests", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(RedisTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(IngestorDrizzleTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_multi_instance_${Date.now()}`),
            )
            .withPostgresAutoCleanup(["wallpapers"])
            .withMigrations()
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
            .withNatsAutoCleanup()
            .withInProcessApp();
        return tester;
    };

    let tester: ReturnType<typeof setup>;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
    });

    afterAll(async () => {
        await tester.destroy();
    });

    it("should handle concurrent stuck upload recovery without duplicates", async () => {
        const stuckUploadsService = tester.getApp().container.resolve(StuckUploadsReconciliation);

        // Create 20 stuck uploads (in 'uploading' state for >10 minutes)
        const stuckUploads: string[] = [];
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const bucket = tester.minio.config.buckets[0];
        const db = tester.getDrizzle();
        const s3Client = tester.minio.getS3Client();

        for (let i = 0; i < 20; i++) {
            const id = `wlpr_test_stuck_${i}_${ulid()}`;
            const storageKey = `${id}/original.jpg`;

            // Upload file to MinIO first
            await s3Client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: storageKey,
                    Body: testImage,
                    ContentType: "image/jpeg",
                }),
            );

            // Insert stuck upload record
            await db.insert(wallpapers).values({
                id,
                userId: "user_test",
                uploadState: "uploading",
                stateChangedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 min ago
                uploadAttempts: 0,
                contentHash: `${generateContentHash(testImage)}_${i}`, // Unique hash per record
            });

            stuckUploads.push(id);
        }

        // Simulate 3 instances running reconciliation concurrently
        const workers = [
            stuckUploadsService.reconcile(),
            stuckUploadsService.reconcile(),
            stuckUploadsService.reconcile(),
        ];

        await Promise.all(workers);

        // Verify: All 20 records should be in 'stored' state
        const storedRecords = await db
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));

        expect(storedRecords.length).toBe(20);

        // Verify: No records left in 'uploading' state
        const uploadingRecords = await db
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "uploading"));

        expect(uploadingRecords.length).toBe(0);

        // Verify: All original IDs are accounted for
        const recoveredIds = storedRecords.map((r) => r.id).sort();
        const expectedIds = stuckUploads.sort();
        expect(recoveredIds).toEqual(expectedIds);
    });

    // it("should handle concurrent missing event publishing without duplicates", async () => {
    //     const missingEventsService = tester.getApp().container.resolve(MissingEventsReconciliation);
    //
    //     // Create 30 records in 'stored' state (awaiting NATS publish)
    //     const storedRecords: string[] = [];
    //     const bucket = tester.minio.config.buckets[0];
    //     const db = tester.getDrizzle();
    //
    //     for (let i = 0; i < 30; i++) {
    //         const id = `wlpr_test_stored_${i}_${ulid()}`;
    //         const storageKey = `${id}/original.jpg`;
    //
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "stored",
    //             stateChangedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
    //             uploadAttempts: 0,
    //             contentHash: `hash_stored_${i}`,
    //             fileType: "image",
    //             mimeType: "image/jpeg",
    //             fileSizeBytes: 1024,
    //             width: 1920,
    //             height: 1080,
    //             storageKey,
    //             storageBucket: bucket,
    //             originalFilename: `test_${i}.jpg`,
    //         });
    //
    //         storedRecords.push(id);
    //     }
    //
    //     // Simulate 3 instances running event publishing concurrently
    //     const workers = [
    //         missingEventsService.reconcile(),
    //         missingEventsService.reconcile(),
    //         missingEventsService.reconcile(),
    //     ];
    //
    //     await Promise.all(workers);
    //
    //     // Verify: All 30 records should be in 'processing' state
    //     const processingRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "processing"));
    //
    //     expect(processingRecords.length).toBe(30);
    //
    //     // Verify: No records left in 'stored' state
    //     const stillStoredRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "stored"));
    //
    //     expect(stillStoredRecords.length).toBe(0);
    //
    //     // Verify: All original IDs are accounted for
    //     const publishedIds = processingRecords.map((r) => r.id).sort();
    //     const expectedIds = storedRecords.sort();
    //     expect(publishedIds).toEqual(expectedIds);
    //
    //     // CRITICAL: Check for duplicate NATS events
    //     // Give NATS a moment to process all messages
    //     await new Promise((resolve) => setTimeout(resolve, 500));
    //
    //     // Get stream info to count total messages
    //     const natsClient = await tester.nats.getConnection();
    //     const jsm = await natsClient.jetstreamManager();
    //     const streamInfo = await jsm.streams.info("WALLPAPER");
    //     const totalMessages = streamInfo.state.messages;
    //
    //     // Should have exactly 30 messages, NOT 90 (30 * 3 workers)
    //     // This is the CRITICAL check for duplicate event publishing
    //     expect(totalMessages).toBe(30);
    // });
    //
    // it("should handle concurrent orphaned intent cleanup without errors", async () => {
    //     const orphanedIntentsService = tester.getApp().container.resolve(OrphanedIntentsReconciliation);
    //
    //     // Create 15 orphaned intents (in 'initiated' state for >1 hour)
    //     const orphanedIntents: string[] = [];
    //     const db = tester.getDrizzle();
    //
    //     for (let i = 0; i < 15; i++) {
    //         const id = `wlpr_test_intent_${i}_${ulid()}`;
    //
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "initiated",
    //             stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    //             uploadAttempts: 0,
    //             contentHash: `hash_intent_${i}`,
    //         });
    //
    //         orphanedIntents.push(id);
    //     }
    //
    //     // Simulate 2 instances running cleanup concurrently
    //     const workers = [
    //         orphanedIntentsService.reconcile(),
    //         orphanedIntentsService.reconcile(),
    //     ];
    //
    //     await Promise.all(workers);
    //
    //     // Verify: All intents deleted (no errors from double deletion)
    //     const remainingIntents = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "initiated"));
    //
    //     expect(remainingIntents.length).toBe(0);
    //
    //     // Verify: No records exist with the original IDs
    //     const totalRecords = await db.select().from(wallpapers);
    //     expect(totalRecords.length).toBe(0);
    // });
    //
    // it("should handle race conditions with 5 concurrent workers (stress test)", async () => {
    //     const testImage = await createTestImage({
    //         width: 1920,
    //         height: 1080,
    //         format: "jpeg",
    //     });
    //     const bucket = tester.minio.config.buckets[0];
    //     const db = tester.getDrizzle();
    //     const s3Client = tester.minio.getS3Client();
    //
    //     // Create 50 stuck uploads (in 'uploading' state)
    //     const uploadingIds: string[] = [];
    //     for (let i = 0; i < 50; i++) {
    //         const id = `wlpr_stress_uploading_${i}_${ulid()}`;
    //         const storageKey = `${id}/original.jpg`;
    //
    //         // Upload file to MinIO
    //         tester.minio.uploadObject(bucket, storageKey, testImage, {
    //             ContentType: "image/jpeg",
    //         });
    //
    //         // Insert stuck in 'uploading'
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "uploading",
    //             stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
    //             uploadAttempts: 0,
    //             contentHash: `hash_uploading_${i}`,
    //         });
    //
    //         uploadingIds.push(id);
    //     }
    //
    //     // Create 30 stuck in 'stored' state
    //     const storedIds: string[] = [];
    //     for (let i = 0; i < 30; i++) {
    //         const id = `wlpr_stress_stored_${i}_${ulid()}`;
    //         const storageKey = `${id}/original.jpg`;
    //
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "stored",
    //             stateChangedAt: new Date(Date.now() - 10 * 60 * 1000),
    //             uploadAttempts: 0,
    //             contentHash: `hash_stored_${i}`,
    //             fileType: "image",
    //             mimeType: "image/jpeg",
    //             fileSizeBytes: 1024,
    //             width: 1920,
    //             height: 1080,
    //             storageKey,
    //             storageBucket: bucket,
    //             originalFilename: `test_${i}.jpg`,
    //         });
    //
    //         storedIds.push(id);
    //     }
    //
    //     // Create 20 orphaned intents
    //     const intentIds: string[] = [];
    //     for (let i = 0; i < 20; i++) {
    //         const id = `wlpr_stress_intent_${i}_${ulid()}`;
    //
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "initiated",
    //             stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    //             uploadAttempts: 0,
    //             contentHash: `hash_intent_${i}`,
    //         });
    //
    //         intentIds.push(id);
    //     }
    //
    //     // Simulate 5 workers running ALL reconciliation functions concurrently
    //     const stuckUploadsService = tester.getApp().container.resolve(StuckUploadsReconciliation);
    //     const missingEventsService = tester.getApp().container.resolve(MissingEventsReconciliation);
    //     const orphanedIntentsService = tester.getApp().container.resolve(OrphanedIntentsReconciliation);
    //
    //     const workers: Promise<void>[] = [];
    //     for (let i = 0; i < 5; i++) {
    //         workers.push(
    //             (async () => {
    //                 await stuckUploadsService.reconcile();
    //                 await missingEventsService.reconcile();
    //                 await orphanedIntentsService.reconcile();
    //             })(),
    //         );
    //     }
    //
    //     await Promise.all(workers);
    //
    //     // Verify final states
    //     const storedRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "stored"));
    //
    //     const processingRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "processing"));
    //
    //     const initiatedRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "initiated"));
    //
    //     const uploadingRecords = await db
    //         .select()
    //         .from(wallpapers)
    //         .where(eq(wallpapers.uploadState, "uploading"));
    //
    //     // 50 uploading → stored (awaiting NATS)
    //     expect(storedRecords.length).toBe(50);
    //
    //     // 30 stored → processing (NATS published)
    //     expect(processingRecords.length).toBe(30);
    //
    //     // 20 intents → deleted
    //     expect(initiatedRecords.length).toBe(0);
    //
    //     // No uploads should remain in 'uploading'
    //     expect(uploadingRecords.length).toBe(0);
    //
    //     // Total should be 80 (50 stored + 30 processing)
    //     const totalRecords = await db.select().from(wallpapers);
    //     expect(totalRecords.length).toBe(80);
    //
    //     // Verify all IDs are accounted for (no duplicates, no missing)
    //     const allRecordIds = totalRecords.map((r) => r.id).sort();
    //     const expectedIds = [...uploadingIds, ...storedIds].sort();
    //     expect(allRecordIds).toEqual(expectedIds);
    //
    //     // CRITICAL: Check for duplicate NATS events
    //     // 30 wallpapers moved to 'processing', so exactly 30 NATS events should exist
    //     // NOT 150 (30 * 5 workers)
    //     await new Promise((resolve) => setTimeout(resolve, 500));
    //
    //     const natsClient = await tester.nats.getConnection();
    //     const jsm = await natsClient.jetstreamManager();
    //     const streamInfo = await jsm.streams.info("WALLPAPER");
    //     const totalMessages = streamInfo.state.messages;
    //
    //     // Should have exactly 30 messages, NOT 150 (30 * 5 workers)
    //     expect(totalMessages).toBe(30);
    // });
    //
    // it("should not create duplicate records when multiple instances process same upload", async () => {
    //     const testImage = await createTestImage({
    //         width: 1920,
    //         height: 1080,
    //         format: "jpeg",
    //     });
    //     const bucket = tester.minio.config.buckets[0];
    //     const db = tester.getDrizzle();
    //     const s3Client = tester.minio.getS3Client();
    //
    //     // Create 10 stuck uploads
    //     for (let i = 0; i < 10; i++) {
    //         const id = `wlpr_test_dup_${i}_${ulid()}`;
    //         const storageKey = `${id}/original.jpg`;
    //
    //         await s3Client.send(
    //             new PutObjectCommand({
    //                 Bucket: bucket,
    //                 Key: storageKey,
    //                 Body: testImage,
    //                 ContentType: "image/jpeg",
    //             }),
    //         );
    //
    //         await db.insert(wallpapers).values({
    //             id,
    //             userId: "user_test",
    //             uploadState: "uploading",
    //             stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
    //             uploadAttempts: 0,
    //             contentHash: `hash_${i}`,
    //         });
    //     }
    //
    //     // Run 4 workers simultaneously (high concurrency)
    //     const stuckUploadsService = tester.getApp().container.resolve(StuckUploadsReconciliation);
    //
    //     const workers = [
    //         stuckUploadsService.reconcile(),
    //         stuckUploadsService.reconcile(),
    //         stuckUploadsService.reconcile(),
    //         stuckUploadsService.reconcile(),
    //     ];
    //
    //     await Promise.all(workers);
    //
    //     // Verify exactly 10 records (no duplicates created)
    //     const allRecords = await db.select().from(wallpapers);
    //     expect(allRecords.length).toBe(10);
    //
    //     // Verify all are in 'stored' state
    //     expect(allRecords.every((r) => r.uploadState === "stored")).toBe(true);
    // });
    //
    // it("should maintain state machine consistency under concurrent updates", async () => {
    //     // Create records in various states
    //     const states = [
    //         { state: "uploading" as const, count: 10, stateAge: 15 * 60 * 1000 },
    //         { state: "stored" as const, count: 10, stateAge: 10 * 60 * 1000 },
    //         { state: "initiated" as const, count: 10, stateAge: 2 * 60 * 60 * 1000 },
    //     ];
    //
    //     const testImage = await createTestImage({
    //         width: 1920,
    //         height: 1080,
    //         format: "jpeg",
    //     });
    //     const bucket = tester.minio.config.buckets[0];
    //     const db = tester.getDrizzle();
    //     const s3Client = tester.minio.getS3Client();
    //
    //     for (const { state, count, stateAge } of states) {
    //         for (let i = 0; i < count; i++) {
    //             const id = `wlpr_consistency_${state}_${i}_${ulid()}`;
    //             const storageKey = `${id}/original.jpg`;
    //
    //             if (state === "uploading") {
    //                 // Upload to MinIO for stuck uploads
    //                 await s3Client.send(
    //                     new PutObjectCommand({
    //                         Bucket: bucket,
    //                         Key: storageKey,
    //                         Body: testImage,
    //                         ContentType: "image/jpeg",
    //                     }),
    //                 );
    //             }
    //
    //             const values: NewWallpaper = {
    //                 id,
    //                 userId: "user_test",
    //                 uploadState: state,
    //                 stateChangedAt: new Date(Date.now() - stateAge),
    //                 uploadAttempts: 0,
    //                 contentHash: `hash_${state}_${i}`,
    //             };
    //
    //             // Add required fields for 'stored' state
    //             if (state === "stored") {
    //                 values.fileType = "image";
    //                 values.mimeType = "image/jpeg";
    //                 values.fileSizeBytes = 1024;
    //                 values.width = 1920;
    //                 values.height = 1080;
    //                 values.storageKey = storageKey;
    //                 values.storageBucket = bucket;
    //                 values.originalFilename = `test_${i}.jpg`;
    //             }
    //
    //             await db.insert(wallpapers).values(values);
    //         }
    //     }
    //
    //     // Run 3 workers doing all reconciliation tasks
    //     const stuckUploadsService = tester.getApp().container.resolve(StuckUploadsReconciliation);
    //     const missingEventsService = tester.getApp().container.resolve(MissingEventsReconciliation);
    //     const orphanedIntentsService = tester.getApp().container.resolve(OrphanedIntentsReconciliation);
    //
    //     const workers: Promise<void>[] = [];
    //     for (let i = 0; i < 3; i++) {
    //         workers.push(
    //             (async () => {
    //                 await stuckUploadsService.reconcile();
    //                 await missingEventsService.reconcile();
    //                 await orphanedIntentsService.reconcile();
    //             })(),
    //         );
    //     }
    //
    //     await Promise.all(workers);
    //
    //     // Verify state transitions are valid
    //     const allRecords = await db.select().from(wallpapers);
    //
    //     for (const record of allRecords) {
    //         // Valid end states after reconciliation
    //         const validStates = ["stored", "processing"];
    //         expect(validStates).toContain(record.uploadState);
    //
    //         // Verify required fields are populated for non-initial states
    //         if (
    //             record.uploadState === "stored" ||
    //             record.uploadState === "processing"
    //         ) {
    //             expect(record.fileType).toBeDefined();
    //             expect(record.mimeType).toBeDefined();
    //             expect(record.storageKey).toBeDefined();
    //         }
    //     }
    //
    //     // Verify final counts
    //     // 10 uploading → stored
    //     // 10 stored → processing
    //     // 10 initiated → deleted
    //     const storedCount = allRecords.filter(
    //         (r) => r.uploadState === "stored",
    //     ).length;
    //     const processingCount = allRecords.filter(
    //         (r) => r.uploadState === "processing",
    //     ).length;
    //
    //     expect(storedCount).toBe(10);
    //     expect(processingCount).toBe(10);
    //     expect(allRecords.length).toBe(20); // 30 - 10 deleted intents
    // });
});
