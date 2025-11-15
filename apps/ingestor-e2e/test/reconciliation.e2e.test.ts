import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import { ulid } from "ulid";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";
import { ContainerizedIngestorTesterBuilder } from "./builders/ContainerizedIngestorBuilder.js";
import { IngestorMigrationsTesterBuilder } from "./builders/IngestorMigrationsTesterBuilder.js";

// Helper to generate wallpaper ID
function generateWallpaperId(): string {
    return `wlpr_${ulid()}`;
}

// Helper to generate test user ID
function generateTestUserId(): string {
    return `user_e2e_${Math.random().toString(36).substring(7)}`;
}

// Helper to create a small test buffer (simulates uploaded file)
function createTestFileBuffer(): Buffer {
    return Buffer.from("fake image data for testing");
}

describe("Reconciliation E2E", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(ContainerizedIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withNetwork()
            .withPostgres((builder) =>
                builder
                    .withDatabase(`test_e2e_reconciliation_${Date.now()}`)
                    .withNetworkAlias("postgres"),
            )
            .withMinio((builder) => builder.withNetworkAlias("minio"))
            .withMinioBucket("wallpapers")
            .withAutoCleanup()
            .withNats((builder) => builder.withNetworkAlias("nats").withJetstream())
            .withStream("WALLPAPER")
            .withMigrations()
            .withContainerizedApp();
        return tester;
    };
    let tester: ReturnType<typeof setup>;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
    }, 180000); // 3 minute timeout for full E2E setup

    afterAll(async () => {
        await tester.destroy();
    });

    beforeEach(async () => {
        // Clean up MinIO and database before each test
        await tester.minio.cleanupBuckets();
        await tester.postgres.query("DELETE FROM wallpapers");
    });

    test("reconciliation recovers stuck upload and transitions to stored", async () => {
        // Arrange: Create a wallpaper record in 'uploading' state with a file in S3
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();
        const storageKey = `${wallpaperId}/original.jpg`;
        const bucket = tester.minio.config.buckets[0];

        // Upload file to S3 (simulating a completed upload)
        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: storageKey,
                Body: createTestFileBuffer(),
                ContentType: "image/jpeg",
            }),
        );

        // Insert DB record in 'uploading' state (simulating stuck upload)
        // Note: Reconciliation requires records older than 10 minutes
        await tester.postgres.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, file_type, mime_type, file_size_bytes,
                width, height, aspect_ratio, storage_key, storage_bucket,
                uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '11 minutes', $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
            [
                wallpaperId,
                userId,
                "test-hash-123",
                "uploading", // Stuck state
                1,
                "image",
                "image/jpeg",
                1024,
                1920,
                1080,
                1.7778,
                storageKey,
                bucket,
            ],
        );

        // Act: Wait for reconciliation cycle to run (1 second interval + buffer)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify upload transitioned to 'stored' state
        const result = await tester.postgres.query<{ upload_state: string }>(
            "SELECT upload_state FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );

        expect(result).toHaveLength(1);
        expect(result[0].upload_state).toBe("stored");
    }, 10000);

    test("reconciliation republishes missing events and transitions to processing", async () => {
        // Arrange: Create a wallpaper record in 'stored' state (missing NATS event)
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();
        const storageKey = `${wallpaperId}/original.jpg`;
        const bucket = tester.minio.config.buckets[0];

        // Upload file to S3
        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: storageKey,
                Body: createTestFileBuffer(),
                ContentType: "image/jpeg",
            }),
        );

        // Insert DB record in 'stored' state (simulating missing event)
        // Note: Missing events reconciliation requires records older than 5 minutes
        await tester.postgres.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, file_type, mime_type, file_size_bytes,
                width, height, aspect_ratio, storage_key, storage_bucket,
                original_filename, uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '6 minutes', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
            [
                wallpaperId,
                userId,
                "test-hash-456",
                "stored", // Waiting for event publish
                1,
                "image",
                "image/jpeg",
                1024,
                1920,
                1080,
                1.7778,
                storageKey,
                bucket,
                "test-image.jpg", // Required for event publishing
            ],
        );

        // Act: Wait for reconciliation cycle to run
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify upload transitioned to 'processing' state (event published)
        const result = await tester.postgres.query<{ upload_state: string }>(
            "SELECT upload_state FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );

        expect(result).toHaveLength(1);
        expect(result[0].upload_state).toBe("processing");
    }, 10000);

    test("reconciliation cleans up orphaned intent records", async () => {
        // Arrange: Create old 'initiated' record (>1 hour old)
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();

        // Insert DB record in 'initiated' state from over an hour ago
        await tester.postgres.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '2 hours', $5, NOW(), NOW())`,
            [wallpaperId, userId, "test-hash-789", "initiated", 0],
        );

        // Verify record exists before reconciliation
        const beforeResult = await tester.postgres.query<{ id: string }>(
            "SELECT id FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );
        expect(beforeResult).toHaveLength(1);

        // Act: Wait for reconciliation cycle to run
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify orphaned intent was deleted
        const afterResult = await tester.postgres.query<{ id: string }>(
            "SELECT id FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );
        expect(afterResult).toHaveLength(0);
    }, 10000);

    test("reconciliation cleans up orphaned MinIO objects", async () => {
        // Arrange: Upload file to S3 without corresponding DB record
        const orphanedKey = `wlpr_orphaned_${ulid()}/original.jpg`;
        const bucket = tester.minio.config.buckets[0];

        await tester.minio.getS3Client().send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: orphanedKey,
                Body: createTestFileBuffer(),
                ContentType: "image/jpeg",
            }),
        );

        // Verify file exists in S3
        const beforeList = await tester.minio.listObjects(bucket);
        expect(beforeList.some((key) => key === orphanedKey)).toBe(true);

        // Act: Wait for MinIO cleanup cycle to run (2 second interval + buffer)
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Assert: Verify orphaned S3 object was deleted
        const afterList = await tester.minio.listObjects(bucket);
        const keyExists = afterList.some((key) => key === orphanedKey);
        expect(keyExists).toBe(false);
    }, 10000);
});
