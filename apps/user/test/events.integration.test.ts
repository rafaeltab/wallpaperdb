import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { brokerLayer, eventPublisherLayer, eventStoreLayer } from '../src/adapters/events/index.js';
import { MaintenanceStore, ProfileEvents } from '../src/maintenance/index.js';

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
