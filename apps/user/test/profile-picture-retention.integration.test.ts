import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createDefaultTesterBuilder, DockerTesterBuilder, S3TesterBuilder } from '@wallpaperdb/test-utils';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { DatabaseConnection } from '../src/connections/database.js';
import { ProfilePictureIngestionService } from '../src/services/profile-picture-ingestion.service.js';
import { ProfilePictureRetentionService } from '../src/services/profile-picture-retention.service.js';
import { ProfilePictureStorage } from '../src/services/profile-picture-storage.js';
import { ProfileService } from '../src/services/profile.service.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const day = 24 * 60 * 60 * 1000;

describe('Private Profile picture retention', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  const StorageTester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const storageTester = new StorageTester().withS3().withS3Bucket('profile-pictures');
  let sql: ReturnType<typeof postgres>;
  let database: DatabaseConnection;
  let objectStorage: S3Client;
  let storage: ProfilePictureStorage;
  let profiles: ProfileService;
  let ingestion: ProfilePictureIngestionService;
  let retention: ProfilePictureRetentionService;
  let config: Config;
  let picture: Buffer;
  const errors: Array<{ bindings: object; message: string }> = [];
  const logger = { error: (bindings: object, message: string) => { errors.push({ bindings, message }); } };

  beforeAll(async () => {
    await storageTester.setup();
    const s3 = storageTester.s3.config;
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    sql = postgres(postgresContainer.getConnectionUri(), { max: 10 });
    for (const path of readdirSync(migrations).filter((path) => path.endsWith('.sql')).sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    config = {
      port: 3009, nodeEnv: 'test', databaseUrl: postgresContainer.getConnectionUri(),
      natsUrl: 'nats://127.0.0.1:4222', natsStream: 'WALLPAPER', otelServiceName: 'picture-retention-test',
      profileHandleMinLength: 1, profileHandleMaxLength: 20, profileDisplayNameMaxLength: 80,
      profileBiographyMaxLength: 5000, profileRetainedAliasLimit: 3, profileEvidenceRetentionDays: 30,
      s3Endpoint: s3.endpoints.fromHost, s3AccessKeyId: s3.options.accessKey,
      s3SecretAccessKey: s3.options.secretKey, s3Region: 'us-east-1', profilePictureBucket: 'profile-pictures',
      profilePictureMaxBytes: 5 * 1024 * 1024, profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024, profilePictureImportTimeoutMs: 10_000,
      profilePictureImportHosts: ['img.clerk.com'],
    };
    database = new DatabaseConnection(config);
    await database.initialize();
    objectStorage = storageTester.s3.getS3Client();
    storage = new ProfilePictureStorage(config);
    profiles = new ProfileService(database, {
      getIdentity: async () => ({ displayName: 'Picture Owner', firstName: null, lastName: null }),
    }, config);
    ingestion = new ProfilePictureIngestionService(database, profiles, storage, config);
    picture = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#475b83' } }).png().toBuffer();
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, profiles cascade`;
    errors.length = 0;
    retention = new ProfilePictureRetentionService(database, storage, logger);
  });

  afterAll(async () => {
    vi.useRealTimers();
    storage?.close();
    objectStorage?.destroy();
    await database?.close();
    await sql?.end();
    await Promise.all([postgresContainer?.stop(), storageTester.destroy()]);
  });

  async function object(assetId: string, profileId = 'user_picture') {
    return objectStorage.send(new GetObjectCommand({
      Bucket: config.profilePictureBucket, Key: `${profileId}/${assetId}.webp`,
    }));
  }

  it('deletes a retired private picture at its deadline while preserving the current Profile and picture', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const owner = await profiles.ensure('user_picture');
      const first = await ingestion.upload(owner.id, picture, owner.version);
      const second = await ingestion.upload(owner.id, picture, first.version);
      const expiresAt = new Date(Date.now() + 30 * day);
      expect(await retention.cleanupExpired(new Date(expiresAt.getTime() - 1))).toEqual({ deleted: 0, failed: 0 });
      expect((await object(first.pictureAssetId!)).ContentType).toBe('image/webp');
      expect(await retention.cleanupExpired(expiresAt)).toEqual({ deleted: 1, failed: 0 });
      await expect(object(first.pictureAssetId!)).rejects.toMatchObject({ name: 'NoSuchKey' });
      expect((await object(second.pictureAssetId!)).ContentType).toBe('image/webp');
      expect(await profiles.ensure(owner.id)).toEqual(second);
      expect(await sql`select id, state from profile_picture_assets`).toEqual([{ id: second.pictureAssetId, state: 'active' }]);
      expect(await retention.cleanupExpired(expiresAt)).toEqual({ deleted: 0, failed: 0 });
    } finally { vi.useRealTimers(); }
  });

  it('keeps deletion evidence after failed or ambiguous storage replies and retries an already missing object', async () => {
    const owner = await profiles.ensure('user_picture');
    const first = await ingestion.upload(owner.id, picture, owner.version);
    await profiles.adoptPicture(owner.id, null, first.version);
    const [asset] = await sql`select * from profile_picture_assets where id = ${first.pictureAssetId!}`;
    const unavailable = vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(new Error('S3 unavailable'));
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 1 });
    } finally { unavailable.mockRestore(); }
    expect((await object(asset.id)).ContentType).toBe('image/webp');
    expect(await sql`select id from profile_picture_assets`).toEqual([{ id: asset.id }]);

    const ambiguous = vi.spyOn(S3Client.prototype, 'send').mockImplementationOnce(async () => {
      ambiguous.mockRestore();
      await objectStorage.send(new DeleteObjectCommand({ Bucket: asset.storage_bucket, Key: asset.storage_key }));
      throw new Error('Reply lost after S3 accepted deletion');
    });
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 1 });
    } finally { ambiguous.mockRestore(); }
    await expect(object(asset.id)).rejects.toMatchObject({ name: 'NoSuchKey' });
    expect(await sql`select id from profile_picture_assets`).toEqual([{ id: asset.id }]);
    expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
    expect(await sql`select id from profile_picture_assets`).toHaveLength(0);
  });

  it('bounds each scan and advances beyond a full failed batch before retrying older objects', async () => {
    const owner = await profiles.ensure('user_picture');
    const first = await ingestion.upload(owner.id, picture, owner.version);
    await profiles.adoptPicture(owner.id, null, first.version);
    const [asset] = await sql`select * from profile_picture_assets where id = ${first.pictureAssetId!}`;
    await sql`
      insert into profile_picture_assets
        (id, profile_id, storage_bucket, storage_key, mime_type, width, height, file_size_bytes, state, expires_at)
      select 'a_failed_' || lpad(i::text, 3, '0'), ${owner.id}, ${asset.storage_bucket},
        'failed-' || i, 'image/webp', 2, 2, 1, 'retired', ${asset.expires_at}
      from generate_series(1, 100) i
    `;
    const unavailable = vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('S3 unavailable'));
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 100 });
      expect(unavailable).toHaveBeenCalledTimes(100);
    } finally { unavailable.mockRestore(); }
    expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
    await expect(object(asset.id)).rejects.toMatchObject({ name: 'NoSuchKey' });
    expect(await sql`select id from profile_picture_assets`).toHaveLength(100);
    expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 100, failed: 0 });
    expect(await sql`select id from profile_picture_assets`).toHaveLength(0);
  });

  it('expires an unadopted private candidate at its configured staging deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const owner = await profiles.ensure('user_picture');
      const shorterIngestion = new ProfilePictureIngestionService(database, profiles, storage, {
        ...config, profileEvidenceRetentionDays: 7,
      });
      const assetId = await shorterIngestion.stage(owner.id, picture);
      const [asset] = await sql`select expires_at from profile_picture_assets where id = ${assetId}`;
      expect(asset.expires_at).toEqual(new Date(Date.now() + 7 * day));
      expect(await retention.cleanupExpired(new Date(asset.expires_at.getTime() - 1))).toEqual({ deleted: 0, failed: 0 });
      expect((await object(assetId)).ContentType).toBe('image/webp');
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
      await expect(object(assetId)).rejects.toMatchObject({ name: 'NoSuchKey' });
      expect(await profiles.ensure(owner.id)).toEqual(owner);
    } finally { vi.useRealTimers(); }
  });

  it('skips an expired candidate while its PUT is in flight and cleans it after the write settles', async () => {
    const owner = await profiles.ensure('user_picture');
    let started!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const stalled = vi.spyOn(S3Client.prototype, 'send').mockImplementationOnce(async (command) => {
      stalled.mockRestore();
      started();
      await blocked;
      return objectStorage.send(command);
    });
    const staging = ingestion.stage(owner.id, picture);
    try {
      await writing;
      const [asset] = await sql`select * from profile_picture_assets where profile_id = ${owner.id}`;
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 0 });
      release();
      expect(await staging).toBe(asset.id);
      expect((await object(asset.id)).ContentType).toBe('image/webp');
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
      await expect(object(asset.id)).rejects.toMatchObject({ name: 'NoSuchKey' });
    } finally {
      release();
      await staging;
      stalled.mockRestore();
    }
  });

  it('identifies each failed picture cleanup without logging storage credentials or object content', async () => {
    const owner = await profiles.ensure('user_picture');
    const assetId = await ingestion.stage(owner.id, picture);
    const [asset] = await sql`select expires_at from profile_picture_assets where id = ${assetId}`;
    const unavailable = vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(new Error('private storage credentials'));
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 1 });
      expect(errors).toEqual([{
        bindings: { category: 'profile-picture-retention', assetId },
        message: 'Profile picture cleanup failed; will retry',
      }]);
    } finally { unavailable.mockRestore(); }
  });

  it('preserves a picture adopted after the cleanup candidate scan', async () => {
    const firstOwner = await profiles.ensure('first_picture');
    const firstId = await ingestion.stage(firstOwner.id, picture);
    const owner = await profiles.ensure('user_picture');
    const adoptedId = await ingestion.stage(owner.id, picture);
    const [asset] = await sql`select expires_at from profile_picture_assets where id = ${adoptedId}`;
    // The first DELETE is the barrier: both candidates were selected, but the
    // second Profile can still adopt its candidate before cleanup locks it.
    const deleting = vi.spyOn(S3Client.prototype, 'send').mockImplementationOnce(async (command) => {
      deleting.mockRestore();
      await profiles.adoptPicture(owner.id, adoptedId, owner.version);
      return objectStorage.send(command);
    });
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
      expect(await profiles.ensure(owner.id)).toMatchObject({ pictureAssetId: adoptedId, version: owner.version + 1 });
      expect((await object(adoptedId)).ContentType).toBe('image/webp');
      await expect(object(firstId, firstOwner.id)).rejects.toMatchObject({ name: 'NoSuchKey' });
      expect(await sql`select id, state, expires_at from profile_picture_assets`).toEqual([
        { id: adoptedId, state: 'active', expires_at: null },
      ]);
    } finally { deleting.mockRestore(); }
  });

  it('preserves a currently referenced picture even if its asset state incorrectly says retired', async () => {
    const owner = await profiles.ensure('user_picture');
    const current = await ingestion.upload(owner.id, picture, owner.version);
    const expiresAt = new Date();
    await sql`update profile_picture_assets set state = 'retired', expires_at = ${expiresAt} where id = ${current.pictureAssetId!}`;
    expect(await retention.cleanupExpired(expiresAt)).toEqual({ deleted: 0, failed: 0 });
    expect((await object(current.pictureAssetId!)).ContentType).toBe('image/webp');
    expect(await profiles.ensure(owner.id)).toEqual(current);
    expect(await sql`select id from profile_picture_assets`).toEqual([{ id: current.pictureAssetId }]);
  });

  it('retries the retained cleanup record after S3 succeeds but its database deletion rolls back', async () => {
    const owner = await profiles.ensure('user_picture');
    const assetId = await ingestion.stage(owner.id, picture);
    const [asset] = await sql`select expires_at from profile_picture_assets where id = ${assetId}`;
    await sql.unsafe(`create function reject_picture_cleanup() returns trigger language plpgsql as $$ begin raise exception 'picture cleanup rejected'; end $$`);
    await sql.unsafe('create trigger reject_picture_cleanup before delete on profile_picture_assets for each row execute function reject_picture_cleanup()');
    try {
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 0, failed: 1 });
      await expect(object(assetId)).rejects.toMatchObject({ name: 'NoSuchKey' });
      expect(await sql`select id from profile_picture_assets`).toEqual([{ id: assetId }]);
    } finally {
      await sql.unsafe('drop trigger reject_picture_cleanup on profile_picture_assets');
      await sql.unsafe('drop function reject_picture_cleanup()');
    }
    expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
    expect(await sql`select id from profile_picture_assets`).toHaveLength(0);
  });

  it('refuses to start a PUT if its candidate expires while waiting for the Profile lock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const owner = await profiles.ensure('user_picture');
    let locked!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => { locked = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const locking = sql.begin(async (tx) => {
      // A non-key update lock permits the staging FK insert while blocking the
      // stronger Profile lock required immediately before uploading bytes.
      await tx`select id from profiles where id = ${owner.id} for no key update`;
      locked();
      await blocked;
    });
    await holding;
    const sending = vi.spyOn(S3Client.prototype, 'send');
    const staging = ingestion.stage(owner.id, picture).then((id) => id, (error: unknown) => error);
    try {
      await vi.waitFor(async () => {
        expect(await sql`select id from profile_picture_assets`).toHaveLength(1);
      });
      const [asset] = await sql`select id, expires_at from profile_picture_assets`;
      vi.setSystemTime(asset.expires_at);
      release();
      await locking;
      expect(await staging).toEqual(new Error('Staged Profile picture expired before its upload could start'));
      expect(sending).not.toHaveBeenCalled();
      expect(await sql`select id from profile_picture_assets`).toEqual([{ id: asset.id }]);
      expect(await retention.cleanupExpired(asset.expires_at)).toEqual({ deleted: 1, failed: 0 });
    } finally {
      release();
      await locking;
      await staging;
      sending.mockRestore();
      vi.useRealTimers();
    }
  });
});
