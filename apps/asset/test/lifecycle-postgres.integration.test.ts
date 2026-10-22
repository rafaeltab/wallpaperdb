import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  LifecycleStore,
  ResultOutbox,
  type Acceptance,
} from '../src/capabilities/lifecycle/index.js';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';

let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let pool: Pool;
let runtime: ManagedRuntime.ManagedRuntime<LifecycleStore | ResultOutbox, unknown>;
const input: Acceptance = {
  context: { occurrence: { source: 'https://test/app', id: 'occurrence-1' } },
  revision: 'revision-1',
  applicationId: 'user',
  canonical: '["create","one"]',
  correlation: { commandId: 'one', applicationReference: 'profile-1' },
  decision: {
    kind: 'create',
    assetType: 'picture',
    owner: { namespace: 'clerk', subject: 'owner-1' },
  },
};
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-1'));
  runtime = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'revision-1',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
});
afterAll(async () => {
  await runtime?.dispose();
  await pool?.end();
  await container?.stop();
});
it('atomically assigns one identity through concurrent replay, preserves application scoping and records conflict results', async () => {
  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* LifecycleStore;
      const outbox = yield* ResultOutbox;
      const results = yield* Effect.all([store.accept(input), store.accept(input)], {
        concurrency: 2,
      });
      expect(results[0]).toEqual(results[1]);
      expect(results[0]?.outcome).toBe('created');
      expect(results[0]?.assetId).toMatch(/^asset_/);
      expect(yield* store.find(results[0]?.assetId ?? '')).toMatchObject({
        applicationId: 'user',
        owner: { namespace: 'clerk', subject: 'owner-1' },
      });
      const publication = (yield* outbox.claim(10))[0];
      expect(publication?.result).toEqual(results[0]);
      expect(yield* outbox.claim(10)).toEqual([]);
      if (!publication) throw new Error('Missing result');
      yield* outbox.published(publication);
      const conflict = yield* store.accept({
        ...input,
        canonical: '["delete","one"]',
        decision: { kind: 'reject', reason: 'forbidden-operation' },
      });
      expect(conflict).toMatchObject({
        outcome: 'rejected',
        reason: 'idempotency-conflict',
        assetId: null,
      });
      const other = yield* store.accept({ ...input, applicationId: 'wallpaper' });
      const fresh = yield* store.accept({
        ...input,
        canonical: '["create","two"]',
        correlation: { ...input.correlation, commandId: 'two' },
      });
      expect(other.assetId).not.toBe(results[0]?.assetId);
      expect(fresh.assetId).not.toBe(results[0]?.assetId);
    })
  );
});
