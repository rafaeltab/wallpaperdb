import type { FastifyInstance } from 'fastify';
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { Config } from '../src/config.js';

/**
 * Clean up MinIO test bucket
 */
export async function cleanupMinio(config: Config) {
  const s3Client = new S3Client({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
    forcePathStyle: true,
  });

  try {
    // List all objects in the bucket
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: config.s3Bucket,
      })
    );

    // Delete all objects
    if (listResponse.Contents && listResponse.Contents.length > 0) {
      for (const object of listResponse.Contents) {
        if (object.Key) {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: config.s3Bucket,
              Key: object.Key,
            })
          );
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup MinIO:', error);
    // Don't throw - cleanup is best effort
  }
}

/**
 * Clean up database test data
 * Note: This will be implemented once the database schema is defined
 */
export async function cleanupDatabase(_config: Config) {
  // TODO: Implement once database schema is ready
  // const pool = new Pool({ connectionString: config.databaseUrl });
  // await pool.query('DELETE FROM wallpapers WHERE user_id LIKE $1', ['user_test_%']);
  // await pool.end();
}

/**
 * Upload a file using multipart/form-data
 */
export async function uploadFile(
  fastify: FastifyInstance,
  options: {
    file: Buffer;
    filename: string;
    userId: string;
    mimeType?: string;
  }
) {
  const { file, filename, userId, mimeType = 'image/jpeg' } = options;

  // Create multipart form data manually
  const boundary = `----WebKitFormBoundary${Math.random().toString(36)}`;
  const formData = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '',
    file.toString('binary'),
    `--${boundary}`,
    `Content-Disposition: form-data; name="userId"`,
    '',
    userId,
    `--${boundary}--`,
  ].join('\r\n');

  return fastify.inject({
    method: 'POST',
    url: '/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(formData, 'binary'),
  });
}

/**
 * Upload a file without userId field (to test missing userId error)
 */
export async function uploadFileWithoutUserId(
  fastify: FastifyInstance,
  options: {
    file: Buffer;
    filename: string;
    mimeType?: string;
  }
) {
  const { file, filename, mimeType = 'image/jpeg' } = options;

  // Create multipart form data without userId field
  const boundary = `----WebKitFormBoundary${Math.random().toString(36)}`;
  const formData = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '',
    file.toString('binary'),
    `--${boundary}--`,
  ].join('\r\n');

  return fastify.inject({
    method: 'POST',
    url: '/upload',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.from(formData, 'binary'),
  });
}

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Timeout waiting for condition');
}
