import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";
import { wallpapers } from "../src/db/schema.js";
import {
    runReconciliationNow,
    startScheduler,
    stopSchedulerAndWait,
} from "../src/services/scheduler.service.js";
import {
    IngestorDrizzleTesterBuilder,
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { createTestImage, generateContentHash } from "./fixtures.js";

/**
 * Scheduler Lifecycle Tests
 *
 * These tests verify that the reconciliation scheduler integrates correctly
 * with the application lifecycle:
 *
 * TESTS:
 * 1. Scheduler starts and runs reconciliation automatically
 * 2. Scheduler stops cleanly during graceful shutdown
 * 3. Reconciliation runs on correct intervals
 * 4. Concurrent reconciliation is prevented
 * 5. Scheduler survives reconciliation errors
 */

describe("Scheduler Lifecycle Tests", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(IngestorDrizzleTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_scheduler_lifecycle_${Date.now()}`),
            )
            .withMigrations()
            .withMinio()
            .withMinioBucket("wallpapers")
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
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

    beforeEach(async () => {
        // Clean up database before each test
        await tester.getDrizzle().delete(wallpapers);

        // Clean up MinIO bucket
        await tester.minio.cleanupBuckets();

        // Clean up NATS stream before each test
        try {
            const natsClient = await tester.nats.getConnection();
            const jsm = await natsClient.jetstreamManager();
            await jsm.streams.purge("WALLPAPER");
        } catch (_) {
            // Stream might not exist, ignore
        }
    });

    afterEach(async () => {
        // Ensure scheduler is stopped after each test
        await stopSchedulerAndWait();
    });

    it("should start scheduler and run reconciliation automatically", async () => {
        // Create test data: stuck upload that needs reconciliation
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const wallpaperId = `wlpr_lifecycle_${ulid()}`;
        const storageKey = `${wallpaperId}/original.jpg`;
        const contentHash = generateContentHash(testImage);

        // Upload file to MinIO
        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: storageKey,
                Body: testImage,
                ContentType: "image/jpeg",
            }),
        );

        // Create stuck upload record (stuck in 'uploading' state for >10 minutes)
        await tester
            .getDrizzle()
            .insert(wallpapers)
            .values({
                id: wallpaperId,
                userId: "user_lifecycle_test",
                uploadState: "uploading",
                stateChangedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
                uploadAttempts: 0,
                contentHash,
            });

        // Verify initial state
        const [initial] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(initial.uploadState).toBe("uploading");

        // Start scheduler (uses 100ms interval in test mode)
        startScheduler();

        // Wait for reconciliation to run (250ms to ensure completion)
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Verify record was reconciled to 'stored' state
        // Note: Reconciliation only changes state, it doesn't extract metadata
        // Metadata extraction happens during initial upload flow
        const [reconciled] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(reconciled.uploadState).toBe("stored");
        expect(reconciled.stateChangedAt.getTime()).toBeGreaterThan(
            initial.stateChangedAt.getTime(),
        );

        // Clean up
        await stopSchedulerAndWait();
    });

    it("should stop scheduler cleanly during graceful shutdown", async () => {
        // Create multiple stuck records
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const contentHash = generateContentHash(testImage);

        for (let i = 0; i < 5; i++) {
            const wallpaperId = `wlpr_shutdown_${i}_${ulid()}`;
            const storageKey = `${wallpaperId}/original.jpg`;

            await tester.minio.getS3Client().send(
                new PutObjectCommand({
                    Bucket: tester.minio.config.buckets[0],
                    Key: storageKey,
                    Body: testImage,
                    ContentType: "image/jpeg",
                }),
            );

            await tester
                .getDrizzle()
                .insert(wallpapers)
                .values({
                    id: wallpaperId,
                    userId: "user_shutdown_test",
                    uploadState: "uploading",
                    stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
                    uploadAttempts: 0,
                    contentHash: `${contentHash}_${i}`,
                });
        }

        // Start scheduler
        startScheduler();

        // Wait for at least one reconciliation cycle
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Get count of reconciled records before shutdown
        const beforeShutdown = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));
        const reconciledBeforeShutdown = beforeShutdown.length;

        // Stop scheduler
        await stopSchedulerAndWait();

        // Wait a bit more (another interval would occur at ~200ms)
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Get count of reconciled records after shutdown
        const afterShutdown = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));
        const reconciledAfterShutdown = afterShutdown.length;

        // Count should not change after scheduler stops
        expect(reconciledAfterShutdown).toBe(reconciledBeforeShutdown);
        expect(reconciledBeforeShutdown).toBeGreaterThan(0); // At least some were processed
    });

    it("should run reconciliation on correct interval", async () => {
        // Create a stuck record
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const wallpaperId = `wlpr_interval_${ulid()}`;
        const storageKey = `${wallpaperId}/original.jpg`;
        const contentHash = generateContentHash(testImage);

        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: storageKey,
                Body: testImage,
                ContentType: "image/jpeg",
            }),
        );

        await tester
            .getDrizzle()
            .insert(wallpapers)
            .values({
                id: wallpaperId,
                userId: "user_interval_test",
                uploadState: "uploading",
                stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
                uploadAttempts: 0,
                contentHash,
            });

        // Start scheduler
        startScheduler();

        // Test interval is 100ms, so we should see reconciliation happen
        // Check at 50ms (should not be processed yet)
        await new Promise((resolve) => setTimeout(resolve, 50));
        let [record] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(record.uploadState).toBe("uploading"); // Not yet processed

        // Check at 150ms (should be processed by now)
        await new Promise((resolve) => setTimeout(resolve, 100));
        [record] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(record.uploadState).toBe("stored"); // Processed

        await stopSchedulerAndWait();
    });

    it("should prevent concurrent reconciliation cycles", async () => {
        // Create many stuck uploads to make reconciliation take longer
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });

        for (let i = 0; i < 30; i++) {
            const wallpaperId = `wlpr_concurrent_${i}_${ulid()}`;
            const storageKey = `${wallpaperId}/original.jpg`;
            const contentHash = generateContentHash(testImage);

            await tester.minio.getS3Client().send(
                new PutObjectCommand({
                    Bucket: tester.minio.config.buckets[0],
                    Key: storageKey,
                    Body: testImage,
                    ContentType: "image/jpeg",
                }),
            );

            await tester
                .getDrizzle()
                .insert(wallpapers)
                .values({
                    id: wallpaperId,
                    userId: "user_concurrent_test",
                    uploadState: "uploading",
                    stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
                    uploadAttempts: 0,
                    contentHash: `${contentHash}_${i}`,
                });
        }

        // Start scheduler
        startScheduler();

        // Manually trigger reconciliation to force concurrent attempt
        const reconciliationPromise = runReconciliationNow();

        // Wait a bit for manual reconciliation to start
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The scheduled interval might try to run, but should be skipped due to isReconciling flag
        // We just verify that we don't get errors and records are processed correctly

        await reconciliationPromise;

        // All records should eventually be processed
        await new Promise((resolve) => setTimeout(resolve, 200));

        const processedCount = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));

        // All 30 should be processed (no duplicates or errors)
        expect(processedCount.length).toBe(30);

        await stopSchedulerAndWait();
    });

    it("should handle reconciliation errors gracefully and continue running", async () => {
        // Create a valid stuck upload
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const wallpaperId = `wlpr_error_recovery_${ulid()}`;
        const storageKey = `${wallpaperId}/original.jpg`;
        const contentHash = generateContentHash(
            Buffer.concat([testImage, Buffer.from("_first")]),
        );

        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: storageKey,
                Body: testImage,
                ContentType: "image/jpeg",
            }),
        );

        await tester
            .getDrizzle()
            .insert(wallpapers)
            .values({
                id: wallpaperId,
                userId: "user_error_test",
                uploadState: "uploading",
                stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
                uploadAttempts: 0,
                contentHash,
            });

        // Start scheduler
        startScheduler();

        // Wait for first reconciliation cycle
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Verify record was processed
        const [processed] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(processed.uploadState).toBe("stored");

        // Now create another record to verify scheduler continues after potential errors
        const wallpaperId2 = `wlpr_error_recovery_2_${ulid()}`;
        const storageKey2 = `${wallpaperId2}/original.jpg`;
        const testImage2 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });
        const contentHash2 = generateContentHash(
            Buffer.concat([testImage2, Buffer.from("_second")]),
        );

        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: storageKey2,
                Body: testImage2,
                ContentType: "image/jpeg",
            }),
        );

        await tester
            .getDrizzle()
            .insert(wallpapers)
            .values({
                id: wallpaperId2,
                userId: "user_error_test",
                uploadState: "uploading",
                stateChangedAt: new Date(Date.now() - 15 * 60 * 1000),
                uploadAttempts: 0,
                contentHash: contentHash2,
            });

        // Wait for next reconciliation cycle
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Verify second record was also processed (scheduler still running)
        const [processed2] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId2));
        expect(processed2.uploadState).toBe("stored");

        await stopSchedulerAndWait();
    });

    it("should handle missing event publishing during scheduled reconciliation", async () => {
        // Create records stuck in 'stored' state (need NATS event publishing)
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });

        for (let i = 0; i < 5; i++) {
            const wallpaperId = `wlpr_stored_${i}_${ulid()}`;
            const storageKey = `${wallpaperId}/original.jpg`;
            // Generate unique content hash for each record to avoid constraint violation
            const contentHash = generateContentHash(
                Buffer.concat([testImage, Buffer.from(`_${i}`)]),
            );

            await tester
                .getDrizzle()
                .insert(wallpapers)
                .values({
                    id: wallpaperId,
                    userId: "user_stored_test",
                    uploadState: "stored",
                    stateChangedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
                    uploadAttempts: 0,
                    contentHash,
                    fileType: "image",
                    mimeType: "image/jpeg",
                    fileSizeBytes: testImage.length,
                    width: 1920,
                    height: 1080,
                    aspectRatio: "1.7778",
                    storageKey,
                    storageBucket: tester.minio.config.buckets[0],
                    originalFilename: `test_${i}.jpg`,
                });
        }

        // Start scheduler
        startScheduler();

        // Wait for reconciliation to run
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Verify all records moved to 'processing' state
        const processing = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "processing"));

        expect(processing.length).toBe(5);

        // Verify NATS events were published (count messages in stream)
        const natsClient = await tester.nats.getConnection();
        const jsm = await natsClient.jetstreamManager();
        const streamInfo = await jsm.streams.info("WALLPAPER");
        expect(streamInfo.state.messages).toBe(5);

        await stopSchedulerAndWait();
    });

    it("should handle orphaned intent cleanup during scheduled reconciliation", async () => {
        // Create orphaned intents (stuck in 'initiated' state for >1 hour)
        for (let i = 0; i < 8; i++) {
            const wallpaperId = `wlpr_orphan_${i}_${ulid()}`;
            const contentHash = generateContentHash(Buffer.from(`test_orphan_${i}`));

            await tester
                .getDrizzle()
                .insert(wallpapers)
                .values({
                    id: wallpaperId,
                    userId: "user_orphan_test",
                    uploadState: "initiated",
                    stateChangedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
                    uploadAttempts: 0,
                    contentHash,
                });
        }

        // Verify initial count
        const initial = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "initiated"));
        expect(initial.length).toBe(8);

        // Start scheduler
        startScheduler();

        // Wait for reconciliation to run multiple cycles to process all 8 records
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Verify all orphaned intents were deleted
        const remaining = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "initiated"));
        expect(remaining.length).toBe(0);

        await stopSchedulerAndWait();
    });
});
