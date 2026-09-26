import { createConnection, createServer, type Socket } from 'node:net';
import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { Cause, Effect, Exit, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dependencyProbeLayer } from '../src/adapters/dependencies/index.js';
import { AvailabilityProbe } from '../src/availability/index.js';

describe('dependency probe with PostgreSQL and NATS', () => {
  let postgres: StartedTestContainer;
  let nats: StartedNatsContainer;
  let admin: Pool;
  const runtimes: Array<ManagedRuntime.ManagedRuntime<AvailabilityProbe, unknown>> = [];

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'tags' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    nats = await createNatsContainer({ enableJetStream: false });
    admin = new Pool({ connectionString: databaseUrl() });
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  afterAll(async () => {
    await admin?.end();
    await nats?.stop();
    await postgres?.stop();
  });

  function databaseUrl(port = postgres.getMappedPort(5432)) {
    return `postgresql://postgres:test@${postgres.getHost()}:${port}/tags`;
  }

  async function activeDatabaseConnections() {
    const { rows } = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = 'tags' AND pid <> pg_backend_pid()"
    );
    return rows[0]?.count;
  }

  it('reports live dependencies without requiring a database schema or JetStream', async () => {
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'tags-dependency-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);

    expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
      database: true,
      nats: true,
      otel: true,
    });
    expect(await activeDatabaseConnections()).toBe(1);
    await runtime.dispose();
    await expect.poll(activeDatabaseConnections).toBe(0);
  });

  it('bounds a stalled database probe by destroying its connection and permits recovery', async () => {
    const proxy = await databaseProxy(postgres.getHost(), postgres.getMappedPort(5432));
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'tags-stalled-dependency-test',
        otelHealthy: true,
        healthTimeoutMs: 100,
      })
    );
    runtimes.push(runtime);
    try {
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ database: true });
      proxy.block();
      const startedAt = Date.now();
      expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
        database: false,
        nats: true,
        otel: true,
      });
      expect(Date.now() - startedAt).toBeLessThan(1000);
      await expect.poll(activeDatabaseConnections).toBe(0);
      proxy.unblock();
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ database: true });
    } finally {
      await runtime.dispose();
      await proxy.close();
    }
  });

  it('cancels a blocked probe without leaving a PostgreSQL session behind', async () => {
    const proxy = await databaseProxy(postgres.getHost(), postgres.getMappedPort(5432));
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'tags-interrupted-dependency-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    const controller = new AbortController();
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      proxy.block();
      const pending = runtime.runPromiseExit(AvailabilityProbe.use((probe) => probe.inspect()), {
        signal: controller.signal,
      });
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      controller.abort();
      const result = await pending;
      expect(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true);
      await expect.poll(activeDatabaseConnections).toBe(0);
    } finally {
      controller.abort();
      await runtime.dispose();
      await proxy.close();
    }
  });

  it('keeps PostgreSQL lazy and reports database and telemetry unavailability independently', async () => {
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: `${databaseUrl()}_missing`,
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'tags-unavailable-dependency-test',
        otelHealthy: false,
      })
    );
    runtimes.push(runtime);
    await runtime.runPromise(AvailabilityProbe);
    expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
      database: false,
      nats: true,
      otel: false,
    });
    await expect.poll(activeDatabaseConnections).toBe(0);
  });

  it('fails startup through the typed channel when NATS cannot connect', async () => {
    const result = await Effect.runPromise(
      AvailabilityProbe.pipe(
        Effect.provide(dependencyProbeLayer({
          databaseUrl: databaseUrl(),
          natsUrl: 'nats://127.0.0.1:1',
          serviceName: 'tags-failed-startup-test',
          otelHealthy: true,
        })),
        Effect.match({
          onFailure: (failure) => failure._tag,
          onSuccess: () => 'unexpected-success',
        })
      )
    );
    expect(result).toBe('DependencyStartupFailure');
  });
});

/** Forward real PostgreSQL traffic, with an optional network stall after authentication. */
async function databaseProxy(host: string, port: number) {
  let blocked = false;
  let blockedTraffic = false;
  const sockets = new Set<Socket>();
  const server = createServer((incoming) => {
    const outgoing = createConnection({ host, port });
    sockets.add(incoming);
    sockets.add(outgoing);
    incoming.on('data', (data) => {
      if (blocked) blockedTraffic = true;
      else outgoing.write(data);
    });
    outgoing.pipe(incoming);
    incoming.on('error', () => outgoing.destroy());
    outgoing.on('error', () => incoming.destroy());
    incoming.on('close', () => {
      sockets.delete(incoming);
      outgoing.destroy();
    });
    outgoing.on('close', () => {
      sockets.delete(outgoing);
      incoming.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy did not bind a TCP port');
  return {
    port: address.port,
    block: () => { blocked = true; },
    unblock: () => { blocked = false; },
    hasBlockedTraffic: () => blockedTraffic,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
