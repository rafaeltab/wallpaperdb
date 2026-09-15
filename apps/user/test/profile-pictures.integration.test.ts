import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { FakeTimerService } from '@wallpaperdb/core/timer';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import sharp from 'sharp';
import { Wait } from 'testcontainers';
import { container } from 'tsyringe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { IdentityProviderToken } from '../src/services/clerk-identity.service.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

describe('Profile picture commands', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let natsContainer: StartedNatsContainer;
  let minioContainer: StartedMinioContainer;
  let sql: ReturnType<typeof postgres>;
  let storage: S3Client;
  let app: FastifyInstance;
  let config: Config;

  beforeAll(async () => {
    [postgresContainer, natsContainer, minioContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(), createNatsContainer(),
      new MinioContainer('minio/minio:latest').withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000)).start(),
    ]);
    sql = postgres(postgresContainer.getConnectionUri(), { max: 10 });
    for (const path of readdirSync(migrations).filter((path) => path.endsWith('.sql')).sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    config = {
      port: 3009, nodeEnv: 'test', databaseUrl: postgresContainer.getConnectionUri(),
      natsUrl: natsContainer.getConnectionUrl(), natsStream: 'WALLPAPER', otelServiceName: 'user-picture-test',
      profileHandleMinLength: 1, profileHandleMaxLength: 20, profileDisplayNameMaxLength: 80, profileRetainedAliasLimit: 3,
      s3Endpoint: minioContainer.getConnectionUrl(), s3AccessKeyId: minioContainer.getUsername(),
      s3SecretAccessKey: minioContainer.getPassword(), s3Region: 'us-east-1', profilePictureBucket: 'profile-pictures',
      profilePictureMaxBytes: 5 * 1024 * 1024, profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024, profilePictureImportTimeoutMs: 10_000,
      profilePictureImportHosts: ['img.clerk.com', 'images.clerk.dev'], userMediaServiceToken: 'test-media-token',
    };
    storage = new S3Client({ endpoint: config.s3Endpoint, region: config.s3Region, forcePathStyle: true,
      credentials: { accessKeyId: minioContainer.getUsername(), secretAccessKey: minioContainer.getPassword() } });
    await storage.send(new CreateBucketCommand({ Bucket: config.profilePictureBucket }));
    container.clearInstances();
    app = await createApp(config, { logger: false, enableOtel: false, aliasExpiryTimer: new FakeTimerService() });
    container.register(IdentityProviderToken, { useValue: { getIdentity: async () => ({ displayName: 'Picture Owner', firstName: null, lastName: null }) } });
  });

  beforeEach(async () => { await sql`truncate table outbox_events, handle_claims, profiles cascade`; });
  afterAll(async () => {
    await app?.close();
    await sql?.end();
    storage?.destroy();
    await Promise.all([postgresContainer?.stop(), natsContainer?.stop(), minioContainer?.stop()]);
  });

  function auth(userId = 'user_picture') {
    return { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: userId })).toString('base64')}` };
  }
  async function ensure(userId = 'user_picture') {
    return app.inject({ method: 'POST', url: '/profile/me/ensure', headers: auth(userId) });
  }
  function upload(bytes: Buffer, version: number, userId = 'user_picture') {
    const boundary = 'picture-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${version}\r\n--${boundary}\r\nContent-Disposition: form-data; name="picture"; filename="avatar.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({ method: 'PUT', url: '/profile/me/picture', headers: { ...auth(userId), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  }

  it('uploads a normalized private picture and atomically publishes its authoritative Profile snapshot', async () => {
    const original = (await ensure()).json();
    const jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#475b83' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const response = await upload(jpeg, original.version);
    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({ id: original.id, version: original.version + 1, pictureAssetId: expect.stringMatching(/^pic_/), pictureImportStatus: 'complete', aliases: original.aliases,
      pictureUploadLimits: { maxBytes: config.profilePictureMaxBytes, maxPixels: config.profilePictureMaxPixels, maxDecodedBytes: config.profilePictureMaxDecodedBytes } });
    expect((await ensure()).json()).toEqual(updated);
    const [event] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'picture-changed'`;
    expect(event.payload).toMatchObject({ change: { before: null, after: updated.pictureAssetId, source: 'upload', asset: { id: updated.pictureAssetId, storageBucket: 'profile-pictures', mimeType: 'image/webp', width: 2, height: 3 } }, profile: { id: original.id, version: updated.version, pictureAssetId: updated.pictureAssetId, aliases: original.aliases } });
    expect(event.payload.profile).not.toHaveProperty('storageKey');
    expect(updated).not.toHaveProperty('storageKey');
    const asset = event.payload.change.asset;
    const object = await storage.send(new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey }));
    const bytes = await object.Body!.transformToByteArray();
    expect(bytes.length).toBe(asset.fileSizeBytes);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 2, height: 3 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });
});
