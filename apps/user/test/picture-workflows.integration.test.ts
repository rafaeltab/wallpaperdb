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
import postgres from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pictures, picturesLayer } from '../src/pictures/index.js';
import { databaseLayer } from '../src/adapters/database/index.js';
import { profileStoreLayer } from '../src/adapters/profiles/index.js';
import {
  pictureStoreLayer,
  pictureStorageLayer,
  pictureSourceLayer,
  pictureCodecLayer,
} from '../src/adapters/pictures/index.js';
import { Profiles, profilesLayer, Identities, type ProfileOutcome } from '../src/profile/index.js';
import type { Config } from '../src/config.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

describe('Profile picture transactions and recovery', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  const StorageTester = createDefaultTesterBuilder()
    .with(DockerTesterBuilder)
    .with(S3TesterBuilder)
    .build();
  const storageTester = new StorageTester().withS3().withS3Bucket('profile-pictures');
  let sql: ReturnType<typeof postgres>;
  let storage: S3Client;
  let config: Config;
  let initialImageUrl: string | undefined;
  let runtime: ReturnType<typeof makeRuntime>;
  const importer = {
    importPending: () =>
      runtime.runPromise(Effect.flatMap(Pictures, (pictures) => pictures.importPending())),
  };
  const ingestion = {
    stage: (profileId: string, bytes: Buffer) =>
      runtime
        .runPromise(Effect.flatMap(Pictures, (pictures) => pictures.stage({ profileId }, bytes)))
        .then((result) => {
          if (result._tag === 'Rejected') throw new Error(result.message);
          return result.assetId;
        }),
  };
  const profiles = {
    adoptPicture: (profileId: string, assetId: string, version: number) =>
      runtime
        .runPromise(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.adoptPicture({ profileId }, assetId, version)
          )
        )
        .then((result) => {
          if (result._tag === 'Rejected') throw new Error(result.message);
          return result.profile;
        }),
  };
  function makeRuntime() {
    const database = databaseLayer({ databaseUrl: config.databaseUrl });
    const profile = profilesLayer(config).pipe(
      Layer.provide(
        Layer.mergeAll(
          profileStoreLayer(config).pipe(Layer.provide(database)),
          Layer.succeed(Identities, {
            getIdentity: () =>
              Effect.succeed({
                displayName: 'Picture Owner',
                firstName: null,
                lastName: null,
                imageUrl: initialImageUrl,
              }),
          })
        )
      )
    );
    const pictures = picturesLayer(config).pipe(
      Layer.provide(
        Layer.mergeAll(
          profile,
          pictureStoreLayer({ bucket: config.profilePictureBucket }).pipe(Layer.provide(database)),
          pictureStorageLayer({
            endpoint: config.s3Endpoint,
            region: config.s3Region,
            accessKeyId: config.s3AccessKeyId,
            secretAccessKey: config.s3SecretAccessKey,
          }).pipe(Layer.provide(database)),
          pictureCodecLayer({
            maxBytes: config.profilePictureMaxBytes,
            maxPixels: config.profilePictureMaxPixels,
            maxDecodedBytes: config.profilePictureMaxDecodedBytes,
          }),
          pictureSourceLayer({
            maxBytes: config.profilePictureMaxBytes,
            timeoutMs: config.profilePictureImportTimeoutMs,
            allowedHosts: config.profilePictureImportHosts,
          })
        )
      )
    );
    return ManagedRuntime.make(Layer.merge(profile, pictures));
  }
  async function restart() {
    await runtime?.dispose();
    runtime = makeRuntime();
  }

  beforeAll(async () => {
    await storageTester.setup();
    const s3 = storageTester.s3.config;
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
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
      natsUrl: 'nats://unused',
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
    await runtime?.dispose();
    await sql?.end();
    storage?.destroy();
    await Promise.all([postgresContainer?.stop(), storageTester.destroy()]);
  });

  const profileResult = (result: ProfileOutcome) => {
    if (result._tag === 'Rejected') throw new Error(result.message);
    return result.profile;
  };
  const ensure = (profileId = 'user_picture') =>
    runtime
      .runPromise(Effect.flatMap(Profiles, (profiles) => profiles.ensure({ profileId })))
      .then(profileResult);
  const uploadOutcome = (bytes: Buffer, version: number, profileId = 'user_picture') =>
    runtime.runPromise(
      Effect.flatMap(Pictures, (pictures) => pictures.upload({ profileId }, bytes, version))
    );
  const upload = (bytes: Buffer, version: number, profileId = 'user_picture') =>
    uploadOutcome(bytes, version, profileId).then((result) => {
      if (result._tag === 'Rejected') throw new Error(result.message);
      if (!result.profile.pictureAssetId) throw new Error('Expected an uploaded picture');
      return { ...result.profile, pictureAssetId: result.profile.pictureAssetId };
    });
  const removeOutcome = (version: number, profileId = 'user_picture') =>
    runtime.runPromise(
      Effect.flatMap(Profiles, (profiles) => profiles.adoptPicture({ profileId }, null, version))
    );
  const remove = (version: number, profileId = 'user_picture') =>
    removeOutcome(version, profileId).then(profileResult);
  const available = (id: string) =>
    runtime.runPromise(Effect.flatMap(Pictures, (pictures) => pictures.pictureAvailable(id)));

  it('retains a removed picture for the configured window from retirement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    config.profileEvidenceRetentionDays = 7;
    await restart();
    try {
      const original = await ensure();
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#475b83' },
      })
        .png()
        .toBuffer();
      const uploaded = await upload(image, original.version);
      vi.setSystemTime(new Date('2030-01-02T00:00:00.000Z'));
      await remove(uploaded.version);
      const [asset] =
        await sql`select state, retired_at, expires_at from profile_picture_assets where id = ${uploaded.pictureAssetId}`;
      expect(asset).toEqual({
        state: 'retired',
        retired_at: new Date('2030-01-02T00:00:00.000Z'),
        expires_at: new Date('2030-01-09T00:00:00.000Z'),
      });
    } finally {
      config.profileEvidenceRetentionDays = 30;
      vi.useRealTimers();
      await restart();
    }
  });

  it('accepts a staged picture before expiry and rejects activation at the deadline without changing current state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = await ensure();
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#475b83' },
      })
        .png()
        .toBuffer();
      const first = await ingestion.stage(original.id, image);
      const expired = await ingestion.stage(original.id, image);
      vi.setSystemTime(new Date('2030-01-30T23:59:59.999Z'));
      const active = await profiles.adoptPicture(original.id, first, original.version);
      const before = await ensure();
      const events = await sql`select id from outbox_events order by id`;
      vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
      expect(
        await runtime.runPromise(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.adoptPicture({ profileId: original.id }, expired, active.version)
          )
        )
      ).toMatchObject({ _tag: 'Rejected', reason: 'picture-unavailable' });
      expect(await ensure()).toEqual(before);
      expect(await sql`select id from outbox_events order by id`).toEqual(events);
      expect(await sql`select id from profile_picture_assets where state = 'active'`).toEqual([
        { id: first },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps manual picture commands scoped to the authenticated Profile', async () => {
    const first = await ensure();
    const second = await ensure('other_owner');
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(image, first.version);
    const otherCommand = await remove(second.version, second.id);
    expect(otherCommand.id).toBe(second.id);
    expect(await ensure()).toEqual(uploaded);
  });

  it('rolls back import completion and manual cancellation when the picture event fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    initialImageUrl = 'https://img.clerk.com/initial-picture';
    const pending = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Uint8Array(image)));
    await sql.unsafe(
      `create function reject_picture_event() returns trigger language plpgsql as $$ begin if NEW.payload->'change'->>'type' = 'picture-changed' then raise exception 'picture event rejected'; end if; return NEW; end $$`
    );
    await sql.unsafe(
      `create trigger reject_picture_event before insert on outbox_events for each row execute function reject_picture_event()`
    );
    try {
      await expect(remove(pending.version)).rejects.toMatchObject({ _tag: 'ProfileUnavailable' });
      expect(await ensure()).toEqual(pending);
      await importer.importPending();
      expect(await ensure()).toMatchObject({
        version: pending.version,
        pictureAssetId: null,
        pictureImportStatus: 'retrying',
      });
      const [job] =
        await sql`select source_url, next_attempt_at from profile_picture_imports where profile_id = ${pending.id}`;
      expect(job.source_url).toBe(initialImageUrl);
      expect(await sql`select state from profile_picture_assets`).toEqual([{ state: 'staged' }]);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
      ).toHaveLength(0);
      await sql.unsafe('drop trigger reject_picture_event on outbox_events');
      vi.setSystemTime(job.next_attempt_at);
      await importer.importPending();
      expect(await ensure()).toMatchObject({
        version: pending.version + 1,
        pictureAssetId: expect.stringMatching(/^pic_/),
        pictureImportStatus: 'complete',
      });
    } finally {
      await sql.unsafe('drop trigger if exists reject_picture_event on outbox_events');
      await sql.unsafe('drop function reject_picture_event()');
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });

  it('runs queued picture imports after ensure has returned without waiting for download', async () => {
    initialImageUrl = 'https://img.clerk.com/scheduled-initial-picture';
    const pending = await ensure();
    expect(pending.pictureImportStatus).toBe('pending');
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(image)));
    try {
      await importer.importPending();
      expect(await ensure()).toMatchObject({
        pictureImportStatus: 'complete',
        pictureAssetId: expect.stringMatching(/^pic_/),
        version: pending.version + 1,
      });
    } finally {
      fetcher.mockRestore();
    }
  });

  it('lets one worker reclaim an expired import lease without accepting the stale attempt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    initialImageUrl = 'https://img.clerk.com/slow-initial-picture';
    const pending = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    let release!: (response: Response) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => {
        started();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      })
      .mockImplementation(async () => new Response(new Uint8Array(image)));
    const first = importer.importPending();
    try {
      await waiting;
      await importer.importPending();
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [lease] =
        await sql`select lease_until from profile_picture_imports where profile_id = ${pending.id}`;
      vi.setSystemTime(lease.lease_until);
      await importer.importPending();
      const winner = await ensure();
      expect(winner).toMatchObject({
        version: pending.version + 1,
        pictureImportStatus: 'complete',
        pictureAssetId: expect.stringMatching(/^pic_/),
      });
      release(new Response(new Uint8Array(image)));
      await first;
      expect(await ensure()).toEqual(winner);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'source' = 'clerk-import'`
      ).toHaveLength(1);
      expect(
        (
          await sql`select status, attempts, source_url from profile_picture_imports where profile_id = ${pending.id}`
        )[0]
      ).toEqual({ status: 'complete', attempts: 2, source_url: null });
      expect(await sql`select id from profile_picture_assets where state = 'active'`).toEqual([
        { id: winner.pictureAssetId },
      ]);
    } finally {
      release?.(new Response(new Uint8Array(image)));
      await first;
      fetcher.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    'upload',
    'remove',
  ])('prevents a late initial import from overwriting manual %s', async (command) => {
    initialImageUrl = 'https://img.clerk.com/slow-initial-picture';
    const pending = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    let release!: (response: Response) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      started();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const importing = importer.importPending();
    try {
      await waiting;
      const response =
        command === 'upload' ? await upload(image, pending.version) : await remove(pending.version);
      const manual = response;
      release(new Response(new Uint8Array(image)));
      await importing;
      expect(await ensure()).toEqual(manual);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'source' = 'clerk-import'`
      ).toHaveLength(0);
      const [staged] = await sql`select * from profile_picture_assets where state = 'staged'`;
      expect(staged).toBeDefined();
      expect(await available(staged.id)).toBe(false);
      expect(
        (
          await sql`select source_url, status from profile_picture_imports where profile_id = ${pending.id}`
        )[0]
      ).toEqual({ source_url: null, status: 'complete' });
    } finally {
      release?.(new Response(new Uint8Array(image)));
      await importing;
      fetcher.mockRestore();
    }
  });

  it.each([
    'upload',
    'remove',
  ])('ends Clerk picture ownership atomically on manual %s, including null removal', async (command) => {
    initialImageUrl = 'https://img.clerk.com/initial-picture';
    const pending = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const response =
      command === 'upload' ? await upload(image, pending.version) : await remove(pending.version);
    const manual = response;
    expect(manual).toMatchObject({
      version: pending.version + 1,
      pictureImportStatus: 'complete',
      pictureAssetId: command === 'upload' ? expect.stringMatching(/^pic_/) : null,
    });
    const [job] = await sql`select * from profile_picture_imports where profile_id = ${pending.id}`;
    expect(job).toMatchObject({
      status: 'complete',
      source_url: null,
      lease_token: null,
      lease_until: null,
    });
    const [event] =
      await sql`select payload from outbox_events where payload->'change'->>'type' = 'picture-changed'`;
    expect(event.payload).toMatchObject({
      change: {
        type: 'picture-changed',
        before: null,
        after: manual.pictureAssetId,
        source: command,
      },
      profile: { version: manual.version },
    });
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Clerk is no longer authoritative'));
    try {
      initialImageUrl = 'https://img.clerk.com/later-picture';
      await importer.importPending();
      expect(await ensure()).toEqual(manual);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it('imports the captured initial picture asynchronously using the latest Profile version', async () => {
    initialImageUrl = 'https://img.clerk.com/initial-picture?private=initial-secret';
    const pending = await ensure();
    const renamed = await runtime
      .runPromise(
        Effect.flatMap(Profiles, (profiles) =>
          profiles.updateDetails(
            { profileId: pending.id },
            { displayName: 'Edited While Importing' },
            pending.version
          )
        )
      )
      .then(profileResult);
    initialImageUrl = 'https://img.clerk.com/later-picture';
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(image)));
    try {
      await importer.importPending();
      const imported = await ensure();
      expect(imported).toMatchObject({
        pictureAssetId: expect.stringMatching(/^pic_/),
        pictureImportStatus: 'complete',
        version: renamed.version + 1,
        displayName: renamed.displayName,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe(
        'https://img.clerk.com/initial-picture?private=initial-secret'
      );
      const [job] =
        await sql`select * from profile_picture_imports where profile_id = ${pending.id}`;
      expect(job).toMatchObject({
        source_url: null,
        status: 'complete',
        lease_token: null,
        lease_until: null,
      });
      const [event] =
        await sql`select payload from outbox_events where payload->'change'->>'source' = 'clerk-import'`;
      expect(event.payload).toMatchObject({
        change: {
          type: 'picture-changed',
          source: 'clerk-import',
          before: null,
          after: imported.pictureAssetId,
        },
        profile: {
          version: imported.version,
          displayName: renamed.displayName,
          aliases: imported.aliases,
        },
      });
      await importer.importPending();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await ensure()).toEqual(imported);
    } finally {
      fetcher.mockRestore();
    }
  });

  it('captures the initial Clerk picture privately without downloading or blocking Profile creation', async () => {
    initialImageUrl = 'https://img.clerk.com/initial-picture?private=initial-secret';
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Image service unavailable'));
    try {
      const response = await ensure();
      const profile = response;
      expect(profile).toMatchObject({
        pictureAssetId: null,
        pictureImportStatus: 'pending',
        version: 1,
      });
      expect(fetcher).not.toHaveBeenCalled();
      const [job] =
        await sql`select * from profile_picture_imports where profile_id = ${profile.id}`;
      expect(job).toMatchObject({ source_url: initialImageUrl, status: 'pending', attempts: 0 });
      initialImageUrl = 'https://img.clerk.com/later-picture';
      expect(await ensure()).toEqual(profile);
      expect(
        (
          await sql`select source_url from profile_picture_imports where profile_id = ${profile.id}`
        )[0].source_url
      ).toBe(job.source_url);
      expect(JSON.stringify(profile)).not.toContain('initial-secret');
      expect(JSON.stringify(await sql`select payload from outbox_events`)).not.toContain(
        'initial-secret'
      );
    } finally {
      fetcher.mockRestore();
    }
  });

  it('serializes competing picture uploads so only one command activates at a Profile version', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const results = await Promise.all([
      uploadOutcome(image, original.version),
      uploadOutcome(image, original.version),
    ]);
    expect(results.map((result) => result._tag).sort()).toEqual(['Rejected', 'Success']);
    expect(results.find((result) => result._tag === 'Rejected')).toMatchObject({
      reason: 'version-conflict',
    });
    const winningResponse = results.find((result) => result._tag === 'Success');
    if (!winningResponse || winningResponse._tag !== 'Success')
      throw new Error('Expected one successful picture upload');
    const winner = winningResponse.profile;
    expect(await ensure()).toEqual(winner);
    const assets = await sql`select * from profile_picture_assets`;
    expect(assets.filter((asset) => asset.state === 'active').map((asset) => asset.id)).toEqual([
      winner.pictureAssetId,
    ]);
    expect(assets.filter((asset) => asset.state === 'staged')).toHaveLength(1);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
    ).toHaveLength(1);
  });

  it('rolls back picture activation and retirement when the event cannot commit', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(image, original.version);
    await sql.unsafe(
      `create function reject_picture_event() returns trigger language plpgsql as $$ begin if NEW.payload->'change'->>'type' = 'picture-changed' then raise exception 'picture event rejected'; end if; return NEW; end $$`
    );
    await sql.unsafe(
      `create trigger reject_picture_event before insert on outbox_events for each row execute function reject_picture_event()`
    );
    try {
      await expect(upload(image, uploaded.version)).rejects.toMatchObject({
        _tag: 'ProfileUnavailable',
      });
      await expect(remove(uploaded.version)).rejects.toMatchObject({ _tag: 'ProfileUnavailable' });
      expect(await ensure()).toEqual(uploaded);
      const rows = await sql`select * from profile_picture_assets order by created_at`;
      expect(rows.map((row) => row.state)).toEqual(['active', 'staged']);
      expect(rows[0].retired_at).toBeNull();
      expect(rows[0].expires_at).toBeNull();
      for (const asset of rows)
        expect(
          (
            await storage.send(
              new GetObjectCommand({ Bucket: asset.storage_bucket, Key: asset.storage_key })
            )
          ).ContentLength
        ).toBeGreaterThan(0);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
      ).toHaveLength(1);
    } finally {
      await sql.unsafe('drop trigger reject_picture_event on outbox_events');
      await sql.unsafe('drop function reject_picture_event()');
    }
  });

  it('leaves a known private candidate on storage failure and keeps the current picture authoritative', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(image, original.version);
    const bucket = config.profilePictureBucket;
    config.profilePictureBucket = 'missing-picture-bucket';
    await restart();
    try {
      await expect(upload(image, uploaded.version)).rejects.toMatchObject({
        _tag: 'PictureUnavailable',
        operation: 'put-picture',
      });
      expect(await ensure()).toEqual(uploaded);
      const [staged] = await sql`select * from profile_picture_assets where state = 'uploading'`;
      expect(staged.expires_at.getTime() - staged.created_at.getTime()).toBe(
        30 * 24 * 60 * 60 * 1000
      );
      expect(await available(staged.id)).toBe(false);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
      ).toHaveLength(1);
    } finally {
      config.profilePictureBucket = bucket;
      await restart();
    }
  });

  it('reports invalid and oversized uploads without publishing or staging them', async () => {
    const original = await ensure();
    const invalid = await uploadOutcome(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      original.version
    );
    expect(invalid).toMatchObject({ _tag: 'Rejected', reason: 'invalid-picture' });
    const tooLarge = await uploadOutcome(
      Buffer.alloc(config.profilePictureMaxBytes + 1),
      original.version
    );
    expect(tooLarge).toMatchObject({ _tag: 'Rejected', reason: 'picture-too-large' });
    expect(await ensure()).toEqual(original);
    expect(await sql`select id from profile_picture_assets`).toHaveLength(0);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
    ).toHaveLength(0);
  });

  it('rejects stale picture commands with version conflicts without changing public state', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(image, original.version);
    const staleUpload = await uploadOutcome(image, original.version);
    expect(staleUpload).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    const staleDelete = await removeOutcome(original.version);
    expect(staleDelete).toMatchObject({ _tag: 'Rejected', reason: 'version-conflict' });
    expect(await ensure()).toEqual(uploaded);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
    ).toHaveLength(1);
  });

  it('removes the picture with an authoritative null snapshot and preserves its private bytes', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = await upload(image, original.version);
    const response = await remove(uploaded.version);
    const removed = response;
    expect(removed).toMatchObject({
      pictureAssetId: null,
      pictureImportStatus: 'complete',
      version: uploaded.version + 1,
    });
    expect(await ensure()).toEqual(removed);
    const check = await available(uploaded.pictureAssetId);
    expect(check).toBe(false);
    const [old] =
      await sql`select * from profile_picture_assets where id = ${uploaded.pictureAssetId}`;
    expect(old.state).toBe('retired');
    expect(old.expires_at.getTime() - old.retired_at.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(
      (
        await storage.send(
          new GetObjectCommand({ Bucket: old.storage_bucket, Key: old.storage_key })
        )
      ).ContentLength
    ).toBeGreaterThan(0);
    const [event] =
      await sql`select payload from outbox_events where payload->'change'->>'source' = 'remove'`;
    expect(event.payload).toMatchObject({
      change: {
        type: 'picture-changed',
        source: 'remove',
        before: uploaded.pictureAssetId,
        after: null,
        asset: null,
      },
      profile: { pictureAssetId: null, version: removed.version, aliases: removed.aliases },
    });
    expect(await remove(removed.version)).toEqual(removed);
  });

  it('replaces a picture with a new immutable ID and immediately retires old public delivery for thirty days', async () => {
    const original = await ensure();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const first = await upload(image, original.version);
    const secondResponse = await upload(image, first.version);
    const second = secondResponse;
    expect(second.pictureAssetId).not.toBe(first.pictureAssetId);
    expect(second.version).toBe(first.version + 1);
    const [old] =
      await sql`select * from profile_picture_assets where id = ${first.pictureAssetId}`;
    expect(old.state).toBe('retired');
    expect(old.retired_at).toEqual(second.updatedAt);
    expect(old.expires_at.getTime() - old.retired_at.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(await available(first.pictureAssetId)).toBe(false);
    expect(await available(second.pictureAssetId)).toBe(true);
    expect(
      (
        await storage.send(
          new GetObjectCommand({ Bucket: old.storage_bucket, Key: old.storage_key })
        )
      ).ContentLength
    ).toBeGreaterThan(0);
    expect(
      (await fetch(`${config.s3Endpoint}/${old.storage_bucket}/${old.storage_key}`)).status
    ).toBe(403);
    const [event] =
      await sql`select payload from outbox_events where payload->'change'->>'after' = ${second.pictureAssetId}`;
    expect(event.payload).toMatchObject({
      change: {
        type: 'picture-changed',
        before: first.pictureAssetId,
        after: second.pictureAssetId,
      },
      profile: { pictureAssetId: second.pictureAssetId, version: second.version },
    });
  });
});
