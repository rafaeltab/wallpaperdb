import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer } from '../src/adapters/sources/index.js';
import { cleanupPostgresLayer } from '../src/adapters/cleanup/index.js';
import { CleanupStore } from '../src/capabilities/cleanup/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import { SourceStore } from '../src/capabilities/sources/index.js';

let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'cleanup-1'));
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
const options = () => ({
  databaseUrl: container.getConnectionUri(),
  maxAttempts: 2,
  retryDelayMs: 1,
  leaseMs: 1000,
});

it('records bounded orphan work atomically, protects current membership and reclaims after restart without moving deadlines', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({ ...options(), revision: 'cleanup-1' })
  );
  const sources = ManagedRuntime.make(sourcePostgresLayer(options()));
  let cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: 'cleanup-1',
          applicationId: 'wallpaper',
          canonical: 'cleanup',
          correlation: { commandId: crypto.randomUUID(), applicationReference: 'cleanup' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const assetId = created.assetId;
    const facts = {
      digest: 'a'.repeat(64),
      byteLength: 4,
      mimeType: 'image/png',
      model: 'sdr-png',
      width: 2,
      height: 2,
    };
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(assetId, 'cleanup-1', (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [{ sourceId: 'current', facts, layout: 'asset-layout-1' }];
          state.defaultSourceId = 'current';
          state.candidates = [
            {
              candidateId: 'abandoned',
              sourceId: 'orphan',
              idempotencyKey: 'abandoned',
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'ready',
              layout: 'asset-layout-1',
              expiresAt: '2000-01-01T00:00:00Z',
              orphanExpiresAt: '2000-01-01T00:00:00Z',
              facts,
            },
          ];
          state.nonterminalCandidateCount = 1;
          return { state, result: undefined };
        })
      )
    );
    const claimed = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    expect(claimed.map((work) => work.target)).toEqual(
      expect.arrayContaining([
        { kind: 'candidate', candidateId: 'abandoned' },
        { kind: 'source', assetId, sourceId: 'orphan' },
      ])
    );
    expect(claimed).toHaveLength(2);
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.claim(10)))).toEqual([]);
    for (const work of claimed)
      await cleanup.runPromise(CleanupStore.use((store) => store.completed(work)));
    await cleanup.dispose();
    cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.claim(10)))).toEqual([]);
    const state = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(assetId, null, (state) => ({ state, result: state }))
      )
    );
    expect(state?.sources.map((source) => source.sourceId)).toEqual(['current']);
    expect(state?.candidates[0]).toMatchObject({
      status: 'rejected',
      reason: 'candidate-expired',
      expiresAt: '2000-01-01T00:00:00Z',
    });
    const retained = await pool.query('SELECT due_at, status FROM source_cleanup ORDER BY id');
    expect(retained.rows.every((row) => row.status === 'completed')).toBe(true);
    expect(
      retained.rows.every((row) => row.due_at.toISOString() === '2000-01-01T00:00:00.000Z')
    ).toBe(true);
  } finally {
    await cleanup.dispose();
    await sources.dispose();
    await lifecycle.dispose();
  }
});
