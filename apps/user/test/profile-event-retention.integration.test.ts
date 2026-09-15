import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type Config } from '../src/config.js';
import { DatabaseConnection } from '../src/connections/database.js';
import { NatsConnectionManager } from '../src/connections/nats.js';
import { ProfileEventRetentionService } from '../src/services/profile-event-retention.service.js';
import { NatsProfileEventPublisher, ProfileOutboxPublisherWorker } from '../src/services/profile-outbox-publisher.service.js';
import { ProfileService } from '../src/services/profile.service.js';

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../drizzle');

describe('Profile event evidence retention', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let sql: ReturnType<typeof postgres>;
  let database: DatabaseConnection;
  let config: Config;
  let profiles: ProfileService;
  const logger = { error: vi.fn() };

  beforeAll(async () => {
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    sql = postgres(postgresContainer.getConnectionUri());
    for (const path of readdirSync(migrations).filter((path) => path.endsWith('.sql')).sort()) {
      await sql.unsafe(readFileSync(join(migrations, path), 'utf8'));
    }
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', postgresContainer.getConnectionUri());
    vi.stubEnv('NATS_URL', 'nats://127.0.0.1:4222');
    config = { ...loadConfig(), profileEvidenceRetentionDays: 30 };
    vi.unstubAllEnvs();
    database = new DatabaseConnection(config);
    await database.initialize();
    profiles = new ProfileService(database, {
      getIdentity: async () => ({ displayName: 'Evidence Owner', firstName: null, lastName: null }),
    }, config);
  });

  beforeEach(async () => {
    await sql`truncate outbox_events, handle_claims, profiles cascade`;
    logger.error.mockClear();
    config.profileEvidenceRetentionDays = 30;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await database?.close();
    await sql?.end();
    await postgresContainer?.stop();
  });

  it('expires acknowledged Profile details exactly at the cutoff while preserving current state and unrelated events', async () => {
    const original = await profiles.ensure('user_evidence');
    const current = await profiles.changeHandle(original.id, 'current-handle', original.version);
    await new ProfileOutboxPublisherWorker(database, { publish: async () => {} }, logger).publishPending();
    await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at, published_at)
      values ('evt_unrelated', 'wallpaper.uploaded', 'wallpaper_1', '{}'::jsonb, '2030-01-01', '2030-01-01')`;
    const before = await sql`select * from profiles`;
    const claims = await sql`select * from handle_claims order by handle`;
    const cleanup = new ProfileEventRetentionService(database, config, logger);
    expect(await cleanup.cleanupExpired(new Date('2030-01-30T23:59:59.999Z'))).toEqual({ deleted: 0, failed: 0 });
    expect(await cleanup.cleanupExpired(new Date('2030-01-31T00:00:00.000Z'))).toEqual({ deleted: 2, failed: 0 });
    expect(await cleanup.cleanupExpired(new Date('2030-01-31T00:00:00.000Z'))).toEqual({ deleted: 0, failed: 0 });
    expect(await sql`select id from outbox_events`).toEqual([{ id: 'evt_unrelated' }]);
    expect(await sql`select * from profiles`).toEqual(before);
    expect(await sql`select * from handle_claims order by handle`).toEqual(claims);
    expect(await profiles.ensure(original.id)).toMatchObject({ handle: current.handle, version: current.version, aliases: current.aliases });
  });

  it('continues beyond a failed deletion and the first batch then retries the retained event', async () => {
    const original = await profiles.ensure('user_evidence');
    const [event] = await sql`select * from outbox_events`;
    await sql`delete from outbox_events`;
    for (let i = 0; i < 102; i++) {
      await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at, published_at)
        values (${`evt_${i.toString().padStart(3, '0')}`}, ${event.subject}, ${original.id}, ${sql.json(event.payload)}, '2030-01-01', '2030-01-01')`;
    }
    await sql.unsafe(`create function reject_evidence_delete() returns trigger language plpgsql as $$ begin if OLD.id = 'evt_000' then raise exception 'evidence delete rejected'; end if; return OLD; end $$`);
    await sql.unsafe('create trigger reject_evidence_delete before delete on outbox_events for each row execute function reject_evidence_delete()');
    const cleanup = new ProfileEventRetentionService(database, config, logger);
    try {
      expect(await cleanup.cleanupExpired(new Date('2030-01-31T00:00:00.000Z'))).toEqual({ deleted: 99, failed: 1 });
      expect(await cleanup.cleanupExpired(new Date('2030-01-31T00:00:00.000Z'))).toEqual({ deleted: 2, failed: 0 });
      expect(await sql`select id from outbox_events`).toEqual([{ id: 'evt_000' }]);
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt_000' }), expect.stringContaining('retry'));
      await sql.unsafe('drop trigger reject_evidence_delete on outbox_events');
      expect(await cleanup.cleanupExpired(new Date('2030-01-31T00:00:00.000Z'))).toEqual({ deleted: 1, failed: 0 });
    } finally {
      await sql.unsafe('drop trigger if exists reject_evidence_delete on outbox_events');
      await sql.unsafe('drop function reject_evidence_delete()');
    }
  });

  it('keeps failed and unacknowledged events until publication succeeds without removing NATS projection history', async () => {
    config.profileEvidenceRetentionDays = 7;
    await profiles.ensure('user_evidence');
    const cleanup = new ProfileEventRetentionService(database, config, logger);
    const now = new Date('2030-01-08T00:00:00.000Z');
    const failedPublisher = new ProfileOutboxPublisherWorker(database, {
      publish: async () => { throw new Error('NATS unavailable'); },
    }, logger);
    await failedPublisher.publishPending();
    expect(await cleanup.cleanupExpired(now)).toEqual({ deleted: 0, failed: 0 });
    expect(await sql`select published_at from outbox_events`).toEqual([{ published_at: null }]);

    const natsContainer = await createNatsContainer();
    const nats = new NatsConnectionManager({ ...config, natsUrl: natsContainer.getConnectionUrl() });
    await nats.initialize();
    try {
      const streams = (await nats.getClient().jetstreamManager()).streams;
      await streams.add({ name: 'PROFILE', subjects: ['profile.>'], max_age: 0 });
      const publisher = new ProfileOutboxPublisherWorker(database, new NatsProfileEventPublisher(nats, config), logger);
      await sql.unsafe(`create function reject_ack_record() returns trigger language plpgsql as $$ begin raise exception 'ack persistence failed'; end $$`);
      await sql.unsafe('create trigger reject_ack_record before update on outbox_events for each row execute function reject_ack_record()');
      try {
        await publisher.publishPending();
        expect((await streams.info('PROFILE')).state.messages).toBe(1);
        expect(await cleanup.cleanupExpired(now)).toEqual({ deleted: 0, failed: 0 });
      } finally {
        await sql.unsafe('drop trigger reject_ack_record on outbox_events');
        await sql.unsafe('drop function reject_ack_record()');
      }
      await publisher.publishPending();
      expect(await cleanup.cleanupExpired(now)).toEqual({ deleted: 1, failed: 0 });
      expect(await sql`select id from outbox_events`).toEqual([]);
      const retained = await streams.info('PROFILE');
      expect(retained.config.max_age).toBe(0);
      expect(retained.state.messages).toBe(1);
    } finally {
      await nats.close();
      await natsContainer.stop();
    }
  });
});
