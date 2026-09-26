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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userLayer } from '../src/app.js';
import { createHttpApp } from '../src/http/index.js';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Pictures } from '../src/pictures/index.js';
import { Profiles } from '../src/profile/index.js';
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

  it('retains a removed picture for the configured window from retirement', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    config.profileEvidenceRetentionDays = 7;
    await restart();
    try {
      const original = (await ensure()).json();
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#475b83' },
      })
        .png()
        .toBuffer();
      const uploaded = (await upload(image, original.version)).json();
      vi.setSystemTime(new Date('2030-01-02T00:00:00.000Z'));
      const removed = await app.inject({
        method: 'DELETE',
        url: '/profile/me/picture',
        headers: auth(),
        payload: { expectedVersion: uploaded.version },
      });
      expect(removed.statusCode).toBe(200);
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
      const original = (await ensure()).json();
      const image = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#475b83' },
      })
        .png()
        .toBuffer();
      const first = await ingestion.stage(original.id, image);
      const expired = await ingestion.stage(original.id, image);
      vi.setSystemTime(new Date('2030-01-30T23:59:59.999Z'));
      const active = await profiles.adoptPicture(original.id, first, original.version);
      const before = (await ensure()).json();
      const events = await sql`select id from outbox_events order by id`;
      vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
      expect(
        await runtime.runPromise(
          Effect.flatMap(Profiles, (profiles) =>
            profiles.adoptPicture({ profileId: original.id }, expired, active.version)
          )
        )
      ).toMatchObject({ _tag: 'Rejected', reason: 'picture-unavailable' });
      expect((await ensure()).json()).toEqual(before);
      expect(await sql`select id from outbox_events order by id`).toEqual(events);
      expect(await sql`select id from profile_picture_assets where state = 'active'`).toEqual([
        { id: first },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('requires owner authentication and keeps picture commands scoped to that Profile', async () => {
    for (const method of ['PUT', 'DELETE'] as const) {
      expect(
        (await app.inject({ method, url: '/profile/me/picture', payload: { expectedVersion: 1 } }))
          .statusCode
      ).toBe(401);
    }
    const first = (await ensure()).json();
    const second = (await ensure('other_owner')).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, first.version)).json();
    const otherCommand = await app.inject({
      method: 'DELETE',
      url: '/profile/me/picture',
      headers: auth(second.id),
      payload: { expectedVersion: second.version },
    });
    expect(otherCommand.statusCode).toBe(200);
    expect(otherCommand.json().id).toBe(second.id);
    expect((await ensure()).json()).toEqual(uploaded);
  });

  it('rolls back import completion and manual cancellation when the picture event fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    initialImageUrl = 'https://img.clerk.com/initial-picture';
    const pending = (await ensure()).json();
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
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/profile/me/picture',
            headers: auth(),
            payload: { expectedVersion: pending.version },
          })
        ).statusCode
      ).toBe(500);
      expect((await ensure()).json()).toEqual(pending);
      await importer.importPending();
      expect((await ensure()).json()).toMatchObject({
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
      expect((await ensure()).json()).toMatchObject({
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
    const pending = (await ensure()).json();
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
      expect((await ensure()).json()).toMatchObject({
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
    const pending = (await ensure()).json();
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
      const winner = (await ensure()).json();
      expect(winner).toMatchObject({
        version: pending.version + 1,
        pictureImportStatus: 'complete',
        pictureAssetId: expect.stringMatching(/^pic_/),
      });
      release(new Response(new Uint8Array(image)));
      await first;
      expect((await ensure()).json()).toEqual(winner);
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
    const pending = (await ensure()).json();
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
        command === 'upload'
          ? await upload(image, pending.version)
          : await app.inject({
              method: 'DELETE',
              url: '/profile/me/picture',
              headers: auth(),
              payload: { expectedVersion: pending.version },
            });
      expect(response.statusCode).toBe(200);
      const manual = response.json();
      release(new Response(new Uint8Array(image)));
      await importing;
      expect((await ensure()).json()).toEqual(manual);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'source' = 'clerk-import'`
      ).toHaveLength(0);
      const [staged] = await sql`select * from profile_picture_assets where state = 'staged'`;
      expect(staged).toBeDefined();
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/internal/profile-pictures/${staged.id}/availability`,
            headers: { authorization: 'Bearer test-media-token' },
          })
        ).statusCode
      ).toBe(404);
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
    const pending = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const response =
      command === 'upload'
        ? await upload(image, pending.version)
        : await app.inject({
            method: 'DELETE',
            url: '/profile/me/picture',
            headers: auth(),
            payload: { expectedVersion: pending.version },
          });
    expect(response.statusCode).toBe(200);
    const manual = response.json();
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
      expect((await ensure()).json()).toEqual(manual);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it('imports the captured initial picture asynchronously using the latest Profile version', async () => {
    initialImageUrl = 'https://img.clerk.com/initial-picture?private=initial-secret';
    const pending = (await ensure()).json();
    const renamed = (
      await app.inject({
        method: 'PATCH',
        url: '/profile/me',
        headers: auth(),
        payload: { expectedVersion: pending.version, displayName: 'Edited While Importing' },
      })
    ).json();
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
      const imported = (await ensure()).json();
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
      expect((await ensure()).json()).toEqual(imported);
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
      expect(response.statusCode).toBe(200);
      const profile = response.json();
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
      expect((await ensure()).json()).toEqual(profile);
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
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const results = await Promise.all([
      upload(image, original.version),
      upload(image, original.version),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const winningResponse = results.find((result) => result.statusCode === 200);
    if (!winningResponse) throw new Error('Expected one successful picture upload');
    const winner = winningResponse.json();
    expect((await ensure()).json()).toEqual(winner);
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
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, original.version)).json();
    await sql.unsafe(
      `create function reject_picture_event() returns trigger language plpgsql as $$ begin if NEW.payload->'change'->>'type' = 'picture-changed' then raise exception 'picture event rejected'; end if; return NEW; end $$`
    );
    await sql.unsafe(
      `create trigger reject_picture_event before insert on outbox_events for each row execute function reject_picture_event()`
    );
    try {
      expect((await upload(image, uploaded.version)).statusCode).toBe(500);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/profile/me/picture',
            headers: auth(),
            payload: { expectedVersion: uploaded.version },
          })
        ).statusCode
      ).toBe(500);
      expect((await ensure()).json()).toEqual(uploaded);
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
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, original.version)).json();
    const bucket = config.profilePictureBucket;
    config.profilePictureBucket = 'missing-picture-bucket';
    await restart();
    try {
      const failed = await upload(image, uploaded.version);
      expect(failed.statusCode).toBe(503);
      expect(failed.json().type).toContain('picture-storage-unavailable');
      expect((await ensure()).json()).toEqual(uploaded);
      const [staged] = await sql`select * from profile_picture_assets where state = 'uploading'`;
      expect(staged.expires_at.getTime() - staged.created_at.getTime()).toBe(
        30 * 24 * 60 * 60 * 1000
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/internal/profile-pictures/${staged.id}/availability`,
            headers: { authorization: 'Bearer test-media-token' },
          })
        ).statusCode
      ).toBe(404);
      expect(
        await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
      ).toHaveLength(1);
    } finally {
      config.profilePictureBucket = bucket;
      await restart();
    }
  });

  it('reports invalid and oversized uploads without publishing or staging them', async () => {
    const original = (await ensure()).json();
    const invalid = await upload(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      original.version
    );
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().type).toContain('invalid-picture');
    const tooLarge = await upload(
      Buffer.alloc(config.profilePictureMaxBytes + 1),
      original.version
    );
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().type).toContain('picture-too-large');
    expect((await ensure()).json()).toEqual(original);
    expect(await sql`select id from profile_picture_assets`).toHaveLength(0);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
    ).toHaveLength(0);
  });

  it('rejects stale picture commands with version conflicts without changing public state', async () => {
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, original.version)).json();
    const staleUpload = await upload(image, original.version);
    expect(staleUpload.statusCode).toBe(409);
    expect(staleUpload.json().type).toContain('profile-version-conflict');
    const staleDelete = await app.inject({
      method: 'DELETE',
      url: '/profile/me/picture',
      headers: auth(),
      payload: { expectedVersion: original.version },
    });
    expect(staleDelete.statusCode).toBe(409);
    expect((await ensure()).json()).toEqual(uploaded);
    expect(
      await sql`select id from outbox_events where payload->'change'->>'type' = 'picture-changed'`
    ).toHaveLength(1);
  });

  it('removes the picture with an authoritative null snapshot and preserves its private bytes', async () => {
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const uploaded = (await upload(image, original.version)).json();
    const response = await app.inject({
      method: 'DELETE',
      url: '/profile/me/picture',
      headers: auth(),
      payload: { expectedVersion: uploaded.version },
    });
    expect(response.statusCode).toBe(200);
    const removed = response.json();
    expect(removed).toMatchObject({
      pictureAssetId: null,
      pictureImportStatus: 'complete',
      version: uploaded.version + 1,
    });
    expect((await ensure()).json()).toEqual(removed);
    const check = await app.inject({
      method: 'GET',
      url: `/internal/profile-pictures/${uploaded.pictureAssetId}/availability`,
      headers: { authorization: 'Bearer test-media-token' },
    });
    expect(check.statusCode).toBe(404);
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
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/profile/me/picture',
          headers: auth(),
          payload: { expectedVersion: removed.version },
        })
      ).json()
    ).toEqual(removed);
  });

  it('replaces a picture with a new immutable ID and immediately retires old public delivery for thirty days', async () => {
    const original = (await ensure()).json();
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#475b83' },
    })
      .png()
      .toBuffer();
    const first = (await upload(image, original.version)).json();
    const secondResponse = await upload(image, first.version);
    expect(secondResponse.statusCode).toBe(200);
    const second = secondResponse.json();
    expect(second.pictureAssetId).not.toBe(first.pictureAssetId);
    expect(second.version).toBe(first.version + 1);
    const [old] =
      await sql`select * from profile_picture_assets where id = ${first.pictureAssetId}`;
    expect(old.state).toBe('retired');
    expect(old.retired_at.toISOString()).toBe(second.updatedAt);
    expect(old.expires_at.getTime() - old.retired_at.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    const check = (id: string) =>
      app.inject({
        method: 'GET',
        url: `/internal/profile-pictures/${id}/availability`,
        headers: { authorization: 'Bearer test-media-token' },
      });
    expect((await check(first.pictureAssetId)).statusCode).toBe(404);
    expect((await check(second.pictureAssetId)).statusCode).toBe(204);
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
