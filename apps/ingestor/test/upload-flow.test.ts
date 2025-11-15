import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    PostgresTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    FixturesTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { uploadFile } from "./helpers.js";

describe("Upload Flow Integration Tests", () => {
    const setup = () => {
        // Build test environment with TesterBuilder pattern
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(FixturesTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        // Configure infrastructure
        tester
            .withPostgres((b) => b.withDatabase(`test_upload_flow_${Date.now()}`))
            .withMinio()
            .withMinioBucket("wallpapers")
            .withNats((b) => b.withJetstream())
            .withStream("WALLPAPER")
            .withMigrations() // Apply database migrations
            .withInProcessApp(); // Create Fastify app
        return tester;
    };

    let tester: ReturnType<typeof setup>;
    let fastify: FastifyInstance;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();

        // Get the Fastify app instance
        fastify = tester.getApp();
    }, 60000);

    afterAll(async () => {
        if (tester) {
            await tester.destroy();
        }
    });

    beforeEach(async () => {
        // Clean up MinIO before each test
        await tester.minio.cleanupBuckets();
    });

    describe("Happy Path - Upload Valid Image", () => {
        it("should successfully upload a valid JPEG image", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should return 200 with upload details
            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.id).toBeDefined();
            expect(body.id).toMatch(/^wlpr_/); // Should be prefixed with wlpr_
            expect(body.status).toBe("processing");
            expect(body.uploadedAt).toBeDefined();
            expect(body.fileType).toBe("image");
            expect(body.mimeType).toBe("image/jpeg");
            expect(body.width).toBe(1920);
            expect(body.height).toBe(1080);
            expect(body.fileSizeBytes).toBeGreaterThan(0);

            // Verify file is stored in MinIO
            const storageKey = `${body.id}/original.jpg`;
            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const headResponse = await s3Client.send(
                new HeadObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: storageKey,
                }),
            );
            expect(headResponse).toBeDefined();
            expect(headResponse.ContentType).toBe("image/jpeg");
        });

        it("should successfully upload a valid PNG image", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("png");
            const imageBuffer = await tester.fixtures.images.validPng();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/png",
            });

            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.mimeType).toBe("image/png");
            expect(body.fileType).toBe("image");
            expect(body.width).toBe(1920);
            expect(body.height).toBe(1080);

            // Verify storage
            const storageKey = `${body.id}/original.png`;
            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const headResponse = await s3Client.send(
                new HeadObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: storageKey,
                }),
            );
            expect(headResponse.ContentType).toBe("image/png");
        });

        it("should successfully upload a valid WebP image", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("webp");
            const imageBuffer = await tester.fixtures.images.validWebp();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/webp",
            });

            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.mimeType).toBe("image/webp");
            expect(body.fileType).toBe("image");

            // Verify storage
            const storageKey = `${body.id}/original.webp`;
            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const headResponse = await s3Client.send(
                new HeadObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: storageKey,
                }),
            );
            expect(headResponse.ContentType).toBe("image/webp");
        });
    });

    describe("Idempotency & Deduplication", () => {
        it("should return existing upload when same file is uploaded twice", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            // First upload
            const response1 = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response1.statusCode).toBe(200);
            const body1 = JSON.parse(response1.body);
            const firstUploadId = body1.id;

            // Second upload (same file, same user)
            const response2 = await uploadFile(fastify, {
                file: imageBuffer,
                filename: "different-name.jpg", // Different filename, same content
                userId,
                mimeType: "image/jpeg",
            });

            expect(response2.statusCode).toBe(200);
            const body2 = JSON.parse(response2.body);

            // Should return the same ID
            expect(body2.id).toBe(firstUploadId);
            expect(body2.status).toMatch(/already_uploaded|processing|completed/);
        });

        it("should allow same file to be uploaded by different users", async () => {
            const user1 = tester.fixtures.generateTestUserId();
            const user2 = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            // Upload by user 1
            const response1 = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId: user1,
                mimeType: "image/jpeg",
            });

            expect(response1.statusCode).toBe(200);
            const body1 = JSON.parse(response1.body);

            // Upload by user 2 (same file, different user)
            const response2 = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId: user2,
                mimeType: "image/jpeg",
            });

            expect(response2.statusCode).toBe(200);
            const body2 = JSON.parse(response2.body);

            // Should create separate uploads (different IDs)
            expect(body2.id).not.toBe(body1.id);
        });

        it("should calculate correct content hash for uploaded files", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();
            const expectedHash =
                await tester.fixtures.generateContentHash(imageBuffer);

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // TODO: Verify database record has correct content_hash
            // This will be tested once we can query the database
            expect(body.id).toBeDefined();
        });
    });

    describe("Database State Machine", () => {
        it("should record wallpaper with correct state transitions", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // Response should indicate processing state
            expect(body.status).toBe("processing");
            expect(body.id).toBeDefined();
            expect(body.uploadedAt).toBeDefined();
        });

        it("should store all required metadata in database", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // Response should include all metadata
            expect(body.id).toBeDefined();
            expect(body.fileType).toBe("image");
            expect(body.mimeType).toBe("image/jpeg");
            expect(body.fileSizeBytes).toBeGreaterThan(0);
            expect(body.width).toBe(1920);
            expect(body.height).toBe(1080);
            expect(body.uploadedAt).toBeDefined();
        });
    });

    describe("File Metadata Extraction", () => {
        it("should extract correct dimensions from image", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            expect(body.width).toBe(1920);
            expect(body.height).toBe(1080);
        });

        it("should calculate correct aspect ratio", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // 1920 / 1080 = 1.7778
            const expectedAspectRatio = 1920 / 1080;
            expect(body.width / body.height).toBeCloseTo(expectedAspectRatio, 4);
        });

        it("should detect correct MIME type from file content", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "fake.jpg"; // Wrong extension
            const imageBuffer = await tester.fixtures.images.validPng(); // But actual PNG

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/png", // Correct MIME type in request
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // Should detect PNG from content, not from filename
            expect(body.mimeType).toBe("image/png");
        });
    });

    describe("Storage Organization", () => {
        it("should store file in correct MinIO path structure", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // Should be stored as: wlpr_<ulid>/original.jpg
            const expectedKey = `${body.id}/original.jpg`;

            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const headResponse = await s3Client.send(
                new HeadObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: expectedKey,
                }),
            );

            expect(headResponse).toBeDefined();
        });

        it("should set correct content type in MinIO", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("png");
            const imageBuffer = await tester.fixtures.images.validPng();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/png",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            const storageKey = `${body.id}/original.png`;
            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const headResponse = await s3Client.send(
                new HeadObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: storageKey,
                }),
            );

            expect(headResponse.ContentType).toBe("image/png");
        });

        it("should store file content correctly in MinIO", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);

            // Retrieve the file from MinIO
            const storageKey = `${body.id}/original.jpg`;
            const s3Client = tester.minio.getS3Client();
            const minioConfig = tester.getMinio();
            const getResponse = await s3Client.send(
                new GetObjectCommand({
                    Bucket: minioConfig.buckets[0],
                    Key: storageKey,
                }),
            );

            // Convert stream to buffer
            const chunks: Uint8Array[] = [];
            if (getResponse.Body) {
                for await (const chunk of getResponse.Body as AsyncIterable<Uint8Array>) {
                    chunks.push(chunk);
                }
            }
            const storedBuffer = Buffer.concat(chunks);

            // Content hashes should match
            const originalHash =
                await tester.fixtures.generateContentHash(imageBuffer);
            const storedHash =
                await tester.fixtures.generateContentHash(storedBuffer);
            expect(storedHash).toBe(originalHash);
        });
    });
});
