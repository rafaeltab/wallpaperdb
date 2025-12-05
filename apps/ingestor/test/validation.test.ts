import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    FixturesTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { uploadFile, uploadFileWithoutUserId } from "./helpers.js";

describe("Validation Integration Tests", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(FixturesTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((b) => b.withDatabase(`test_validation_${Date.now()}`))
            .withPostgresAutoCleanup(["wallpapers"])
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((b) => b.withJetstream())
            .withNatsAutoCleanup()
            .withMigrations()
            .withInProcessApp();
        return tester;
    };

    let tester: ReturnType<typeof setup>;
    let fastify: FastifyInstance;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
        fastify = tester.getApp();
    }, 60000);

    afterAll(async () => {
        if (tester) {
            await tester.destroy();
        }
    });

    beforeEach(async () => {
        await tester.minio.cleanupBuckets();
    });

    describe("File Format Validation", () => {
        it("should reject invalid file format with RFC 7807 error", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "invalid.txt";

            const response = await uploadFile(fastify, {
                file: tester.fixtures.INVALID_FILE,
                filename,
                userId,
                mimeType: "text/plain",
            });

            // Should return 400 Bad Request
            expect(response.statusCode).toBe(400);

            // Should return RFC 7807 Problem Details
            const contentType = response.headers["content-type"];
            expect(contentType).toContain("application/problem+json");

            const body = JSON.parse(response.body);
            expect(body.type).toBeDefined();
            expect(body.type).toContain("invalid-file-format");
            expect(body.title).toBe("Invalid File Format");
            expect(body.status).toBe(400);
            expect(body.detail).toBeDefined();
            expect(body.detail).toContain("JPEG, PNG, WebP");
            expect(body.instance).toBe("/upload");
            expect(body.receivedMimeType).toBe("text/plain");
        });

        it("should accept valid JPEG format", async () => {
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
        });

        it("should accept valid PNG format", async () => {
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
        });

        it("should accept valid WebP format", async () => {
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
        });

        it("should detect MIME type from content, not extension", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "fake.jpg"; // Wrong extension
            const imageBuffer = await tester.fixtures.images.validPng(); // But actually PNG

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/png",
            });

            // Should succeed because content is valid PNG
            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.mimeType).toBe("image/png");
        });
    });

    describe("File Size Validation", () => {
        it("should reject file larger than limit with RFC 7807 error", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");

            // Create a large buffer to simulate >50MB file
            // Note: We'll mock this as creating a real 50MB+ file is slow
            const largeBuffer = Buffer.alloc(51 * 1024 * 1024); // 51MB

            const response = await uploadFile(fastify, {
                file: largeBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should return 413 Payload Too Large
            expect(response.statusCode).toBe(413);

            // Should return RFC 7807 Problem Details
            const contentType = response.headers["content-type"];
            expect(contentType).toContain("application/problem+json");

            const body = JSON.parse(response.body);
            expect(body.type).toContain("file-too-large");
            expect(body.title).toBe("File Too Large");
            expect(body.status).toBe(413);
            expect(body.detail).toBeDefined();
            expect(body.detail).toContain("50MB");
            expect(body.instance).toBe("/upload");
            expect(body.fileSizeBytes).toBeDefined();
            expect(body.maxFileSizeBytes).toBe(50 * 1024 * 1024);
            expect(body.fileType).toBe("image");
        });

        it("should accept file within size limit", async () => {
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
        });
    });

    describe("Dimension Validation", () => {
        it("should reject image with dimensions too small", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.tooSmall(); // 800x600

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should return 400 Bad Request
            expect(response.statusCode).toBe(400);

            // Should return RFC 7807 Problem Details
            const contentType = response.headers["content-type"];
            expect(contentType).toContain("application/problem+json");

            const body = JSON.parse(response.body);
            expect(body.type).toContain("dimensions-out-of-bounds");
            expect(body.title).toBe("Dimensions Out of Bounds");
            expect(body.status).toBe(400);
            expect(body.detail).toBeDefined();
            expect(body.detail).toContain("1280x720");
            expect(body.instance).toBe("/upload");
            expect(body.width).toBe(800);
            expect(body.height).toBe(600);
            expect(body.minWidth).toBe(1280);
            expect(body.minHeight).toBe(720);
            expect(body.maxWidth).toBe(7680);
            expect(body.maxHeight).toBe(4320);
        });

        it("should reject image with dimensions too large", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.tooLarge(); // 8192x8192

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should return 400 Bad Request
            expect(response.statusCode).toBe(400);

            const body = JSON.parse(response.body);
            expect(body.type).toContain("dimensions-out-of-bounds");
            expect(body.title).toBe("Dimensions Out of Bounds");
            expect(body.status).toBe(400);
            expect(body.width).toBe(8192);
            expect(body.height).toBe(8192);
            expect(body.maxWidth).toBe(7680);
            expect(body.maxHeight).toBe(4320);
        });

        it("should accept image with valid dimensions", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg(); // 1920x1080

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should accept minimum valid dimensions (1280x720)", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");

            // Create image with minimum dimensions
            const imageBuffer = await tester.fixtures.createTestImage({
                width: 1280,
                height: 720,
                format: "jpeg",
            });

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
        });

        it("should accept maximum valid dimensions (7680x4320)", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");

            // Create image with maximum dimensions (8K)
            const imageBuffer = await tester.fixtures.createTestImage({
                width: 7680,
                height: 4320,
                format: "jpeg",
            });

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe("Filename Sanitization", () => {
        it("should accept upload with path traversal characters in filename", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const maliciousFilename = "../../../etc/passwd.jpg";
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename: maliciousFilename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should succeed - filename will be sanitized internally
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body).id).toBeDefined();
        });

        it("should accept upload with special characters in filename", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "test<script>alert(1)</script>.jpg";
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should succeed - filename will be sanitized internally
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body).id).toBeDefined();
        });

        it("should accept upload with very long filename", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const longFilename = `${"a".repeat(300)}.jpg`; // >255 chars
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename: longFilename,
                userId,
                mimeType: "image/jpeg",
            });

            // Should succeed - filename will be truncated internally
            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.body).id).toBeDefined();
        });
    });

    describe("Missing File Validation", () => {
        it("should reject request without file", async () => {
            const userId = tester.fixtures.generateTestUserId();

            // Create a request without file
            const boundary = `----WebKitFormBoundary${Math.random().toString(36)}`;
            const formData = [
                `--${boundary}`,
                `Content-Disposition: form-data; name="userId"`,
                "",
                userId,
                `--${boundary}--`,
            ].join("\r\n");

            const response = await fastify.inject({
                method: "POST",
                url: "/upload",
                headers: {
                    "content-type": `multipart/form-data; boundary=${boundary}`,
                },
                payload: Buffer.from(formData, "binary"),
            });

            expect(response.statusCode).toBe(400);

            const body = JSON.parse(response.body);
            expect(body.type).toContain("missing-file");
            expect(body.title).toBe("Missing File");
            expect(body.status).toBe(400);
        });
    });

    describe("Missing UserId Validation", () => {
        it("should reject request without userId field", async () => {
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFileWithoutUserId(fastify, {
                file: imageBuffer,
                filename,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(400);

            const body = JSON.parse(response.body);
            expect(body.type).toContain("missing-user-id");
            expect(body.title).toBe("Missing userId");
            expect(body.status).toBe(400);
        });
    });

    describe("User-Specific Validation Limits", () => {
        it("should apply validation limits from ValidationLimitsService", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            // Default limits should be applied (from DefaultValidationLimitsService)
            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.id).toBeDefined();
            expect(body.width).toBe(1920);
            expect(body.height).toBe(1080);
        });

        it("should respect allowed formats from user limits", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "test.bmp"; // BMP not in allowed formats

            // Create a fake BMP buffer
            const bmpBuffer = Buffer.from([0x42, 0x4d]); // BMP header

            const response = await uploadFile(fastify, {
                file: bmpBuffer,
                filename,
                userId,
                mimeType: "image/bmp",
            });

            expect(response.statusCode).toBe(400);

            const body = JSON.parse(response.body);
            expect(body.type).toContain("invalid-file-format");
        });
    });

    describe("RFC 7807 Problem Details Format", () => {
        it("should return proper content-type for all errors", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "invalid.txt";

            const response = await uploadFile(fastify, {
                file: tester.fixtures.INVALID_FILE,
                filename,
                userId,
                mimeType: "text/plain",
            });

            expect(response.statusCode).toBe(400);
            expect(response.headers["content-type"]).toContain(
                "application/problem+json",
            );
        });

        it("should include all required RFC 7807 fields", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = "invalid.txt";

            const response = await uploadFile(fastify, {
                file: tester.fixtures.INVALID_FILE,
                filename,
                userId,
                mimeType: "text/plain",
            });

            const body = JSON.parse(response.body);

            // Required fields
            expect(body.type).toBeDefined();
            expect(body.title).toBeDefined();
            expect(body.status).toBeDefined();
            expect(body.detail).toBeDefined();
            expect(body.instance).toBeDefined();

            // Type should be URI
            expect(body.type).toMatch(/^https?:\/\//);

            // Status in body should match HTTP status
            expect(body.status).toBe(response.statusCode);

            // Instance should be the endpoint
            expect(body.instance).toBe("/upload");
        });

        it("should include extension fields for context", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const imageBuffer = await tester.fixtures.images.tooSmall();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename: "small.jpg",
                userId,
                mimeType: "image/jpeg",
            });

            const body = JSON.parse(response.body);

            // Extension fields for dimension errors
            expect(body.width).toBeDefined();
            expect(body.height).toBeDefined();
            expect(body.minWidth).toBeDefined();
            expect(body.minHeight).toBeDefined();
            expect(body.maxWidth).toBeDefined();
            expect(body.maxHeight).toBeDefined();
        });
    });
});
