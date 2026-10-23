import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  LifecycleStore,
  ResultOutbox,
  type Acceptance,
} from '../src/capabilities/lifecycle/index.js';
import {
  activateLifecycle,
  initializeLifecycle,
  lifecyclePostgresLayer,
} from '../src/adapters/lifecycle/index.js';

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
beforeEach(async () => {
  await pool.query(
    'TRUNCATE owned_assets, asset_commands, asset_result_outbox, asset_deletions, asset_source_state, immutable_sources'
  );
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
      expect(
        yield* store.accept({
          ...input,
          context: { occurrence: { source: 'https://test/app', id: 'request-replay-2' } },
        })
      ).toEqual(results[0]);
      const replayPublications = yield* outbox.claim(10);
      expect(replayPublications).toHaveLength(1);
      expect(replayPublications[0]?.id).not.toBe(publication.id);
      for (const replay of replayPublications) yield* outbox.published(replay);
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

it('stops result publication after a durable finite budget and requires deliberate recovery', async () => {
  await runtime.runPromise(LifecycleStore.use((store) => store.accept(input)));
  let lastId = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let claimed: readonly import('../src/capabilities/lifecycle/index.js').ResultPublication[] = [];
    await expect
      .poll(
        async () => {
          claimed = await runtime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)));
          return claimed.length;
        },
        { timeout: 1000 }
      )
      .toBe(1);
    const publication = claimed[0];
    if (!publication) throw new Error('Missing publication');
    lastId = publication.id;
    expect(publication.attempts).toBe(attempt);
    await runtime.runPromise(ResultOutbox.use((outbox) => outbox.failed(publication)));
  }
  expect(await runtime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)))).toEqual([]);
  expect(await runtime.runPromise(ResultOutbox.use((outbox) => outbox.pendingAlerts(10)))).toEqual([
    { id: lastId, applicationId: 'user', context: input.context },
  ]);
  expect(await runtime.runPromise(ResultOutbox.use((outbox) => outbox.recover(lastId)))).toBe(true);
  expect(
    (await runtime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1))))[0]?.attempts
  ).toBe(1);
});

it('initializes only once and fences stale acceptance after explicit configuration activation', async () => {
  await Effect.runPromise(initializeLifecycle(container.getConnectionUri(), 'revision-1'));
  await expect(
    Effect.runPromise(initializeLifecycle(container.getConnectionUri(), 'other-revision'))
  ).rejects.toThrow();
  try {
    await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-2'));
    await expect(
      runtime.runPromise(LifecycleStore.use((store) => store.accept(input)))
    ).rejects.toThrow();
    expect(await runtime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)))).toEqual([]);
  } finally {
    await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-1'));
  }
});

it('rolls back Asset and command acceptance when the outbox write fails, then safely retries', async () => {
  await pool.query(
    'ALTER TABLE asset_result_outbox ADD CONSTRAINT proof_outbox_failure CHECK (false) NOT VALID'
  );
  try {
    await expect(
      runtime.runPromise(LifecycleStore.use((store) => store.accept(input)))
    ).rejects.toThrow();
    for (const table of ['owned_assets', 'asset_commands', 'asset_result_outbox'])
      expect((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(
        0
      );
  } finally {
    await pool.query('ALTER TABLE asset_result_outbox DROP CONSTRAINT proof_outbox_failure');
  }
  expect(
    await runtime.runPromise(LifecycleStore.use((store) => store.accept(input)))
  ).toMatchObject({ outcome: 'created' });
  expect(await runtime.runPromise(ResultOutbox.use((outbox) => outbox.claim(1)))).toHaveLength(1);
});

it('terminally deletes only for its Creating application and preserves replay fences after deletion', async () => {
  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* LifecycleStore;
      const created = yield* store.accept(input);
      if (created.outcome !== 'created') throw new Error('Expected Asset');
      const deletion: Acceptance = {
        ...input,
        canonical: '["delete","terminal"]',
        correlation: { commandId: 'terminal', applicationReference: 'removal-1' },
        decision: {
          kind: 'delete',
          assetId: created.assetId,
          evidenceRetentionMsByType: { picture: 2592000000 },
        },
      };
      expect(yield* store.accept({ ...deletion, applicationId: 'wallpaper' })).toMatchObject({
        outcome: 'rejected',
        reason: 'unavailable-asset',
      });
      expect(yield* store.find(created.assetId)).not.toBeNull();
      const deleted = yield* store.accept(deletion);
      expect(deleted).toEqual({
        commandId: 'terminal',
        applicationReference: 'removal-1',
        outcome: 'deleted',
        assetId: created.assetId,
      });
      expect(yield* store.find(created.assetId)).toBeNull();
      expect(yield* store.accept(deletion)).toEqual(deleted);
      expect(
        yield* store.accept({
          ...deletion,
          canonical: '["delete","again"]',
          correlation: { commandId: 'again', applicationReference: '' },
        })
      ).toMatchObject({ outcome: 'already-deleted', assetId: created.assetId });
      expect(yield* store.accept(input)).toEqual(created);
      expect(yield* store.find(created.assetId)).toBeNull();
      expect(
        yield* store.accept({
          ...deletion,
          canonical: '["delete","unknown"]',
          correlation: { commandId: 'unknown', applicationReference: '' },
          decision: {
            ...deletion.decision,
            kind: 'delete',
            assetId: 'asset_unknown',
            evidenceRetentionMsByType: { picture: 2592000000 },
          },
        })
      ).toMatchObject({ outcome: 'rejected', reason: 'unavailable-asset' });
    })
  );
});

it('rolls back terminal state and all responsibilities if the deletion result cannot commit', async () => {
  const created = await runtime.runPromise(LifecycleStore.use((s) => s.accept(input)));
  if (created.outcome !== 'created') throw new Error('Expected Asset');
  const deletion: Acceptance = {
    ...input,
    canonical: 'rollback-delete',
    correlation: { commandId: 'rollback-delete', applicationReference: '' },
    decision: {
      kind: 'delete',
      assetId: created.assetId,
      evidenceRetentionMsByType: { picture: 2592000000 },
    },
  };
  await pool.query(
    'ALTER TABLE asset_result_outbox ADD CONSTRAINT proof_delete_failure CHECK (false) NOT VALID'
  );
  try {
    await expect(
      runtime.runPromise(LifecycleStore.use((s) => s.accept(deletion)))
    ).rejects.toThrow();
    expect(
      await runtime.runPromise(LifecycleStore.use((s) => s.find(created.assetId)))
    ).not.toBeNull();
    expect((await pool.query('SELECT count(*)::int AS count FROM asset_deletions')).rows).toEqual([
      { count: 0 },
    ]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM asset_commands WHERE command_id = 'rollback-delete'"
        )
      ).rows
    ).toEqual([{ count: 0 }]);
  } finally {
    await pool.query('ALTER TABLE asset_result_outbox DROP CONSTRAINT proof_delete_failure');
  }
  const outcomes = await Promise.all(
    ['delete-a', 'delete-b'].map((commandId) =>
      runtime.runPromise(
        LifecycleStore.use((s) =>
          s.accept({
            ...deletion,
            canonical: commandId,
            correlation: { commandId, applicationReference: '' },
          })
        )
      )
    )
  );
  expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual(['already-deleted', 'deleted']);
  const before = (await pool.query('SELECT * FROM asset_deletions')).rows;
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({
    asset_id: created.assetId,
    source_set_revision: '1',
    delivery_revision: '1',
    capabilities_pending: true,
    cleanup_pending: true,
  });
  await runtime.runPromise(
    LifecycleStore.use((s) =>
      s.accept({
        ...deletion,
        canonical: 'after-expiry',
        correlation: { commandId: 'after-expiry', applicationReference: '' },
        decision: {
          kind: 'delete',
          assetId: created.assetId,
          evidenceRetentionMsByType: { picture: 1 },
        },
      })
    )
  );
  expect((await pool.query('SELECT * FROM asset_deletions')).rows).toEqual(before);
});
