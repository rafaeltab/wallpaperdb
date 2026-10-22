import { ManagedRuntime } from 'effect';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { WorkflowStore, WorkflowDelivery } from '../src/capabilities/creation/index.js';
import { workflowPostgresLayer } from '../src/adapters/workflow/index.js';
let container: StartedTestContainer;
const databaseUrl = () =>
  `postgresql://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/wallpaper`;
let pool: Pool;
beforeAll(async () => {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'wallpaper' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();
  pool = new Pool({ connectionString: databaseUrl() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
it('durably reserves one identity and its command across concurrent callers and restart', async () => {
  const layer = () =>
    workflowPostgresLayer({
      databaseUrl: databaseUrl(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 20,
    });
  let runtime = ManagedRuntime.make(layer());
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        runtime.runPromise(
          WorkflowStore.use((s) =>
            s.begin({ namespace: 'authors', subject: 'creator' }, 'same-key')
          )
        )
      )
    );
    expect(new Set(results.map((w) => w.id)).size).toBe(1);
    expect(results[0]?.id).not.toBe(results[0]?.commandId);
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    const replay = await runtime.runPromise(
      WorkflowStore.use((s) => s.begin({ namespace: 'authors', subject: 'creator' }, 'same-key'))
    );
    expect(replay).toEqual(results[0]);
    const pending = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.event).toMatchObject({
      id: replay.creationEventId,
      type: 'asset.command.create',
      data: {
        commandId: replay.commandId,
        applicationReference: replay.id,
        ownerSubject: 'creator',
        assetType: 'wallpaper',
      },
    });
  } finally {
    await runtime.dispose();
  }
});
