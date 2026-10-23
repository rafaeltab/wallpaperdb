import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenericContainer, Wait } from 'testcontainers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { connect, type NatsConnection } from 'nats';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import {
  renderBrokerConfiguration,
  provisionAssetBroker,
  protectedCommandsLayer,
  ProtectedCommandHealth,
  encodeAssetResult,
  recoverQuarantine,
} from '../src/adapters/commands/index.js';
import {
  Lifecycle,
  LifecycleStore,
  ResultOutbox,
  lifecycleLayer,
} from '../src/capabilities/lifecycle/index.js';
import { authorityFixture } from './fixtures/authority.js';
import { runOperator } from '../scripts/operator.js';

const authority = parseAuthority(authorityFixture());
let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let broker: Awaited<ReturnType<GenericContainer['start']>>;
let pool: Pool;
let url: string;
let operator: NatsConnection;
let application: NatsConnection;
let runtime: ReturnType<typeof start>;
function start() {
  const persistence = lifecyclePostgresLayer({
    databaseUrl: postgres.getConnectionUri(),
    revision: authority.identity,
    ...authority.delivery,
    leaseMs: 1000,
  });
  const lifecycle = lifecycleLayer({
    assetTypes: authority.assetTypes,
    revision: authority.identity,
    applications: authority.applications,
  }).pipe(Layer.provide(persistence));
  return ManagedRuntime.make(
    protectedCommandsLayer({
      url,
      credential: authority.broker.service,
      applications: authority.applications,
      maxAckPending: authority.broker.maxAckPending,
      ...authority.delivery,
    }).pipe(Layer.provideMerge(lifecycle), Layer.provide(persistence))
  );
}
beforeAll(async () => {
  postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: postgres.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
  broker = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  url = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
  operator = await connect({
    servers: url,
    ...{ user: 'asset-operator_user', pass: authority.broker.operator.password },
  });
  await provisionAssetBroker(operator, authority, 'user');
  const wallpaperOperator = await connect({
    servers: url,
    user: 'asset-operator_wallpaper',
    pass: authority.broker.operator.password,
  });
  await provisionAssetBroker(wallpaperOperator, authority, 'wallpaper');
  await wallpaperOperator.close();
  application = await connect({
    servers: url,
    user: 'user-1',
    pass: 'user-secret',
    inboxPrefix: '_ASSET_INBOX.user',
  });
  runtime = start();
  await runtime.runPromise(ProtectedCommandHealth);
});

it('runs trusted bootstrap and the application creation CLI against real adapters', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-cli-'));
  const path = join(directory, 'authority.json');
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = postgres.getConnectionUri();
  await writeFile(path, JSON.stringify(authorityFixture()), { mode: 0o600 });
  try {
    expect(await runOperator(['bootstrap', '--url', url, '--authority-file', path])).toMatchObject({
      outcome: 'initialized',
      configuration: authority.identity,
    });
    const result = await runOperator([
      'create',
      '--url',
      url,
      '--authority-file',
      path,
      '--application',
      'user',
      '--command-id',
      'cli-create-1',
      '--owner-subject',
      'cli-owner',
      '--asset-type',
      'picture',
    ]);
    expect(result).toMatchObject({
      commandId: 'cli-create-1',
      applicationReference: '',
      outcome: 'created',
      assetId: expect.stringMatching(/^asset_/),
    });
    expect(
      await runOperator([
        'quarantine',
        '--url',
        url,
        '--authority-file',
        path,
        '--application',
        'user',
      ])
    ).toEqual({ records: [] });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
afterAll(async () => {
  await runtime?.dispose();
  await application?.close();
  await operator?.close();
  await pool?.end();
  await broker?.stop();
  await postgres?.stop();
});
it('creates durably over protected NATS, returns its assigned empty Asset, and returns the original result after restart/replay', async () => {
  const results = await application.jetstream().consumers.get('ASSET_RESULTS', 'results_user');
  const event = {
    specversion: '1.0',
    id: 'create-occurrence-1',
    source: 'https://spoof.example/wallpaper',
    type: 'asset.command.create',
    time: '2026-10-22T00:00:00.000Z',
    datacontenttype: 'application/json',
    data: {
      commandId: 'create-one',
      applicationReference: '',
      assetType: 'picture',
      ownerSubject: 'owner-1',
    },
  };
  await application.jetstream().publish('asset.commands.user.create', JSON.stringify(event));
  const response = await results.next({ expires: 10000 });
  expect(response).not.toBeNull();
  const created = response?.json<{
    id: string;
    data: { commandId: string; assetId: string; outcome: string };
  }>();
  expect(created?.data).toMatchObject({
    commandId: 'create-one',
    applicationReference: '',
    outcome: 'created',
  });
  expect(created?.data.assetId).toMatch(/^asset_/);
  response?.ack();
  const assetId = created?.data.assetId ?? '';
  expect(
    await runtime.runPromise(
      Lifecycle.use((service) =>
        service.inspect({ namespace: 'clerk-test', subject: 'owner-1' }, assetId)
      )
    )
  ).toMatchObject({ kind: 'found', asset: { assetId, sources: [], sourceSetRevision: '0' } });
  await runtime.dispose();
  runtime = start();
  await runtime.runPromise(ProtectedCommandHealth);
  await application
    .jetstream()
    .publish('asset.commands.user.create', JSON.stringify({ ...event, id: 'replay-occurrence-2' }));
  const replay = await results.next({ expires: 10000 });
  expect(replay?.json<{ data: unknown }>().data).toEqual(created?.data);
  expect(replay?.json<{ id: string }>().id).not.toBe(created?.id);
  replay?.ack();
  await application.jetstream().publish(
    'asset.commands.user.create',
    JSON.stringify({
      ...event,
      id: 'conflict-occurrence-3',
      data: { ...event.data, ownerSubject: 'attacker' },
    })
  );
  const conflict = await results.next({ expires: 10000 });
  expect(conflict?.json<{ data: unknown }>().data).toMatchObject({
    outcome: 'rejected',
    reason: 'idempotency-conflict',
    assetId: null,
  });
  conflict?.ack();
});

it('reclaims an ambiguous real broker publication after process restart with the same occurrence and bytes', async () => {
  await runtime.dispose();
  const persistence = () =>
    ManagedRuntime.make(
      lifecyclePostgresLayer({
        databaseUrl: postgres.getConnectionUri(),
        revision: authority.identity,
        ...authority.delivery,
        leaseMs: 1000,
      })
    );
  let storeRuntime = persistence();
  try {
    await storeRuntime.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: authority.identity,
          applicationId: 'user',
          canonical: '["create","ambiguous"]',
          correlation: { commandId: 'ambiguous-publication', applicationReference: '' },
          context: {
            occurrence: { source: 'https://example.test/application', id: 'ambiguous-1' },
          },
          decision: {
            kind: 'create',
            assetType: 'picture',
            owner: { namespace: 'clerk-test', subject: 'ambiguous-owner' },
          },
        })
      )
    );
    const first = (await storeRuntime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1))))[0];
    if (!first) throw new Error('Missing committed publication');
    const encoded = encodeAssetResult(first);
    const initial = await operator
      .jetstream()
      .publish(encoded.subject, JSON.stringify(encoded.event), { msgID: first.id });
    expect(initial.duplicate).toBe(false);
    // The broker committed, but the process stopped before recording local completion.
    await storeRuntime.dispose();
    storeRuntime = persistence();
    let reclaimed: typeof first | undefined;
    await expect
      .poll(
        async () => {
          reclaimed = (
            await storeRuntime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)))
          )[0];
          return reclaimed?.id;
        },
        { timeout: 3000 }
      )
      .toBe(first.id);
    if (!reclaimed) throw new Error('Missing reclaimed publication');
    expect(encodeAssetResult(reclaimed)).toEqual(encoded);
    const retry = await operator
      .jetstream()
      .publish(encoded.subject, JSON.stringify(encoded.event), { msgID: reclaimed.id });
    expect(retry.duplicate).toBe(true);
    expect(retry.seq).toBe(initial.seq);
    await storeRuntime.runPromise(ResultOutbox.use((outbox) => outbox.published(reclaimed!)));
    expect(await storeRuntime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)))).toEqual(
      []
    );
  } finally {
    await storeRuntime.dispose();
  }
  runtime = start();
  await runtime.runPromise(ProtectedCommandHealth);
});

it('durably quarantines the largest accepted raw envelope after finite dependency failures and recovers deliberately', async () => {
  const event = JSON.stringify({
    specversion: '1.0',
    id: 'bounded-quarantine',
    source: 'https://example.test/application',
    correlationid: 'quarantine-workflow',
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    type: 'asset.command.create',
    time: '2026-10-22T00:00:00.000Z',
    datacontenttype: 'application/json',
    data: {
      commandId: 'bounded-quarantine',
      applicationReference: '',
      assetType: 'picture',
      ownerSubject: 'bounded-owner',
    },
  });
  const bytes = Buffer.from(event + ' '.repeat(16384 - Buffer.byteLength(event)));
  const manager = await operator.jetstreamManager();
  await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), 'temporarily-inactive'));
  try {
    await application.jetstream().publish('asset.commands.user.create', bytes);
    await expect
      .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
        timeout: 5000,
      })
      .toBe(1);
    const stored = await manager.streams.getMessage('ASSET_QUARANTINE', { seq: 1 });
    const record = JSON.parse(stored.string());
    expect(record.data).toMatchObject({ reason: 'exhausted', attempts: 3 });
    expect(Buffer.from(record.data.encoded, 'base64')).toEqual(bytes);
    expect(stored.data.byteLength).toBeGreaterThan(16384);
    expect((await manager.streams.info('ASSET_OPERATIONS')).state.messages).toBe(1);
    const notice = JSON.parse(
      (await manager.streams.getMessage('ASSET_OPERATIONS', { seq: 1 })).string()
    );
    expect(notice.context).toEqual({
      occurrence: { source: 'https://example.test/application', id: 'bounded-quarantine' },
      correlationId: 'quarantine-workflow',
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM asset_commands WHERE command_id='bounded-quarantine'"
        )
      ).rows[0].count
    ).toBe(0);
  } finally {
    await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
  }
  await recoverQuarantine(operator, authority, 'user', 1);
  const recoveredSequence = (await manager.streams.info('ASSET_COMMANDS')).state.last_seq;
  expect(
    Buffer.from(
      (await manager.streams.getMessage('ASSET_COMMANDS', { seq: recoveredSequence })).data
    )
  ).toEqual(bytes);
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM asset_commands WHERE command_id='bounded-quarantine'"
          )
        ).rows[0].count,
      { timeout: 3000 }
    )
    .toBe(1);
});

it('hands excessively nested malformed input to durable quarantine without repeated application processing', async () => {
  const manager = await operator.jetstreamManager();
  const before = (await manager.streams.info('ASSET_QUARANTINE')).state.messages;
  const event = JSON.stringify({
    specversion: '1.0',
    id: 'deep-malformed',
    source: 'https://example.test/application',
    type: 'asset.command.create',
    time: '2026-10-22T00:00:00.000Z',
    datacontenttype: 'application/json',
    data: { commandId: 'deep-malformed', applicationReference: '', nested: null },
  }).replace('"nested":null', '"nested":' + '['.repeat(5000) + '0' + ']'.repeat(5000));
  await application.jetstream().publish('asset.commands.user.create', event);
  await expect
    .poll(async () => (await manager.streams.info('ASSET_QUARANTINE')).state.messages, {
      timeout: 3000,
    })
    .toBe(before + 1);
  const sequence = (await manager.streams.info('ASSET_QUARANTINE')).state.last_seq;
  const record = JSON.parse(
    (await manager.streams.getMessage('ASSET_QUARANTINE', { seq: sequence })).string()
  );
  expect(record.data).toMatchObject({ reason: 'invalid', attempts: 1 });
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM asset_commands WHERE command_id='deep-malformed'"
      )
    ).rows[0].count
  ).toBe(0);
});

it('reports an essential stopped command worker while the broker and other application remain available', async () => {
  const manager = await operator.jetstreamManager();
  await manager.consumers.delete('ASSET_COMMANDS', 'commands_user');
  try {
    await expect
      .poll(() => runtime.runPromise(ProtectedCommandHealth.use((service) => service.check())), {
        timeout: 3000,
      })
      .toBe(false);
    expect((await manager.streams.info('ASSET_COMMANDS')).config.name).toBe('ASSET_COMMANDS');
  } finally {
    await runtime.dispose();
    await provisionAssetBroker(operator, authority, 'user');
    runtime = start();
    await runtime.runPromise(ProtectedCommandHealth);
  }
});
