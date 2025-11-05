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
});
