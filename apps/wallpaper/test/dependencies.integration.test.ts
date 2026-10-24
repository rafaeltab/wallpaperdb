import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { Pool } from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dependencyProxy } from './fixtures/dependency-proxy.js';
import { dependencyProbeLayer } from '../src/adapters/dependencies/index.js';
import { AvailabilityProbe } from '../src/capabilities/availability/index.js';

describe('dependency probe with PostgreSQL and NATS', () => {
  let postgres: StartedTestContainer;
  let nats: StartedNatsContainer;
  let admin: Pool;
  const runtimes: Array<ManagedRuntime.ManagedRuntime<AvailabilityProbe, unknown>> = [];
  const proxies: Array<Awaited<ReturnType<typeof dependencyProxy>>> = [];
  const extraBrokers: StartedNatsContainer[] = [];

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    nats = await createNatsContainer({ enableJetStream: false });
    admin = new Pool({ connectionString: databaseUrl() });
  });

  afterEach(async () => {
    const results = await Promise.allSettled([
      ...runtimes.splice(0).map((runtime) => runtime.dispose()),
      ...proxies.splice(0).map((proxy) => proxy.close()),
      ...extraBrokers.splice(0).map((broker) => broker.stop()),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason));
  });

  afterAll(async () => {
    const results = await Promise.allSettled([admin?.end(), nats?.stop(), postgres?.stop()]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason));
  });

  function databaseUrl(port = postgres.getMappedPort(5432)) {
    return `postgresql://postgres:test@${postgres.getHost()}:${port}/wallpaper`;
  }

  function activeWorkerPorts() {
    return process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length;
  }

  async function activeDatabaseConnections() {
    const { rows } = await admin.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = 'wallpaper' AND pid <> pg_backend_pid()"
    );
    return rows[0]?.count;
  }

  // Advance the deadline only after real broker work stalls. Cold worker loading is
  // host scheduling, not a promise that replacement startup finishes within 100ms.
  async function stalledBrokerInspection(
    runtime: ManagedRuntime.ManagedRuntime<AvailabilityProbe | TestClock.TestClock, unknown>,
    proxy: Awaited<ReturnType<typeof dependencyProxy>>,
    phase: 'traffic' | 'connection'
  ) {
    const controller = new AbortController();
    let settled = false;
    const pending = runtime.runPromise(
      AvailabilityProbe.use((probe) => probe.inspect()),
      {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]),
      }
    );
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    try {
      if (phase === 'traffic') await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      else await proxy.waitForConnection();
      await runtime.runPromise(TestClock.adjust(99));
      expect(settled).toBe(false);
      await runtime.runPromise(TestClock.adjust(1));
      return await pending;
    } finally {
      controller.abort();
      await Promise.allSettled([pending]);
    }
  }

  it('reports live dependencies without requiring a database schema or JetStream', async () => {
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'wallpaper-dependency-test',
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
    const natsConnections = async () => {
      const response = await fetch(
        `http://${nats.getHost()}:${nats.getContainer().getMappedPort(8222)}/connz`
      );
      return response.json();
    };
    expect(await natsConnections()).toMatchObject({ num_connections: 1 });
    await runtime.dispose();
    await expect.poll(activeDatabaseConnections).toBe(0);
    await expect.poll(natsConnections).toMatchObject({ num_connections: 0 });
  });

  it('authenticates with the percent-encoded credentials from its configured broker URL', async () => {
    const user = 'wallpaper-client';
    const password = 'broker-private-marker:/@%';
    const protectedBroker = await createNatsContainer({
      enableJetStream: false,
      additionalArgs: ['--user', user, '--pass', password],
    });
    extraBrokers.push(protectedBroker);
    const address = new URL(protectedBroker.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const url = new URL(`nats://127.0.0.1:${proxy.port}`);
    url.username = encodeURIComponent(user);
    url.password = encodeURIComponent(password);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: url.toString(),
        serviceName: 'wallpaper-authenticated-broker-test',
        otelHealthy: true,
        healthTimeoutMs: 100,
      }).pipe(Layer.provideMerge(TestClock.layer()))
    );
    runtimes.push(runtime);
    expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
      database: true,
      nats: true,
      otel: true,
    });
    proxy.block();
    expect(await stalledBrokerInspection(runtime, proxy, 'traffic')).toMatchObject({ nats: false });
    await expect.poll(proxy.socketCount).toBe(0);
    proxy.unblock();
    expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
      database: true,
      nats: true,
      otel: true,
    });
  });

  it('closes stalled broker work and recovers repeatedly in the same runtime', async () => {
    const workerPortsBefore = activeWorkerPorts();
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: `nats://127.0.0.1:${proxy.port}`,
        serviceName: 'wallpaper-stalled-broker-test',
        otelHealthy: true,
        healthTimeoutMs: 100,
      }).pipe(Layer.provideMerge(TestClock.layer()))
    );
    runtimes.push(runtime);
    try {
      expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
        database: true,
        nats: true,
        otel: true,
      });
      for (let cycle = 0; cycle < 2; cycle++) {
        proxy.block();
        const startedAt = Date.now();
        expect(await stalledBrokerInspection(runtime, proxy, 'traffic')).toEqual({
          database: true,
          nats: false,
          otel: true,
        });
        expect(Date.now() - startedAt).toBeLessThan(1000);
        await expect.poll(proxy.socketCount).toBe(0);
        proxy.unblock();
        expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual(
          {
            database: true,
            nats: true,
            otel: true,
          }
        );
        expect(proxy.socketCount()).toBe(2);
      }
      const concurrent = await Promise.all(
        Array.from({ length: 3 }, () =>
          runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
        )
      );
      expect(concurrent).toEqual(
        Array.from({ length: 3 }, () => ({ database: true, nats: true, otel: true }))
      );
      expect(proxy.socketCount()).toBe(2);
      await runtime.dispose();
      await expect.poll(proxy.socketCount).toBe(0);
      await expect.poll(activeWorkerPorts).toBe(workerPortsBefore);
    } finally {
      await runtime.dispose();
    }
  });

  it('interrupts broker inspection and queued callers, then recovers without extra connections', async () => {
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: `nats://127.0.0.1:${proxy.port}`,
        serviceName: 'wallpaper-interrupted-broker-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    const active = new AbortController();
    const queued = new AbortController();
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      proxy.block();
      const pending = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: active.signal,
        }
      );
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      const waiting = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: queued.signal,
        }
      );
      queued.abort();
      const queuedResult = await waiting;
      expect(Exit.isFailure(queuedResult) && Cause.hasInterruptsOnly(queuedResult.cause)).toBe(
        true
      );
      expect(proxy.socketCount()).toBe(2);
      active.abort();
      const activeResult = await pending;
      expect(Exit.isFailure(activeResult) && Cause.hasInterruptsOnly(activeResult.cause)).toBe(
        true
      );
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.unblock();
      expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
        database: true,
        nats: true,
        otel: true,
      });
    } finally {
      active.abort();
      queued.abort();
      await runtime.dispose();
    }
  });

  it('cancels broker acquisition and concurrent probes, then recovers and shuts down', async () => {
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: `nats://127.0.0.1:${proxy.port}`,
        serviceName: 'wallpaper-late-broker-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    const controller = new AbortController();
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      // Interrupt an RTT to close the current connection, then stall its replacement handshake.
      proxy.block();
      const interrupted = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: controller.signal,
        }
      );
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      controller.abort();
      const interruptedResult = await interrupted;
      expect(
        Exit.isFailure(interruptedResult) && Cause.hasInterruptsOnly(interruptedResult.cause)
      ).toBe(true);
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.unblock();
      proxy.pause();
      const acquiring = new AbortController();
      const pending = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: acquiring.signal,
        }
      );
      await proxy.waitForConnection();
      expect(proxy.socketCount()).toBe(2);
      acquiring.abort();
      const acquiredResult = await pending;
      expect(Exit.isFailure(acquiredResult) && Cause.hasInterruptsOnly(acquiredResult.cause)).toBe(
        true
      );
      await expect.poll(proxy.socketCount).toBe(0);
      const overlapping = Promise.all(
        Array.from({ length: 3 }, () =>
          runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
        )
      );
      await proxy.waitForConnection();
      expect(proxy.socketCount()).toBe(2);
      expect((await overlapping).every((health) => !health.nats)).toBe(true);
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.resume();
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ nats: true });
      // Lose the real transport, so a probe replaces a terminal connection as well.
      proxy.disconnect();
      await expect.poll(proxy.socketCount).toBe(0);
      await expect
        .poll(() => runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect())))
        .toMatchObject({ nats: true });
      proxy.block();
      const shutdownProbe = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect())
      );
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      const startedAt = Date.now();
      await runtime.dispose();
      await shutdownProbe;
      expect(Date.now() - startedAt).toBeLessThan(3000);
      await expect.poll(proxy.socketCount).toBe(0);
      await expect.poll(activeDatabaseConnections).toBe(0);
    } finally {
      controller.abort();
      proxy.resume();
      await runtime.dispose();
    }
  });

  it('bounds repeated stalled broker acquisitions and permits a later successful probe', async () => {
    const workerPortsBefore = activeWorkerPorts();
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: `nats://127.0.0.1:${proxy.port}`,
        serviceName: 'wallpaper-failed-broker-acquisition-test',
        otelHealthy: true,
        healthTimeoutMs: 100,
      }).pipe(Layer.provideMerge(TestClock.layer()))
    );
    runtimes.push(runtime);
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      proxy.block();
      expect(await stalledBrokerInspection(runtime, proxy, 'traffic')).toMatchObject({
        nats: false,
      });
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.unblock();
      proxy.pause();
      for (let cycle = 0; cycle < 2; cycle++) {
        const startedAt = Date.now();
        expect(await stalledBrokerInspection(runtime, proxy, 'connection')).toMatchObject({
          nats: false,
        });
        expect(Date.now() - startedAt).toBeLessThan(1000);
        await expect.poll(proxy.socketCount).toBe(0);
      }
      proxy.resume();
      expect(await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))).toEqual({
        database: true,
        nats: true,
        otel: true,
      });
      await runtime.dispose();
      await expect.poll(proxy.socketCount).toBe(0);
      await expect.poll(activeWorkerPorts).toBe(workerPortsBefore);
    } finally {
      proxy.resume();
      await runtime.dispose();
    }
  });

  it('disposes a replacement broker connection acquired during shutdown', async () => {
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(),
        natsUrl: `nats://127.0.0.1:${proxy.port}`,
        serviceName: 'wallpaper-broker-acquisition-shutdown-test',
        otelHealthy: true,
        healthTimeoutMs: 100,
      }).pipe(Layer.provideMerge(TestClock.layer()))
    );
    runtimes.push(runtime);
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      proxy.block();
      expect(await stalledBrokerInspection(runtime, proxy, 'traffic')).toMatchObject({
        nats: false,
      });
      await expect.poll(proxy.socketCount).toBe(0);
      proxy.unblock();
      proxy.pause();
      const pending = runtime.runPromiseExit(AvailabilityProbe.use((probe) => probe.inspect()));
      await proxy.waitForConnection();
      expect(proxy.socketCount()).toBe(2);
      const disposing = runtime.dispose();
      proxy.resume();
      const startedAt = Date.now();
      await Promise.all([disposing, pending]);
      expect(Date.now() - startedAt).toBeLessThan(1000);
      await expect.poll(proxy.socketCount).toBe(0);
      await expect.poll(activeDatabaseConnections).toBe(0);
    } finally {
      proxy.resume();
      await runtime.dispose();
    }
  });

  it('reports a borrowed database connection loss as unavailable and recovers without leaking sessions', async () => {
    const proxy = await dependencyProxy(postgres.getHost(), postgres.getMappedPort(5432));
    proxies.push(proxy);
    const serviceName = 'wallpaper-disconnected-probe-test';
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName,
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    try {
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ database: true });
      proxy.block();
      const pending = runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      const sessions = await admin.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1',
        [serviceName]
      );
      expect(sessions.rows).toEqual([{ count: 1 }]);
      proxy.disconnect();
      expect(await pending).toEqual({ database: false, nats: true, otel: true });
      await expect.poll(activeDatabaseConnections).toBe(0);
      proxy.unblock();
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ database: true });
      await runtime.dispose();
      await expect.poll(activeDatabaseConnections).toBe(0);
    } finally {
      await runtime.dispose();
    }
  });

  it('bounds a stalled database probe by destroying its connection and permits recovery', async () => {
    const proxy = await dependencyProxy(postgres.getHost(), postgres.getMappedPort(5432));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'wallpaper-stalled-dependency-test',
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
    }
  });

  it('cancels a blocked probe without leaving a PostgreSQL session behind', async () => {
    const proxy = await dependencyProxy(postgres.getHost(), postgres.getMappedPort(5432));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'wallpaper-interrupted-dependency-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    const controller = new AbortController();
    try {
      await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()));
      proxy.block();
      const pending = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: controller.signal,
        }
      );
      await expect.poll(proxy.hasBlockedTraffic).toBe(true);
      controller.abort();
      const result = await pending;
      expect(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true);
      await expect.poll(activeDatabaseConnections).toBe(0);
    } finally {
      controller.abort();
      await runtime.dispose();
    }
  });

  it('disposes a database connection acquired after inspection was interrupted', async () => {
    const proxy = await dependencyProxy(postgres.getHost(), postgres.getMappedPort(5432));
    proxies.push(proxy);
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: databaseUrl(proxy.port),
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'wallpaper-late-database-test',
        otelHealthy: true,
      })
    );
    runtimes.push(runtime);
    const controller = new AbortController();
    try {
      await runtime.runPromise(AvailabilityProbe);
      proxy.pause();
      const pending = runtime.runPromiseExit(
        AvailabilityProbe.use((probe) => probe.inspect()),
        {
          signal: controller.signal,
        }
      );
      await proxy.waitForConnection();
      expect(proxy.socketCount()).toBe(2);
      controller.abort();
      const result = await pending;
      expect(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause)).toBe(true);
      proxy.resume();
      await expect.poll(proxy.socketCount).toBe(0);
      await expect.poll(activeDatabaseConnections).toBe(0);
      expect(
        await runtime.runPromise(AvailabilityProbe.use((probe) => probe.inspect()))
      ).toMatchObject({ database: true });
    } finally {
      controller.abort();
      proxy.resume();
      await runtime.dispose();
    }
  });

  it('keeps PostgreSQL lazy and reports database and telemetry unavailability independently', async () => {
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: `${databaseUrl()}_missing`,
        natsUrl: nats.getConnectionUrl(),
        serviceName: 'wallpaper-unavailable-dependency-test',
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

  it('bounds startup stalled before broker INFO and releases its worker and sockets', async () => {
    const workerPortsBefore = activeWorkerPorts();
    const address = new URL(nats.getConnectionUrl());
    const proxy = await dependencyProxy(address.hostname, Number(address.port));
    proxies.push(proxy);
    proxy.pause();
    const startedAt = Date.now();
    const result = await Effect.runPromise(
      AvailabilityProbe.pipe(
        Effect.provide(
          dependencyProbeLayer({
            databaseUrl: databaseUrl(),
            natsUrl: `nats://127.0.0.1:${proxy.port}`,
            serviceName: 'wallpaper-pre-info-startup-test',
            otelHealthy: true,
          })
        ),
        Effect.result
      )
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure._tag).toBe('DependencyStartupFailure');
    expect(Date.now() - startedAt).toBeLessThan(3000);
    await expect.poll(proxy.socketCount).toBe(0);
    await expect.poll(activeWorkerPorts).toBe(workerPortsBefore);
    await expect.poll(activeDatabaseConnections).toBe(0);
  });

  it('fails startup through the typed channel when NATS cannot connect', async () => {
    const result = await Effect.runPromise(
      AvailabilityProbe.pipe(
        Effect.provide(
          dependencyProbeLayer({
            databaseUrl: databaseUrl(),
            natsUrl: 'nats://127.0.0.1:1',
            serviceName: 'wallpaper-failed-startup-test',
            otelHealthy: true,
          })
        ),
        Effect.match({
          onFailure: (failure) => failure._tag,
          onSuccess: () => 'unexpected-success',
        })
      )
    );
    expect(result).toBe('DependencyStartupFailure');
  });
  it('refuses cleartext NATS when the configured URL requires TLS', async () => {
    const url = new URL(nats.getConnectionUrl());
    url.protocol = 'tls:';
    const result = await Effect.runPromise(
      AvailabilityProbe.pipe(
        Effect.provide(
          dependencyProbeLayer({
            databaseUrl: databaseUrl(),
            natsUrl: url.toString(),
            serviceName: 'wallpaper-tls-required',
            otelHealthy: true,
          })
        ),
        Effect.result
      )
    );
    expect(result._tag).toBe('Failure');
    if (result._tag === 'Failure') expect(result.failure._tag).toBe('DependencyStartupFailure');
  });
});
