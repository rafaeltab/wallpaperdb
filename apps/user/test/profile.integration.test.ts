import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { connect, type NatsConnection } from 'nats';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userLayer } from '../src/app.js';
import { createHttpApp } from '../src/http/index.js';
import type { Config } from '../src/config.js';
import {
  type Profiles,
  ProfileUnavailable,
  type ExternalIdentity,
  type Identities,
} from '../src/profile/index.js';
import { Maintenance } from '../src/maintenance/index.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationPaths = readdirSync(migrationDirectory)
  .filter((path) => path.endsWith('.sql'))
  .sort()
  .map((path) => join(migrationDirectory, path));

class FakeIdentityProvider implements Identities {
  readonly identities = new Map<string, ExternalIdentity>();
  error: Error | null = null;
  getIdentity(userId: string) {
    return Effect.suspend(() =>
      this.error
        ? Effect.fail(new ProfileUnavailable({ operation: 'identity-lookup', cause: this.error }))
        : Effect.succeed(
            this.identities.get(userId) ?? { displayName: null, firstName: null, lastName: null }
          )
    );
  }
}

describe('Profile production composition', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let natsContainer: StartedNatsContainer;
  let sql: ReturnType<typeof postgres>;
  let app: FastifyInstance;
  let runtime: ManagedRuntime.ManagedRuntime<Profiles | Maintenance, unknown>;
  let nats: NatsConnection;
  const identities = new FakeIdentityProvider();
  let config: Config;

  beforeAll(async () => {
    [postgresContainer, natsContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      createNatsContainer(),
    ]);
    nats = await connect({ servers: natsContainer.getConnectionUrl() });
    await (await nats.jetstreamManager()).streams.add({
      name: 'WALLPAPER',
      subjects: ['wallpaper.>'],
    });
    await (await nats.jetstreamManager()).streams.add({ name: 'PROFILE', subjects: ['profile.>'] });
    const databaseUrl = postgresContainer.getConnectionUri().replace('localhost', '127.0.0.1');
    sql = postgres(databaseUrl, { max: 10 });
    for (const migrationPath of migrationPaths) {
      await sql.unsafe(readFileSync(migrationPath, 'utf8'));
    }
    config = {
      port: 3009,
      nodeEnv: 'test',
      databaseUrl,
      natsUrl: natsContainer.getConnectionUrl(),
      natsStream: 'WALLPAPER',
      otelServiceName: 'user-test',
      profileHandleMinLength: 1,
      profileHandleMaxLength: 20,
      profileDisplayNameMaxLength: 80,
      profileBiographyMaxLength: 5000,
      profileRetainedAliasLimit: 3,
      profileEvidenceRetentionDays: 30,
      s3Region: 'us-east-1',
      assetReferenceBucket: 'asset-references',
      profilePictureBucket: 'profile-pictures',
      profilePictureMaxBytes: 5 * 1024 * 1024,
      profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024,
      profilePictureImportTimeoutMs: 10_000,
      profilePictureImportHosts: ['img.clerk.com', 'images.clerk.dev'],
    };
    await reconfigure();
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, wallpaper_ownership, profiles cascade`;
    identities.identities.clear();
    identities.error = null;
  });

  afterAll(async () => {
    await app.close();
    await runtime.dispose();
    await nats.close();
    await sql.end();
    await Promise.all([postgresContainer.stop(), natsContainer.stop()]);
  });

  async function reconfigure() {
    await app?.close();
    await runtime?.dispose();
    const services = ManagedRuntime.make(userLayer({ ...config }, { identities, workers: false }));
    runtime = services;
    app = await createHttpApp({ ...config }, Layer.succeedContext(await services.context()), {
      logger: false,
    });
  }

  const maintenance = <A, E>(use: (maintenance: Maintenance) => Effect.Effect<A, E>) =>
    runtime.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* Maintenance);
      })
    );
  async function request(userId: string) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'POST',
      url: '/profile/me/ensure',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function publishBiographyWallpaper(
    wallpaperId: string,
    profileId: string,
    eventId = `evt_${wallpaperId}`
  ) {
    const now = new Date().toISOString();
    const event: WallpaperUploadedEvent = {
      eventId,
      eventType: 'wallpaper.uploaded',
      timestamp: now,
      wallpaper: {
        id: wallpaperId,
        userId: profileId,
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: 100,
        width: 10,
        height: 10,
        aspectRatio: 1,
        storageKey: `${wallpaperId}.png`,
        storageBucket: 'wallpapers',
        originalFilename: 'owned.png',
        uploadedAt: now,
      },
    };
    await nats
      .jetstream()
      .publish(event.eventType, new TextEncoder().encode(JSON.stringify(event)));
  }

  it('expires acknowledged Profile events through the retention capability', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      await maintenance((service) => service.publishPending());
      vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
      await maintenance((service) => service.cleanupEvents(new Date()));
      expect(await sql`select id from outbox_events`).toEqual([]);
      expect((await request('user_1')).json()).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it('projects publication before lazy Profile creation and preserves ownership across replay', async () => {
    await publishBiographyWallpaper('wlpr_before_profile', 'user_1');
    await vi.waitFor(
      async () => {
        expect(
          await sql`select wallpaper_id from wallpaper_ownership where wallpaper_id = 'wlpr_before_profile'`
        ).toHaveLength(1);
      },
      { timeout: 5000, interval: 25 }
    );
    expect(await sql`select id from profiles`).toHaveLength(0);
    await publishBiographyWallpaper('wlpr_before_profile', 'user_1');
    await publishBiographyWallpaper(
      'wlpr_before_profile',
      'other_profile',
      'evt_conflicting_replay'
    );
    await publishBiographyWallpaper('wlpr_replay_barrier', 'other_profile');
    await vi.waitFor(
      async () => {
        expect(
          await sql`select wallpaper_id from wallpaper_ownership where wallpaper_id = 'wlpr_replay_barrier'`
        ).toHaveLength(1);
      },
      { timeout: 5000, interval: 25 }
    );
    expect(
      await sql`select * from wallpaper_ownership where wallpaper_id = 'wlpr_before_profile'`
    ).toEqual([{ wallpaper_id: 'wlpr_before_profile', profile_id: 'user_1' }]);
    const owner = (await request('user_1')).json();
    const biographyMarkdown = '![Published](wallpaper:wlpr_before_profile)';
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile/me',
      headers: {
        authorization: `Bearer ${Buffer.from(JSON.stringify({ id: owner.id })).toString('base64')}`,
      },
      payload: { biographyMarkdown, expectedVersion: owner.version },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().biographyMarkdown).toBe(biographyMarkdown);
  });

  it('allows an owned published Wallpaper embed after the ownership event catches up', async () => {
    const original = (await request('user_1')).json();
    const biographyMarkdown = '![Sunset](wallpaper:wlpr_owned)';
    const save = () =>
      app.inject({
        method: 'PATCH',
        url: '/profile/me',
        headers: {
          authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}`,
        },
        payload: { biographyMarkdown, expectedVersion: original.version },
      });
    const waiting = await save();
    expect(waiting.statusCode).toBe(400);
    expect(waiting.json()).toMatchObject({
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/unavailable-wallpaper.md',
      retryable: true,
    });
    expect((await request('user_1')).json()).toEqual(original);
    const now = new Date().toISOString();
    const event: WallpaperUploadedEvent = {
      eventId: 'evt_owned_wallpaper',
      eventType: 'wallpaper.uploaded',
      timestamp: now,
      wallpaper: {
        id: 'wlpr_owned',
        userId: original.id,
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: 100,
        width: 10,
        height: 10,
        aspectRatio: 1,
        storageKey: 'wlpr_owned.png',
        storageBucket: 'wallpapers',
        originalFilename: 'owned.png',
        uploadedAt: now,
      },
    };
    await nats
      .jetstream()
      .publish(event.eventType, new TextEncoder().encode(JSON.stringify(event)));
    const saved = await vi.waitFor(
      async () => {
        const response = await save();
        expect(response.statusCode).toBe(200);
        return response.json();
      },
      { timeout: 5000, interval: 25 }
    );
    expect(saved).toMatchObject({ biographyMarkdown, version: original.version + 1 });
    const [changed] =
      await sql`select payload from outbox_events where payload->'change'->>'type' = 'biography-changed'`;
    expect(changed.payload.profile.biographyMarkdown).toBe(biographyMarkdown);
  });

  it('creates a profile and typed outbox event from the authenticated ID', async () => {
    identities.identities.set('user_1', {
      displayName: 'Ada Display',
      firstName: 'Ignored',
      lastName: 'Name',
    });
    const response = await request('user_1');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'user_1',
      displayName: 'Ada Display',
      handle: 'ada-display',
      biographyMarkdown: '',
      pictureAssetId: null,
      version: 1,
    });
    const events = await sql`select payload from outbox_events`;
    expect(events[0].payload).toMatchObject({
      eventType: 'profile.created',
      change: { type: 'created' },
      profile: {
        id: 'user_1',
        claimGeneration: expect.any(Number),
        biographyMarkdown: '',
        pictureAssetId: null,
      },
    });
    const claims = await sql`select claim_generation from handle_claims`;
    expect(Number(claims[0].claim_generation)).toBeGreaterThan(0);
  });

  it('returns 503 and writes nothing when Clerk lookup fails', async () => {
    identities.error = new Error('Clerk unavailable');
    const response = await request('user_1');
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/identity-unavailable.md',
      title: 'Identity service unavailable',
      status: 503,
      detail: 'Clerk identity lookup failed',
      instance: '/profile/me/ensure',
    });
    expect((await sql`select * from profiles`).length).toBe(0);
    expect((await sql`select * from handle_claims`).length).toBe(0);
    expect((await sql`select * from outbox_events`).length).toBe(0);
  });
});
