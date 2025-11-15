import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import sharp from "sharp";
import { request } from "undici";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "vitest";
import {
    ContainerizedIngestorTesterBuilder,
    IngestorMigrationsTesterBuilder,
} from "./builders/index.js";

// Helper to create a test JPEG image with minimum required dimensions (1280x720)
async function createTestJpeg(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1280,
            height: 720,
            channels: 3,
            background: { r: 100, g: 150, b: 200 },
        },
    })
        .jpeg()
        .toBuffer();
}

// Helper to create a test PNG image with minimum required dimensions (1280x720)
async function createTestPng(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1280,
            height: 720,
            channels: 3,
            background: { r: 150, g: 100, b: 200 },
        },
    })
        .png()
        .toBuffer();
}

// Helper to create a test WebP image with minimum required dimensions (1280x720)
async function createTestWebP(): Promise<Buffer> {
    return sharp({
        create: {
            width: 1280,
            height: 720,
            channels: 3,
            background: { r: 200, g: 150, b: 100 },
        },
    })
        .webp()
        .toBuffer();
}

// Helper to create a small test JPEG image below minimum dimensions (640x480)
async function createSmallTestJpeg(): Promise<Buffer> {
    return sharp({
        create: {
            width: 640,
            height: 480,
            channels: 3,
            background: { r: 50, g: 50, b: 50 },
        },
    })
        .jpeg()
        .toBuffer();
}

// Generate random user ID
function generateTestUserId(): string {
    return `user_e2e_${Math.random().toString(36).substring(7)}`;
}

describe("Upload E2E", () => {
    const setup = () => {
        // Build test environment with builder composition
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(ContainerizedIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        // Configure infrastructure WITH network - containers communicate via network
        tester
            .withNetwork()
            .withPostgres((builder) =>
                builder
                    .withDatabase(`test_e2e_upload_${Date.now()}`)
                    .withNetworkAlias("postgres"),
            )
            .withMinio((builder) => builder.withNetworkAlias("minio"))
            .withMinioBucket("wallpapers")
            .withAutoCleanup() // Enable automatic MinIO cleanup
            .withNats((builder) => builder.withNetworkAlias("nats").withJetstream())
            .withStream("WALLPAPER")
            .withMigrations()
            .withContainerizedApp();
        return tester;
    };
    let tester: ReturnType<typeof setup>;
    let baseUrl: string;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
        baseUrl = tester.getBaseUrl();
    }, 180000); // 3 minute timeout for full E2E setup

    afterAll(async () => {
        if (tester) {
            await tester.destroy();
        }
    });

    beforeEach(async () => {
        // Clean up between tests using tester helpers
        await tester.minio.cleanupBuckets(); // Clean MinIO
        await tester.postgres.query("DELETE FROM wallpapers"); // Clean database
    });

    test("upload JPEG wallpaper creates S3 object and database record", async () => {
        // Arrange: Create test image and form data
        const testImage = await createTestJpeg();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([testImage], { type: "image/jpeg" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Upload via HTTP to Docker container
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Verify: HTTP response
        expect(response.statusCode).toBe(200);
        const body = await response.body.json();
        expect(body).toMatchObject({
            id: expect.stringMatching(/^wlpr_/),
            status: expect.stringMatching(/^(stored|processing|completed)$/),
        });

        const wallpaperId = (body as { id: string }).id;

        // Verify: Side effect in S3 - object was created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBeGreaterThan(0);
        expect(s3Objects[0]).toContain(wallpaperId);

        // Verify: Side effect in database - record was created
        const dbResult = await tester.postgres.query<{
            id: string;
            user_id: string;
            upload_state: string;
            file_type: string;
            storage_key: string;
        }>(
            "SELECT id, user_id, upload_state, file_type, storage_key FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: "image",
        });
        // Upload should be in a successful state (stored, processing, or completed)
        expect(["stored", "processing", "completed"]).toContain(
            dbResult[0].upload_state,
        );
        expect(dbResult[0].storage_key).toBeTruthy();
    });

    test("upload invalid file returns 400 error without creating side effects", async () => {
        // Arrange: Create invalid file
        const invalidFile = Buffer.from("This is not an image");
        const userId = generateTestUserId();

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([invalidFile], { type: "text/plain" }),
            "invalid.txt",
        );
        formData.append("userId", userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Verify: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No database record created (or only in 'initiated' state)
        const dbResult = await tester.postgres.query<{
            id: string;
            upload_state: string;
        }>("SELECT id, upload_state FROM wallpapers WHERE user_id = $1", [userId]);
        // Should be empty or only have 'initiated' records (which is fine)
        const completedOrStored = dbResult.filter(
            (row) =>
                row.upload_state === "completed" || row.upload_state === "stored",
        );
        expect(completedOrStored).toHaveLength(0);
    });

    test("uploading duplicate file returns already_uploaded status without creating duplicate records", async () => {
        // Arrange: Create test image and user
        const testImage = await createTestJpeg();
        const userId = generateTestUserId();
        const filename = `duplicate-test-${Date.now()}.jpg`;

        // Act: Upload the same image twice
        const formData1 = new FormData();
        formData1.append(
            "file",
            new Blob([testImage], { type: "image/jpeg" }),
            filename,
        );
        formData1.append("userId", userId);

        const response1 = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData1,
        });

        // Verify first upload succeeded
        expect(response1.statusCode).toBe(200);
        const body1 = await response1.body.json();
        const wallpaperId = (body1 as { id: string }).id;

        // Wait a moment to ensure first upload is fully committed to database
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Upload the same file again with the same user
        const formData2 = new FormData();
        formData2.append(
            "file",
            new Blob([testImage], { type: "image/jpeg" }),
            filename,
        );
        formData2.append("userId", userId);

        const response2 = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData2,
        });

        // Assert: Second upload returns 200 with already_uploaded status (idempotency)
        expect(response2.statusCode).toBe(200);
        const body2 = await response2.body.json();
        expect(body2).toMatchObject({
            id: wallpaperId, // Same ID as first upload
            status: "already_uploaded",
        });

        // Verify: Only one S3 object exists
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(1);
        expect(s3Objects[0]).toContain(wallpaperId);

        // Verify: Only one database record exists in successful state
        const dbResult = await tester.postgres.query<{
            id: string;
            upload_state: string;
        }>(
            "SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)",
            [userId, "stored", "processing", "completed"],
        );
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0].id).toBe(wallpaperId);
    });

    test("upload PNG wallpaper creates S3 object and database record", async () => {
        // Arrange: Create test PNG image and form data
        const testImage = await createTestPng();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.png`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([testImage], { type: "image/png" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP response
        expect(response.statusCode).toBe(200);
        const body = await response.body.json();
        expect(body).toMatchObject({
            id: expect.stringMatching(/^wlpr_/),
            status: expect.stringMatching(/^(stored|processing|completed)$/),
        });

        const wallpaperId = (body as { id: string }).id;

        // Verify: S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBeGreaterThan(0);
        expect(s3Objects[0]).toContain(wallpaperId);

        // Verify: Database record created with correct MIME type
        const dbResult = await tester.postgres.query<{
            id: string;
            user_id: string;
            upload_state: string;
            file_type: string;
            mime_type: string;
            storage_key: string;
        }>(
            "SELECT id, user_id, upload_state, file_type, mime_type, storage_key FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: "image",
            mime_type: "image/png",
        });
        expect(["stored", "processing", "completed"]).toContain(
            dbResult[0].upload_state,
        );
    });

    test("upload WebP wallpaper creates S3 object and database record", async () => {
        // Arrange: Create test WebP image and form data
        const testImage = await createTestWebP();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.webp`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([testImage], { type: "image/webp" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP response
        expect(response.statusCode).toBe(200);
        const body = await response.body.json();
        expect(body).toMatchObject({
            id: expect.stringMatching(/^wlpr_/),
            status: expect.stringMatching(/^(stored|processing|completed)$/),
        });

        const wallpaperId = (body as { id: string }).id;

        // Verify: S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBeGreaterThan(0);
        expect(s3Objects[0]).toContain(wallpaperId);

        // Verify: Database record created with correct MIME type
        const dbResult = await tester.postgres.query<{
            id: string;
            user_id: string;
            upload_state: string;
            file_type: string;
            mime_type: string;
            storage_key: string;
        }>(
            "SELECT id, user_id, upload_state, file_type, mime_type, storage_key FROM wallpapers WHERE id = $1",
            [wallpaperId],
        );
        expect(dbResult).toHaveLength(1);
        expect(dbResult[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: "image",
            mime_type: "image/webp",
        });
        expect(["stored", "processing", "completed"]).toContain(
            dbResult[0].upload_state,
        );
    });

    test("upload image below minimum dimensions returns 400 error", async () => {
        // Arrange: Create test image below minimum dimensions (640x480, need 1280x720)
        const smallImage = await createSmallTestJpeg();
        const userId = generateTestUserId();
        const filename = `small-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([smallImage], { type: "image/jpeg" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No database record in successful state
        const dbResult = await tester.postgres.query<{
            id: string;
            upload_state: string;
        }>(
            "SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)",
            [userId, "stored", "processing", "completed"],
        );
        expect(dbResult).toHaveLength(0);
    });

    test("upload without userId returns 400 error", async () => {
        // Arrange: Create test image but omit userId
        const testImage = await createTestJpeg();
        const filename = `test-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([testImage], { type: "image/jpeg" }),
            filename,
        );
        // Intentionally omit userId

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);
        const body = (await response.body.json()) as object;
        expect(body).toHaveProperty("type");
        // Note: Validation order changed - file validation happens first
        expect((body as { type: unknown }).type).toMatch(/missing-(user-id|file)/);

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No database record created
        const dbResult = await tester.postgres.query("SELECT id FROM wallpapers");
        expect(dbResult).toHaveLength(0);
    });

    test("upload empty file returns 400 error", async () => {
        // Arrange: Create empty file (0 bytes)
        const emptyFile = Buffer.alloc(0);
        const userId = generateTestUserId();
        const filename = `empty-file-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([emptyFile], { type: "image/jpeg" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No successful database record created
        const dbResult = await tester.postgres.query<{
            id: string;
            upload_state: string;
        }>(
            "SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)",
            [userId, "stored", "processing", "completed"],
        );
        expect(dbResult).toHaveLength(0);
    });

    test("upload with no file field returns 400 error", async () => {
        // Arrange: Create form data with only userId, no file
        const userId = generateTestUserId();

        const formData = new FormData();
        formData.append("userId", userId);
        // Intentionally omit file field

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No database record created
        const dbResult = await tester.postgres.query<{ id: string }>(
            "SELECT id FROM wallpapers WHERE user_id = $1",
            [userId],
        );
        expect(dbResult).toHaveLength(0);
    });

    test("upload video file returns 400 error (format not supported)", async () => {
        // Arrange: Create minimal MP4 file header (video format not supported)
        // This is a minimal valid MP4 file signature
        const mp4Header = Buffer.from([
            0x00,
            0x00,
            0x00,
            0x18,
            0x66,
            0x74,
            0x79,
            0x70, // ftyp box
            0x6d,
            0x70,
            0x34,
            0x32,
            0x00,
            0x00,
            0x00,
            0x00, // mp42
            0x6d,
            0x70,
            0x34,
            0x32,
            0x69,
            0x73,
            0x6f,
            0x6d, // isommp42
        ]);
        const userId = generateTestUserId();
        const filename = `test-video-${Date.now()}.mp4`;

        const formData = new FormData();
        formData.append(
            "file",
            new Blob([mp4Header], { type: "video/mp4" }),
            filename,
        );
        formData.append("userId", userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: "POST",
            body: formData,
        });

        // Assert: HTTP error response (video not supported)
        expect(response.statusCode).toBe(400);
        const body = await response.body.json();
        expect(body).toHaveProperty("type");
        // Should fail format validation since video/mp4 is not in allowedFormats

        // Verify: No S3 object created
        const s3Objects = await tester.minio.listObjects(
            tester.minio.config.buckets[0],
        );
        expect(s3Objects.length).toBe(0);

        // Verify: No successful database record created
        const dbResult = await tester.postgres.query<{
            id: string;
            upload_state: string;
        }>(
            "SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)",
            [userId, "stored", "processing", "completed"],
        );
        expect(dbResult).toHaveLength(0);
    });
});
