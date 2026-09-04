import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { FakeTimerService } from '@wallpaperdb/core/timer';
import type { ProfileCreatedEvent, ProfileUpdatedEvent } from '@wallpaperdb/events';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import type { FastifyInstance } from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import {
  type ProfileEventPublisher,
  ProfileOutboxPublisherWorker,
} from '../src/services/profile-outbox-publisher.service.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const migrationPaths = [
  join(migrationDirectory, '0000_parallel_shocker.sql'),
  join(migrationDirectory, '0001_wild_carnage.sql'),
];

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
  let config: Config;

  beforeAll(async () => {
    [postgresContainer, natsContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      createNatsContainer(),
    ]);
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
      profileDisplayNameMaxLength: 80,
    };
    container.clearInstances();
    app = await createApp(config, { logger: false, enableOtel: false });
    container.register(IdentityProviderToken, { useValue: identities });
    database = container.resolve(DatabaseConnection);
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, profiles cascade`;
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
