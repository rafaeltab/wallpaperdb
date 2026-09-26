import { createNatsContainer, type StartedNatsContainer } from '@wallpaperdb/testcontainers';
import { ManagedRuntime } from 'effect';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dependencyProbeLayer } from '../src/adapters/dependencies/index.js';
import { AvailabilityProbe } from '../src/availability/index.js';

describe('dependency probe with PostgreSQL and NATS', () => {
  let postgres: StartedTestContainer;
  let nats: StartedNatsContainer;
  const runtimes: Array<ManagedRuntime.ManagedRuntime<AvailabilityProbe, unknown>> = [];

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'tags' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start();
    nats = await createNatsContainer({ enableJetStream: false });
  });

  afterAll(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    await nats?.stop();
    await postgres?.stop();
  });

  it('reports live dependencies without requiring a database schema or JetStream', async () => {
    const runtime = ManagedRuntime.make(
      dependencyProbeLayer({
        databaseUrl: `postgresql://postgres:test@${postgres.getHost()}:${postgres.getMappedPort(5432)}/tags`,
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
  });
});
