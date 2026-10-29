import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Cause, Effect, Exit, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer } from '../src/adapters/sources/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import {
  SourceStore,
  SourceAcceptanceOutbox,
  type SourceConfirmation,
} from '../src/capabilities/sources/index.js';
let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-1'));
});
afterAll(async () => {
  await pool?.end();
  await container?.stop();
});
it('preserves a pure transition exception as a defect and rolls back the proposed Source state', async () => {
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  // This Asset is independent of the other contracts and needs no activation change.
  await pool.query(
    `INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
     VALUES ('asset_decision_defect', 'wallpaper', 'wallpaper', 'clerk', 'owner')`
  );
  const defect = new Error('unique Source transition defect');
  const read = SourceStore.use((store) =>
    store.transact('asset_decision_defect', null, (state) => ({ state, result: state }))
  );
  try {
    const before = await sources.runPromise(read);
    const result = await sources.runPromiseExit(
      SourceStore.use((store) =>
        store.transact('asset_decision_defect', null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sourceSetRevision = '999';
          state.defaultSourceId = 'source_uncommitted';
          throw defect;
        })
      )
    );
    expect(Exit.isFailure(result)).toBe(true);
    if (!Exit.isFailure(result)) throw new Error('Expected failure');
    expect(Cause.hasDies(result.cause)).toBe(true);
    expect(Cause.squash(result.cause)).toBe(defect);
    expect(await sources.runPromise(read)).toEqual(before);
    expect(
      await sources.runPromise(SourceAcceptanceOutbox.use((outbox) => outbox.claim(10)))
    ).toEqual([]);
    // A genuine database/policy failure keeps the declared technical error channel.
    const unavailable = await sources.runPromiseExit(
      SourceStore.use((store) =>
        store.transact('asset_decision_defect', 'inactive-revision', (state) => ({
          state,
          result: state,
        }))
      )
    );
    expect(Exit.isFailure(unavailable)).toBe(true);
    if (!Exit.isFailure(unavailable)) throw new Error('Expected technical failure');
    expect(Cause.hasFails(unavailable.cause)).toBe(true);
    expect(Cause.hasDies(unavailable.cause)).toBe(false);
    expect(Cause.squash(unavailable.cause)).toMatchObject({
      _tag: 'SourceFailure',
      operation: 'transact',
    });
    expect(await sources.runPromise(read)).toEqual(before);
  } finally {
    await sources.dispose();
  }
});
it('owns a checked-out connection lost during a Source transaction and can continue on a fresh client', async () => {
  const databaseUrl = new URL(container.getConnectionUri());
  databaseUrl.searchParams.set('application_name', 'source-disconnect-contract');
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: databaseUrl.toString(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  await pool.query(
    `INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
     VALUES ('asset_disconnect', 'wallpaper', 'wallpaper', 'clerk', 'owner')`
  );
  const read = SourceStore.use((store) =>
    store.transact('asset_disconnect', null, (state) => ({ state, result: state }))
  );
  const blocker = await pool.connect();
  let pending: ReturnType<typeof sources.runPromiseExit> | undefined;
  try {
    const before = await sources.runPromise(read);
    await blocker.query('BEGIN');
    await blocker.query("SELECT id FROM owned_assets WHERE id = 'asset_disconnect' FOR UPDATE");
    pending = sources.runPromiseExit(
      SourceStore.use((store) =>
        store.transact('asset_disconnect', null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sourceSetRevision = '999';
          return { state, result: state };
        })
      )
    );
    let pid: number | undefined;
    await expect
      .poll(async () => {
        const result = await pool.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE application_name = 'source-disconnect-contract' AND wait_event_type = 'Lock'"
        );
        pid = result.rows[0]?.pid;
        return pid !== undefined;
      })
      .toBe(true);
    if (pid === undefined) throw new Error('Expected blocked Source backend');
    expect((await pool.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows).toEqual(
      [{ terminated: true }]
    );
    const result = await pending;
    expect(Exit.isFailure(result)).toBe(true);
    if (!Exit.isFailure(result)) throw new Error('Expected connection failure');
    expect(Cause.hasDies(result.cause)).toBe(false);
    expect(Cause.squash(result.cause)).toMatchObject({
      _tag: 'SourceFailure',
      operation: 'transact',
    });
    await blocker.query('ROLLBACK');
    expect(await sources.runPromise(read)).toEqual(before);
    expect(
      await sources.runPromise(SourceAcceptanceOutbox.use((outbox) => outbox.claim(10)))
    ).toEqual([]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await sources.dispose();
  }
});
it('commits immutable metadata, revisions, first provenance and one logical outbox together and fences stale activation', async () => {
  const runtime = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'revision-1',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  try {
    const created = await runtime.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'revision-1',
          applicationId: 'wallpaper',
          canonical: 'first',
          correlation: { commandId: 'first', applicationReference: 'intent-1' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/app', id: 'event-1' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const confirmation: SourceConfirmation = {
      context: { occurrence: { source: 'https://test/author', id: 'accept-one' } },
      id: 'source-accepted:source_1',
      applicationId: 'wallpaper',
      assetId: created.assetId,
      assetType: 'wallpaper',
      candidateId: 'candidate_1',
      sourceId: 'source_1',
      defaultSourceId: 'source_1',
      initialAnalysisSourceId: 'source_1',
      sourceSetRevision: '1',
      deliveryRevision: '1',
    };
    const accept = (revision: string) =>
      SourceStore.use((s) =>
        s.transact(created.assetId, revision, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [
            {
              sourceId: 'source_1',
              layout: 'asset-layout-1',
              facts: {
                digest: 'a'.repeat(64),
                byteLength: 4,
                mimeType: 'image/png',
                model: 'sdr-png',
                width: 2,
                height: 2,
              },
            },
          ];
          state.sourceSetRevision = '1';
          state.deliveryRevision = '1';
          state.defaultSourceId = 'source_1';
          state.initialAnalysisSourceId = 'source_1';
          return { state, result: state, confirmation };
        })
      );
    const accepted = await sources.runPromise(accept('revision-1'));
    expect(accepted.sourceSetRevision).toBe('1');
    expect(await sources.runPromise(accept('revision-1'))).toEqual(accepted);
    const claimed = await sources.runPromise(SourceAcceptanceOutbox.use((o) => o.claim(10)));
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.confirmation).toEqual(confirmation);
    await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-2'));
    expect(await sources.runPromise(Effect.exit(accept('revision-1')))).toMatchObject({
      _tag: 'Failure',
    });
    expect(
      await sources.runPromise(
        SourceStore.use((s) =>
          s.transact(created.assetId, null, (state) => ({ state, result: state }))
        )
      )
    ).toEqual(accepted);
  } finally {
    await sources.dispose();
    await runtime.dispose();
  }
});
it('quarantines exhausted confirmation responsibility and exposes deliberate operator recovery', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runOperator } = await import('../scripts/operator.js');
  const { authorityFixture } = await import('./fixtures/authority.js');
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-3'));
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'revision-3',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const directory = await mkdtemp(join(tmpdir(), 'source-recovery-'));
  const path = join(directory, 'authority.json');
  await writeFile(path, JSON.stringify(authorityFixture()), { mode: 0o600 });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = container.getConnectionUri();
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'revision-3',
          applicationId: 'wallpaper',
          canonical: 'recovery',
          correlation: { commandId: 'recovery', applicationReference: 'recovery-intent' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'recovery-create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const id = 'source-accepted:source_12345678-1234-4123-8123-123456789012';
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(created.assetId, 'revision-3', (state) => {
          if (!state) throw new Error('Expected state');
          const sourceId = id.slice('source-accepted:'.length);
          state.sources = [
            {
              sourceId,
              layout: 'asset-layout-1',
              facts: {
                digest: 'c'.repeat(64),
                byteLength: 4,
                mimeType: 'image/png',
                model: 'sdr-png',
                width: 2,
                height: 2,
              },
            },
          ];
          state.sourceSetRevision = '1';
          state.deliveryRevision = '1';
          state.defaultSourceId = sourceId;
          state.initialAnalysisSourceId = sourceId;
          return {
            state,
            result: undefined,
            confirmation: {
              context: {
                occurrence: { source: 'https://test/author', id: 'accept-recovery' },
                correlationId: 'recovery-intent',
              },
              id,
              applicationId: 'wallpaper',
              assetId: created.assetId,
              assetType: 'wallpaper',
              candidateId: 'candidate_recovery',
              sourceId,
              defaultSourceId: sourceId,
              initialAnalysisSourceId: sourceId,
              sourceSetRevision: '1',
              deliveryRevision: '1',
            },
          };
        })
      )
    );
    for (let attempt = 1; attempt <= 3; attempt++) {
      let publication: import('../src/capabilities/sources/index.js').SourcePublication | undefined;
      await expect
        .poll(async () => {
          publication = (
            await sources.runPromise(SourceAcceptanceOutbox.use((o) => o.claim(100)))
          ).find((p) => p.id === id);
          return publication?.attempts;
        })
        .toBe(attempt);
      if (!publication) throw new Error('Expected publication');
      const claimedPublication = publication;
      await sources.runPromise(SourceAcceptanceOutbox.use((o) => o.failed(claimedPublication)));
    }
    const outbox = await sources.runPromise(SourceAcceptanceOutbox);
    const firstAlert = (await sources.runPromise(outbox.pendingAlerts())).find((c) => c.id === id);
    if (!firstAlert) throw new Error('Expected first quarantine');
    await sources.runPromise(outbox.alerted(firstAlert));
    expect(
      await runOperator(['recover-source-confirmation', '--id', id, '--authority-file', path])
    ).toEqual({ recovered: true });
    // A delayed first-cycle acknowledgement cannot acknowledge the renewed duty,
    // either before or after that duty exhausts its fresh finite budget.
    await sources.runPromise(outbox.alerted(firstAlert));
    for (let attempt = 1; attempt <= 3; attempt++) {
      let publication: import('../src/capabilities/sources/index.js').SourcePublication | undefined;
      await expect
        .poll(async () => {
          publication = (await sources.runPromise(outbox.claim(100))).find((p) => p.id === id);
          return publication?.attempts;
        })
        .toBe(attempt);
      if (!publication) throw new Error('Expected renewed publication');
      await sources.runPromise(outbox.failed(publication));
    }
    const renewed = (await sources.runPromise(outbox.pendingAlerts())).find((c) => c.id === id);
    expect(renewed).toMatchObject({ ...firstAlert, quarantineId: expect.any(String) });
    if (!renewed) throw new Error('Expected renewed quarantine');
    expect(renewed.quarantineId).not.toBe(firstAlert.quarantineId);
    const restarted = ManagedRuntime.make(
      sourcePostgresLayer({
        databaseUrl: container.getConnectionUri(),
        maxAttempts: 3,
        retryDelayMs: 1,
        leaseMs: 1000,
      })
    );
    try {
      const restartedOutbox = await restarted.runPromise(SourceAcceptanceOutbox);
      expect(
        (await restarted.runPromise(restartedOutbox.pendingAlerts())).find((c) => c.id === id)
      ).toEqual(renewed);
      await restarted.runPromise(restartedOutbox.alerted(firstAlert));
      expect(
        (await restarted.runPromise(restartedOutbox.pendingAlerts())).find((c) => c.id === id)
      ).toEqual(renewed);
      await restarted.runPromise(restartedOutbox.alerted(renewed));
      expect(
        (await restarted.runPromise(restartedOutbox.pendingAlerts())).find((c) => c.id === id)
      ).toBeUndefined();
      // Other contracts share this database, so their expired leases remain claimable.
      expect(
        (await restarted.runPromise(restartedOutbox.claim(100))).find((p) => p.id === id)
      ).toBeUndefined();
    } finally {
      await restarted.dispose();
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    await sources.dispose();
    await lifecycle.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
it('rolls back immutable metadata and membership when acceptance confirmation cannot commit', async () => {
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-4'));
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'revision-4',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'revision-4',
          applicationId: 'wallpaper',
          canonical: 'rollback',
          correlation: { commandId: 'rollback', applicationReference: 'rollback-intent' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'rollback-create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const write = (applicationId: string, digest: string) =>
      SourceStore.use((store) =>
        store.transact(created.assetId, 'revision-4', (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [
            {
              sourceId: 'source_rollback',
              layout: 'asset-layout-1',
              facts: {
                digest,
                byteLength: 4,
                width: 2,
                height: 2,
                model: 'sdr-png',
                mimeType: 'image/png',
              },
            },
          ];
          state.sourceSetRevision = '1';
          state.deliveryRevision = '1';
          state.defaultSourceId = 'source_rollback';
          state.initialAnalysisSourceId = 'source_rollback';
          return {
            state,
            result: state,
            confirmation: {
              id: 'source-accepted:source_rollback',
              applicationId,
              assetId: created.assetId,
              assetType: 'wallpaper',
              candidateId: 'candidate_rollback',
              sourceId: 'source_rollback',
              defaultSourceId: 'source_rollback',
              initialAnalysisSourceId: 'source_rollback',
              sourceSetRevision: '1',
              deliveryRevision: '1',
              context: { occurrence: { source: 'https://test/author', id: 'rollback-accept' } },
            },
          };
        })
      );
    expect(
      await sources.runPromise(Effect.exit(write('wrong-application', 'd'.repeat(64))))
    ).toMatchObject({ _tag: 'Failure' });
    expect(
      await sources.runPromise(
        SourceStore.use((store) =>
          store.transact(created.assetId, null, (state) => ({ state, result: state }))
        )
      )
    ).toMatchObject({
      sourceSetRevision: '0',
      deliveryRevision: '0',
      defaultSourceId: null,
      initialAnalysisSourceId: null,
      sources: [],
    });
    // Different actual facts under the same reserved Source ID prove that the failed transaction left no immutable row behind.
    expect(await sources.runPromise(write('wallpaper', 'e'.repeat(64)))).toMatchObject({
      sourceSetRevision: '1',
      initialAnalysisSourceId: 'source_rollback',
      sources: [{ facts: { digest: 'e'.repeat(64) } }],
    });
    const replace = (applicationId: string) =>
      SourceStore.use((store) =>
        store.transact(created.assetId, 'revision-4', (state) => {
          const old = state?.sources[0];
          if (!state || !old) throw new Error('Expected accepted predecessor');
          state.sources = [{ ...old, sourceId: 'source_replacement_rollback' }];
          state.defaultSourceId = 'source_replacement_rollback';
          state.sourceSetRevision = '2';
          state.deliveryRevision = '2';
          return {
            state,
            result: state,
            retirement: {
              sourceId: 'source_rollback',
              evidenceExpiresAt: '2030-01-01T00:00:00.000Z',
            },
            confirmation: {
              id: 'source-accepted:source_replacement_rollback',
              applicationId,
              assetId: created.assetId,
              assetType: 'wallpaper',
              candidateId: 'candidate_replacement_rollback',
              sourceId: 'source_replacement_rollback',
              defaultSourceId: 'source_replacement_rollback',
              initialAnalysisSourceId: 'source_rollback',
              sourceSetRevision: '2',
              deliveryRevision: '2',
              context: {
                occurrence: { source: 'https://test/author', id: 'replacement-rollback' },
              },
            },
          };
        })
      );
    expect(await sources.runPromise(Effect.exit(replace('wrong-application')))).toMatchObject({
      _tag: 'Failure',
    });
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
          'source_rollback',
        ])
      ).rows
    ).toEqual([{ evidence_expires_at: null }]);
    const unchanged = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(created.assetId, null, (state) => ({ state, result: state }))
      )
    );
    expect(unchanged).toMatchObject({ sourceSetRevision: '1', defaultSourceId: 'source_rollback' });
    expect(await sources.runPromise(replace('wallpaper'))).toMatchObject({
      sourceSetRevision: '2',
      initialAnalysisSourceId: 'source_rollback',
    });
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
          'source_rollback',
        ])
      ).rows
    ).toEqual([{ evidence_expires_at: new Date('2030-01-01T00:00:00.000Z') }]);
    // Even a stale adapter callback cannot resurrect retired immutable identity.
    expect(await sources.runPromise(Effect.exit(write('wallpaper', 'e'.repeat(64))))).toMatchObject(
      { _tag: 'Failure' }
    );
    expect(
      (
        await pool.query('SELECT evidence_expires_at FROM immutable_sources WHERE id = $1', [
          'source_rollback',
        ])
      ).rows
    ).toEqual([{ evidence_expires_at: new Date('2030-01-01T00:00:00.000Z') }]);
  } finally {
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('serializes concurrent per-Asset preparation without dropping a candidate or exceeding its reserved count', async () => {
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-concurrent'));
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'revision-concurrent',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'revision-concurrent',
          applicationId: 'wallpaper',
          canonical: 'concurrent',
          correlation: { commandId: 'concurrent', applicationReference: 'concurrent-intent' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
          context: { occurrence: { source: 'https://test/author', id: 'concurrent-create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const reserve = (id: string) =>
      sources.runPromise(
        SourceStore.use((s) =>
          s.transact(created.assetId, 'revision-concurrent', (state) => {
            if (!state) throw new Error('Missing Asset');
            if (state.candidates.length === 2) return { state, result: 'full' };
            state.nonterminalCandidateCount++;
            state.candidates.push({
              candidateId: id,
              sourceId: `source-${id}`,
              idempotencyKey: id,
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'awaiting-bytes',
              expiresAt: '2099-01-01T00:00:00Z',
              orphanExpiresAt: '2099-01-01T00:00:00Z',
              layout: 'asset-layout-1',
            });
            return { state, result: 'reserved' };
          })
        )
      );
    expect((await Promise.all(['a', 'b', 'c'].map(reserve))).sort()).toEqual([
      'full',
      'reserved',
      'reserved',
    ]);
    const saved = await sources.runPromise(
      SourceStore.use((s) =>
        s.transact(created.assetId, null, (state) => ({ state, result: state }))
      )
    );
    expect(saved?.candidates).toHaveLength(2);
    expect(new Set(saved?.candidates.map((c) => c.candidateId)).size).toBe(2);
  } finally {
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('cannot restore detached Source state or publish a late confirmation after terminal deletion', async () => {
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'terminal-revision'));
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision: 'terminal-revision',
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'terminal-revision',
          applicationId: 'wallpaper',
          canonical: 'terminal-create',
          correlation: { commandId: 'terminal-create', applicationReference: '' },
          context: { occurrence: { source: 'https://test/app', id: 'terminal-create' } },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'owner' },
          },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const before = await sources.runPromise(
      SourceStore.use((s) =>
        s.transact(created.assetId, null, (state) => ({ state, result: state }))
      )
    );
    if (!before) throw new Error('Expected Source state');
    await lifecycle.runPromise(
      LifecycleStore.use((s) =>
        s.accept({
          revision: 'terminal-revision',
          applicationId: 'wallpaper',
          canonical: 'terminal-delete',
          correlation: { commandId: 'terminal-delete', applicationReference: '' },
          context: { occurrence: { source: 'https://test/app', id: 'terminal-delete' } },
          decision: {
            kind: 'delete',
            assetId: created.assetId,
            evidenceRetentionMsByType: { wallpaper: 604800000 },
          },
        })
      )
    );
    await expect(
      sources.runPromise(
        SourceStore.use((s) =>
          s.transact(created.assetId, null, () => ({ state: before, result: undefined }))
        )
      )
    ).rejects.toThrow();
    expect(
      await sources.runPromise(
        SourceStore.use((s) =>
          s.transact(created.assetId, null, (state) => ({ state, result: state }))
        )
      )
    ).toBeNull();
    const confirmation: SourceConfirmation = {
      id: 'late-terminal-confirmation',
      applicationId: 'wallpaper',
      assetId: created.assetId,
      assetType: 'wallpaper',
      candidateId: 'late-terminal-candidate',
      sourceId: 'late-terminal-source',
      defaultSourceId: 'late-terminal-source',
      initialAnalysisSourceId: 'late-terminal-source',
      sourceSetRevision: '1',
      deliveryRevision: '1',
      context: { occurrence: { source: 'https://test/author', id: 'late-terminal-event' } },
    };
    await expect(
      sources.runPromise(
        SourceStore.use((s) =>
          s.transact(created.assetId, null, (state) => ({ state, result: undefined, confirmation }))
        )
      )
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM source_acceptance_outbox WHERE id=$1',
          [confirmation.id]
        )
      ).rows
    ).toEqual([{ count: 0 }]);
  } finally {
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('retires the complete prior set atomically and rejects stale restoration while preserving another Asset', async () => {
  const revision = 'picture-whole-set';
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), revision));
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      revision,
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  const source = (id: string) => ({
    sourceId: id,
    layout: 'asset-layout-1' as const,
    facts: {
      width: 512,
      height: 512,
      model: 'sdr-webp',
      mimeType: 'image/webp',
      byteLength: 4,
      digest: 'a'.repeat(64),
    },
  });
  try {
    const create = async (key: string) => {
      const result = await lifecycle.runPromise(
        LifecycleStore.use((store) =>
          store.accept({
            revision,
            applicationId: 'user',
            canonical: key,
            correlation: { commandId: key, applicationReference: key },
            context: { occurrence: { source: 'https://test/user', id: key } },
            decision: {
              kind: 'create',
              assetType: 'picture',
              owner: { namespace: 'clerk', subject: 'owner' },
            },
          })
        )
      );
      if (result.outcome !== 'created') throw new Error('Expected picture');
      return result.assetId;
    };
    const assetId = await create('whole-set-picture');
    const adjacentId = await create('adjacent-picture');
    const seed = (id: string, ids: string[]) =>
      sources.runPromise(
        SourceStore.use((store) =>
          store.transact(id, revision, (state) => {
            if (!state) throw new Error('Expected Source state');
            state.sources = ids.map(source);
            state.sourceSetRevision = '1';
            state.deliveryRevision = '7';
            state.defaultSourceId = ids[0]!;
            state.initialAnalysisSourceId = ids[0]!;
            return { state, result: structuredClone(state) };
          })
        )
      );
    const before = await seed(assetId, ['picture-prior-a', 'picture-prior-b']);
    const adjacent = await seed(adjacentId, ['picture-adjacent']);
    const deadline = '2026-11-22T00:00:00.000Z';
    const replace = (invalidSecond: boolean) =>
      sources.runPromise(
        SourceStore.use((store) =>
          store.transact(assetId, revision, (state) => {
            if (!state) throw new Error('Expected Source state');
            state.sources = [source('picture-winner')];
            state.sourceSetRevision = '2';
            state.deliveryRevision = '8';
            state.defaultSourceId = 'picture-winner';
            return {
              state,
              result: structuredClone(state),
              retirements: [
                { sourceId: 'picture-prior-a', evidenceExpiresAt: deadline },
                {
                  sourceId: invalidSecond ? 'unrelated-source' : 'picture-prior-b',
                  evidenceExpiresAt: deadline,
                },
              ],
              confirmation: {
                id: 'picture-set-confirmation',
                applicationId: 'user',
                assetId,
                assetType: 'picture',
                candidateId: 'picture-set-candidate',
                sourceId: 'picture-winner',
                defaultSourceId: 'picture-winner',
                initialAnalysisSourceId: 'picture-prior-a',
                sourceSetRevision: '2',
                deliveryRevision: '8',
                context: { occurrence: { source: 'https://test/author', id: 'picture-whole-set' } },
              },
            };
          })
        )
      );
    const read = (id: string) =>
      sources.runPromise(
        SourceStore.use((store) => store.transact(id, null, (state) => ({ state, result: state })))
      );
    // The second retirement fails after the first write; all effects must roll back.
    await expect(replace(true)).rejects.toThrow();
    expect(await read(assetId)).toEqual(before);
    expect(
      (
        await pool.query(
          'SELECT id, evidence_expires_at FROM immutable_sources WHERE asset_id=$1 ORDER BY id',
          [assetId]
        )
      ).rows
    ).toEqual([
      { id: 'picture-prior-a', evidence_expires_at: null },
      { id: 'picture-prior-b', evidence_expires_at: null },
    ]);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM source_acceptance_outbox WHERE id=$1',
          ['picture-set-confirmation']
        )
      ).rows
    ).toEqual([{ count: 0 }]);
    const winner = await replace(false);
    expect(winner.initialAnalysisSourceId).toBe('picture-prior-a');
    expect(winner.sources.map((s) => s.sourceId)).toEqual(['picture-winner']);
    const retired = (
      await pool.query(
        'SELECT id, evidence_expires_at FROM immutable_sources WHERE asset_id=$1 AND evidence_expires_at IS NOT NULL ORDER BY id',
        [assetId]
      )
    ).rows;
    expect(retired).toEqual([
      { id: 'picture-prior-a', evidence_expires_at: new Date(deadline) },
      { id: 'picture-prior-b', evidence_expires_at: new Date(deadline) },
    ]);
    expect(
      (
        await pool.query('SELECT id, due_at FROM source_cleanup WHERE asset_id=$1 ORDER BY id', [
          assetId,
        ])
      ).rows
    ).toEqual([
      { id: 'source:picture-prior-a', due_at: new Date(deadline) },
      { id: 'source:picture-prior-b', due_at: new Date(deadline) },
    ]);
    // A retained Source and any descendant carrying that provenance have no active membership.
    for (const old of before.sources)
      expect(winner.sources.some((current) => current.sourceId === old.sourceId)).toBe(false);
    await expect(
      sources.runPromise(
        SourceStore.use((store) =>
          store.transact(assetId, null, () => ({ state: before, result: undefined }))
        )
      )
    ).rejects.toThrow();
    expect(await read(assetId)).toEqual(winner);
    expect(await read(adjacentId)).toEqual(adjacent);
    expect(
      (
        await pool.query(
          'SELECT id, evidence_expires_at FROM immutable_sources WHERE asset_id=$1 AND evidence_expires_at IS NOT NULL ORDER BY id',
          [assetId]
        )
      ).rows
    ).toEqual(retired);
  } finally {
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('bounds candidate hydration and state writes while retaining growing replay history', async () => {
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  await pool.query(`INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
    VALUES ('asset_history', 'wallpaper', 'wallpaper', 'clerk', 'owner')`);
  try {
    for (let index = 0; index < 96; index++) {
      await sources.runPromise(
        SourceStore.use((store) =>
          store.transact(
            'asset_history',
            null,
            (state) => {
              if (!state) throw new Error('Expected Asset');
              expect(state.candidates).toHaveLength(0);
              state.candidates.push({
                candidateId: `history-${index}`,
                sourceId: `history-source-${index}`,
                idempotencyKey: `history-key-${index}`,
                operation: 'add',
                expectedSourceSetRevision: '0',
                status: 'cancelled',
                expiresAt: '2099-01-01T00:00:00Z',
                orphanExpiresAt: '2099-01-01T00:00:00Z',
                layout: 'asset-layout-1',
              });
              return { state, result: undefined };
            },
            { kind: 'replay', key: `history-key-${index}`, now: new Date().toISOString() }
          )
        )
      );
    }
    const read = (id: string) =>
      sources.runPromise(
        SourceStore.use((store) =>
          store.transact('asset_history', null, (state) => ({ state, result: state?.candidates }), {
            kind: 'candidate',
            id,
          })
        )
      );
    expect(await read('history-0')).toMatchObject([
      { candidateId: 'history-0', status: 'cancelled' },
    ]);
    expect(await read('missing')).toEqual([]);
    await expect(
      sources.runPromise(
        SourceStore.use((store) =>
          store.transact(
            'asset_history',
            null,
            (state) => {
              if (!state?.candidates[0]) throw new Error('Expected candidate');
              state.candidates[0].status = 'ready';
              return {
                state,
                result: undefined,
                confirmation: {
                  id: 'history-rollback',
                  assetId: 'wrong-asset',
                  applicationId: 'wallpaper',
                  assetType: 'wallpaper',
                  candidateId: 'history-0',
                  sourceId: 'history-source-0',
                  defaultSourceId: 'history-source-0',
                  initialAnalysisSourceId: 'history-source-0',
                  sourceSetRevision: '1',
                  deliveryRevision: '1',
                  context: {
                    occurrence: { source: 'https://test/author', id: 'history-rollback' },
                  },
                },
              };
            },
            { kind: 'candidate', id: 'history-0' }
          )
        )
      )
    ).rejects.toThrow();
    expect(await read('history-0')).toMatchObject([
      { candidateId: 'history-0', status: 'cancelled' },
    ]);

    const page = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact('asset_history', null, (state) => ({ state, result: state }), {
          kind: 'page',
        })
      )
    );
    expect(page?.candidates).toHaveLength(32);
    expect(page?.candidateWindow).toEqual({ start: 64, valid: true });
    const next = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact('asset_history', null, (state) => ({ state, result: state }), {
          kind: 'page',
          cursor: '64:history-64',
        })
      )
    );
    expect(next?.candidates[0]?.candidateId).toBe('history-32');
    expect(next?.candidateWindow).toEqual({ start: 32, valid: true });
    const persisted = await pool.query('SELECT state FROM asset_source_state WHERE asset_id=$1', [
      'asset_history',
    ]);
    expect(persisted.rows[0].state.candidates).toEqual([]);
    expect(JSON.stringify(persisted.rows[0].state).length).toBeLessThan(1000);
  } finally {
    await sources.dispose();
  }
});

it('migrates retained legacy history once without dropping replay identities or cursor positions', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const sources = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  await pool.query(`INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
    VALUES ('asset_legacy_history', 'wallpaper', 'wallpaper', 'clerk', 'owner')`);
  try {
    const state = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact('asset_legacy_history', null, (state) => ({ state, result: state }))
      )
    );
    if (!state) throw new Error('Expected Asset');
    const history = Array.from({ length: 80 }, (_, index) => ({
      candidateId: `legacy-${index}`,
      sourceId: `legacy-source-${index}`,
      idempotencyKey: `legacy-key-${index}`,
      operation: 'add',
      expectedSourceSetRevision: '0',
      status: 'cancelled',
      expiresAt: '2099-01-01T00:00:00Z',
      orphanExpiresAt: '2099-01-01T00:00:00Z',
      layout: 'asset-layout-1',
    }));
    await pool.query('UPDATE asset_source_state SET state=$1 WHERE asset_id=$2', [
      JSON.stringify({ ...state, candidates: history }),
      state.asset.id,
    ]);
    for (let attempt = 0; attempt < 2; attempt++)
      await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'scripts/migrate-source-history.ts'],
        {
          env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
        }
      );
    const replay = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(state.asset.id, null, (state) => ({ state, result: state?.candidates }), {
          kind: 'replay',
          key: 'legacy-key-0',
          now: new Date().toISOString(),
        })
      )
    );
    expect(replay).toEqual([history[0]]);
    const page = await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(state.asset.id, null, (state) => ({ state, result: state }), {
          kind: 'page',
          cursor: '48:legacy-48',
        })
      )
    );
    expect(page?.candidateWindow).toEqual({ start: 16, valid: true });
    expect(page?.candidates).toEqual(history.slice(16, 48));
  } finally {
    await sources.dispose();
  }
});
