import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { brokerLayer, eventPublisherLayer, eventStoreLayer, ConsumerHealth, ownershipConsumerLayer } from '../src/adapters/events/index.js';
import { Maintenance, MaintenanceStore, ProfileEvents } from '../src/maintenance/index.js';

let database: StartedPostgreSqlContainer;
let nats: Awaited<ReturnType<typeof createNatsContainer>>;
let connection: NatsConnection;
let sql: ReturnType<typeof postgres>;
const occurred = '2030-01-01T00:00:00.000Z';
function profileEvent(id: string) {
  return { eventId: id, eventType: 'profile.created', timestamp: occurred, change: { type: 'created' }, profile: {
    id: 'user_1', displayName: 'Owner', handle: 'owner', biographyMarkdown: '', pictureAssetId: null,
    claimGeneration: 1, aliases: [], version: 1, createdAt: occurred, updatedAt: occurred,
  } };
}
function wallpaperEvent(id: string) { return { eventId: id, eventType: 'wallpaper.uploaded', timestamp: occurred, wallpaper: {
  id: `wp_${id}`, userId: 'owner-before-profile', fileType: 'image', mimeType: 'image/png', fileSizeBytes: 8,
  width: 2, height: 2, aspectRatio: 1, storageBucket: 'wallpapers', storageKey: 'private-key', originalFilename: 'wallpaper.png', uploadedAt: occurred,
} }; }
beforeAll(async () => {
  [database, nats] = await Promise.all([new PostgreSqlContainer('postgres:16-alpine').start(), createNatsContainer()]);
  sql = postgres(database.getConnectionUri());
  const directory = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort())
    await sql.unsafe(readFileSync(new URL(name, directory), 'utf8'));
  connection = await connect({ servers: nats.getConnectionUrl() });
  const manager = await connection.jetstreamManager();
  await manager.streams.add({ name: 'WALLPAPER', subjects: ['wallpaper.>'] });
  await manager.streams.add({ name: 'PROFILE', subjects: ['profile.>'] });
});
beforeEach(async () => {
  await sql`truncate outbox_events, wallpaper_ownership`;
  const manager = await connection.jetstreamManager();
  await manager.streams.purge('PROFILE');
});
afterAll(async () => {
  await connection?.close(); await sql?.end(); await nats?.stop(); await database?.stop();
});
function adapters() {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-contract' };
  return Layer.mergeAll(eventStoreLayer(), eventPublisherLayer(options)).pipe(
    Layer.provide(brokerLayer(options)), Layer.provide(databaseLayer({ databaseUrl: database.getConnectionUri() })),
  );
}
it('publishes the original occurrence and leaves completion separate from acknowledged broker storage', async () => {
  const payload = profileEvent('event-publication');
  await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at)
    values (${payload.eventId}, 'profile.created', 'user_1', ${sql.json(payload)}, ${occurred})`;
  const runtime = ManagedRuntime.make(adapters());
  try {
    const publish = Effect.flatMap(ProfileEvents, (events) => events.publish('event-publication'));
    await runtime.runPromise(publish);
    await runtime.runPromise(publish);
    expect(await sql`select published_at from outbox_events`).toEqual([{ published_at: null }]);
    const manager = await connection.jetstreamManager();
    expect((await manager.streams.info('PROFILE')).state.messages).toBe(1);
    const stored = await manager.streams.getMessage('PROFILE', { last_by_subj: 'profile.created' });
    expect(stored.header.get('ce-source')).toBe('https://wallpaperdb/user');
    expect(stored.header.get('ce-id')).toBe('event-publication');
    expect(stored.header.get('ce-specversion')).toBe('1.0');
    expect(JSON.parse(new TextDecoder().decode(stored.data))).toEqual(payload);
    await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.markPublished('event-publication', new Date(occurred))));
    expect(await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.pendingEvents()))).toEqual([]);
  } finally { await runtime.dispose(); }
});

it('expires only acknowledged Profile evidence at the exact cutoff and preserves current data and unacknowledged events', async () => {
  await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at, published_at) values
    ('old-acknowledged', 'profile.created', 'user_1', '{}'::jsonb, '2030-01-01', '2030-01-01'),
    ('old-pending', 'profile.updated', 'user_1', '{}'::jsonb, '2030-01-01', null),
    ('new-acknowledged', 'profile.created', 'user_1', '{}'::jsonb, '2030-01-02', '2030-01-02'),
    ('unrelated', 'wallpaper.uploaded', 'user_1', '{}'::jsonb, '2030-01-01', '2030-01-01')`;
  const runtime = ManagedRuntime.make(adapters());
  try {
    expect(await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.expiredEvents(new Date('2029-12-31T23:59:59.999Z'))))).toEqual([]);
    expect(await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.expiredEvents(new Date(occurred))))).toEqual([{ id: 'old-acknowledged', createdAt: new Date(occurred) }]);
    for (const id of ['old-acknowledged', 'old-pending', 'new-acknowledged', 'unrelated']) {
      expect(await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.deleteExpiredEvent(id, new Date(occurred))))).toBe(id === 'old-acknowledged');
    }
    expect((await sql`select id from outbox_events order by id`).map((row) => row.id)).toEqual(['new-acknowledged', 'old-pending', 'unrelated']);
  } finally { await runtime.dispose(); }
});

it('keeps the first recorded wallpaper owner across replay before Profile creation', async () => {
  const runtime = ManagedRuntime.make(adapters());
  try {
    const accept = (profileId: string) => Effect.flatMap(MaintenanceStore, (store) => store.recordWallpaperOwnership({ wallpaperId: 'wp_1', profileId }));
    await runtime.runPromise(accept('first-owner'));
    await Promise.all([runtime.runPromise(accept('second-owner')), runtime.runPromise(accept('first-owner'))]);
    expect(await sql`select wallpaper_id, profile_id from wallpaper_ownership`).toEqual([{ wallpaper_id: 'wp_1', profile_id: 'first-owner' }]);
  } finally { await runtime.dispose(); }
});

it('accepts validated ownership facts through a durable consumer and acknowledges only completed projection', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-consumer-contract', retryDelayMs: 10, shutdownTimeoutMs: 200 };
  const accepted: string[] = [];
  const unused = () => Effect.die('Unexpected maintenance task');
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(
    Layer.provide(brokerLayer(options)),
    Layer.provide(Layer.succeed(Maintenance, { publishPending: unused, cleanupEvents: unused, expireAliases: unused,
      recordWallpaperOwnership: (ownership) => Effect.sync(() => { accepted.push(ownership.wallpaperId); }),
    })),
  ));
  const manager = await connection.jetstreamManager();
  try {
    expect(await runtime.runPromise(Effect.flatMap(ConsumerHealth, (health) => health.check()))).toBe(true);
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('first')));
    await expect.poll(() => accepted).toEqual(['wp_first']);
    await expect.poll(async () => (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).num_ack_pending).toBe(0);
    expect((await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).config.max_deliver).toBe(-1);
  } finally { await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership'); await manager.streams.purge('WALLPAPER'); }
});
