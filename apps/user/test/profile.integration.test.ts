import 'reflect-metadata';
import { validateProfileMarkdown } from '@wallpaperdb/profile-markdown';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { FakeTimerService } from '@wallpaperdb/core/timer';
import type { ProfileCreatedEvent, ProfileUpdatedEvent, WallpaperUploadedEvent } from '@wallpaperdb/events';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { connect } from 'nats';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { DatabaseConnection } from '../src/connections/database.js';
import { NatsConnectionManager } from '../src/connections/nats.js';
import {
  IdentityProviderToken,
  type ExternalIdentity,
  type IdentityProvider,
} from '../src/services/clerk-identity.service.js';
import { ProfileService } from '../src/services/profile.service.js';
import { ProfileAliasExpiryWorker } from '../src/services/profile-alias-expiry.service.js';
import {
  type ProfileEventPublisher,
  ProfileOutboxPublisherWorker,
} from '../src/services/profile-outbox-publisher.service.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationPaths = readdirSync(migrationDirectory).filter((path) => path.endsWith('.sql')).sort().map((path) => join(migrationDirectory, path));

class FakeIdentityProvider implements IdentityProvider {
  readonly identities = new Map<string, ExternalIdentity>();
  error: Error | null = null;

  async getIdentity(userId: string): Promise<ExternalIdentity> {
    if (this.error) throw this.error;
    return (
      this.identities.get(userId) ?? { displayName: null, firstName: null, lastName: null }
    );
  }
}

class FakeProfileEventPublisher implements ProfileEventPublisher {
  readonly events: Array<ProfileCreatedEvent | ProfileUpdatedEvent> = [];
  failuresRemaining = 0;

  async publish(event: ProfileCreatedEvent | ProfileUpdatedEvent): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new Error('NATS unavailable');
    }
    this.events.push(event);
  }
}

describe('Profile commands', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let natsContainer: StartedNatsContainer;
  let sql: ReturnType<typeof postgres>;
  let app: FastifyInstance;
  let database: DatabaseConnection;
  const identities = new FakeIdentityProvider();
  const aliasExpiryTimer = new FakeTimerService();
  let config: Config;

  beforeAll(async () => {
    [postgresContainer, natsContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      createNatsContainer(),
    ]);
    const streamConnection = await connect({ servers: natsContainer.getConnectionUrl() });
    await (await streamConnection.jetstreamManager()).streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] });
    await streamConnection.close();
    const databaseUrl = postgresContainer.getConnectionUri();
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
      profileDisplayNameMaxLength: 80, profileBiographyMaxLength: 5000,
      profileRetainedAliasLimit: 3,
      s3Region: 'us-east-1', profilePictureBucket: 'profile-pictures',
      profilePictureMaxBytes: 5 * 1024 * 1024, profilePictureMaxPixels: 16_000_000,
      profilePictureMaxDecodedBytes: 64 * 1024 * 1024, profilePictureImportTimeoutMs: 10_000,
      profilePictureImportHosts: ['img.clerk.com', 'images.clerk.dev'],
    };
    container.clearInstances();
    app = await createApp(config, { logger: false, enableOtel: false, aliasExpiryTimer });
    container.register(IdentityProviderToken, { useValue: identities });
    database = container.resolve(DatabaseConnection);
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, wallpaper_ownership, profiles cascade`;
    identities.identities.clear();
    identities.error = null;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await Promise.all([postgresContainer.stop(), natsContainer.stop()]);
  });

  function service(): ProfileService {
    return new ProfileService(database, identities, config);
  }

  async function request(userId: string) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'POST',
      url: '/profile/me/ensure',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function patch(userId: string, displayName: string, expectedVersion: number) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'PATCH',
      url: '/profile/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName, expectedVersion },
    });
  }

  async function changeHandle(userId: string, handle: string, expectedVersion: number) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'PUT',
      url: '/profile/me/handle',
      headers: { authorization: `Bearer ${token}` },
      payload: { handle, expectedVersion },
    });
  }

  async function scheduleAlias(userId: string, handle: string, expectedVersion: number) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'DELETE',
      url: `/profile/me/aliases/${encodeURIComponent(handle)}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { expectedVersion },
    });
  }

  async function expireAlias(userId: string, handle: string, expectedVersion: number) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'POST', url: `/profile/me/aliases/${encodeURIComponent(handle)}/expire`,
      headers: { authorization: `Bearer ${token}` }, payload: { expectedVersion },
    });
  }

  async function reactivateAlias(userId: string, handle: string, expectedVersion: number) {
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    return app.inject({
      method: 'PUT', url: `/profile/me/aliases/${encodeURIComponent(handle)}`,
      headers: { authorization: `Bearer ${token}` }, payload: { expectedVersion },
    });
  }

  async function publishBiographyWallpaper(wallpaperId: string, profileId: string, eventId = `evt_${wallpaperId}`) {
    const now = new Date().toISOString();
    const event: WallpaperUploadedEvent = {
      eventId, eventType: 'wallpaper.uploaded', timestamp: now,
      wallpaper: { id: wallpaperId, userId: profileId, fileType: 'image', mimeType: 'image/png', fileSizeBytes: 100,
        width: 10, height: 10, aspectRatio: 1, storageKey: `${wallpaperId}.png`, storageBucket: 'wallpapers', originalFilename: 'owned.png', uploadedAt: now },
    };
    await container.resolve(NatsConnectionManager).getClient().jetstream().publish(event.eventType, new TextEncoder().encode(JSON.stringify(event)));
  }

  it.each([
    '<script>alert(1)</script>',
    '[Unsafe](javascript:alert%281%29)',
    '[Credentials](https://user:pass@example.com)',
    '![Remote](https://example.com/image.png)',
    '[Custom](wallpaper:wlpr_owned)',
    '![Data](data:image/png;base64,eA==)',
  ])('enforces shared malicious-Markdown policy without partial Profile changes: %s', async (biographyMarkdown) => {
    expect(validateProfileMarkdown(biographyMarkdown).valid).toBe(false);
    const original = (await request('user_1')).json();
    const response = await app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: original.id })).toString('base64')}` }, payload: { displayName: 'Rejected Name', biographyMarkdown, expectedVersion: original.version } });
    expect(response.statusCode).toBe(400);
    expect(response.json().type).toContain('invalid-biography');
    expect((await request('user_1')).json()).toEqual(original);
    expect((await sql`select id from outbox_events where subject = 'profile.updated'`)).toHaveLength(0);
  });

  it('projects publication before lazy Profile creation and preserves ownership across replay', async () => {
    await publishBiographyWallpaper('wlpr_before_profile', 'user_1');
    await vi.waitFor(async () => { expect((await sql`select wallpaper_id from wallpaper_ownership where wallpaper_id = 'wlpr_before_profile'`)).toHaveLength(1); }, { timeout: 5000, interval: 25 });
    expect((await sql`select id from profiles`)).toHaveLength(0);
    await publishBiographyWallpaper('wlpr_before_profile', 'user_1');
    await publishBiographyWallpaper('wlpr_before_profile', 'other_profile', 'evt_conflicting_replay');
    await publishBiographyWallpaper('wlpr_replay_barrier', 'other_profile');
    await vi.waitFor(async () => { expect((await sql`select wallpaper_id from wallpaper_ownership where wallpaper_id = 'wlpr_replay_barrier'`)).toHaveLength(1); }, { timeout: 5000, interval: 25 });
    expect((await sql`select * from wallpaper_ownership where wallpaper_id = 'wlpr_before_profile'`)).toEqual([{ wallpaper_id: 'wlpr_before_profile', profile_id: 'user_1' }]);
    const owner = (await request('user_1')).json();
    const biographyMarkdown = '![Published](wallpaper:wlpr_before_profile)';
    const response = await app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: owner.id })).toString('base64')}` }, payload: { biographyMarkdown, expectedVersion: owner.version } });
    expect(response.statusCode).toBe(200);
    expect(response.json().biographyMarkdown).toBe(biographyMarkdown);
  });

  it('rejects another Profile’s published Wallpaper without applying either edited field', async () => {
    const original = (await request('user_1')).json();
    await publishBiographyWallpaper('wlpr_foreign', 'other_profile');
    await vi.waitFor(async () => { expect((await sql`select wallpaper_id from wallpaper_ownership where wallpaper_id = 'wlpr_foreign'`)).toHaveLength(1); }, { timeout: 5000, interval: 25 });
    const response = await app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}` }, payload: { displayName: 'Rejected Name', biographyMarkdown: '![Foreign](wallpaper:wlpr_foreign)', expectedVersion: original.version } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ type: 'https://wallpaperdb.example/problems/unavailable-wallpaper', retryable: false });
    expect((await request('user_1')).json()).toEqual(original);
    expect((await sql`select id from outbox_events where subject = 'profile.updated'`)).toHaveLength(0);
  });

  it('allows an owned published Wallpaper embed after the ownership event catches up', async () => {
    const original = (await request('user_1')).json();
    const biographyMarkdown = '![Sunset](wallpaper:wlpr_owned)';
    const save = () => app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}` }, payload: { biographyMarkdown, expectedVersion: original.version } });
    const waiting = await save();
    expect(waiting.statusCode).toBe(400);
    expect(waiting.json()).toMatchObject({ type: 'https://wallpaperdb.example/problems/unavailable-wallpaper', retryable: true });
    expect((await request('user_1')).json()).toEqual(original);
    const now = new Date().toISOString();
    const event: WallpaperUploadedEvent = {
      eventId: 'evt_owned_wallpaper', eventType: 'wallpaper.uploaded', timestamp: now,
      wallpaper: { id: 'wlpr_owned', userId: original.id, fileType: 'image', mimeType: 'image/png', fileSizeBytes: 100,
        width: 10, height: 10, aspectRatio: 1, storageKey: 'wlpr_owned.png', storageBucket: 'wallpapers', originalFilename: 'owned.png', uploadedAt: now },
    };
    await container.resolve(NatsConnectionManager).getClient().jetstream().publish(event.eventType, new TextEncoder().encode(JSON.stringify(event)));
    const saved = await vi.waitFor(async () => {
      const response = await save();
      expect(response.statusCode).toBe(200);
      return response.json();
    }, { timeout: 5000, interval: 25 });
    expect(saved).toMatchObject({ biographyMarkdown, version: original.version + 1 });
    const [changed] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'biography-changed'`;
    expect(changed.payload.profile.biographyMarkdown).toBe(biographyMarkdown);
  });

  it('audits a combined Display-name and Biography edit in one atomic Profile version', async () => {
    const original = (await request('user_1')).json();
    const biographyMarkdown = 'A new **Biography**.';
    const response = await app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}` }, payload: { displayName: '  New Name  ', biographyMarkdown, expectedVersion: original.version } });
    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({ displayName: 'New Name', biographyMarkdown, version: original.version + 1 });
    const [event] = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(event.payload.change).toEqual({ type: 'profile-details-changed', before: { displayName: original.displayName, biographyMarkdown: original.biographyMarkdown }, after: { displayName: updated.displayName, biographyMarkdown } });
    expect(event.payload.profile).toMatchObject({ displayName: 'New Name', biographyMarkdown, version: updated.version, aliases: updated.aliases });
    expect((await sql`select id from outbox_events where subject = 'profile.updated'`)).toHaveLength(1);
  });

  it('enforces the configured Biography limit in Unicode code points without truncating authored text', async () => {
    const previousLimit = config.profileBiographyMaxLength;
    config.profileBiographyMaxLength = 4;
    try {
      const original = (await request('user_1')).json();
      expect(original.biographyMaxLength).toBe(4);
      const headers = { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}` };
      const accepted = await app.inject({ method: 'PATCH', url: '/profile/me', headers, payload: { biographyMarkdown: '👋abc', expectedVersion: original.version } });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().biographyMarkdown).toBe('👋abc');
      const rejected = await app.inject({ method: 'PATCH', url: '/profile/me', headers, payload: { biographyMarkdown: '👋abcd', expectedVersion: accepted.json().version } });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().type).toContain('invalid-biography');
      expect((await request('user_1')).json()).toEqual(accepted.json());
      expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'biography-changed'`)).toHaveLength(1);
    } finally { config.profileBiographyMaxLength = previousLimit; }
  });

  it('stores authored Biography Markdown and returns a complete authoritative versioned snapshot', async () => {
    const original = (await request('user_1')).json();
    const authored = '  # Hello 👋\n\nA **Biography** with `<literal>` code.\n';
    const response = await app.inject({ method: 'PATCH', url: '/profile/me', headers: { authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64')}` }, payload: { biographyMarkdown: authored, expectedVersion: original.version } });
    expect(response.statusCode).toBe(200);
    const updated = response.json();
    expect(updated).toMatchObject({ biographyMarkdown: authored, displayName: original.displayName, version: original.version + 1, biographyMaxLength: 5000, aliases: original.aliases });
    expect((await request('user_1')).json()).toEqual(updated);
    const [event] = await sql`select payload, created_at from outbox_events where payload->'change'->>'type' = 'biography-changed'`;
    expect(event.created_at.toISOString()).toBe(event.payload.timestamp);
    expect(event.payload).toMatchObject({ change: { type: 'biography-changed', before: '', after: authored }, profile: { biographyMarkdown: authored, version: updated.version, aliases: updated.aliases, pictureAssetId: updated.pictureAssetId } });
    expect(event.payload.profile).not.toHaveProperty('biographyHtml');
    expect(event.payload.profile).not.toHaveProperty('biographyMaxLength');
  });

  it('reactivates a released historical Handle with a new claim and authoritative event', async () => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const released = (await expireAlias('user_1', original.handle, scheduled.version)).json();
    const response = await reactivateAlias('user_1', original.handle.toUpperCase(), released.version);
    expect(response.statusCode).toBe(200);
    const reactivated = response.json();
    expect(reactivated).toMatchObject({ handle: changed.handle, version: released.version + 1, lastHandleChangedAt: changed.lastHandleChangedAt, historicalHandles: [] });
    expect(reactivated.aliases).toEqual([{ handle: original.handle, claimGeneration: expect.any(Number), createdAt: reactivated.updatedAt, expiresAt: null }]);
    expect(reactivated.aliases[0].claimGeneration).toBeGreaterThan(scheduled.aliases[0].claimGeneration);
    expect((await request('user_1')).json()).toEqual(reactivated);
    const [event] = await sql`select payload, created_at from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`;
    expect(event.created_at.toISOString()).toBe(event.payload.timestamp);
    expect(event.payload).toMatchObject({ change: { type: 'alias-reactivated', handle: original.handle, claimGeneration: reactivated.aliases[0].claimGeneration, before: null, after: null }, profile: { handle: changed.handle, version: reactivated.version, aliases: reactivated.aliases } });
    expect(event.payload.profile).not.toHaveProperty('historicalHandles');
  });

  it('keeps an expiring alias with the same claim and defeats its stale expiry candidate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const alias = scheduled.aliases[0];
      vi.setSystemTime(new Date('2030-01-01T01:00:00.000Z'));
      const response = await reactivateAlias('user_1', original.handle, scheduled.version);
      expect(response.statusCode).toBe(200);
      const kept = response.json();
      expect(kept).toMatchObject({ handle: changed.handle, lastHandleChangedAt: changed.lastHandleChangedAt, version: scheduled.version + 1, aliases: [{ ...alias, createdAt: '2030-01-01T01:00:00.000Z', expiresAt: null }], historicalHandles: [] });
      const [event] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`;
      expect(event.payload).toMatchObject({ change: { type: 'alias-reactivated', handle: alias.handle, claimGeneration: alias.claimGeneration, before: alias.expiresAt, after: null }, profile: { aliases: kept.aliases, version: kept.version } });
      expect((await reactivateAlias('user_1', original.handle, kept.version)).json()).toEqual(kept);
      expect((await reactivateAlias('user_1', original.handle, scheduled.version)).statusCode).toBe(409);
      vi.setSystemTime(new Date(alias.expiresAt));
      expect(await service().expireDueAlias({ profileId: original.id, handle: alias.handle, claimGeneration: alias.claimGeneration }, new Date())).toBe(false);
      expect((await request('user_1')).json()).toEqual(kept);
      expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, 1])('rejects alias reactivation without a retained slot at limit %i', async (limit) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const previousLimit = config.profileRetainedAliasLimit;
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'second-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      vi.setSystemTime(new Date('2030-01-08T00:00:00.000Z'));
      const current = limit === 0 ? scheduled : (await changeHandle('user_1', 'current-handle', scheduled.version)).json();
      config.profileRetainedAliasLimit = limit;
      const before = (await request('user_1')).json();
      expect(before.historicalHandles).toContainEqual({ handle: original.handle, eligibleUntil: '2030-01-31T00:00:00.000Z', unavailableReason: 'alias-limit' });
      const rejected = await reactivateAlias('user_1', original.handle, before.version);
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().type).toContain('alias-limit');
      expect((await request('user_1')).json()).toEqual(before);
      const released = (await expireAlias('user_1', original.handle, before.version)).json();
      const rejectedReleased = await reactivateAlias('user_1', original.handle, released.version);
      expect(rejectedReleased.statusCode).toBe(409);
      expect(rejectedReleased.json().type).toContain('alias-limit');
      expect((await request('user_1')).json()).toEqual(released);
      expect(released.aliases).toEqual(current.aliases.filter((alias: {handle: string}) => alias.handle !== original.handle));
      expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`)).toHaveLength(0);
    } finally {
      config.profileRetainedAliasLimit = previousLimit;
      vi.useRealTimers();
    }
  });

  it('reports another Profile claim and rejects reactivating its historical Handle', async () => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const released = (await expireAlias('user_1', original.handle, scheduled.version)).json();
    const other = (await request('user_2')).json();
    expect((await changeHandle('user_2', original.handle, other.version)).statusCode).toBe(200);
    const before = (await request('user_1')).json();
    expect(before.historicalHandles).toEqual([{ ...released.historicalHandles[0], unavailableReason: 'claimed' }]);
    const response = await reactivateAlias('user_1', original.handle, released.version);
    expect(response.statusCode).toBe(409);
    expect(response.json().type).toContain('handle-unavailable');
    expect((await request('user_1')).json()).toEqual(before);
    expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`)).toHaveLength(0);
  });

  it('ends history eligibility at exactly thirty days without renewing it from Display-name snapshots', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const released = (await expireAlias('user_1', original.handle, scheduled.version)).json();
      vi.setSystemTime(new Date('2030-01-30T00:00:00.000Z'));
      const renamed = (await patch('user_1', 'invented-handle', released.version)).json();
      expect(renamed.historicalHandles).toEqual(released.historicalHandles);
      const secondRename = (await patch('user_1', 'another-invention', renamed.version)).json();
      expect(secondRename.historicalHandles).toEqual(released.historicalHandles);
      for (const handle of ['invented-handle', 'another-invention', 'arbitrary-alias']) {
        const rejection = await reactivateAlias('user_1', handle, secondRename.version);
        expect(rejection.statusCode).toBe(400);
        expect(rejection.json().type).toContain('ineligible-handle');
      }
      const other = (await request('user_2')).json();
      const wrongOwner = await reactivateAlias('user_2', original.handle, other.version);
      expect(wrongOwner.statusCode).toBe(400);
      expect(wrongOwner.json().type).toContain('ineligible-handle');
      vi.setSystemTime(new Date('2030-01-30T23:59:59.999Z'));
      expect((await request('user_1')).json().historicalHandles).toEqual(released.historicalHandles);
      vi.setSystemTime(new Date('2030-01-31T00:00:00.000Z'));
      const atDeadline = (await request('user_1')).json();
      expect(atDeadline.historicalHandles).toEqual([]);
      const expiredHistory = await reactivateAlias('user_1', original.handle, secondRename.version);
      expect(expiredHistory.statusCode).toBe(400);
      expect(expiredHistory.json().type).toContain('ineligible-handle');
      expect((await request('user_1')).json()).toEqual(atDeadline);
      expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renews an old alias only when a typed overflow schedule records that Handle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const previousLimit = config.profileRetainedAliasLimit;
    config.profileRetainedAliasLimit = 1;
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'second-handle', original.version)).json();
      vi.setSystemTime(new Date('2030-02-10T00:00:00.000Z'));
      const renamed = (await patch('user_1', 'New Display Name', changed.version)).json();
      expect((await reactivateAlias('user_1', original.handle, renamed.version)).statusCode).toBe(400);
      const overflowed = (await changeHandle('user_1', 'current-handle', renamed.version)).json();
      expect(overflowed.historicalHandles).toEqual([{ handle: original.handle, eligibleUntil: '2030-03-12T00:00:00.000Z', unavailableReason: 'alias-limit' }]);
      expect((await request('user_1')).json()).toEqual(overflowed);
      const freed = (await scheduleAlias('user_1', changed.handle, overflowed.version)).json();
      const restored = await reactivateAlias('user_1', original.handle, freed.version);
      expect(restored.statusCode).toBe(200);
      expect(restored.json().aliases.filter((alias: {expiresAt: string | null}) => alias.expiresAt === null)).toEqual([{ ...changed.aliases[0], createdAt: '2030-02-10T00:00:00.000Z' }]);
    } finally {
      config.profileRetainedAliasLimit = previousLimit;
      vi.useRealTimers();
    }
  });

  it('allows exactly one claimant when historical reactivation races a different Profile', async () => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const released = (await expireAlias('user_1', original.handle, scheduled.version)).json();
    const other = (await request('user_2')).json();
    const [reactivation, competingClaim] = await Promise.all([
      reactivateAlias('user_1', original.handle, released.version),
      changeHandle('user_2', original.handle, other.version),
    ]);
    expect([reactivation.statusCode, competingClaim.statusCode].sort()).toEqual([200, 409]);
    const wonReactivation = reactivation.statusCode === 200;
    const claims = await sql`select profile_id, claim_generation from handle_claims where handle = ${original.handle}`;
    expect(claims).toHaveLength(1);
    expect(claims[0].profile_id).toBe(wonReactivation ? 'user_1' : 'user_2');
    expect(Number(claims[0].claim_generation)).toBeGreaterThan(scheduled.aliases[0].claimGeneration);
    const ownerAfter = (await request('user_1')).json();
    expect(ownerAfter).toMatchObject({ handle: changed.handle, version: released.version + Number(wonReactivation) });
    expect(ownerAfter.aliases).toHaveLength(Number(wonReactivation));
    const otherAfter = (await request('user_2')).json();
    expect(otherAfter).toMatchObject({ handle: wonReactivation ? other.handle : original.handle, version: other.version + Number(!wonReactivation) });
    expect((await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`)).toHaveLength(Number(wonReactivation));
  });

  it('serializes keeping an alias against its due expiry with one accepted transition', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const alias = scheduled.aliases[0];
      const candidate = { profileId: original.id, handle: alias.handle, claimGeneration: alias.claimGeneration };
      vi.setSystemTime(new Date(alias.expiresAt));
      const [keep, expired] = await Promise.all([
        reactivateAlias('user_1', original.handle, scheduled.version),
        service().expireDueAlias(candidate, new Date()),
      ]);
      expect(keep.statusCode).toBe(expired ? 409 : 200);
      const after = (await request('user_1')).json();
      expect(after).toMatchObject({ handle: changed.handle, version: scheduled.version + 1 });
      expect(after.aliases).toEqual(expired ? [] : [{ ...alias, createdAt: alias.expiresAt, expiresAt: null }]);
      const transitions = await sql`select payload from outbox_events where payload->'change'->>'type' in ('alias-expired', 'alias-reactivated')`;
      expect(transitions).toHaveLength(1);
      expect(transitions[0].payload.change.type).toBe(expired ? 'alias-expired' : 'alias-reactivated');
      expect(await service().expireDueAlias(candidate, new Date())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('rolls back reactivation claims and state when its event fails (released=%s)', async (released) => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const before = released ? (await expireAlias('user_1', original.handle, scheduled.version)).json() : scheduled;
    const claimsBefore = await sql`select * from handle_claims where profile_id = 'user_1' order by handle`;
    await sql.unsafe(`create function reject_reactivation_event() returns trigger language plpgsql as $$ begin if new.payload->'change'->>'type' = 'alias-reactivated' then raise exception 'reactivation event rejected'; end if; return new; end $$`);
    await sql.unsafe('create trigger reject_reactivation_event before insert on outbox_events for each row execute function reject_reactivation_event()');
    try {
      expect((await reactivateAlias('user_1', original.handle, before.version)).statusCode).toBe(500);
      expect((await request('user_1')).json()).toEqual(before);
      expect(await sql`select * from handle_claims where profile_id = 'user_1' order by handle`).toEqual(claimsBefore);
      expect(await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`).toHaveLength(0);
    } finally {
      await sql.unsafe('drop trigger reject_reactivation_event on outbox_events; drop function reject_reactivation_event()');
    }
    const retried = await reactivateAlias('user_1', original.handle, before.version);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().version).toBe(before.version + 1);
    expect(await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`).toHaveLength(1);
  });

  it('requires authentication and valid versioned commands to reactivate aliases', async () => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const url = `/profile/me/aliases/${original.handle}`;
    expect((await app.inject({ method: 'PUT', url, payload: { expectedVersion: scheduled.version } })).statusCode).toBe(401);
    const token = Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64');
    for (const payload of [{}, { expectedVersion: '3' }, { expectedVersion: 0 }, { expectedVersion: -1 }, { expectedVersion: 1.5 }]) {
      const response = await app.inject({ method: 'PUT', url, headers: { authorization: `Bearer ${token}` }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().type).toContain('invalid-alias-command');
    }
    const currentHandle = await reactivateAlias('user_1', changed.handle.toUpperCase(), scheduled.version);
    expect(currentHandle.statusCode).toBe(400);
    expect(currentHandle.json().type).toContain('invalid-alias-command');
    const stale = await reactivateAlias('user_1', original.handle, changed.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().type).toContain('profile-version-conflict');
    expect((await request('user_1')).json()).toEqual(scheduled);
    expect(await sql`select id from outbox_events where payload->'change'->>'type' = 'alias-reactivated'`).toHaveLength(0);
  });

  it('returns recent typed Handle history after scheduling and expiry events commit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      expect(original.historicalHandles).toEqual([]);
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      expect(changed.historicalHandles).toEqual([]);
      vi.setSystemTime(new Date('2030-02-10T00:00:00.000Z'));
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      expect(scheduled.historicalHandles).toEqual([{ handle: original.handle, eligibleUntil: '2030-03-12T00:00:00.000Z', unavailableReason: null }]);
      expect((await request('user_1')).json()).toEqual(scheduled);
      vi.setSystemTime(new Date('2030-02-11T00:00:00.000Z'));
      const expired = (await expireAlias('user_1', original.handle, scheduled.version)).json();
      expect(expired.historicalHandles).toEqual([{ handle: original.handle, eligibleUntil: '2030-03-13T00:00:00.000Z', unavailableReason: null }]);
      expect((await request('user_1')).json()).toEqual(expired);
    } finally {
      vi.useRealTimers();
    }
  });

  it('immediately expires a scheduled alias through a versioned owner command', async () => {
    const original = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
    const response = await expireAlias('user_1', original.handle.toUpperCase(), scheduled.version);
    expect(response.statusCode).toBe(200);
    const expired = response.json();
    expect(expired).toMatchObject({ aliases: [], handle: changed.handle, version: scheduled.version + 1 });
    expect((await request('user_1')).json()).toEqual(expired);
    const [event] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
    expect(event.payload).toMatchObject({
      change: { type: 'alias-expired', handle: original.handle, claimGeneration: scheduled.aliases[0].claimGeneration, before: scheduled.aliases[0].expiresAt, after: null, reason: 'immediate' },
      profile: { aliases: [], version: expired.version },
    });
    expect(Date.parse(event.payload.timestamp)).toBeLessThan(Date.parse(scheduled.aliases[0].expiresAt));
    const other = (await request('user_2')).json();
    expect((await changeHandle('user_2', original.handle, other.version)).statusCode).toBe(200);
  });

  it('releases a due alias at its exact expiry and permits a newer claim generation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const other = (await request('user_2')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const alias = scheduled.aliases[0];
      const candidate = { profileId: original.id, handle: alias.handle, claimGeneration: alias.claimGeneration };
      const deadline = new Date(alias.expiresAt);
      expect(await service().expireDueAlias(candidate, new Date(deadline.getTime() - 1))).toBe(false);
      expect((await request('user_1')).json()).toEqual(scheduled);
      expect((await changeHandle('user_2', alias.handle, other.version)).statusCode).toBe(409);
      vi.setSystemTime(deadline);
      expect(await service().expireDueAlias(candidate, deadline)).toBe(true);
      const expired = (await request('user_1')).json();
      expect(expired).toMatchObject({ handle: changed.handle, aliases: [], version: scheduled.version + 1 });
      const [event] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
      expect(event.payload).toMatchObject({
        timestamp: deadline.toISOString(),
        change: { type: 'alias-expired', handle: alias.handle, claimGeneration: alias.claimGeneration, before: alias.expiresAt, after: null, reason: 'scheduled' },
        profile: { aliases: [], version: expired.version },
      });
      expect(await service().expireDueAlias(candidate, deadline)).toBe(false);
      const reclaimed = await changeHandle('user_2', alias.handle, other.version);
      expect(reclaimed.statusCode).toBe(200);
      const [claimEvent] = await sql`select payload from outbox_events where aggregate_id = 'user_2' and subject = 'profile.updated'`;
      expect(claimEvent.payload.profile.claimGeneration).toBeGreaterThan(alias.claimGeneration);
      expect((await request('user_1')).json()).toEqual({ ...expired, historicalHandles: [{ ...expired.historicalHandles[0], unavailableReason: 'claimed' }] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('automatically expires due aliases through the running application worker', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const deadline = new Date(scheduled.aliases[0].expiresAt);
      vi.setSystemTime(new Date(deadline.getTime() - 1));
      await aliasExpiryTimer.tickAsync(1_000);
      expect((await request('user_1')).json()).toEqual(scheduled);
      vi.setSystemTime(deadline);
      await aliasExpiryTimer.tickAsync(1_000);
      const expired = (await request('user_1')).json();
      expect(expired).toMatchObject({ aliases: [], version: scheduled.version + 1 });
      await aliasExpiryTimer.tickAsync(1_000);
      expect((await request('user_1')).json()).toEqual(expired);
      expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('only permits authenticated owners to immediately expire scheduled aliases at the last-seen version', async () => {
    const original = (await request('user_1')).json();
    const other = (await request('user_2')).json();
    const retained = (await changeHandle('user_1', 'current-handle', original.version)).json();
    const unauthenticated = await app.inject({ method: 'POST', url: `/profile/me/aliases/${original.handle}/expire`, payload: { expectedVersion: retained.version } });
    expect(unauthenticated.statusCode).toBe(401);
    expect((await expireAlias('user_1', original.handle, 0)).statusCode).toBe(400);
    const notScheduled = await expireAlias('user_1', original.handle, retained.version);
    expect(notScheduled.statusCode).toBe(409);
    expect(notScheduled.json().type).toMatch(/alias-not-scheduled$/);
    expect((await expireAlias('user_2', original.handle, other.version)).statusCode).toBe(404);
    expect((await expireAlias('user_1', retained.handle, retained.version)).statusCode).toBe(404);
    expect((await request('user_1')).json()).toEqual(retained);
    const scheduled = (await scheduleAlias('user_1', original.handle, retained.version)).json();
    const stale = await expireAlias('user_1', original.handle, retained.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().type).toMatch(/profile-version-conflict$/);
    const expired = (await expireAlias('user_1', original.handle, scheduled.version)).json();
    expect((await expireAlias('user_1', original.handle, scheduled.version)).statusCode).toBe(409);
    expect((await expireAlias('user_1', original.handle, expired.version)).statusCode).toBe(404);
    expect((await request('user_1')).json()).toEqual(expired);
    expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`).toHaveLength(1);
  });

  it('rolls back failed expiry events and retries them without blocking later due aliases', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      identities.identities.set('user_bad', { displayName: 'A poison', firstName: null, lastName: null });
      identities.identities.set('user_good', { displayName: 'Z healthy', firstName: null, lastName: null });
      const owners = [];
      for (const id of ['user_bad', 'user_good']) {
        const original = (await request(id)).json();
        const changed = (await changeHandle(id, `current-${id.replace('_', '-')}`, original.version)).json();
        owners.push((await scheduleAlias(id, original.handle, changed.version)).json());
      }
      const [bad, good] = owners;
      const other = (await request('user_other')).json();
      await sql.unsafe(`create function reject_expiry_event() returns trigger language plpgsql as $$ begin if new.aggregate_id = 'user_bad' and new.payload->'change'->>'type' = 'alias-expired' then raise exception 'expiry event rejected'; end if; return new; end $$`);
      await sql.unsafe(`create trigger reject_expiry_event before insert on outbox_events for each row execute function reject_expiry_event()`);
      try {
        expect((await expireAlias(bad.id, bad.aliases[0].handle, bad.version)).statusCode).toBe(500);
        expect((await request(bad.id)).json()).toEqual(bad);
        expect((await changeHandle(other.id, bad.aliases[0].handle, other.version)).statusCode).toBe(409);
        vi.setSystemTime(new Date(bad.aliases[0].expiresAt));
        await aliasExpiryTimer.tickAsync(1_000);
        expect((await request(bad.id)).json()).toEqual(bad);
        expect((await request(good.id)).json()).toMatchObject({ aliases: [], version: good.version + 1 });
        const events = await sql`select aggregate_id from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
        expect(events.map((event) => event.aggregate_id)).toEqual([good.id]);
      } finally {
        await sql.unsafe('drop trigger reject_expiry_event on outbox_events; drop function reject_expiry_event()');
      }
      await aliasExpiryTimer.tickAsync(1_000);
      expect((await request(bad.id)).json()).toMatchObject({ aliases: [], version: bad.version + 1 });
      expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('safely races workers, immediate expiry, and a new Handle claimant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const other = (await request('user_2')).json();
      const changed = (await changeHandle('user_1', 'current-handle', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const reference = { profileId: original.id, handle: original.handle, claimGeneration: scheduled.aliases[0].claimGeneration };
      vi.setSystemTime(new Date(scheduled.aliases[0].expiresAt));
      const worker = () => new ProfileAliasExpiryWorker(database, (alias, now) => service().expireDueAlias(alias, now), { error: () => {} });
      const firstWorker = worker();
      const secondWorker = worker();
      const [,,, immediate, claim] = await Promise.all([
        firstWorker.expirePending(), firstWorker.expirePending(), secondWorker.expirePending(),
        expireAlias('user_1', original.handle, scheduled.version),
        changeHandle('user_2', original.handle, other.version),
      ]);
      expect([200, 409]).toContain(immediate.statusCode);
      expect([200, 409]).toContain(claim.statusCode);
      expect((await request('user_1')).json()).toMatchObject({ aliases: [], version: scheduled.version + 1 });
      expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expired'`).toHaveLength(1);
      if (claim.statusCode === 409) expect((await changeHandle('user_2', original.handle, other.version)).statusCode).toBe(200);
      const reclaimed = (await request('user_2')).json();
      expect(reclaimed.handle).toBe(original.handle);
      expect(await service().expireDueAlias(reference, new Date())).toBe(false);
      expect((await request('user_2')).json()).toEqual(reclaimed);
      const [event] = await sql`select payload from outbox_events where aggregate_id = 'user_2' and subject = 'profile.updated'`;
      expect(event.payload.profile.claimGeneration).toBeGreaterThan(reference.claimGeneration);
      await Promise.all([firstWorker.stop(), secondWorker.stop()]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drains a failed alias scan during shutdown without preventing dependency cleanup', async () => {
    const failure = new Error('database scan failed');
    const scan = vi.spyOn(database.getClient().db.query.handleClaims, 'findMany').mockRejectedValue(failure);
    const timer = new FakeTimerService();
    const logger = { error: vi.fn() };
    const worker = new ProfileAliasExpiryWorker(database, async () => false, logger, timer);
    try {
      worker.start();
      await expect(worker.stop()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith({ err: failure }, 'Profile alias expiry cycle failed');
      await timer.tickAsync(1_000);
      expect(scan).toHaveBeenCalledTimes(1);
    } finally {
      scan.mockRestore();
    }
  });

  it('ignores an old expiry scan after the owner promotes and retains a newer claim for that Handle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const original = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'first-current', original.version)).json();
      const scheduled = (await scheduleAlias('user_1', original.handle, changed.version)).json();
      const staleReference = { profileId: original.id, handle: original.handle, claimGeneration: scheduled.aliases[0].claimGeneration };
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      const promoted = await changeHandle('user_1', original.handle, scheduled.version);
      expect(promoted.statusCode).toBe(200);
      expect(await service().expireDueAlias(staleReference, new Date())).toBe(false);
      vi.setSystemTime(new Date('2030-01-15T12:00:00.000Z'));
      const changedAgain = (await changeHandle('user_1', 'second-current', promoted.json().version)).json();
      const scheduledAgain = (await scheduleAlias('user_1', original.handle, changedAgain.version)).json();
      const newer = scheduledAgain.aliases.find((alias: { handle: string }) => alias.handle === original.handle);
      expect(newer.claimGeneration).toBeGreaterThan(staleReference.claimGeneration);
      vi.setSystemTime(new Date(newer.expiresAt));
      expect(await service().expireDueAlias(staleReference, new Date())).toBe(false);
      expect((await request('user_1')).json()).toEqual(scheduledAgain);
      expect(await service().expireDueAlias({ ...staleReference, claimGeneration: newer.claimGeneration }, new Date())).toBe(true);
      const expired = (await request('user_1')).json();
      expect(expired.aliases.map((alias: { handle: string }) => alias.handle)).toEqual(['first-current']);
      const [event] = await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expired'`;
      expect(event.payload.change.claimGeneration).toBe(newer.claimGeneration);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a retained alias for exactly 24 hours and records its complete versioned snapshot', async () => {
    const before = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
    const now = new Date('2030-01-01T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      const response = await scheduleAlias('user_1', before.handle.toUpperCase(), changed.version);
      expect(response.statusCode).toBe(200);
      const scheduled = response.json();
      const expiresAt = '2030-01-02T12:00:00.000Z';
      expect(scheduled).toMatchObject({
        handle: changed.handle, version: 3, lastHandleChangedAt: changed.lastHandleChangedAt,
        aliases: [{ ...changed.aliases[0], expiresAt }],
      });
      const events = await sql`select payload from outbox_events where payload->'change'->>'type' = 'alias-expiry-scheduled'`;
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        eventType: 'profile.updated', timestamp: now.toISOString(),
        change: { type: 'alias-expiry-scheduled', handle: before.handle, before: null, after: expiresAt },
        profile: { handle: changed.handle, version: 3, aliases: scheduled.aliases },
      });
      const renamed = (await patch('user_1', 'Renamed', scheduled.version)).json();
      expect(renamed.aliases).toEqual(scheduled.aliases);
      expect((await request('user_1')).json()).toEqual(renamed);
      const publisher = new FakeProfileEventPublisher();
      await new ProfileOutboxPublisherWorker(database, publisher, { error: () => {} }).publishPending();
      expect(publisher.events).toContainEqual(expect.objectContaining({
        change: events[0].payload.change,
        profile: expect.objectContaining({ aliases: scheduled.aliases }),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns retained alias dates and the configured limit in every owner snapshot', async () => {
    const before = (await request('user_1')).json();
    expect(before).toMatchObject({ retainedAliasLimit: 3, aliases: [] });
    const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
    expect(changed.aliases).toEqual([{
      handle: before.handle,
      claimGeneration: expect.any(Number),
      createdAt: changed.lastHandleChangedAt,
      expiresAt: null,
    }]);
    const renamed = (await patch('user_1', 'New name', changed.version)).json();
    expect(renamed).toMatchObject({ aliases: changed.aliases, retainedAliasLimit: 3 });
    expect((await request('user_1')).json()).toEqual(renamed);
    const events = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(events).toHaveLength(2);
    for (const { payload } of events) expect(payload.profile.aliases).toEqual(changed.aliases);
  });

  it('keeps a scheduled expiry unchanged on retry and reserves the alias until a later release', async () => {
    const before = (await request('user_1')).json();
    const other = (await request('user_2')).json();
    const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
    const scheduled = (await scheduleAlias('user_1', before.handle, changed.version)).json();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.parse(scheduled.aliases[0].expiresAt) + 1));
    try {
      const repeated = await scheduleAlias('user_1', before.handle, scheduled.version);
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json()).toEqual(scheduled);
      expect((await scheduleAlias('user_1', before.handle, changed.version)).statusCode).toBe(409);
      expect((await changeHandle('user_2', before.handle, other.version)).statusCode).toBe(409);
      expect((await request('user_1')).json()).toEqual(scheduled);
      expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expiry-scheduled'`).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('atomically schedules the deterministic oldest retained alias when changing at capacity', async () => {
    identities.identities.set('user_1', { displayName: 'Zulu', firstName: null, lastName: null });
    let owner = (await request('user_1')).json();
    const week = 7 * 24 * 60 * 60 * 1000;
    const start = Date.parse('2030-01-01T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (const [index, handle] of ['alpha', 'bravo', 'current'].entries()) {
        vi.setSystemTime(new Date(start + index * week));
        const response = await changeHandle('user_1', handle, owner.version);
        expect(response.statusCode).toBe(200);
        owner = response.json();
      }
      expect(owner.aliases).toHaveLength(3);
      expect(owner.aliases.every((alias: { expiresAt: string | null }) => alias.expiresAt === null)).toBe(true);
      // Existing claims can share retention timestamps; Handle breaks that tie.
      await sql`update handle_claims set created_at = '2030-01-01T12:00:00Z' where handle in ('zulu', 'alpha')`;
      const now = new Date(start + 3 * week);
      vi.setSystemTime(now);
      const response = await changeHandle('user_1', 'next-handle', owner.version);
      expect(response.statusCode).toBe(200);
      const updated = response.json();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      expect(updated.aliases.filter((alias: { expiresAt: string | null }) => alias.expiresAt !== null)).toEqual([
        { ...owner.aliases.find((alias: { handle: string }) => alias.handle === 'alpha'), createdAt: new Date(start).toISOString(), expiresAt },
      ]);
      expect(updated.aliases.filter((alias: { expiresAt: string | null }) => alias.expiresAt === null)).toHaveLength(3);
      expect((await request('user_1')).json()).toEqual(updated);
      const events = await sql`select payload from outbox_events where payload->'profile'->>'version' = ${String(updated.version)}`;
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        change: { type: 'handle-changed', before: 'current', after: 'next-handle', scheduledAliases: [{ handle: 'alpha', expiresAt }] },
        profile: { version: updated.version, aliases: updated.aliases },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('immediately excludes expiring aliases from a configured retained limit of one', async () => {
    const previousLimit = config.profileRetainedAliasLimit;
    config.profileRetainedAliasLimit = 1;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const before = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'first', before.version)).json();
      // After cooldown, schedule and immediately use the freed retained slot.
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      const scheduled = (await scheduleAlias('user_1', before.handle, changed.version)).json();
      const response = await changeHandle('user_1', 'second', scheduled.version);
      expect(response.statusCode).toBe(200);
      const updated = response.json();
      expect(updated.retainedAliasLimit).toBe(1);
      expect(updated.aliases).toEqual([
        scheduled.aliases[0],
        { handle: 'first', claimGeneration: expect.any(Number), createdAt: updated.lastHandleChangedAt, expiresAt: null },
      ]);
      const [event] = await sql`select payload from outbox_events where payload->'profile'->>'version' = ${String(updated.version)}`;
      expect(event.payload.change.scheduledAliases).toEqual([]);
    } finally {
      config.profileRetainedAliasLimit = previousLimit;
      vi.useRealTimers();
    }
  });

  it('enforces a reduced limit of zero by scheduling all excess aliases in one change', async () => {
    const previousLimit = config.profileRetainedAliasLimit;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    try {
      const before = (await request('user_1')).json();
      const changed = (await changeHandle('user_1', 'first', before.version)).json();
      config.profileRetainedAliasLimit = 0;
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      const response = await changeHandle('user_1', 'second', changed.version);
      expect(response.statusCode).toBe(200);
      const updated = response.json();
      const expiresAt = '2030-01-09T12:00:00.000Z';
      expect(updated.retainedAliasLimit).toBe(0);
      expect(updated.aliases).toHaveLength(2);
      expect(updated.aliases.every((alias: { expiresAt: string | null }) => alias.expiresAt === expiresAt)).toBe(true);
      const [event] = await sql`select payload from outbox_events where payload->'profile'->>'version' = ${String(updated.version)}`;
      expect(event.payload.change.scheduledAliases).toEqual([
        { handle: before.handle, expiresAt }, { handle: 'first', expiresAt },
      ]);
    } finally {
      config.profileRetainedAliasLimit = previousLimit;
      vi.useRealTimers();
    }
  });

  it('requires authentication, ownership, and the last-seen version to schedule an alias', async () => {
    const before = (await request('user_1')).json();
    const other = (await request('user_2')).json();
    const owner = (await changeHandle('user_1', 'current-handle', before.version)).json();
    const unauthenticated = await app.inject({ method: 'DELETE', url: `/profile/me/aliases/${before.handle}`, payload: { expectedVersion: owner.version } });
    expect(unauthenticated.statusCode).toBe(401);
    const token = Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64');
    for (const payload of [{}, { expectedVersion: '2' }, { expectedVersion: 0 }, { expectedVersion: 1.5 }]) {
      const invalid = await app.inject({ method: 'DELETE', url: `/profile/me/aliases/${before.handle}`, headers: { authorization: `Bearer ${token}` }, payload });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().type).toMatch(/invalid-alias-command$/);
    }
    const stale = await scheduleAlias('user_1', before.handle, before.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().type).toMatch(/profile-version-conflict$/);
    for (const response of [
      await scheduleAlias('user_2', before.handle, other.version),
      await scheduleAlias('user_1', owner.handle, owner.version),
      await scheduleAlias('user_1', 'unclaimed-alias', owner.version),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().type).toMatch(/alias-not-found$/);
    }
    expect((await request('user_1')).json()).toEqual(owner);
    expect((await request('user_2')).json()).toEqual(other);
    expect(await sql`select * from outbox_events where payload->'change'->>'type' = 'alias-expiry-scheduled'`).toHaveLength(0);
  });

  it('serializes scheduling against a Handle change at capacity with coherent owner reads', async () => {
    const start = Date.parse('2030-01-01T12:00:00.000Z');
    const week = 7 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(start));
    try {
      let owner = (await request('user_1')).json();
      for (const [index, handle] of ['first', 'second', 'current'].entries()) {
        vi.setSystemTime(new Date(start + index * week));
        owner = (await changeHandle('user_1', handle, owner.version)).json();
      }
      vi.setSystemTime(new Date(start + 3 * week));
      const [schedule, change, ...reads] = await Promise.all([
        scheduleAlias('user_1', owner.aliases[0].handle, owner.version),
        changeHandle('user_1', 'next', owner.version),
        ...Array.from({ length: 8 }, () => request('user_1')),
      ]);
      expect([schedule.statusCode, change.statusCode].sort()).toEqual([200, 409]);
      const accepted = (schedule.statusCode === 200 ? schedule : change).json();
      const stale = (schedule.statusCode === 409 ? schedule : change).json();
      expect(stale.type).toMatch(/profile-version-conflict$/);
      expect(accepted.version).toBe(owner.version + 1);
      expect(accepted.aliases.filter((alias: { expiresAt: string | null }) => alias.expiresAt !== null)).toHaveLength(1);
      for (const read of reads) expect(read.json()).toEqual(read.json().version === owner.version ? owner : accepted);
      expect((await request('user_1')).json()).toEqual(accepted);
      expect(await sql`select * from outbox_events where payload->'profile'->>'version' = ${String(accepted.version)}`).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back explicit and automatic scheduling when recording the Profile event fails', async () => {
    const previousLimit = config.profileRetainedAliasLimit;
    config.profileRetainedAliasLimit = 1;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00.000Z'));
    const initial = (await request('user_1')).json();
    const owner = (await changeHandle('user_1', 'current', initial.version)).json();
    await sql.unsafe(`create function reject_alias_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'alias event rejected'; end if; return new; end $$`);
    await sql.unsafe(`create trigger reject_alias_event before insert on outbox_events for each row execute function reject_alias_event()`);
    try {
      expect((await scheduleAlias('user_1', initial.handle, owner.version)).statusCode).toBe(500);
      expect((await request('user_1')).json()).toEqual(owner);
      vi.setSystemTime(new Date('2030-01-08T12:00:00.000Z'));
      expect((await changeHandle('user_1', 'rollback-next', owner.version)).statusCode).toBe(500);
      expect((await request('user_1')).json()).toEqual(owner);
      expect(await sql`select * from handle_claims where handle = 'rollback-next'`).toHaveLength(0);
      expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(1);
    } finally {
      await sql.unsafe('drop trigger reject_alias_event on outbox_events; drop function reject_alias_event()');
      config.profileRetainedAliasLimit = previousLimit;
      vi.useRealTimers();
    }
  });

  it('changes a Handle atomically and preserves the former Handle as an alias', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    const before = (await request('user_1')).json();
    const response = await changeHandle('user_1', '  New__Hándle -- ', before.version);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'user_1', handle: 'new-handle', displayName: 'Before', version: 2,
      aliases: [{ handle: 'before', claimGeneration: expect.any(Number) }],
    });
    const events = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      eventType: 'profile.updated',
      change: { type: 'handle-changed', before: 'before', after: 'new-handle' },
      profile: {
        id: 'user_1', handle: 'new-handle', displayName: 'Before', version: 2,
        biographyMarkdown: '', pictureAssetId: null,
        aliases: response.json().aliases,
      },
    });
    expect(events[0].payload.profile.claimGeneration).toBeGreaterThan(response.json().aliases[0].claimGeneration);
    expect((await request('user_1')).json()).toMatchObject(response.json());
  });

  it('rejects reserved and out-of-range normalized Handles without changing the Profile', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    const before = (await request('user_1')).json();
    const previousMinimum = config.profileHandleMinLength;
    const previousMaximum = config.profileHandleMaxLength;
    config.profileHandleMinLength = 3;
    config.profileHandleMaxLength = 10;
    try {
      for (const handle of [' ADMÍN ', 'sUpPoRt', 'GraphQL', 'settings', '--!!!', ' A ', 'abcdefghijkl']) {
        const response = await changeHandle('user_1', handle, before.version);
        expect(response.statusCode, handle).toBe(400);
        expect(response.json().type).toMatch(/invalid-handle$/);
      }
      expect((await request('user_1')).json()).toEqual(before);
      expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(0);
    } finally {
      config.profileHandleMinLength = previousMinimum;
      config.profileHandleMaxLength = previousMaximum;
    }
  });

  it('requires authentication and a positive expected version for Handle commands', async () => {
    const before = (await request('user_1')).json();
    const unauthenticated = await app.inject({ method: 'PUT', url: '/profile/me/handle', payload: { handle: 'new', expectedVersion: 1 } });
    expect(unauthenticated.statusCode).toBe(401);
    const token = Buffer.from(JSON.stringify({ id: 'user_1' })).toString('base64');
    for (const payload of [{}, { handle: 2, expectedVersion: 1 }, { handle: 'new' }, { handle: 'new', expectedVersion: 0 }, { handle: 'new', expectedVersion: 1.5 }]) {
      const response = await app.inject({ method: 'PUT', url: '/profile/me/handle', headers: { authorization: `Bearer ${token}` }, payload });
      expect(response.statusCode).toBe(400);
    }
    const stale = await changeHandle('user_1', 'new', before.version + 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().type).toMatch(/profile-version-conflict$/);
    expect((await request('user_1')).json()).toEqual(before);
  });

  it('enforces seven days between Handle changes and allows the exact cooldown boundary', async () => {
    const before = (await request('user_1')).json();
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2030-01-01T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const first = await changeHandle('user_1', 'first-handle', before.version);
      expect(first.statusCode).toBe(200);
      const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      vi.setSystemTime(new Date(deadline.getTime() - 1));
      const early = await changeHandle('user_1', 'second-handle', first.json().version);
      expect(early.statusCode).toBe(429);
      expect(early.json()).toMatchObject({ type: expect.stringMatching(/handle-cooldown$/), nextHandleChangeAt: deadline.toISOString() });
      expect((await request('user_1')).json()).toEqual(first.json());
      expect(first.json().lastHandleChangedAt).toBe(now.toISOString());
      vi.setSystemTime(deadline);
      const next = await changeHandle('user_1', 'second-handle', first.json().version);
      expect(next.statusCode).toBe(200);
      expect(next.json()).toMatchObject({ handle: 'second-handle', version: 3, lastHandleChangedAt: deadline.toISOString() });
      expect(next.json().aliases).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns unchanged owner state for the same normalized Handle during cooldown', async () => {
    const before = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
    const same = await changeHandle('user_1', ' NEW__HANDLE ', changed.version);
    expect(same.statusCode).toBe(200);
    expect(same.json()).toEqual(changed);
    expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(1);
    expect((await changeHandle('user_1', 'new-handle', before.version)).statusCode).toBe(409);
  });

  it('permits one concurrent claimant and reserves current Handles and aliases together', async () => {
    identities.identities.set('one', { displayName: 'First', firstName: null, lastName: null });
    identities.identities.set('two', { displayName: 'Second', firstName: null, lastName: null });
    const before = await Promise.all(['one', 'two'].map(async (id) => (await request(id)).json()));
    const responses = await Promise.all([
      changeHandle('one', 'same-handle', 1),
      changeHandle('two', ' SAME_HANDLE ', 1),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winnerIndex = responses.findIndex((response) => response.statusCode === 200);
    const loserIndex = 1 - winnerIndex;
    const winner = responses[winnerIndex].json();
    const loser = before[loserIndex];
    expect(responses[loserIndex].json().type).toMatch(/handle-unavailable$/);
    expect((await request(loser.id)).json()).toEqual(loser);
    const aliasCollision = await changeHandle(loser.id, before[winnerIndex].handle.toUpperCase(), 1);
    expect(aliasCollision.statusCode).toBe(409);
    expect(aliasCollision.json().type).toMatch(/handle-unavailable$/);
    expect((await request(winner.id)).json()).toEqual(winner);
    const events = await sql`select payload from outbox_events where subject = 'profile.updated'`;
    expect(events).toHaveLength(1);
    expect(events[0].payload.profile.claimGeneration).toBeGreaterThan(winner.aliases[0].claimGeneration);
    identities.identities.set('three', { displayName: before[winnerIndex].handle, firstName: null, lastName: null });
    const allocated = (await request('three')).json();
    expect(allocated.handle).not.toBe(before[winnerIndex].handle);
  });

  it('preserves aliases in owner responses and complete snapshots after Display-name edits', async () => {
    const before = (await request('user_1')).json();
    const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
    const edited = await patch('user_1', 'New Display', changed.version);
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      aliases: changed.aliases, lastHandleChangedAt: changed.lastHandleChangedAt,
      displayName: 'New Display', version: 3,
    });
    const events = await sql`select payload from outbox_events where subject = 'profile.updated' order by created_at, id`;
    expect(events[1].payload.profile).toMatchObject({ aliases: changed.aliases, handle: changed.handle, displayName: 'New Display', version: 3 });
    expect((await patch('user_1', 'New Display', 3)).json()).toEqual(edited.json());
    expect((await request('user_1')).json()).toEqual(edited.json());
  });

  it('can promote its own retained alias with a new generation after cooldown', async () => {
    const before = (await request('user_1')).json();
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = new Date('2030-01-01T12:00:00.000Z');
    vi.setSystemTime(now);
    try {
      const changed = (await changeHandle('user_1', 'new-handle', before.version)).json();
      vi.setSystemTime(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      const reverted = await changeHandle('user_1', before.handle, changed.version);
      expect(reverted.statusCode).toBe(200);
      expect(reverted.json()).toMatchObject({ handle: before.handle, version: 3, aliases: [{ handle: 'new-handle', claimGeneration: expect.any(Number) }] });
      const events = await sql`select payload from outbox_events where subject = 'profile.updated' order by created_at, id`;
      expect(events[1].payload.profile.claimGeneration).toBeGreaterThan(events[0].payload.profile.claimGeneration);
      expect(events[1].payload.change).toEqual({ type: 'handle-changed', before: 'new-handle', after: before.handle, scheduledAliases: [] });
      expect((await request('user_1')).json()).toEqual(reverted.json());
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls back the Handle, cooldown, and claims when recording the transition fails', async () => {
    const before = (await request('user_1')).json();
    await sql.unsafe(`create function reject_handle_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'handle event rejected'; end if; return new; end $$`);
    await sql.unsafe('create trigger reject_handle_event before insert on outbox_events for each row execute function reject_handle_event()');
    try {
      const failed = await changeHandle('user_1', 'new-handle', before.version);
      expect(failed.statusCode).toBe(500);
      expect((await request('user_1')).json()).toEqual(before);
      expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(0);
    } finally {
      await sql.unsafe('drop trigger reject_handle_event on outbox_events; drop function reject_handle_event()');
    }
    const accepted = await changeHandle('user_1', 'new-handle', before.version);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ version: 2, aliases: [{ handle: before.handle, claimGeneration: expect.any(Number) }] });
  });

  it('serializes competing Handle edits and returns coherent owner snapshots', async () => {
    const before = (await request('user_1')).json();
    const [first, second, ...reads] = await Promise.all([
      changeHandle('user_1', 'first-handle', before.version),
      changeHandle('user_1', 'second-handle', before.version),
      ...Array.from({ length: 8 }, () => request('user_1')),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const stale = first.statusCode === 409 ? first : second;
    expect(stale.json().type).toMatch(/profile-version-conflict$/);
    for (const response of reads) {
      expect(response.statusCode).toBe(200);
      const profile = response.json();
      if (profile.version === 1) expect(profile).toEqual(before);
      else expect(profile).toMatchObject({
        version: 2, handle: expect.stringMatching(/^(first|second)-handle$/),
        aliases: [{ handle: before.handle, claimGeneration: expect.any(Number) }],
      });
    }
    expect(await sql`select * from outbox_events where subject = 'profile.updated'`).toHaveLength(1);
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

  it('returns the existing profile without creating another event', async () => {
    identities.identities.set('user_1', { displayName: 'Ada', firstName: null, lastName: null });
    const first = await service().ensure('user_1');
    identities.identities.set('user_1', { displayName: 'Changed', firstName: null, lastName: null });
    const second = await service().ensure('user_1');
    expect(second).toEqual(first);
    expect((await sql`select * from outbox_events`).length).toBe(1);
  });

  it('normalizes Unicode whitespace and records an atomic Display-name change', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');

    const response = await patch('user_1', '  Éowyn\t雪\nQueen  ', 1);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'user_1',
      displayName: 'Éowyn 雪 Queen',
      version: 2,
    });
    const rows = await sql`select subject, payload from outbox_events order by created_at, id`;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      subject: 'profile.updated',
      payload: {
        eventType: 'profile.updated',
        change: { type: 'display-name-changed', before: 'Before', after: 'Éowyn 雪 Queen' },
        profile: { displayName: 'Éowyn 雪 Queen', version: 2 },
      },
    });
  });

  it('rejects whitespace-only and over-limit Display names without changing state', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');
    const previousMaximum = config.profileDisplayNameMaxLength;
    config.profileDisplayNameMaxLength = 3;

    try {
      const whitespace = await patch('user_1', ' \t\n ', 1);
      const tooLong = await patch('user_1', '雪雪雪雪', 1);
      expect(whitespace.statusCode).toBe(400);
      expect(tooLong.statusCode).toBe(400);
      expect((await sql`select display_name, version from profiles where id = 'user_1'`)[0]).toMatchObject({
        display_name: 'Before',
        version: 1,
      });
      expect((await sql`select * from outbox_events`).length).toBe(1);
    } finally {
      config.profileDisplayNameMaxLength = previousMaximum;
    }
  });

  it('allows only one of two concurrent edits at the last-seen version', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');

    const responses = await Promise.all([
      patch('user_1', 'First edit', 1),
      patch('user_1', 'Second edit', 1),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const [stored] = await sql`select display_name, version from profiles where id = 'user_1'`;
    expect(stored.version).toBe(2);
    expect(['First edit', 'Second edit']).toContain(stored.display_name);
    expect((await sql`select * from outbox_events where subject = 'profile.updated'`).length).toBe(1);
  });

  it('rolls back the Display name and version when recording its event fails', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');
    await sql.unsafe(`create function reject_update_event() returns trigger language plpgsql as $$ begin if new.subject = 'profile.updated' then raise exception 'update event rejected'; end if; return new; end $$`);
    await sql.unsafe(`create trigger reject_update_event before insert on outbox_events for each row execute function reject_update_event()`);

    try {
      await expect(service().updateDisplayName('user_1', 'After', 1)).rejects.toThrow(
        'update event rejected'
      );
      expect((await sql`select display_name, version from profiles where id = 'user_1'`)[0]).toMatchObject({
        display_name: 'Before',
        version: 1,
      });
    } finally {
      await sql.unsafe(
        'drop trigger reject_update_event on outbox_events; drop function reject_update_event()'
      );
    }
  });

  it('prioritizes full name and then a stable generated fallback', async () => {
    identities.identities.set('full', {
      displayName: null,
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    const full = await service().ensure('full');
    const fallback = await service().ensure('fallback');
    expect(full.displayName).toBe('Grace Hopper');
    expect(full.handle).toBe('grace-hopper');
    expect(fallback.displayName).toMatch(/^(quiet|bright|silver|wild) (aurora|canvas|horizon|pixel)$/);
    expect(fallback.handle).toBe(fallback.displayName.replace(' ', '-'));
  });

  it('normalizes and bounds the initial Display name with the configured policy', async () => {
    identities.identities.set('bounded', {
      displayName: '  Éowyn\t Snow  ',
      firstName: null,
      lastName: null,
    });
    const previousMaximum = config.profileDisplayNameMaxLength;
    config.profileDisplayNameMaxLength = 5;

    try {
      const profile = await service().ensure('bounded');
      expect(profile.displayName).toBe('Éowyn');
      expect(profile.handle).toBe('eowyn');
    } finally {
      config.profileDisplayNameMaxLength = previousMaximum;
    }
  });

  it('claims collision suffixes atomically for different users', async () => {
    for (const id of ['one', 'two']) {
      identities.identities.set(id, { displayName: 'Same Name', firstName: null, lastName: null });
    }
    const results = await Promise.all([service().ensure('one'), service().ensure('two')]);
    const handles = results.map((profile) => profile.handle);
    expect(new Set(handles).size).toBe(2);
    expect(handles).toContain('same-name');
    expect(handles.find((handle) => handle !== 'same-name')).toMatch(/^same-name-[a-z0-9]{6}$/);
    const claims = await sql`select claim_generation from handle_claims order by claim_generation`;
    expect(Number(claims[1].claim_generation)).toBeGreaterThan(
      Number(claims[0].claim_generation)
    );
  });

  it('keeps collision handles within a short configured maximum', async () => {
    for (const id of ['short-one', 'short-two']) {
      identities.identities.set(id, { displayName: 'Ada', firstName: null, lastName: null });
    }
    const previousMaximum = config.profileHandleMaxLength;
    config.profileHandleMaxLength = 3;

    try {
      const profiles = await Promise.all([
        service().ensure('short-one'),
        service().ensure('short-two'),
      ]);

      expect(new Set(profiles.map((profile) => profile.handle)).size).toBe(2);
      expect(profiles.every((profile) => profile.handle.length <= 3)).toBe(true);
    } finally {
      config.profileHandleMaxLength = previousMaximum;
    }
  });

  it('avoids reserved handles and respects the configured maximum length', async () => {
    identities.identities.set('reserved', {
      displayName: 'Admin',
      firstName: null,
      lastName: null,
    });
    identities.identities.set('long', {
      displayName: 'A very long profile display name',
      firstName: null,
      lastName: null,
    });
    identities.identities.set('route', {
      displayName: 'GraphQL',
      firstName: null,
      lastName: null,
    });
    identities.identities.set('api', {
      displayName: 'Tags',
      firstName: null,
      lastName: null,
    });
    const reserved = await service().ensure('reserved');
    const long = await service().ensure('long');
    const route = await service().ensure('route');
    const api = await service().ensure('api');
    expect(reserved.handle).toBe('admin-profile');
    expect(long.handle.length).toBeLessThanOrEqual(config.profileHandleMaxLength);
    expect(route.handle).toBe('graphql-profile');
    expect(api.handle).toBe('tags-profile');
  });

  it('does not recreate a reserved handle when applying the configured maximum length', async () => {
    identities.identities.set('reserved', {
      displayName: 'Security',
      firstName: null,
      lastName: null,
    });
    const previousMaximum = config.profileHandleMaxLength;
    config.profileHandleMaxLength = 8;

    try {
      const profile = await service().ensure('reserved');
      expect(profile.handle).not.toBe('security');
      expect(profile.handle.length).toBeLessThanOrEqual(config.profileHandleMaxLength);
    } finally {
      config.profileHandleMaxLength = previousMaximum;
    }
  });

  it('is idempotent under concurrent ensures for the same user', async () => {
    identities.identities.set('same', { displayName: 'Concurrent', firstName: null, lastName: null });
    const results = await Promise.all(Array.from({ length: 8 }, () => service().ensure('same')));
    expect(new Set(results.map((profile) => profile.id))).toEqual(new Set(['same']));
    expect((await sql`select * from profiles`).length).toBe(1);
    expect((await sql`select * from outbox_events`).length).toBe(1);
  });

  it('returns 503 and writes nothing when Clerk lookup fails', async () => {
    identities.error = new Error('Clerk unavailable');
    const response = await request('user_1');
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'https://wallpaperdb.example/problems/identity-unavailable',
      title: 'Identity service unavailable',
      status: 503,
      detail: 'Clerk identity lookup failed',
      instance: '/profile/me/ensure',
    });
    expect((await sql`select * from profiles`).length).toBe(0);
    expect((await sql`select * from handle_claims`).length).toBe(0);
    expect((await sql`select * from outbox_events`).length).toBe(0);
  });

  it('rolls back profile and handle writes when the outbox write fails', async () => {
    identities.identities.set('user_1', { displayName: 'Rollback', firstName: null, lastName: null });
    await sql.unsafe(`create function reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'outbox rejected'; end $$`);
    await sql.unsafe(`create trigger reject_outbox before insert on outbox_events for each row execute function reject_outbox()`);
    try {
      await expect(service().ensure('user_1')).rejects.toThrow('outbox rejected');
      expect((await sql`select * from profiles`).length).toBe(0);
      expect((await sql`select * from handle_claims`).length).toBe(0);
    } finally {
      await sql.unsafe('drop trigger reject_outbox on outbox_events; drop function reject_outbox()');
    }
  });

  it('marks an outbox event published only after acknowledged publication', async () => {
    identities.identities.set('user_1', { displayName: 'Ada', firstName: null, lastName: null });
    await service().ensure('user_1');
    const publisher = new FakeProfileEventPublisher();
    const worker = new ProfileOutboxPublisherWorker(database, publisher, { error: () => {} });

    await worker.publishPending();

    const [stored] = await sql`select id, published_at from outbox_events`;
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0].eventId).toBe(stored.id);
    expect(stored.published_at).not.toBeNull();
  });

  it('publishes recorded Display-name updates through the typed outbox publisher', async () => {
    identities.identities.set('user_1', { displayName: 'Before', firstName: null, lastName: null });
    await service().ensure('user_1');
    await service().updateDisplayName('user_1', 'After', 1);
    const publisher = new FakeProfileEventPublisher();
    const worker = new ProfileOutboxPublisherWorker(database, publisher, { error: () => {} });

    await worker.publishPending();

    expect(publisher.events).toMatchObject([
      { eventType: 'profile.created' },
      {
        eventType: 'profile.updated',
        change: { type: 'display-name-changed', before: 'Before', after: 'After' },
        profile: { displayName: 'After', version: 2 },
      },
    ]);
  });

  it('publishes outbox rows recorded before typed changes were added', async () => {
    const timestamp = new Date().toISOString();
    await sql`
      insert into outbox_events (id, subject, aggregate_id, payload)
      values (
        'evt_legacy',
        'profile.created',
        'user_legacy',
        ${sql.json({
          eventId: 'evt_legacy',
          eventType: 'profile.created',
          timestamp,
          profile: {
            id: 'user_legacy',
            displayName: 'Legacy Profile',
            handle: 'legacy-profile',
            claimGeneration: 1,
            biographyMarkdown: '',
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        })}
      )
    `;
    const publisher = new FakeProfileEventPublisher();
    const worker = new ProfileOutboxPublisherWorker(database, publisher, { error: () => {} });

    await worker.publishPending();

    expect(publisher.events).toMatchObject([
      { eventId: 'evt_legacy', change: { type: 'created' } },
    ]);
    expect((await sql`select published_at from outbox_events`)[0].published_at).not.toBeNull();
  });

  it('leaves failed publications retryable', async () => {
    identities.identities.set('user_1', { displayName: 'Ada', firstName: null, lastName: null });
    await service().ensure('user_1');
    const publisher = new FakeProfileEventPublisher();
    publisher.failuresRemaining = 1;
    const timer = new FakeTimerService();
    const worker = new ProfileOutboxPublisherWorker(
      database,
      publisher,
      { error: () => {} },
      timer
    );

    worker.start();
    await worker.publishPending();
    expect((await sql`select published_at from outbox_events`)[0].published_at).toBeNull();

    await timer.tickAsync(1_000);
    expect(publisher.events).toHaveLength(1);
    expect((await sql`select published_at from outbox_events`)[0].published_at).not.toBeNull();
    await worker.stop();
  });

  it('leaves unrelated outbox subjects for their owning publisher', async () => {
    const timestamp = new Date().toISOString();
    await sql`
      insert into outbox_events (id, subject, aggregate_id, payload)
      values (
        'evt_unrelated',
        'wallpaper.uploaded',
        'wallpaper_1',
        ${sql.json({
          eventId: 'evt_unrelated',
          eventType: 'profile.created',
          timestamp,
          change: { type: 'created' },
          profile: {
            id: 'user_unrelated',
            displayName: 'Wrong Publisher',
            handle: 'wrong-publisher',
            claimGeneration: 1,
            biographyMarkdown: '',
            pictureAssetId: null,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        })}
      )
    `;
    identities.identities.set('user_profile', {
      displayName: 'Profile Event',
      firstName: null,
      lastName: null,
    });
    await service().ensure('user_profile');
    const publisher = new FakeProfileEventPublisher();
    const worker = new ProfileOutboxPublisherWorker(database, publisher, { error: () => {} });

    await worker.publishPending();

    expect(publisher.events.map((event) => event.profile.id)).toEqual(['user_profile']);
    const [unrelated] = await sql`
      select published_at from outbox_events where id = 'evt_unrelated'
    `;
    expect(unrelated.published_at).toBeNull();
  });

  it('publishes created and updated events through the production NATS adapter', async () => {
    const nats = container.resolve(NatsConnectionManager).getClient();
    await nats.jetstreamManager().then((manager) =>
      manager.streams.add({
        name: 'PROFILE',
        subjects: ['profile.>'],
      })
    );
    identities.identities.set('user_real_nats', {
      displayName: 'Real NATS',
      firstName: null,
      lastName: null,
    });

    const ensureResponse = await request('user_real_nats');
    expect(ensureResponse.statusCode).toBe(200);
    const updateResponse = await patch('user_real_nats', 'Updated via real NATS', 1);
    expect(updateResponse.statusCode).toBe(200);

    await expect.poll(
      async () => {
        const events = await sql`
          select subject, published_at
          from outbox_events
          where aggregate_id = 'user_real_nats'
          order by subject
        `;
        return events.map((event) => ({
          subject: event.subject,
          published: event.published_at !== null,
        }));
      },
      { timeout: 5_000 }
    ).toEqual([
      { subject: 'profile.created', published: true },
      { subject: 'profile.updated', published: true },
    ]);
  });
});
