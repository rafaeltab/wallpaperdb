import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'undici';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import sharp from 'sharp';
import { baseUrl, databaseUrl, s3Endpoint, s3AccessKeyId, s3SecretAccessKey, s3Bucket } from './setup.js';

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

describe('Upload E2E', () => {
    let s3Client: S3Client;
    let dbPool: Pool;

    beforeEach(async () => {
        // Initialize S3 client for verification
        s3Client = new S3Client({
            endpoint: s3Endpoint,
            region: 'us-east-1',
            credentials: {
                accessKeyId: s3AccessKeyId,
                secretAccessKey: s3SecretAccessKey,
            },
            forcePathStyle: true,
        });

        // Initialize database pool for verification
        dbPool = new Pool({ connectionString: databaseUrl });

        // Clean up S3 bucket before each test
        try {
            const listResponse = await s3Client.send(
                new ListObjectsV2Command({ Bucket: s3Bucket })
            );

            if (listResponse.Contents && listResponse.Contents.length > 0) {
                for (const object of listResponse.Contents) {
                    if (object.Key) {
                        await s3Client.send(
                            new DeleteObjectCommand({
                                Bucket: s3Bucket,
                                Key: object.Key,
                            })
                        );
                    }
                }
            }
        } catch (error) {
            console.warn('S3 cleanup failed:', error);
        }

        // Clean up database before each test
        await dbPool.query('DELETE FROM wallpapers');
    });

    afterEach(async () => {
        await dbPool.end();
    });

    test('upload JPEG wallpaper creates S3 object and database record', async () => {
        // Arrange: Create test image and form data
        const testImage = await createTestJpeg();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append('file', new Blob([testImage], { type: 'image/jpeg' }), filename);
        formData.append('userId', userId);

        // Act: Upload via HTTP to Docker container
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
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
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents).toBeDefined();
        expect(s3Objects.Contents?.length).toBeGreaterThan(0);
        expect(s3Objects.Contents?.[0].Key).toContain(wallpaperId);

        // Verify: Side effect in database - record was created
        const dbResult = await dbPool.query(
            'SELECT id, user_id, upload_state, file_type, storage_key FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );
        expect(dbResult.rows).toHaveLength(1);
        expect(dbResult.rows[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: 'image',
        });
        // Upload should be in a successful state (stored, processing, or completed)
        expect(['stored', 'processing', 'completed']).toContain(dbResult.rows[0].upload_state);
        expect(dbResult.rows[0].storage_key).toBeTruthy();
    });

    test('upload invalid file returns 400 error without creating side effects', async () => {
        // Arrange: Create invalid file
        const invalidFile = Buffer.from('This is not an image');
        const userId = generateTestUserId();

        const formData = new FormData();
        formData.append('file', new Blob([invalidFile], { type: 'text/plain' }), 'invalid.txt');
        formData.append('userId', userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Verify: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No database record created (or only in 'initiated' state)
        const dbResult = await dbPool.query(
            'SELECT id, upload_state FROM wallpapers WHERE user_id = $1',
            [userId]
        );
        // Should be empty or only have 'initiated' records (which is fine)
        const completedOrStored = dbResult.rows.filter(
            (row) => row.upload_state === 'completed' || row.upload_state === 'stored'
        );
        expect(completedOrStored).toHaveLength(0);
    });

    test('uploading duplicate file returns already_uploaded status without creating duplicate records', async () => {
        // Arrange: Create test image and user
        const testImage = await createTestJpeg();
        const userId = generateTestUserId();
        const filename = `duplicate-test-${Date.now()}.jpg`;

        // Act: Upload the same image twice
        const formData1 = new FormData();
        formData1.append('file', new Blob([testImage], { type: 'image/jpeg' }), filename);
        formData1.append('userId', userId);

        const response1 = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData1 as any,
        });

        // Verify first upload succeeded
        expect(response1.statusCode).toBe(200);
        const body1 = await response1.body.json();
        const wallpaperId = (body1 as { id: string }).id;

        // Wait a moment to ensure first upload is fully committed to database
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Upload the same file again with the same user
        const formData2 = new FormData();
        formData2.append('file', new Blob([testImage], { type: 'image/jpeg' }), filename);
        formData2.append('userId', userId);

        const response2 = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData2 as any,
        });

        // Assert: Second upload returns 200 with already_uploaded status (idempotency)
        expect(response2.statusCode).toBe(200);
        const body2 = await response2.body.json();
        expect(body2).toMatchObject({
            id: wallpaperId, // Same ID as first upload
            status: 'already_uploaded',
        });

        // Verify: Only one S3 object exists
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length).toBe(1);
        expect(s3Objects.Contents?.[0].Key).toContain(wallpaperId);

        // Verify: Only one database record exists in successful state
        const dbResult = await dbPool.query(
            'SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)',
            [userId, 'stored', 'processing', 'completed']
        );
        expect(dbResult.rows).toHaveLength(1);
        expect(dbResult.rows[0].id).toBe(wallpaperId);
    });

    test('upload PNG wallpaper creates S3 object and database record', async () => {
        // Arrange: Create test PNG image and form data
        const testImage = await createTestPng();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.png`;

        // Small delay to ensure clean state
        await new Promise((resolve) => setTimeout(resolve, 50));

        const formData = new FormData();
        formData.append('file', new Blob([testImage], { type: 'image/png' }), filename);
        formData.append('userId', userId);

        // Act: Upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
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
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents).toBeDefined();
        expect(s3Objects.Contents?.length).toBeGreaterThan(0);
        expect(s3Objects.Contents?.[0].Key).toContain(wallpaperId);

        // Verify: Database record created with correct MIME type
        const dbResult = await dbPool.query(
            'SELECT id, user_id, upload_state, file_type, mime_type, storage_key FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );
        expect(dbResult.rows).toHaveLength(1);
        expect(dbResult.rows[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: 'image',
            mime_type: 'image/png',
        });
        expect(['stored', 'processing', 'completed']).toContain(dbResult.rows[0].upload_state);
    });

    test('upload WebP wallpaper creates S3 object and database record', async () => {
        // Arrange: Create test WebP image and form data
        const testImage = await createTestWebP();
        const userId = generateTestUserId();
        const filename = `test-wallpaper-${Date.now()}.webp`;

        const formData = new FormData();
        formData.append('file', new Blob([testImage], { type: 'image/webp' }), filename);
        formData.append('userId', userId);

        // Act: Upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
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
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents).toBeDefined();
        expect(s3Objects.Contents?.length).toBeGreaterThan(0);
        expect(s3Objects.Contents?.[0].Key).toContain(wallpaperId);

        // Verify: Database record created with correct MIME type
        const dbResult = await dbPool.query(
            'SELECT id, user_id, upload_state, file_type, mime_type, storage_key FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );
        expect(dbResult.rows).toHaveLength(1);
        expect(dbResult.rows[0]).toMatchObject({
            id: wallpaperId,
            user_id: userId,
            file_type: 'image',
            mime_type: 'image/webp',
        });
        expect(['stored', 'processing', 'completed']).toContain(dbResult.rows[0].upload_state);
    });

    test('upload image below minimum dimensions returns 400 error', async () => {
        // Arrange: Create test image below minimum dimensions (640x480, need 1280x720)
        const smallImage = await createSmallTestJpeg();
        const userId = generateTestUserId();
        const filename = `small-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append('file', new Blob([smallImage], { type: 'image/jpeg' }), filename);
        formData.append('userId', userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No database record in successful state
        const dbResult = await dbPool.query(
            'SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)',
            [userId, 'stored', 'processing', 'completed']
        );
        expect(dbResult.rows).toHaveLength(0);
    });

    test('upload without userId returns 400 error', async () => {
        // Arrange: Create test image but omit userId
        const testImage = await createTestJpeg();
        const filename = `test-wallpaper-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append('file', new Blob([testImage], { type: 'image/jpeg' }), filename);
        // Intentionally omit userId

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);
        const body = await response.body.json();
        expect(body).toHaveProperty('type');
        expect(body.type).toContain('missing-user-id');

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No database record created
        const dbResult = await dbPool.query('SELECT id FROM wallpapers');
        expect(dbResult.rows).toHaveLength(0);
    });

    test('upload empty file returns 400 error', async () => {
        // Arrange: Create empty file (0 bytes)
        const emptyFile = Buffer.alloc(0);
        const userId = generateTestUserId();
        const filename = `empty-file-${Date.now()}.jpg`;

        const formData = new FormData();
        formData.append('file', new Blob([emptyFile], { type: 'image/jpeg' }), filename);
        formData.append('userId', userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No successful database record created
        const dbResult = await dbPool.query(
            'SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)',
            [userId, 'stored', 'processing', 'completed']
        );
        expect(dbResult.rows).toHaveLength(0);
    });

    test('upload with no file field returns 400 error', async () => {
        // Arrange: Create form data with only userId, no file
        const userId = generateTestUserId();

        const formData = new FormData();
        formData.append('userId', userId);
        // Intentionally omit file field

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Assert: HTTP error response
        expect(response.statusCode).toBe(400);

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No database record created
        const dbResult = await dbPool.query(
            'SELECT id FROM wallpapers WHERE user_id = $1',
            [userId]
        );
        expect(dbResult.rows).toHaveLength(0);
    });

    test('upload video file returns 400 error (format not supported)', async () => {
        // Arrange: Create minimal MP4 file header (video format not supported)
        // This is a minimal valid MP4 file signature
        const mp4Header = Buffer.from([
            0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ftyp box
            0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, // mp42
            0x6D, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6F, 0x6D, // isommp42
        ]);
        const userId = generateTestUserId();
        const filename = `test-video-${Date.now()}.mp4`;

        const formData = new FormData();
        formData.append('file', new Blob([mp4Header], { type: 'video/mp4' }), filename);
        formData.append('userId', userId);

        // Act: Attempt upload via HTTP
        const response = await request(`${baseUrl}/upload`, {
            method: 'POST',
            body: formData as any,
        });

        // Assert: HTTP error response (video not supported)
        expect(response.statusCode).toBe(400);
        const body = await response.body.json();
        expect(body).toHaveProperty('type');
        // Should fail format validation since video/mp4 is not in allowedFormats

        // Verify: No S3 object created
        const s3Objects = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(s3Objects.Contents?.length || 0).toBe(0);

        // Verify: No successful database record created
        const dbResult = await dbPool.query(
            'SELECT id, upload_state FROM wallpapers WHERE user_id = $1 AND upload_state IN ($2, $3, $4)',
            [userId, 'stored', 'processing', 'completed']
        );
        expect(dbResult.rows).toHaveLength(0);
    });
});
