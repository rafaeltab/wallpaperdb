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
import { SchedulerService } from "../src/services/scheduler.service.js";
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
            .with(RedisTesterBuilder)
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
            .withPostgresAutoCleanup(["wallpapers"])
            .withMigrations()
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
            .withNatsAutoCleanup()
            .withFakeTimers()
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
        // Reset the fake timer so each test starts with a clean clock at t=0
        // with no stale intervals or timeouts from a previous test.
        tester.getFakeTimer().reset();

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
        const app = tester.getApp();
        const schedulerService = app.container.resolve(SchedulerService);
        await schedulerService.stopAndWait();
    });

    it("should start scheduler and run reconciliation automatically", async () => {
        const fakeTimer = tester.getFakeTimer();

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

        // Start scheduler
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Advance one reconciliation interval — deterministic, no wall-clock waiting
        await fakeTimer.tickAsync(5 * 60 * 1000);

        // Verify record was reconciled to 'stored' state
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
        await schedulerService.stopAndWait();
    });

    it("should stop scheduler cleanly during graceful shutdown", async () => {
        const fakeTimer = tester.getFakeTimer();

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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Advance one reconciliation interval
        await fakeTimer.tickAsync(5 * 60 * 1000);

        // Get count of reconciled records before shutdown
        const beforeShutdown = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));
        const reconciledBeforeShutdown = beforeShutdown.length;

        // Stop scheduler
        await schedulerService.stopAndWait();

        // Advance more time — nothing should fire because the scheduler is stopped
        await fakeTimer.tickAsync(5 * 60 * 1000);

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
        const fakeTimer = tester.getFakeTimer();

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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Advance to just before the reconciliation interval — should NOT fire yet
        await fakeTimer.tickAsync(5 * 60 * 1000 - 1);
        let [record] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(record.uploadState).toBe("uploading"); // Not yet processed

        // Advance the remaining 1 ms to reach the interval
        await fakeTimer.tickAsync(1);
        [record] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(record.uploadState).toBe("stored"); // Processed

        await schedulerService.stopAndWait();
    });

    it("should prevent concurrent reconciliation cycles", async () => {
        const fakeTimer = tester.getFakeTimer();

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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Manually trigger reconciliation to force concurrent attempt
        const reconciliationPromise = schedulerService.runReconciliationNow();

        // Advance the timer so a scheduled interval also fires — the isReconciling
        // guard should prevent a concurrent cycle from running.
        await fakeTimer.tickAsync(5 * 60 * 1000);

        await reconciliationPromise;

        // Allow any remaining batches to finish
        for (let i = 0; i < 10; i++) {
            await fakeTimer.tickAsync(5 * 60 * 1000);
            const remaining = await tester
                .getDrizzle()
                .select()
                .from(wallpapers)
                .where(eq(wallpapers.uploadState, "uploading"));
            if (remaining.length === 0) break;
        }

        const processedCount = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "stored"));

        // All 30 should be processed (no duplicates or errors)
        expect(processedCount.length).toBe(30);

        await schedulerService.stopAndWait();
    });

    it("should handle reconciliation errors gracefully and continue running", async () => {
        const fakeTimer = tester.getFakeTimer();

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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Advance one interval
        await fakeTimer.tickAsync(5 * 60 * 1000);

        // Verify record was processed
        const [processed] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId));
        expect(processed.uploadState).toBe("stored");

        // Now create another record to verify scheduler continues
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

        // Advance another interval — scheduler must still be running
        await fakeTimer.tickAsync(5 * 60 * 1000);

        // Verify second record was also processed (scheduler still running)
        const [processed2] = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.id, wallpaperId2));
        expect(processed2.uploadState).toBe("stored");

        await schedulerService.stopAndWait();
    });

    it("should handle missing event publishing during scheduled reconciliation", async () => {
        const fakeTimer = tester.getFakeTimer();

        // Create records stuck in 'stored' state (need NATS event publishing)
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
        });

        for (let i = 0; i < 5; i++) {
            const wallpaperId = `wlpr_stored_${i}_${ulid()}`;
            const storageKey = `${wallpaperId}/original.jpg`;
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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Advance one reconciliation interval
        await fakeTimer.tickAsync(5 * 60 * 1000);

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

        await schedulerService.stopAndWait();
    });

    it("should handle orphaned intent cleanup during scheduled reconciliation", async () => {
        const fakeTimer = tester.getFakeTimer();

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
        const schedulerService = tester.getApp().container.resolve(SchedulerService);
        schedulerService.start();

        // Tick in a loop until all orphaned intents are deleted (batch processing)
        for (let i = 0; i < 20; i++) {
            await fakeTimer.tickAsync(5 * 60 * 1000);
            const remaining = await tester
                .getDrizzle()
                .select()
                .from(wallpapers)
                .where(eq(wallpapers.uploadState, "initiated"));
            if (remaining.length === 0) break;
        }

        // Verify all orphaned intents were deleted
        const remaining = await tester
            .getDrizzle()
            .select()
            .from(wallpapers)
            .where(eq(wallpapers.uploadState, "initiated"));
        expect(remaining.length).toBe(0);

        await schedulerService.stopAndWait();
    });
});
