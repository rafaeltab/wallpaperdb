import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { connect } from 'nats';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer } from '../src/adapters/sources/index.js';
import {
  cleanupPostgresLayer,
  cleanupWorkerLayer,
  CleanupHealth,
} from '../src/adapters/cleanup/index.js';
import { CleanupBytes, CleanupFailure, cleanupLayer } from '../src/capabilities/cleanup/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import { SourceStore } from '../src/capabilities/sources/index.js';
import {
  operatorWebhookLayer,
  OperatorNotificationHealth,
  provisionAssetBroker,
  renderBrokerConfiguration,
} from '../src/adapters/commands/index.js';
import { runOperator } from '../scripts/operator.js';

it('routes exhausted cleanup to the authenticated operator inbox and resumes only deliberate trusted recovery', async () => {
  const received: { kind: string; applicationId: string }[] = [];
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer operator-inbox-token') {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString()));
    response.writeHead(200).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing inbox address');
  const raw = authorityFixture();
  raw.delivery = { maxAttempts: 2, retryDelayMs: 5, pollMs: 5, shutdownTimeoutMs: 1000 };
  const authority = parseAuthority(raw);
  const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: postgres.getConnectionUri() });
  const broker = await new GenericContainer('nats:2.10-alpine')
    .withCopyContentToContainer([
      { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
    ])
    .withCommand(['-c', '/etc/nats/asset.conf'])
    .withExposedPorts(4222)
    .withWaitStrategy(Wait.forLogMessage('Server is ready'))
    .start();
  const url = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
  const connections = [];
  const directory = await mkdtemp(join(tmpdir(), 'cleanup-operator-'));
  const previous = process.env.DATABASE_URL;
  let disposeWorker = async () => {};
  const options = {
    databaseUrl: postgres.getConnectionUri(),
    ...authority.delivery,
    leaseMs: 1000,
  };
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({ ...options, revision: authority.identity })
  );
  const sources = ManagedRuntime.make(sourcePostgresLayer(options));
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
    for (const app of Object.values(authority.applications)) {
      const connection = await connect({
        servers: url,
        user: app.operatorUser,
        pass: authority.broker.operator.password,
      });
      connections.push(connection);
      await provisionAssetBroker(connection, authority, app.id);
    }
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: authority.identity,
          applicationId: 'wallpaper',
          canonical: 'cleanup-notice',
          correlation: { commandId: 'cleanup-notice', applicationReference: '' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk-test', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(created.assetId, null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.candidates = [
            {
              candidateId: 'candidate_notice',
              sourceId: 'source_notice',
              idempotencyKey: 'notice',
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'cancelled',
              layout: 'asset-layout-1',
              expiresAt: '2000-01-01T00:00:00Z',
              orphanExpiresAt: '2000-01-01T00:00:00Z',
            },
          ];
          return { state, result: undefined };
        })
      )
    );
    let failing = true,
      calls = 0;
    const persistence = cleanupPostgresLayer(options);
    const capability = cleanupLayer.pipe(
      Layer.provide(
        Layer.merge(
          persistence,
          Layer.succeed(CleanupBytes, {
            reclaim: () =>
              Effect.suspend(() => {
                calls++;
                return failing
                  ? Effect.fail(
                      new CleanupFailure({
                        operation: 'fixture-outage',
                        cause: 'controlled dependency outage',
                      })
                    )
                  : Effect.void;
              }),
          })
        )
      )
    );
    const commandOptions = {
      url,
      credential: authority.broker.service,
      applications: authority.applications,
      ...authority.delivery,
    };
    const runtime = ManagedRuntime.make(
      Layer.merge(
        cleanupWorkerLayer(commandOptions).pipe(
          Layer.provide(Layer.merge(capability, persistence))
        ),
        operatorWebhookLayer({
          ...commandOptions,
          target: {
            url: `http://127.0.0.1:${address.port}/events`,
            token: authority.operatorNotification.token,
          },
        })
      )
    );
    disposeWorker = () => runtime.dispose();
    await runtime.runPromise(CleanupHealth);
    await runtime.runPromise(OperatorNotificationHealth);
    await expect.poll(() => received.length, { timeout: 5000 }).toBe(2);
    expect(
      received.every(
        (notice) => notice.kind === 'cleanup-quarantine' && notice.applicationId === 'wallpaper'
      )
    ).toBe(true);
    expect(calls).toBe(4);
    const quarantined = (
      await pool.query('SELECT id, status, due_at FROM source_cleanup ORDER BY id')
    ).rows;
    expect(quarantined.every((row) => row.status === 'quarantined')).toBe(true);
    failing = false;
    const path = join(directory, 'authority.json');
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });
    process.env.DATABASE_URL = postgres.getConnectionUri();
    for (const row of quarantined)
      expect(
        await runOperator(['recover-cleanup', '--id', row.id, '--authority-file', path])
      ).toEqual({ recovered: true });
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "SELECT count(*)::int AS count FROM source_cleanup WHERE status <> 'completed'"
            )
          ).rows[0].count,
        { timeout: 5000 }
      )
      .toBe(0);
    expect(calls).toBe(6);
    expect((await pool.query('SELECT due_at FROM source_cleanup ORDER BY id')).rows).toEqual(
      quarantined.map((row) => ({ due_at: row.due_at }))
    );
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await disposeWorker();
    await sources.dispose();
    await lifecycle.dispose();
    for (const connection of connections) await connection.close();
    await pool.end();
    await broker.stop();
    await postgres.stop();
    await rm(directory, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
