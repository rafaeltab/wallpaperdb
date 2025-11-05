import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import { databaseUrl, s3Endpoint, s3AccessKeyId, s3SecretAccessKey, s3Bucket } from './setup.js';

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
    return Buffer.from('fake image data for testing');
}

describe('Reconciliation E2E', () => {
    let s3Client: S3Client;
    let dbPool: Pool;

    beforeEach(async () => {
        // Initialize S3 client
        s3Client = new S3Client({
            endpoint: s3Endpoint,
            region: 'us-east-1',
            credentials: {
                accessKeyId: s3AccessKeyId,
                secretAccessKey: s3SecretAccessKey,
            },
            forcePathStyle: true,
        });

        // Initialize database pool
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

    test('reconciliation recovers stuck upload and transitions to stored', async () => {
        // Arrange: Create a wallpaper record in 'uploading' state with a file in S3
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();
        const storageKey = `${wallpaperId}/original.jpg`;

        // Upload file to S3 (simulating a completed upload)
        await s3Client.send(
            new PutObjectCommand({
                Bucket: s3Bucket,
                Key: storageKey,
                Body: createTestFileBuffer(),
                ContentType: 'image/jpeg',
            })
        );

        // Insert DB record in 'uploading' state (simulating stuck upload)
        // Note: Reconciliation requires records older than 10 minutes
        await dbPool.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, file_type, mime_type, file_size_bytes,
                width, height, aspect_ratio, storage_key, storage_bucket,
                uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '11 minutes', $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
            [
                wallpaperId,
                userId,
                'test-hash-123',
                'uploading', // Stuck state
                1,
                'image',
                'image/jpeg',
                1024,
                1920,
                1080,
                1.7778,
                storageKey,
                s3Bucket,
            ]
        );

        // Act: Wait for reconciliation cycle to run (1 second interval + buffer)
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify upload transitioned to 'stored' state
        const result = await dbPool.query(
            'SELECT upload_state FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].upload_state).toBe('stored');
    }, 10000);

    test('reconciliation republishes missing events and transitions to processing', async () => {
        // Arrange: Create a wallpaper record in 'stored' state (missing NATS event)
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();
        const storageKey = `${wallpaperId}/original.jpg`;

        // Upload file to S3
        await s3Client.send(
            new PutObjectCommand({
                Bucket: s3Bucket,
                Key: storageKey,
                Body: createTestFileBuffer(),
                ContentType: 'image/jpeg',
            })
        );

        // Insert DB record in 'stored' state (simulating missing event)
        // Note: Missing events reconciliation requires records older than 5 minutes
        await dbPool.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, file_type, mime_type, file_size_bytes,
                width, height, aspect_ratio, storage_key, storage_bucket,
                original_filename, uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '6 minutes', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
            [
                wallpaperId,
                userId,
                'test-hash-456',
                'stored', // Waiting for event publish
                1,
                'image',
                'image/jpeg',
                1024,
                1920,
                1080,
                1.7778,
                storageKey,
                s3Bucket,
                'test-image.jpg', // Required for event publishing
            ]
        );

        // Act: Wait for reconciliation cycle to run
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify upload transitioned to 'processing' state (event published)
        const result = await dbPool.query(
            'SELECT upload_state FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].upload_state).toBe('processing');
    }, 10000);

    test('reconciliation cleans up orphaned intent records', async () => {
        // Arrange: Create old 'initiated' record (>1 hour old)
        const wallpaperId = generateWallpaperId();
        const userId = generateTestUserId();

        // Insert DB record in 'initiated' state from over an hour ago
        await dbPool.query(
            `INSERT INTO wallpapers (
                id, user_id, content_hash, upload_state, state_changed_at,
                upload_attempts, uploaded_at, updated_at
            ) VALUES ($1, $2, $3, $4, NOW() - INTERVAL '2 hours', $5, NOW(), NOW())`,
            [
                wallpaperId,
                userId,
                'test-hash-789',
                'initiated', // Orphaned intent
                0,
            ]
        );

        // Verify record exists before reconciliation
        const beforeResult = await dbPool.query(
            'SELECT id FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );
        expect(beforeResult.rows).toHaveLength(1);

        // Act: Wait for reconciliation cycle to run
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Assert: Verify orphaned intent was deleted
        const afterResult = await dbPool.query(
            'SELECT id FROM wallpapers WHERE id = $1',
            [wallpaperId]
        );
        expect(afterResult.rows).toHaveLength(0);
    }, 10000);

    test('reconciliation cleans up orphaned MinIO objects', async () => {
        // Arrange: Upload file to S3 without corresponding DB record
        const orphanedKey = `wlpr_orphaned_${ulid()}/original.jpg`;

        await s3Client.send(
            new PutObjectCommand({
                Bucket: s3Bucket,
                Key: orphanedKey,
                Body: createTestFileBuffer(),
                ContentType: 'image/jpeg',
            })
        );

        // Verify file exists in S3
        const beforeList = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        expect(beforeList.Contents?.some((obj) => obj.Key === orphanedKey)).toBe(true);

        // Act: Wait for MinIO cleanup cycle to run (2 second interval + buffer)
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Assert: Verify orphaned S3 object was deleted
        const afterList = await s3Client.send(
            new ListObjectsV2Command({ Bucket: s3Bucket })
        );
        // Contents will be undefined if bucket is empty, or an empty array
        const keyExists = afterList.Contents?.some((obj) => obj.Key === orphanedKey) ?? false;
        expect(keyExists).toBe(false);
    }, 10000);
});
