import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Effect, ManagedRuntime } from 'effect';
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
    expect(
      (await sources.runPromise(SourceAcceptanceOutbox.use((o) => o.pendingAlerts()))).some(
        (c) => c.id === id
      )
    ).toBe(true);
    expect(
      await runOperator(['recover-source-confirmation', '--id', id, '--authority-file', path])
    ).toEqual({ recovered: true });
    expect(
      (await sources.runPromise(SourceAcceptanceOutbox.use((o) => o.claim(100)))).find(
        (p) => p.id === id
      )?.attempts
    ).toBe(1);
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
