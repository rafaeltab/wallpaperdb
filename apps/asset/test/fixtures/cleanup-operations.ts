import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import { connect, type NatsConnection } from 'nats';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { Effect, ManagedRuntime } from 'effect';
import { parseAuthority } from '../../src/authority.js';
import { authorityFixture } from './authority.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer } from '../../src/adapters/sources/index.js';
import {
  provisionAssetBroker,
  renderBrokerConfiguration,
} from '../../src/adapters/commands/index.js';

export async function withCleanupOperationsFixture(
  handler: RequestListener,
  run: (fixture: Awaited<ReturnType<typeof acquire>>) => Promise<void>,
  faults: {
    afterListener?: (server: ReturnType<typeof createServer>) => Promise<void>;
    afterAcquisition?: (fixture: Awaited<ReturnType<typeof acquire>>) => Promise<void>;
    closeConnection?: (connection: NatsConnection) => Promise<void>;
    closeServer?: (server: ReturnType<typeof createServer>) => Promise<void>;
  } = {}
) {
  const previous = process.env.DATABASE_URL;
  const releases: Array<() => Promise<unknown>> = [];
  const failures: unknown[] = [];
  async function acquire() {
    const server = createServer(handler);
    releases.push(async () => {
      if (faults.closeServer) return faults.closeServer(server);
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await faults.afterListener?.(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing inbox address');
    const raw = authorityFixture();
    raw.delivery = { maxAttempts: 2, retryDelayMs: 5, pollMs: 5, shutdownTimeoutMs: 1000 };
    const authority = parseAuthority(raw);
    const postgres = await new PostgreSqlContainer('postgres:16-alpine').start();
    releases.push(() => postgres.stop());
    const pool = new Pool({ connectionString: postgres.getConnectionUri() });
    releases.push(() => pool.end());
    const broker = await new GenericContainer('nats:2.10-alpine')
      .withCopyContentToContainer([
        { content: renderBrokerConfiguration(authority), target: '/etc/nats/asset.conf' },
      ])
      .withCommand(['-c', '/etc/nats/asset.conf'])
      .withExposedPorts(4222)
      .withWaitStrategy(Wait.forLogMessage('Server is ready'))
      .start();
    releases.push(() => broker.stop());
    const url = `nats://${broker.getHost()}:${broker.getMappedPort(4222)}`;
    const connections: NatsConnection[] = [];
    const directory = await mkdtemp(join(tmpdir(), 'cleanup-operator-'));
    releases.push(() => rm(directory, { recursive: true, force: true }));
    const options = {
      databaseUrl: postgres.getConnectionUri(),
      ...authority.delivery,
      leaseMs: 1000,
    };
    const lifecycle = ManagedRuntime.make(
      lifecyclePostgresLayer({ ...options, revision: authority.identity })
    );
    releases.push(() => lifecycle.dispose());
    const sources = ManagedRuntime.make(sourcePostgresLayer(options));
    releases.push(() => sources.dispose());
    return {
      server,
      address,
      raw,
      authority,
      postgres,
      pool,
      broker,
      url,
      connections,
      directory,
      options,
      lifecycle,
      sources,
      ownWorker: (dispose: () => Promise<void>) => {
        releases.push(dispose);
      },
    };
  }
  try {
    const fixture = await acquire();
    await faults.afterAcquisition?.(fixture);
    const { pool, postgres, authority, url, connections } = fixture;
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    await Effect.runPromise(activateLifecycle(postgres.getConnectionUri(), authority.identity));
    for (const app of Object.values(authority.applications)) {
      const connection = await connect({
        servers: url,
        user: app.operatorUser,
        pass: authority.broker.operator.password,
      });
      releases.push(() =>
        faults.closeConnection ? faults.closeConnection(connection) : connection.close()
      );
      connections.push(connection);
      await provisionAssetBroker(connection, authority, app.id);
    }
    await run(fixture);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Cleanup operations fixture failed');
}
