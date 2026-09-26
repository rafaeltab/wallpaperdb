import { readFileSync, readdirSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createNatsContainer } from '@wallpaperdb/testcontainers';
import { Deferred, Effect, Layer, ManagedRuntime } from 'effect';
import { connect, DiscardPolicy, headers, type NatsConnection } from 'nats';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { databaseLayer } from '../src/adapters/database/index.js';
import { brokerLayer, eventPublisherLayer, eventStoreLayer, ConsumerHealth, ownershipConsumerLayer } from '../src/adapters/events/index.js';
import { Maintenance, MaintenanceFailure, MaintenanceStore, ProfileEvents } from '../src/maintenance/index.js';

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
  await sql`truncate outbox_events, wallpaper_ownership, handle_claims, profiles cascade`;
  const manager = await connection.jetstreamManager();
  await manager.streams.purge('PROFILE');
  await manager.streams.purge('USER_QUARANTINE').catch((error) => { if (error.code !== '404') throw error; });
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

it('publishes legacy creation and typed updates, carries persisted trace context, and ignores other subjects', async () => {
  const created = profileEvent('legacy');
  const { change: _change, ...legacy } = created;
  const updated = { ...profileEvent('updated'), eventType: 'profile.updated', change: { type: 'display-name-changed', before: 'Owner', after: 'Changed' }, profile: { ...created.profile, displayName: 'Changed', version: 2 } };
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at, trace_parent, trace_state) values
    ('legacy', 'profile.created', 'user_1', ${sql.json(legacy)}, ${occurred}, null, null),
    ('updated', 'profile.updated', 'user_1', ${sql.json(updated)}, ${occurred}, ${traceparent}, 'vendor=state'),
    ('unrelated', 'wallpaper.uploaded', 'user_1', '{}'::jsonb, ${occurred}, null, null)`;
  const runtime = ManagedRuntime.make(adapters());
  try {
    expect((await runtime.runPromise(Effect.flatMap(MaintenanceStore, (store) => store.pendingEvents()))).map((row) => row.id)).toEqual(['legacy', 'updated']);
    await runtime.runPromise(Effect.flatMap(ProfileEvents, (events) => events.publish('legacy')));
    await runtime.runPromise(Effect.flatMap(ProfileEvents, (events) => events.publish('updated')));
    const manager = await connection.jetstreamManager();
    const first = await manager.streams.getMessage('PROFILE', { last_by_subj: 'profile.created' });
    expect(JSON.parse(new TextDecoder().decode(first.data))).toEqual(created);
    const second = await manager.streams.getMessage('PROFILE', { last_by_subj: 'profile.updated' });
    expect(JSON.parse(new TextDecoder().decode(second.data))).toEqual(updated);
    expect(second.header.get('traceparent')).toBe(traceparent);
    expect(second.header.get('tracestate')).toBe('vendor=state');
    expect(second.header.get('Nats-Msg-Id')).toBe('["https://wallpaperdb/user","updated"]');
  } finally { await runtime.dispose(); }
});

it('retains corrupt recorded events instead of publishing a different identity or owner', async () => {
  const event = profileEvent('bad');
  await sql`insert into outbox_events (id, subject, aggregate_id, payload, created_at)
    values ('bad', 'profile.created', 'another-owner', ${sql.json(event)}, ${occurred})`;
  const runtime = ManagedRuntime.make(adapters());
  try {
    const result = await runtime.runPromise(Effect.flatMap(ProfileEvents, (events) => events.publish('bad')).pipe(Effect.result));
    expect(result._tag).toBe('Failure');
    expect((await (await connection.jetstreamManager()).streams.info('PROFILE')).state.messages).toBe(0);
    expect(await sql`select published_at from outbox_events`).toEqual([{ published_at: null }]);
  } finally { await runtime.dispose(); }
});

it('expires only acknowledged Profile evidence at the exact cutoff and preserves current data and unacknowledged events', async () => {
  await sql`insert into profiles (id, display_name, handle) values ('retention-owner', 'Current owner', 'retention-owner')`;
  await sql`insert into handle_claims (handle, profile_id, kind) values ('retention-owner', 'retention-owner', 'profile'), ('retained-alias', 'retention-owner', 'alias')`;
  const currentProfiles = await sql`select * from profiles`;
  const currentClaims = await sql`select * from handle_claims order by handle`;
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
    expect(await sql`select * from profiles`).toEqual(currentProfiles);
    expect(await sql`select * from handle_claims order by handle`).toEqual(currentClaims);
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

it('quarantines invalid messages and exhausted projection failures after three delayed attempts', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-consumer-contract', retryDelayMs: 30, shutdownTimeoutMs: 200 };
  const attempts: number[] = [];
  const unused = () => Effect.die('Unexpected maintenance task');
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(Layer.provide(brokerLayer(options)), Layer.provide(Layer.succeed(Maintenance, {
    publishPending: unused, cleanupEvents: unused, expireAliases: unused,
    recordWallpaperOwnership: () => Effect.suspend(() => { attempts.push(Date.now()); return Effect.fail(new MaintenanceFailure({ operation: 'project', cause: 'offline' })); }),
  }))));
  const manager = await connection.jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('exhausted')));
    await connection.jetstream().publish('wallpaper.uploaded', 'malformed-json');
    await expect.poll(async () => (await manager.streams.info('USER_QUARANTINE')).state.messages, { timeout: 3000 }).toBe(2);
    expect(attempts).toHaveLength(3);
    expect((attempts[1] ?? 0) - (attempts[0] ?? 0)).toBeGreaterThanOrEqual(25);
    await expect.poll(async () => (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).num_ack_pending).toBe(0);
    const recorded = await manager.streams.getMessage('USER_QUARANTINE', { last_by_subj: 'user.quarantine' });
    const evidence = JSON.parse(new TextDecoder().decode(recorded.data));
    expect(evidence.subject).toBe('wallpaper.uploaded');
    expect(evidence.reason).toBe('exhausted');
    expect(JSON.parse(Buffer.from(evidence.data, 'base64').toString())).toEqual(wallpaperEvent('exhausted'));
  } finally { await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership'); await manager.streams.purge('WALLPAPER'); }
});

it('keeps quarantine failures unacknowledged and repairs purged partial chunks before accepting responsibility', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-quarantine-contract', retryDelayMs: 20, shutdownTimeoutMs: 200 };
  const unused = () => Effect.die('Invalid input must not enter the capability');
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(Layer.provide(brokerLayer(options)), Layer.provide(Layer.succeed(Maintenance, {
    publishPending: unused, cleanupEvents: unused, expireAliases: unused, recordWallpaperOwnership: unused,
  }))));
  const manager = await connection.jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await manager.streams.update('USER_QUARANTINE', { max_msgs: 1, max_msg_size: 1024, discard: DiscardPolicy.New });
    const original = 'invalid'.repeat(500);
    const metadata = headers(); metadata.set('ce-id', 'original-occurrence'); metadata.set('ce-source', 'https://original.example');
    await connection.jetstream().publish('wallpaper.uploaded', original, { headers: metadata });
    await expect.poll(async () => (await manager.streams.info('USER_QUARANTINE')).state.messages).toBe(1);
    await expect.poll(() => runtime.runPromise(Effect.flatMap(ConsumerHealth, (health) => health.check()))).toBe(false);
    expect((await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).num_ack_pending).toBe(1);
    // Purge leaves deduplication IDs alive. A repeated PubAck must be verified against actual evidence.
    await manager.streams.purge('USER_QUARANTINE');
    await manager.streams.update('USER_QUARANTINE', { max_msgs: -1 });
    await expect.poll(async () => (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).num_ack_pending).toBe(0);
    const manifest = JSON.parse(new TextDecoder().decode((await manager.streams.getMessage('USER_QUARANTINE', { last_by_subj: 'user.quarantine' })).data));
    expect(manifest.encoding).toBe('json-base64');
    const chunks: Uint8Array[] = [];
    for (const sequence of manifest.sequences) chunks.push((await manager.streams.getMessage('USER_QUARANTINE', { seq: sequence })).data);
    const evidence = JSON.parse(Buffer.concat(chunks).toString());
    expect(Buffer.from(evidence.data, 'base64').toString()).toBe(original);
    expect(evidence.headers['ce-id']).toEqual(['original-occurrence']);
    expect(evidence.headers['ce-source']).toEqual(['https://original.example']);
    expect(await runtime.runPromise(Effect.flatMap(ConsumerHealth, (health) => health.check()))).toBe(true);
  } finally {
    await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership');
    await manager.streams.purge('WALLPAPER'); await manager.streams.update('USER_QUARANTINE', { max_msgs: -1, max_msg_size: -1 });
  }
});

it('drains an accepted ownership update and acknowledges it before closing the broker', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-drain-contract', shutdownTimeoutMs: 1000 };
  const started = Effect.runSync(Deferred.make<void>());
  const finish = Effect.runSync(Deferred.make<void>());
  const unused = () => Effect.die('Unexpected maintenance task');
  let completed = 0;
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(Layer.provide(brokerLayer(options)), Layer.provide(Layer.succeed(Maintenance, {
    publishPending: unused, cleanupEvents: unused, expireAliases: unused,
    recordWallpaperOwnership: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish)), Effect.andThen(Effect.sync(() => { completed++; }))),
  }))));
  const manager = await connection.jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('drain')));
    await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout(2000)));
    const closing = runtime.dispose();
    await Effect.runPromise(Deferred.succeed(finish, undefined));
    await closing;
    expect(completed).toBe(1);
    await expect.poll(async () => (await manager.consumers.info('WALLPAPER', 'user-wallpaper-ownership')).num_ack_pending).toBe(0);
  } finally { await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership'); await manager.streams.purge('WALLPAPER'); }
});

it('interrupts stalled ownership work at the drain deadline and leaves the event redeliverable', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-interrupt-contract', shutdownTimeoutMs: 50, retryDelayMs: 10 };
  const started = Effect.runSync(Deferred.make<void>());
  let interrupted = false;
  const unused = () => Effect.die('Unexpected maintenance task');
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(Layer.provide(brokerLayer(options)), Layer.provide(Layer.succeed(Maintenance, {
    publishPending: unused, cleanupEvents: unused, expireAliases: unused,
    recordWallpaperOwnership: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))),
  }))));
  const manager = await connection.jetstreamManager();
  try {
    await runtime.runPromise(ConsumerHealth);
    await connection.jetstream().publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('interrupted')));
    await Effect.runPromise(Deferred.await(started).pipe(Effect.timeout(2000)));
    await runtime.dispose();
    expect(interrupted).toBe(true);
    const consumer = await connection.jetstream().consumers.get('WALLPAPER', 'user-wallpaper-ownership');
    const replay = await consumer.next({ expires: 1000 });
    expect(replay?.json()).toEqual(wallpaperEvent('interrupted'));
    replay?.ack();
  } finally { await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership'); await manager.streams.purge('WALLPAPER'); }
});

it('accepts structured and binary CloudEvents while quarantining contradictory or malformed envelopes', async () => {
  const options = { url: nats.getConnectionUrl(), stream: 'WALLPAPER', serviceName: 'user-envelope-contract', retryDelayMs: 10, shutdownTimeoutMs: 200 };
  const accepted: string[] = [];
  const unused = () => Effect.die('Unexpected maintenance task');
  const runtime = ManagedRuntime.make(ownershipConsumerLayer(options).pipe(Layer.provide(brokerLayer(options)), Layer.provide(Layer.succeed(Maintenance, {
    publishPending: unused, cleanupEvents: unused, expireAliases: unused,
    recordWallpaperOwnership: (ownership) => Effect.sync(() => { accepted.push(ownership.wallpaperId); }),
  }))));
  const manager = await connection.jetstreamManager();
  const metadata = headers();
  for (const [key, value] of Object.entries({ specversion: '1.0', source: 'https://wallpaperdb/ingestor', id: 'binary', type: 'wallpaper.uploaded', time: occurred })) metadata.set(`ce-${key}`, value);
  try {
    await runtime.runPromise(ConsumerHealth);
    const js = connection.jetstream();
    await js.publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('binary')), { headers: metadata });
    await js.publish('wallpaper.uploaded', JSON.stringify({ specversion: '1.0', source: 'https://wallpaperdb/ingestor', id: 'structured', type: 'wallpaper.uploaded', time: occurred, datacontenttype: 'application/json', data: { wallpaper: wallpaperEvent('structured').wallpaper } }));
    await js.publish('wallpaper.uploaded', JSON.stringify(wallpaperEvent('contradiction')), { headers: metadata });
    await js.publish('wallpaper.uploaded', JSON.stringify({ ...wallpaperEvent('malformed-structured'), specversion: '1.0', source: 'https://wallpaperdb/ingestor', id: 'malformed-structured', type: 'wallpaper.uploaded', time: occurred, datacontenttype: 'text/html' }));
    await expect.poll(() => accepted).toEqual(['wp_binary', 'wp_structured']);
    await expect.poll(async () => (await manager.streams.info('USER_QUARANTINE')).state.messages).toBe(2);
  } finally { await runtime.dispose(); await manager.consumers.delete('WALLPAPER', 'user-wallpaper-ownership'); await manager.streams.purge('WALLPAPER'); }
});
