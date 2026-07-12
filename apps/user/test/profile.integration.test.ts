import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import Fastify from 'fastify';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import { registerAuth } from '@wallpaperdb/auth';
import type { Config } from '../src/config.js';
import { DatabaseConnection } from '../src/connections/database.js';
import profileRoutes from '../src/routes/profile.routes.js';
import {
  IdentityProviderToken,
  type ExternalIdentity,
  type IdentityProvider,
} from '../src/services/clerk-identity.service.js';
import { ProfileService } from '../src/services/profile.service.js';

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../drizzle/0000_parallel_shocker.sql'
);

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

describe('POST /profile/me/ensure', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let database: DatabaseConnection;
  let identities: FakeIdentityProvider;
  let config: Config;

  beforeAll(async () => {
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = postgresContainer.getConnectionUri();
    sql = postgres(databaseUrl, { max: 10 });
    await sql.unsafe(readFileSync(migrationPath, 'utf8'));
    config = {
      port: 3009,
      nodeEnv: 'test',
      databaseUrl,
      natsUrl: 'nats://127.0.0.1:4222',
      natsStream: 'WALLPAPER',
      otelServiceName: 'user-test',
      profileHandleMinLength: 1,
      profileHandleMaxLength: 20,
    };
    database = new DatabaseConnection(config);
    await database.initialize();
  });

  beforeEach(async () => {
    await sql`truncate table outbox_events, handle_claims, profiles cascade`;
    identities = new FakeIdentityProvider();
  });

  afterAll(async () => {
    await database.close();
    await sql.end();
    await postgresContainer.stop();
  });

  function service(): ProfileService {
    return new ProfileService(database, identities, config);
  }

  async function request(userId: string) {
    container.clearInstances();
    container.register('config', { useValue: config });
    container.register(IdentityProviderToken, { useValue: identities });
    container.register(DatabaseConnection, { useValue: database });
    container.register(ProfileService, { useValue: service() });
    const app = Fastify();
    await registerAuth(app, { testMode: true });
    await app.register(profileRoutes);
    const token = Buffer.from(JSON.stringify({ id: userId })).toString('base64');
    const response = await app.inject({
      method: 'POST',
      url: '/profile/me/ensure',
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    return response;
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
      profile: { id: 'user_1', biographyMarkdown: '', pictureAssetId: null },
    });
  });

  it('returns the existing profile without creating another event', async () => {
    identities.identities.set('user_1', { displayName: 'Ada', firstName: null, lastName: null });
    const first = await service().ensure('user_1');
    identities.identities.set('user_1', { displayName: 'Changed', firstName: null, lastName: null });
    const second = await service().ensure('user_1');
    expect(second).toEqual(first);
    expect((await sql`select * from outbox_events`).length).toBe(1);
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
    const reserved = await service().ensure('reserved');
    const long = await service().ensure('long');
    expect(reserved.handle).toBe('admin-profile');
    expect(long.handle.length).toBeLessThanOrEqual(config.profileHandleMaxLength);
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
});
