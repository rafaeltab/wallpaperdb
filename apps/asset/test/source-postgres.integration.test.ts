import { mkdtemp, mkdir, readFile, readdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { Pool } from 'pg';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { activateLifecycle, lifecyclePostgresLayer } from '../src/adapters/lifecycle/index.js';
import { sourcePostgresLayer } from '../src/adapters/sources/index.js';
import { LifecycleStore } from '../src/capabilities/lifecycle/index.js';
import {
  SourceStore,
  Sources,
  SourceBytes,
  MandatoryInspection,
  sourcesLayer,
  initialSourcePolicies,
  SourceAcceptanceOutbox,
  type SourceConfirmation,
} from '../src/capabilities/sources/index.js';
let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
let pool: Pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  const baseline = await mkdtemp(join(tmpdir(), 'source-history-migration-'));
  try {
    await mkdir(join(baseline, 'meta'));
    const journal = JSON.parse(await readFile('./drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 18);
    await writeFile(join(baseline, 'meta/_journal.json'), JSON.stringify(journal));
    for (const file of await readdir('./drizzle'))
      if (file.endsWith('.sql')) await copyFile(join('./drizzle', file), join(baseline, file));
    await migrate(drizzle(pool), { migrationsFolder: baseline });
    const candidates = Array.from({ length: 40 }, (_, position) => ({
      candidateId: `upgrade-${position}`,
      sourceId: `upgrade-source-${position}`,
      idempotencyKey: `upgrade-key-${position}`,
      operation: 'add',
      expectedSourceSetRevision: '0',
      status: 'cancelled',
      expiresAt: '2027-01-01T00:00:00Z',
      orphanExpiresAt: '2027-01-01T00:00:00Z',
      layout: 'asset-layout-1',
    }));
    await pool.query(`INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
      VALUES ('asset_upgrade', 'wallpaper', 'wallpaper', 'clerk', 'owner')`);
    await pool.query('INSERT INTO asset_source_state (asset_id, state) VALUES ($1, $2)', [
      'asset_upgrade',
      {
        asset: {
          id: 'asset_upgrade',
          applicationId: 'wallpaper',
          assetType: 'wallpaper',
          owner: { namespace: 'clerk', subject: 'owner' },
        },
        sourceSetRevision: '0',
        deliveryRevision: '0',
        defaultSourceId: null,
        initialAnalysisSourceId: null,
        sources: [],
        candidates,
        nonterminalCandidateCount: 0,
      },
    ]);
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await rm(baseline, { recursive: true, force: true });
  }
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

it('keeps persisted Source state bounded as retained candidate history grows', async () => {
  const persistence = sourcePostgresLayer({
    databaseUrl: container.getConnectionUri(),
    maxAttempts: 3,
    retryDelayMs: 1,
    leaseMs: 1000,
  });
  const runtime = ManagedRuntime.make(
    Layer.merge(
      persistence,
      sourcesLayer({ revision: 'revision-548', types: initialSourcePolicies }).pipe(
        Layer.provide(
          Layer.mergeAll(
            persistence,
            Layer.succeed(SourceBytes, {
              put: () => Effect.die('unused'),
              prepare: () => Effect.die('unused'),
              read: () => Effect.die('unused'),
            }),
            Layer.succeed(MandatoryInspection, { inspect: () => Effect.die('unused') })
          )
        )
      )
    )
  );
  await Effect.runPromise(activateLifecycle(container.getConnectionUri(), 'revision-548'));
  const assetId = 'asset_growing_history';
  await pool.query(
    `INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject)
    VALUES ($1, 'wallpaper', 'wallpaper', 'clerk', 'owner')`,
    [assetId]
  );
  try {
    for (let index = 0; index < 128; index++) {
      await runtime.runPromise(
        SourceStore.use((store) =>
          store.transact(assetId, null, (state) => {
            if (!state) throw new Error('Expected Asset');
            state.candidates.push({
              candidateId: `history-${index}`,
              sourceId: `history-source-${index}`,
              idempotencyKey: `history-key-${index}`,
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'cancelled',
              expiresAt: '2027-01-01T00:00:00Z',
              orphanExpiresAt: '2027-01-01T00:00:00Z',
              layout: 'asset-layout-1',
            });
            return { state, result: undefined };
          })
        )
      );
    }
    const stored = await pool.query<{ bytes: number }>(
      'SELECT octet_length(state::text) AS bytes FROM asset_source_state WHERE asset_id=$1',
      [assetId]
    );
    expect(stored.rows[0]?.bytes).toBeLessThan(2048);
    const owner = { namespace: 'clerk', subject: 'owner' };
    const oldest = await runtime.runPromise(
      Sources.use((s) => s.status(owner, assetId, 'history-0'))
    );
    expect(oldest).toMatchObject({ kind: 'candidate', candidate: { status: 'cancelled' } });
    expect(
      await runtime.runPromise(
        Sources.use((s) =>
          s.create(owner, assetId, {
            operation: 'add',
            expectedSourceSetRevision: '0',
            idempotencyKey: 'history-key-0',
          })
        )
      )
    ).toEqual(oldest);
    expect(
      await runtime.runPromise(
        Sources.use((s) =>
          s.create(owner, assetId, {
            operation: 'add',
            expectedSourceSetRevision: '1',
            idempotencyKey: 'history-key-0',
          })
        )
      )
    ).toEqual({ kind: 'rejected', reason: 'idempotency-conflict' });
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = await runtime.runPromise(Sources.use((s) => s.list(owner, assetId, cursor)));
      if (page.kind !== 'found') throw new Error('Expected page');
      expect(page.asset.candidates).toHaveLength(32);
      expect(page.asset.hasPendingCandidates).toBe(false);
      ids.push(...page.asset.candidates.map((c) => c.candidateId));
      cursor = page.asset.nextCandidateCursor;
    } while (cursor !== undefined);
    expect(ids).toEqual(Array.from({ length: 128 }, (_, i) => `history-${127 - i}`));
    expect(
      await runtime.runPromise(Sources.use((s) => s.list(owner, assetId, '32:wrong')))
    ).toEqual({ kind: 'unavailable' });
    // Grow the same retained history another 64-fold without changing live capacity.
    await pool.query(
      `INSERT INTO source_candidates
      (asset_id, candidate_id, idempotency_key, position, expires_at, status, candidate)
      SELECT asset_id, 'history-' || n, 'history-key-' || n, n, expires_at, status,
        candidate || jsonb_build_object('candidateId', 'history-' || n, 'sourceId', 'history-source-' || n, 'idempotencyKey', 'history-key-' || n)
      FROM source_candidates CROSS JOIN generate_series(128, 8319) n
      WHERE asset_id=$1 AND candidate_id='history-0'`,
      [assetId]
    );
    await pool.query('UPDATE asset_source_state SET candidate_sequence=8320 WHERE asset_id=$1', [
      assetId,
    ]);
    await pool.query('ANALYZE source_candidates');
    for (const query of [
      "SELECT candidate FROM source_candidates WHERE asset_id=$1 AND candidate_id='history-0'",
      "SELECT candidate FROM source_candidates WHERE asset_id=$1 AND idempotency_key='history-key-0'",
      'SELECT candidate FROM source_candidates WHERE asset_id=$1 AND position <= 8000 ORDER BY position DESC LIMIT 33',
      "SELECT candidate_id FROM source_candidates WHERE asset_id=$1 AND status NOT IN ('accepted', 'rejected', 'cancelled') AND expires_at > now() LIMIT 2",
    ]) {
      const plan = await pool.query<{
        'QUERY PLAN': {
          Plan: {
            'Actual Rows': number;
            'Shared Hit Blocks': number;
            'Shared Read Blocks': number;
          };
        }[];
      }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, [assetId]);
      const work = plan.rows[0]?.['QUERY PLAN'][0]?.Plan;
      expect(work?.['Actual Rows']).toBeLessThanOrEqual(33);
      expect(
        (work?.['Shared Hit Blocks'] ?? Infinity) + (work?.['Shared Read Blocks'] ?? Infinity)
      ).toBeLessThan(64);
    }
    expect(
      await runtime.runPromise(Sources.use((s) => s.status(owner, assetId, 'history-0')))
    ).toEqual(oldest);
    const grownPage = await runtime.runPromise(
      Sources.use((s) => s.list(owner, assetId, '8000:history-8000'))
    );
    expect(grownPage).toMatchObject({
      kind: 'found',
      asset: {
        candidates: Array.from({ length: 32 }, (_, i) => ({ candidateId: `history-${7999 - i}` })),
      },
    });
    const beforeRows = await pool.query(
      'SELECT candidate_id, xmin::text AS version FROM source_candidates WHERE asset_id=$1 ORDER BY position',
      [assetId]
    );
    const created = await runtime.runPromise(
      Sources.use((s) =>
        s.create(owner, assetId, {
          operation: 'add',
          expectedSourceSetRevision: '0',
          idempotencyKey: 'after-history',
        })
      )
    );
    if (created.kind !== 'candidate') throw new Error('History must not consume intake capacity');
    expect(
      await runtime.runPromise(
        Sources.use((s) => s.cancel(owner, assetId, created.candidate.candidateId))
      )
    ).toMatchObject({ kind: 'candidate', candidate: { status: 'cancelled' } });
    const afterRows = await pool.query(
      'SELECT candidate_id, xmin::text AS version FROM source_candidates WHERE asset_id=$1 AND candidate_id <> $2 ORDER BY position',
      [assetId, created.candidate.candidateId]
    );
    expect(afterRows.rows).toEqual(beforeRows.rows);
    expect(
      (
        await pool.query('SELECT count(*)::int AS count FROM source_candidates WHERE asset_id=$1', [
          assetId,
        ])
      ).rows
    ).toEqual([{ count: 8321 }]);
    // Read-only and one-candidate transitions never rewrite retained replay records.
    expect(
      await runtime.runPromise(
        Sources.use((s) => s.status({ ...owner, subject: 'other' }, assetId, 'history-0'))
      )
    ).toEqual({ kind: 'unavailable' });
  } finally {
    await runtime.dispose();
  }
});

it('migrates existing replay history without losing identities or cursor positions', async () => {
  expect(
    (
      await pool.query(
        "SELECT candidate_sequence, state->'candidates' AS candidates FROM asset_source_state WHERE asset_id='asset_upgrade'"
      )
    ).rows
  ).toEqual([{ candidate_sequence: '40', candidates: [] }]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM source_candidates WHERE asset_id='asset_upgrade'"
      )
    ).rows
  ).toEqual([{ count: 40 }]);
  const runtime = ManagedRuntime.make(
    sourcePostgresLayer({
      databaseUrl: container.getConnectionUri(),
      maxAttempts: 3,
      retryDelayMs: 1,
      leaseMs: 1000,
    })
  );
  try {
    const replay = await runtime.runPromise(
      SourceStore.use((s) =>
        s.transact('asset_upgrade', null, (state) => ({ state, result: state?.candidates }), {
          idempotencyKey: 'upgrade-key-0',
        })
      )
    );
    expect(replay).toMatchObject([{ candidateId: 'upgrade-0', status: 'cancelled' }]);
    const page = await runtime.runPromise(
      SourceStore.use((s) =>
        s.transact('asset_upgrade', null, (state) => ({ state, result: state }), {
          page: { cursor: '8:upgrade-8' },
        })
      )
    );
    expect(page?.candidateOffset).toBe(0);
    expect(page?.candidates.map((c) => c.candidateId)).toEqual(
      Array.from({ length: 9 }, (_, i) => `upgrade-${i}`)
    );
  } finally {
    await runtime.dispose();
  }
});
