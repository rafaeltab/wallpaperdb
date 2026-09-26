import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from '@wallpaperdb/test-utils';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { connect } from 'nats';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userLayer } from '../src/app.js';
import { createHttpApp } from '../src/http/index.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { Config } from '../src/config.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

describe('Profile picture commands', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let natsContainer: StartedNatsContainer;
  const StorageTester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const storageTester = new StorageTester().withS3().withS3Bucket('profile-pictures');
  let sql: ReturnType<typeof postgres>;
  let storage: S3Client;
  let app: FastifyInstance;
  let config: Config;
  let initialImageUrl: string | undefined;
  let runtime: ReturnType<typeof makeRuntime>;
  function makeRuntime() {
    return ManagedRuntime.make(
      userLayer(config, {
        workers: false,
        identities: {
          getIdentity: () =>
            Effect.succeed({
              displayName: 'Picture Owner',
              firstName: null,
              lastName: null,
              imageUrl: initialImageUrl,
            }),
        },
      })
    );
  }
  async function restart() {
    await app?.close();
    await runtime?.dispose();
    runtime = makeRuntime();
    app = await createHttpApp(config, Layer.succeedContext(await runtime.context()), {
      logger: false,
    });
  }

  beforeAll(async () => {
    await storageTester.setup();
    const s3 = storageTester.s3.config;
    [postgresContainer, natsContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      createNatsContainer(),
    ]);
    const streamConnection = await connect({ servers: natsContainer.getConnectionUrl() });
    await (await streamConnection.jetstreamManager()).streams.add({
      name: 'WALLPAPER',
      subjects: ['wallpaper.>'],
    });
    await streamConnection.close();
    sql = postgres(postgresContainer.getConnectionUri(), { max: 10 });
    for (const path of readdirSync(migrations)
      .filter((path) => path.endsWith('.sql'))
      .sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    config = {
      port: 3009,
      nodeEnv: 'test',
      databaseUrl: postgresContainer.getConnectionUri(),
      natsUrl: natsContainer.getConnectionUrl(),
      natsStream: 'WALLPAPER',
      otelServiceName: 'user-picture-test',
      profileHandleMinLength: 1,
      profileHandleMaxLength: 20,
      profileDisplayNameMaxLength: 80,
      profileBiographyMaxLength: 5000,
      profileRetainedAliasLimit: 3,
      profileEvidenceRetentionDays: 30,
      s3Endpoint: s3.endpoints.fromHost,
      s3AccessKeyId: s3.options.accessKey,
      s3SecretAccessKey: s3.options.secretKey,
      s3Region: 'us-east-1',
      assetReferenceBucket: 'asset-references',
      profilePictureBucket: 'profile-pictures',
      profilePictureMaxBytes: 5 * 1024 * 1024,
      profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024,
      profilePictureImportTimeoutMs: 10_000,
      profilePictureImportHosts: ['img.clerk.com', 'images.clerk.dev'],
      userMediaServiceToken: 'test-media-token',
    };
    storage = storageTester.s3.getS3Client();
    await restart();
  });

  beforeEach(async () => {
    initialImageUrl = undefined;
    await sql`truncate table outbox_events, handle_claims, profiles cascade`;
  });
  afterAll(async () => {
    await app?.close();
    await runtime?.dispose();
    await sql?.end();
    storage?.destroy();
    await Promise.all([postgresContainer?.stop(), natsContainer?.stop(), storageTester.destroy()]);
  });

  function auth(userId = 'user_picture') {
    return {
      authorization: `Bearer ${Buffer.from(JSON.stringify({ id: userId })).toString('base64')}`,
    };
  }
  async function ensure(userId = 'user_picture') {
    return app.inject({ method: 'POST', url: '/profile/me/ensure', headers: auth(userId) });
  }
  function upload(bytes: Buffer, version: number, userId = 'user_picture') {
    const boundary = 'picture-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="expectedVersion"\r\n\r\n${version}\r\n--${boundary}\r\nContent-Disposition: form-data; name="picture"; filename="avatar.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: 'PUT',
      url: '/profile/me/picture',
      headers: { ...auth(userId), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
  }

  it('authorizes public delivery only for an active current asset while storage remains private', async () => {
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, original.version)).json();
    const url = `/internal/profile-pictures/${uploaded.pictureAssetId}/availability`;
    const active = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer test-media-token' },
    });
    expect(active.statusCode).toBe(204);
    expect(active.headers['cache-control']).toBe('no-store');
    for (const authorization of [undefined, 'Bearer wrong-token', auth().authorization]) {
      const denied = await app.inject({
        method: 'GET',
        url,
        headers: authorization ? { authorization } : {},
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers['cache-control']).toBe('no-store');
    }
    const unknown = await app.inject({
      method: 'GET',
      url: '/internal/profile-pictures/pic_unknown/availability',
      headers: { authorization: 'Bearer test-media-token' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.headers['cache-control']).toBe('no-store');
    const [event] =
      await sql`select payload from outbox_events where payload->'change'->>'type' = 'picture-changed'`;
    const asset = event.payload.change.asset;
    expect(
      (await fetch(`${config.s3Endpoint}/${asset.storageBucket}/${asset.storageKey}`)).status
    ).toBe(403);
    expect(
      (
        await storage.send(
          new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey })
        )
      ).ContentLength
    ).toBeGreaterThan(0);
  });

  it('uploads a normalized private picture and atomically publishes its authoritative Profile snapshot', async () => {
    const original = (await ensure()).json();
    const jpeg = await sharp({
      create: { width: 3, height: 2, channels: 3, background: '#475b83' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const response = await upload(jpeg, original.version);
    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({
      id: original.id,
      version: original.version + 1,
      pictureAssetId: expect.stringMatching(/^pic_/),
      pictureImportStatus: 'complete',
      aliases: original.aliases,
      pictureUploadLimits: {
        maxBytes: config.profilePictureMaxBytes,
        maxPixels: config.profilePictureMaxPixels,
        maxDecodedBytes: config.profilePictureMaxDecodedBytes,
      },
    });
    expect((await ensure()).json()).toEqual(updated);
    const [event] =
      await sql`select payload from outbox_events where payload->'change'->>'type' = 'picture-changed'`;
    expect(event.payload).toMatchObject({
      change: {
        before: null,
        after: updated.pictureAssetId,
        source: 'upload',
        asset: {
          id: updated.pictureAssetId,
          storageBucket: 'profile-pictures',
          mimeType: 'image/webp',
          width: 2,
          height: 3,
        },
      },
      profile: {
        id: original.id,
        version: updated.version,
        pictureAssetId: updated.pictureAssetId,
        aliases: original.aliases,
      },
    });
    expect(event.payload.profile).not.toHaveProperty('storageKey');
    expect(updated).not.toHaveProperty('storageKey');
    const asset = event.payload.change.asset;
    const object = await storage.send(
      new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey })
    );
    if (!object.Body) throw new Error('Expected stored picture bytes');
    const bytes = await object.Body.transformToByteArray();
    expect(bytes.length).toBe(asset.fileSizeBytes);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 2, height: 3 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });
});
