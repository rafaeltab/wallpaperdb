import { PostgreSqlContainer } from '@testcontainers/postgresql';
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
} from '../src/adapters/commands/index.js';
import { Lifecycle, lifecycleLayer } from '../src/capabilities/lifecycle/index.js';
import { authorityFixture } from './fixtures/authority.js';

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
