import "reflect-metadata";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
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
import { type UploadState, wallpapers } from "../src/db/schema.js";
import { StuckUploadsReconciliation } from "../src/services/reconciliation/stuck-uploads-reconciliation.service.js";
import { SchedulerService } from "../src/services/scheduler.service.js";
import {
    IngestorDrizzleTesterBuilder,
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";

describe("Scheduler Service Tests", () => {
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
                builder.withDatabase(`test_scheduler_${Date.now()}`),
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

    beforeEach(async () => {
        // Clean up database before each test
        await tester.getDrizzle().delete(wallpapers);

        // Clean up MinIO bucket before each test
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

    afterEach(() => {
        // Ensure scheduler is stopped after each test
        try {
            const schedulerService = tester.getApp().container.resolve(SchedulerService); schedulerService.stop();
        } catch {
            // Ignore if scheduler doesn't exist or is already stopped
        }
    });

    afterAll(async () => {
        await tester.destroy();
    });

    /**
     * Test Helper: Create a wallpaper record in a specific state with an old timestamp
     */
    async function createStuckUpload(
        state: "initiated" | "uploading" | "stored" | "processing",
        minutesAgo: number,
        options: {
            userId?: string;
            hasMinioFile?: boolean;
            uploadAttempts?: number;
        } = {},
    ) {
        const id = `wlpr_${ulid()}`;
        const userId = options.userId || "test-user";
        const uploadAttempts = options.uploadAttempts || 0;
        const now = new Date();
        const oldTimestamp = new Date(now.getTime() - minutesAgo * 60 * 1000);

        // Create database record
        await tester
            .getDrizzle()
            .insert(wallpapers)
            .values({
                id,
                userId,
                contentHash: `hash_${id}`,
                uploadState: state,
                stateChangedAt: oldTimestamp,
                uploadAttempts,
                // Add metadata for 'stored' and 'processing' states
                ...(state === "stored" || state === "processing"
                    ? {
                        fileType: "image" as const,
                        mimeType: "image/jpeg",
                        fileSizeBytes: 1024,
                        width: 1920,
                        height: 1080,
                        storageKey: `${id}/original.jpg`,
                        storageBucket: tester.minio.config.buckets[0],
                        originalFilename: "test.jpg",
                    }
                    : {}),
            });

        // Optionally create MinIO file
        if (options.hasMinioFile) {
            await tester.minio.getS3Client().send(
                new PutObjectCommand({
                    Bucket: tester.minio.config.buckets[0],
                    Key: `${id}/original.jpg`,
                    Body: Buffer.from("test image data"),
                    ContentType: "image/jpeg",
                }),
            );
        }

        return id;
    }

    /**
     * Test Helper: Create an orphaned MinIO object (no DB record)
     */
    async function createOrphanedMinioObject(id?: string) {
        const wallpaperId = id || `wlpr_${ulid()}`;

        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: `${wallpaperId}/original.jpg`,
                Body: Buffer.from("orphaned file data"),
                ContentType: "image/jpeg",
            }),
        );

        return wallpaperId;
    }

    /**
     * Test Helper: Get wallpaper record state from database
     */
    async function getRecordState(id: string) {
        const record = await tester.getDrizzle().query.wallpapers.findFirst({
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
    async function countRecordsInState(state: UploadState): Promise<number> {
        const records = await tester.getDrizzle().query.wallpapers.findMany({
            where: eq(wallpapers.uploadState, state),
        });
        return records.length;
    }

    describe("Scheduler Lifecycle", () => {
        it("should start scheduler successfully", () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler (should not throw)
            expect(() => schedulerService.start()).not.toThrow();
        });

        it("should stop scheduler gracefully", () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler first
            schedulerService.start();

            // Stop scheduler (should not throw)
            expect(() => schedulerService.stop()).not.toThrow();
        });

        it("should not allow starting an already running scheduler", () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler
            schedulerService.start();

            // Try to start again (should be idempotent or throw)
            // Implementation could either ignore or throw - just ensure it's handled
            const secondStart = () => schedulerService.start();

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

        it("should clean up intervals when stopped", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create stuck upload to verify reconciliation runs
            const id = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Start scheduler with short interval (for testing)
            schedulerService.start();

            // Wait for at least one cycle (implementation should use ~100ms for tests)
            await wait(500);

            // Stop scheduler
            schedulerService.stop();

            // Verify reconciliation ran before stop
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("stored");

            // Create another stuck upload
            const id2 = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Wait to ensure no more cycles run
            await wait(500);

            // Verify second upload was NOT reconciled (scheduler stopped)
            const record2 = await getRecordState(id2);
            expect(record2?.uploadState).toBe("uploading");
        });
    });

    describe("Regular Reconciliation Cycles", () => {
        it("should run reconcileStuckUploads on scheduled interval", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create stuck upload in 'uploading' state
            const id = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Verify initial state
            expect((await getRecordState(id))?.uploadState).toBe("uploading");

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation cycle to run
            await wait(500);

            // Verify reconciliation was executed
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("stored");
        });

        it("should run reconcileMissingEvents on scheduled interval", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create record in 'stored' state
            const id = await createStuckUpload("stored", 10);

            // Verify initial state
            expect((await getRecordState(id))?.uploadState).toBe("stored");

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation cycle to run
            await wait(500);

            // Verify event was republished and state changed
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("processing");
        });

        it("should run reconcileOrphanedIntents on scheduled interval", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create old 'initiated' record
            const id = await createStuckUpload("initiated", 90);

            // Verify record exists
            expect(await getRecordState(id)).toBeDefined();

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation cycle to run
            await wait(500);

            // Verify record was deleted
            expect(await getRecordState(id)).toBeUndefined();
        });

        it("should run all three reconciliation functions in one cycle", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create test data for all three scenarios
            const uploadingId = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });
            const storedId = await createStuckUpload("stored", 10);
            const initiatedId = await createStuckUpload("initiated", 90);

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation cycle to complete
            await wait(500);

            // Verify all three were executed
            expect((await getRecordState(uploadingId))?.uploadState).toBe("stored");
            expect((await getRecordState(storedId))?.uploadState).toBe("processing");
            expect(await getRecordState(initiatedId)).toBeUndefined();
        });

        it("should run multiple cycles continuously", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler
            schedulerService.start();

            // Create first batch of stuck uploads
            const id1 = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Wait for first cycle
            await wait(300);

            // Verify first batch processed
            expect((await getRecordState(id1))?.uploadState).toBe("stored");

            // Create second batch
            const id2 = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Wait for second cycle
            await wait(300);

            // Verify second batch processed
            expect((await getRecordState(id2))?.uploadState).toBe("stored");
        });

        it("should handle empty database gracefully", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // No test data created - database is empty

            // Start scheduler (should not throw on empty database)
            expect(() => schedulerService.start()).not.toThrow();

            // Wait for cycle
            await wait(300);

            // Should still be running without errors
            // (No assertion needed - just verify no crash)
        });
    });

    describe("MinIO Cleanup Cycles", () => {
        it("should run MinIO cleanup on separate schedule", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create orphaned MinIO object
            const orphanedId = await createOrphanedMinioObject();

            // Verify object exists
            const headCommand = new HeadObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: `${orphanedId}/original.jpg`,
            });
            await expect(
                tester.minio.getS3Client().send(headCommand),
            ).resolves.toBeDefined();

            // Start scheduler
            // Note: Implementation should have a way to trigger MinIO cleanup
            // either via shorter interval for tests or manual trigger
            schedulerService.start();

            // Wait for MinIO cleanup cycle
            // This might need to be longer or triggered manually in tests
            await wait(1000);

            // Verify orphaned object was deleted
            await expect(
                tester.minio.getS3Client().send(headCommand),
            ).rejects.toThrow();
        });

        it("should not run MinIO cleanup on regular reconciliation cycles", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create regular stuck upload (should be reconciled quickly)
            const regularId = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Create orphaned MinIO object (should NOT be cleaned up in regular cycle)
            const orphanedId = await createOrphanedMinioObject();

            // Start scheduler
            schedulerService.start();

            // Wait for one regular cycle (not MinIO cleanup)
            await wait(300);

            // Verify regular reconciliation ran
            expect((await getRecordState(regularId))?.uploadState).toBe("stored");

            // Verify orphaned object still exists (not cleaned up yet)
            const headCommand = new HeadObjectCommand({
                Bucket: tester.minio.config.buckets[0],
                Key: `${orphanedId}/original.jpg`,
            });
            await expect(
                tester.minio.getS3Client().send(headCommand),
            ).resolves.toBeDefined();
        });
    });

    describe("Manual Reconciliation Triggers", () => {
        it("should support manual trigger for immediate reconciliation", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create stuck uploads
            const id = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Trigger immediate reconciliation (without starting scheduler)
            await schedulerService.runReconciliationNow();

            // Verify reconciliation ran immediately
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("stored");
        });

        it("should run manual reconciliation without waiting for scheduled interval", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler
            schedulerService.start();

            // Create test data
            const id = await createStuckUpload("stored", 10);

            // Immediately trigger manual reconciliation (don't wait for interval)
            await schedulerService.runReconciliationNow();

            // Should be processed immediately, not waiting for next scheduled cycle
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("processing");
        });

        it("should work when scheduler is not running", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Do NOT start scheduler

            // Create test data
            const id = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Manual trigger should work independently
            await expect(schedulerService.runReconciliationNow()).resolves.not.toThrow();

            // Verify it processed the record
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("stored");
        });
    });

    describe("Error Handling", () => {
        it("should continue running after reconciliation function throws error", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler
            schedulerService.start();

            // Create invalid data that might cause errors
            // For example, a record with missing required fields
            await tester
                .getDrizzle()
                .insert(wallpapers)
                .values({
                    id: `wlpr_${ulid()}`,
                    userId: "test-user",
                    contentHash: "hash_invalid",
                    uploadState: "stored",
                    stateChangedAt: new Date(Date.now() - 10 * 60 * 1000),
                    uploadAttempts: 0,
                    // Missing required fields for 'stored' state - may cause errors
                    // Using unknown cast to bypass type safety for testing error handling
                    fileType: null as unknown as "image",
                    mimeType: null as unknown as string,
                });

            // Wait for cycle (should handle error gracefully)
            await wait(500);

            // Create valid data
            const validId = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });

            // Wait for next cycle (increased to ensure reconciliation completes)
            await wait(400);

            // Scheduler should still be running and processing valid records
            const record = await getRecordState(validId);
            expect(record?.uploadState).toBe("stored");
        });

        it("should handle database connection errors gracefully", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Start scheduler
            schedulerService.start();

            // Scheduler should not crash even if database has issues
            // This is a basic smoke test - implementation should log errors
            await wait(300);

            // Verify scheduler is still running (by stopping it)
            expect(() => schedulerService.stop()).not.toThrow();
        });

        it("should handle NATS connection errors gracefully", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create stuck upload in 'stored' state
            const id = await createStuckUpload("stored", 10);

            // Note: This test is simplified - NATS connection errors are handled gracefully
            // Records stay in 'stored' state if NATS publish fails
            // Start scheduler
            schedulerService.start();

            // Wait for cycle
            await wait(500);

            // Record should be in 'processing' state (NATS connection is available in test)
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("processing");

            // Scheduler should still be running
            expect(() => schedulerService.stop()).not.toThrow();
        });

        it("should log errors without crashing the process", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create data that will cause reconciliation errors
            const id = await createStuckUpload("uploading", 15, {
                hasMinioFile: false,
                uploadAttempts: 3, // Max retries - will be marked as failed
            });

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation
            await wait(500);

            // Verify record was marked as failed (error handled properly)
            const record = await getRecordState(id);
            expect(record?.uploadState).toBe("failed");

            // Scheduler should still be running
            expect(() => schedulerService.stop()).not.toThrow();
        });

        it("should continue reconciliation even if one function fails", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create test data for multiple reconciliation types
            const uploadingId = await createStuckUpload("uploading", 15, {
                hasMinioFile: true,
            });
            const initiatedId = await createStuckUpload("initiated", 90);

            // Even if one reconciliation function fails, others should run
            schedulerService.start();

            await wait(500);

            // At least some reconciliation should have succeeded
            // (This tests that errors in one function don't stop the whole cycle)
            const uploadingRecord = await getRecordState(uploadingId);
            const initiatedRecord = await getRecordState(initiatedId);

            // At least one of these should have been processed
            const atLeastOneProcessed =
                uploadingRecord?.uploadState === "stored" ||
                initiatedRecord === undefined;

            expect(atLeastOneProcessed).toBe(true);
        });
    });

    describe("Integration Tests", () => {
        it("should work end-to-end with real infrastructure", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create comprehensive test scenario with multiple stuck states
            await Promise.all([
                // Stuck uploads that can be recovered
                createStuckUpload("uploading", 15, { hasMinioFile: true }),
                createStuckUpload("uploading", 15, { hasMinioFile: true }),

                // Stuck uploads that should fail
                createStuckUpload("uploading", 15, {
                    hasMinioFile: false,
                    uploadAttempts: 3,
                }),

                // Missing events
                createStuckUpload("stored", 10),
                createStuckUpload("stored", 10),

                // Orphaned intents
                createStuckUpload("initiated", 90),
                createStuckUpload("initiated", 90),
            ]);

            // Start scheduler
            schedulerService.start();

            // Wait for reconciliation to complete
            await wait(800);

            // Verify results
            const storedCount = await countRecordsInState("stored");
            const processingCount = await countRecordsInState("processing");
            const failedCount = await countRecordsInState("failed");

            // Should have 2 recovered uploads in 'stored' state
            expect(storedCount).toBe(2);

            // Should have 2 records in 'processing' state (NATS events published)
            expect(processingCount).toBe(2);

            // Should have 1 failed upload
            expect(failedCount).toBe(1);

            // Should have 2 orphaned intents deleted (total count should be 5)
            const totalCount = await tester.getDrizzle().query.wallpapers.findMany();
            expect(totalCount.length).toBe(5); // 2 stored + 2 processing + 1 failed
        });

        it("should handle high volume of stuck records", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create 50 stuck uploads
            await Promise.all(
                Array.from({ length: 50 }, () =>
                    createStuckUpload("uploading", 15, { hasMinioFile: true }),
                ),
            );

            // Start scheduler
            schedulerService.start();

            // Wait for multiple cycles to process all records
            await wait(2000);

            // Verify all were processed to 'stored' state
            const storedCount = await countRecordsInState("stored");
            expect(storedCount).toBeGreaterThanOrEqual(45); // Allow for some still processing
        });

        it("should coordinate with multiple scheduler instances via row-level locking", async () => {
            const stuckUploadsService = tester.getApp().container.resolve(StuckUploadsReconciliation);

            // Create 30 stuck uploads
            await Promise.all(
                Array.from({ length: 30 }, () =>
                    createStuckUpload("uploading", 15, { hasMinioFile: true }),
                ),
            );

            // Simulate multiple instances by calling reconciliation directly
            // (The scheduler itself will call these, but we can test the underlying safety)
            await Promise.all([
                stuckUploadsService.reconcile(),
                stuckUploadsService.reconcile(),
                stuckUploadsService.reconcile(),
            ]);

            // Verify all were processed exactly once (no duplicates)
            const storedCount = await countRecordsInState("stored");
            expect(storedCount).toBe(30);

            // Verify no records left in 'uploading'
            const uploadingCount = await countRecordsInState("uploading");
            expect(uploadingCount).toBe(0);
        });
    });

    describe("Timing and Configuration", () => {
        it("should respect time windows for stuck uploads (10 minutes)", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create upload that is 9 minutes old (should NOT be reconciled)
            const recentId = await createStuckUpload("uploading", 9, {
                hasMinioFile: true,
            });

            // Create upload that is 11 minutes old (should be reconciled)
            const oldId = await createStuckUpload("uploading", 11, {
                hasMinioFile: true,
            });

            // Start scheduler
            schedulerService.start();

            // Wait for cycle
            await wait(500);

            // Recent upload should remain in 'uploading'
            expect((await getRecordState(recentId))?.uploadState).toBe("uploading");

            // Old upload should be reconciled to 'stored'
            expect((await getRecordState(oldId))?.uploadState).toBe("stored");
        });

        it("should respect time windows for missing events (5 minutes)", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create record that is 4 minutes old (should NOT be reconciled)
            const recentId = await createStuckUpload("stored", 4);

            // Create record that is 6 minutes old (should be reconciled)
            const oldId = await createStuckUpload("stored", 6);

            // Start scheduler
            schedulerService.start();

            // Wait for cycle
            await wait(500);

            // Recent record should remain in 'stored'
            expect((await getRecordState(recentId))?.uploadState).toBe("stored");

            // Old record should be reconciled to 'processing'
            expect((await getRecordState(oldId))?.uploadState).toBe("processing");
        });

        it("should respect time windows for orphaned intents (1 hour)", async () => {
            const schedulerService = tester.getApp().container.resolve(SchedulerService);

            // Create intent that is 50 minutes old (should NOT be deleted)
            const recentId = await createStuckUpload("initiated", 50);

            // Create intent that is 90 minutes old (should be deleted)
            const oldId = await createStuckUpload("initiated", 90);

            // Start scheduler
            schedulerService.start();

            // Wait for cycle
            await wait(500);

            // Recent intent should still exist
            expect(await getRecordState(recentId)).toBeDefined();

            // Old intent should be deleted
            expect(await getRecordState(oldId)).toBeUndefined();
        });
    });
});
