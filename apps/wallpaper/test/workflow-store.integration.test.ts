import { Effect, ManagedRuntime } from 'effect';
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
    for (const p of pending) await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(p)));
  } finally {
    await runtime.dispose();
  }
});

it('quarantines finite failed publication attempts across restart and recovers the original occurrence deliberately', async () => {
  const layer = () =>
    workflowPostgresLayer({
      databaseUrl: databaseUrl(),
      maxAttempts: 2,
      retryDelayMs: 1,
      leaseMs: 5,
    });
  let runtime = ManagedRuntime.make(layer());
  try {
    const wallpaper = await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.begin({ namespace: 'authors', subject: 'recovery-owner' }, 'recovery-key')
      )
    );
    const first = (await runtime.runPromise(WorkflowDelivery.use((s) => s.claim())))[0];
    if (!first) throw new Error('No claim');
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(first)));
    let claims: readonly import('../src/capabilities/creation/index.js').WorkflowPublication[] = [];
    await expect
      .poll(
        async () => {
          claims = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
          return claims.length;
        },
        { timeout: 1000 }
      )
      .toBe(1);
    const second = claims[0];
    if (!second) throw new Error('No retry claim');
    expect(second.id).toBe(first.id);
    expect(second.event).toEqual(first.event);
    expect(second.attempts).toBe(1);
    // The old lease cannot acknowledge the newer claim.
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(first)));
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(second)));
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()))).toEqual([]);
    const alerts = await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()));
    expect(alerts).toEqual([{ id: first.id, scope: 'outbox', reason: 'exhausted' }]);
    expect(
      await runtime.runPromise(WorkflowStore.use((s) => s.begin(wallpaper.owner, wallpaper.key)))
    ).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(first.id, 'outbox')));
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([]);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(first.id)))).toBe(true);
    const recovered = (await runtime.runPromise(WorkflowDelivery.use((s) => s.claim())))[0];
    if (!recovered) throw new Error('No recovered claim');
    expect(recovered.id).toBe(first.id);
    expect(recovered.event).toEqual(first.event);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(recovered)));
  } finally {
    await runtime.dispose();
  }
});
it('rolls back a conflicting Asset attachment and leaves both prior states intact', async () => {
  const runtime = ManagedRuntime.make(
    workflowPostgresLayer({
      databaseUrl: databaseUrl(),
      maxAttempts: 2,
      retryDelayMs: 1,
      leaseMs: 5,
    })
  );
  try {
    const owner = { namespace: 'authors', subject: 'atomic-owner' };
    const [first, second] = await Promise.all(
      ['one', 'two'].map((key) => runtime.runPromise(WorkflowStore.use((s) => s.begin(owner, key))))
    );
    if (!first || !second) throw new Error('Missing identities');
    await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.change({ kind: 'wallpaper', id: first.id }, (w) => {
          if (!w) throw new Error('Missing');
          return { wallpaper: { ...w, assetId: 'unique-asset' }, result: true };
        })
      )
    );
    const result = await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.change({ kind: 'wallpaper', id: second.id }, (w) => {
          if (!w) throw new Error('Missing');
          return { wallpaper: { ...w, assetId: 'unique-asset' }, result: true };
        })
      ).pipe(Effect.result)
    );
    expect(result._tag).toBe('Failure');
    expect(await runtime.runPromise(WorkflowStore.use((s) => s.list(owner)))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, assetId: 'unique-asset' }),
        expect.objectContaining({ id: second.id, assetId: null }),
      ])
    );
  } finally {
    await runtime.dispose();
  }
});
