import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { Effect, Schema } from 'effect';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { startTags } from '../src/server.js';

let postgres: StartedTestContainer;
let nats: StartedNatsContainer;
let admin: Pool;

beforeAll(async () => {
  postgres = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'tags' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();
  nats = await createNatsContainer({ enableJetStream: false });
  admin = new Pool({ connectionString: config(0).databaseUrl });
});

afterAll(async () => {
  await admin?.end();
  await nats?.stop();
  await postgres?.stop();
});

function config(port: number): Config {
  return {
    nodeEnv: 'test',
    port,
    databaseUrl: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/tags`,
    natsUrl: nats.getConnectionUrl(),
    natsStream: 'WALLPAPER',
    otelServiceName: 'tags-server-contract',
  };
}

const decodeConnections = Schema.decodeUnknownSync(Schema.Struct({ num_connections: Schema.Int }));
async function brokerConnections(): Promise<number> {
  const response = await fetch(
    `http://${nats.getHost()}:${nats.getContainer().getMappedPort(8222)}/connz`,
    { signal: AbortSignal.timeout(3000) }
  );
  return decodeConnections(await response.json()).num_connections;
}

async function databaseConnections() {
  const { rows } = await admin.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = 'tags' AND pid <> pg_backend_pid()"
  );
  return rows[0]?.count;
}

it('serves health and readiness through a real listener and releases its resources on scope exit', async () => {
  const baseline = await brokerConnections();
  const address = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startTags(config(0));
        const address = server.address.replace('0.0.0.0', '127.0.0.1');
        yield* Effect.promise(async () => {
          const health = await fetch(`${address}/health`, { signal: AbortSignal.timeout(3000) });
          expect(health.status).toBe(200);
          expect(await health.json()).toMatchObject({
            status: 'healthy',
            checks: { database: true, nats: true, otel: true },
          });
          const ready = await fetch(`${address}/ready`, { signal: AbortSignal.timeout(3000) });
          expect(ready.status).toBe(200);
          expect(await ready.json()).toMatchObject({ ready: true });
          expect(await brokerConnections()).toBe(baseline + 1);
          expect(await databaseConnections()).toBe(1);
        });
        return address;
      })
    )
  );
  await expect.poll(brokerConnections).toBe(baseline);
  await expect.poll(databaseConnections).toBe(0);
  await expect(fetch(`${address}/ready`, { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
}, 10000);
