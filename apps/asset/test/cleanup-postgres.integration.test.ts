import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Clock, Effect, ManagedRuntime } from 'effect';
import { TestClock } from 'effect/testing';
import { createServer, connect, type Socket } from 'node:net';
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

it('replays cleanup completion after a lost real COMMIT response without losing its compact identity', async () => {
  const assetId = crypto.randomUUID(),
    candidateId = crypto.randomUUID(),
    id = `candidate:${candidateId}`;
  await pool.query(
    "INSERT INTO owned_assets (id, application_id, asset_type, owner_namespace, owner_subject) VALUES ($1, 'wallpaper', 'wallpaper', 'clerk', 'commit')",
    [assetId]
  );
  await pool.query(
    "INSERT INTO source_cleanup (id, asset_id, application_id, target, due_at) VALUES ($1, $2, 'wallpaper', $3, '2000-01-01')",
    [id, assetId, JSON.stringify({ kind: 'candidate', candidateId })]
  );
  const direct = ManagedRuntime.make(cleanupPostgresLayer(options()));
  const sockets = new Set<Socket>(),
    upstreamUrl = new URL(container.getConnectionUri());
  let dropCommit = true,
    dropped = false;
  const proxy = createServer((client) => {
    const upstream = connect({ host: upstreamUrl.hostname, port: Number(upstreamUrl.port) });
    sockets.add(client);
    sockets.add(upstream);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on('close', () => {
      sockets.delete(upstream);
      client.destroy();
    });
    client.pipe(upstream);
    let buffered = Buffer.alloc(0);
    upstream.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 5) {
        const length = 1 + buffered.readInt32BE(1);
        if (buffered.length < length) return;
        const frame = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        if (dropCommit && frame[0] === 67 && frame.subarray(5).equals(Buffer.from('COMMIT\0'))) {
          dropCommit = false;
          dropped = true;
          client.destroy();
          upstream.destroy();
          return;
        }
        client.write(frame);
      }
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing proxy');
  const proxyUrl = new URL(upstreamUrl);
  proxyUrl.hostname = '127.0.0.1';
  proxyUrl.port = String(address.port);
  const ambiguous = ManagedRuntime.make(
    cleanupPostgresLayer({ ...options(), databaseUrl: proxyUrl.toString() })
  );
  try {
    const [work] = await direct.runPromise(CleanupStore.use((store) => store.claim(100)));
    if (!work || work.id !== id) throw new Error('Expected exact fixture claim');
    await expect(
      ambiguous.runPromise(CleanupStore.use((store) => store.completed(work)))
    ).rejects.toBeDefined();
    expect(dropped).toBe(true);
    const committed = (await pool.query('SELECT * FROM source_cleanup WHERE id=$1', [id])).rows;
    expect(committed[0]).toMatchObject({ status: 'completed', due_at: new Date('2000-01-01') });
    await ambiguous.runPromise(CleanupStore.use((store) => store.completed(work)));
    expect((await pool.query('SELECT * FROM source_cleanup WHERE id=$1', [id])).rows).toEqual(
      committed
    );
  } finally {
    await ambiguous.dispose();
    await direct.dispose();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

it('honors the exact recorded seven-day and thirty-day evidence boundaries and finishes empty terminal Assets', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({ ...options(), revision: 'cleanup-1' })
  );
  const sources = ManagedRuntime.make(sourcePostgresLayer(options()));
  const cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
  const clockRuntime = ManagedRuntime.make(TestClock.layer());
  const clock = await clockRuntime.runPromise(Clock.Clock);
  const targets: { assetId: string; sourceId: string }[] = [];
  try {
    for (const [assetType, evidenceExpiresAt] of [
      ['wallpaper', '2030-01-01T00:00:00Z'],
      ['picture', '2030-01-24T00:00:00Z'],
    ]) {
      const command = {
        revision: 'cleanup-1',
        applicationId: 'wallpaper',
        canonical: crypto.randomUUID(),
        correlation: { commandId: crypto.randomUUID(), applicationReference: '' },
        decision: {
          kind: 'create' as const,
          assetType: assetType!,
          owner: { namespace: 'clerk', subject: 'exact-expiry' },
        },
        context: { occurrence: { source: 'https://test/wallpaper', id: crypto.randomUUID() } },
      };
      const created = await lifecycle.runPromise(
        LifecycleStore.use((store) => store.accept(command))
      );
      if (created.outcome !== 'created') throw new Error('Expected Asset');
      const assetId = created.assetId,
        sourceId = crypto.randomUUID();
      targets.push({ assetId, sourceId });
      await sources.runPromise(
        SourceStore.use((store) =>
          store.transact(assetId, null, (state) => {
            if (!state) throw new Error('Expected Asset');
            state.sources = [
              {
                sourceId,
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
            return { state, result: undefined };
          })
        )
      );
      await sources.runPromise(
        SourceStore.use((store) =>
          store.transact(assetId, null, (state) => {
            if (!state) throw new Error('Expected Asset');
            state.sources = [];
            return {
              state,
              result: undefined,
              retirement: { sourceId, evidenceExpiresAt: evidenceExpiresAt! },
            };
          })
        )
      );
    }
    const claim = () =>
      cleanup.runPromise(
        CleanupStore.use((store) => store.claim(100)).pipe(
          Effect.provideService(Clock.Clock, clock)
        )
      );
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2029-12-31T23:59:59.999Z')));
    expect(await claim()).toEqual([]);
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2030-01-01T00:00:00Z')));
    const wallpaper = await claim();
    expect(wallpaper.map((work) => work.target)).toEqual([{ kind: 'source', ...targets[0] }]);
    for (const work of wallpaper)
      await cleanup.runPromise(CleanupStore.use((store) => store.completed(work)));
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2030-01-23T23:59:59.999Z')));
    expect(await claim()).toEqual([]);
    await clockRuntime.runPromise(TestClock.setTime(Date.parse('2030-01-24T00:00:00Z')));
    const picture = await claim();
    expect(picture.map((work) => work.target)).toEqual([{ kind: 'source', ...targets[1] }]);
    for (const work of picture)
      await cleanup.runPromise(CleanupStore.use((store) => store.completed(work)));
    const empty = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: 'cleanup-1',
          applicationId: 'wallpaper',
          canonical: crypto.randomUUID(),
          correlation: { commandId: crypto.randomUUID(), applicationReference: '' },
          decision: {
            kind: 'create',
            assetType: 'picture',
            owner: { namespace: 'clerk', subject: 'empty' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'empty' } },
        })
      )
    );
    if (empty.outcome !== 'created') throw new Error('Expected empty Asset');
    await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: 'cleanup-1',
          applicationId: 'wallpaper',
          canonical: crypto.randomUUID(),
          correlation: { commandId: crypto.randomUUID(), applicationReference: '' },
          decision: {
            kind: 'delete',
            assetId: empty.assetId,
            evidenceRetentionMsByType: { picture: 2592000000 },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'empty-delete' } },
        })
      )
    );
    expect(await claim()).toEqual([]);
    expect(
      (
        await pool.query('SELECT cleanup_pending FROM asset_deletions WHERE asset_id=$1', [
          empty.assetId,
        ])
      ).rows
    ).toEqual([{ cleanup_pending: false }]);
  } finally {
    await clockRuntime.dispose();
    await cleanup.dispose();
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('bounds failed and abandoned claims, fences stale completion and recovers deliberately across restart', async () => {
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
          canonical: 'recover',
          correlation: { commandId: crypto.randomUUID(), applicationReference: '' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'recover' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'recover-create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const assetId = created.assetId,
      candidateId = crypto.randomUUID();
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(assetId, null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.candidates = [
            {
              candidateId,
              sourceId: crypto.randomUUID(),
              idempotencyKey: 'recover',
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'cancelled',
              layout: 'asset-layout-1',
              expiresAt: '2000-01-01T00:00:00Z',
              orphanExpiresAt: '2000-01-01T00:00:00Z',
            },
          ];
          return { state, result: undefined };
        })
      )
    );
    const initial = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    const first = initial.find(
      (work) => work.target.kind === 'candidate' && work.target.candidateId === candidateId
    );
    if (!first) throw new Error('Expected candidate claim');
    for (const work of initial)
      if (work !== first)
        await cleanup.runPromise(CleanupStore.use((store) => store.completed(work)));
    await pool.query("UPDATE source_cleanup SET available_at='2000-01-01' WHERE id=$1", [first.id]);
    await cleanup.dispose();
    cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
    const [second] = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    if (!second) throw new Error('Expected restart claim');
    expect(second.attempts).toBe(2);
    expect(second.leaseId).not.toBe(first.leaseId);
    await cleanup.runPromise(CleanupStore.use((store) => store.completed(first)));
    expect(
      (await pool.query('SELECT status FROM source_cleanup WHERE id=$1', [first.id])).rows
    ).toEqual([{ status: 'reclaiming' }]);
    await cleanup.runPromise(CleanupStore.use((store) => store.failed(second)));
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)))).toEqual([]);
    expect(
      await cleanup.runPromise(CleanupStore.use((store) => store.pendingAlerts()))
    ).toContainEqual(expect.objectContaining({ id: first.id, applicationId: 'wallpaper' }));
    const [oldAlert] = await cleanup.runPromise(CleanupStore.use((store) => store.pendingAlerts()));
    if (!oldAlert) throw new Error('Expected alert');
    await cleanup.runPromise(
      CleanupStore.use((store) => store.alerted(first.id, oldAlert.notificationId))
    );
    expect(
      await cleanup.runPromise(CleanupStore.use((store) => store.pendingAlerts()))
    ).not.toContainEqual(expect.objectContaining({ id: first.id, applicationId: 'wallpaper' }));
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.recover(first.id)))).toBe(
      true
    );
    const [recovered] = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    if (!recovered) throw new Error('Expected recovered claim');
    expect(recovered.attempts).toBe(1);
    await cleanup.runPromise(CleanupStore.use((store) => store.failed(recovered)));
    await pool.query("UPDATE source_cleanup SET available_at='2000-01-01' WHERE id=$1", [first.id]);
    const [retried] = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    if (!retried) throw new Error('Expected current retry');
    // Lose the final claim without reporting failure. Restart must quarantine it,
    // observe that committed transition, and return no reclaimable work.
    await pool.query("UPDATE source_cleanup SET available_at='2000-01-01' WHERE id=$1", [first.id]);
    await cleanup.dispose();
    cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)))).toEqual([]);
    expect(
      (
        await pool.query('SELECT status, attempts, lease_id FROM source_cleanup WHERE id=$1', [
          first.id,
        ])
      ).rows
    ).toEqual([{ status: 'quarantined', attempts: 2, lease_id: null }]);
    const [currentAlert] = await cleanup.runPromise(
      CleanupStore.use((store) => store.pendingAlerts())
    );
    if (!currentAlert) throw new Error('Expected new quarantine');
    expect(currentAlert.notificationId).not.toBe(oldAlert.notificationId);
    await cleanup.runPromise(
      CleanupStore.use((store) => store.alerted(first.id, oldAlert.notificationId))
    );
    expect(
      await cleanup.runPromise(CleanupStore.use((store) => store.pendingAlerts()))
    ).toContainEqual(currentAlert);
    await cleanup.runPromise(
      CleanupStore.use((store) => store.alerted(first.id, currentAlert.notificationId))
    );
    expect(
      await cleanup.runPromise(CleanupStore.use((store) => store.pendingAlerts()))
    ).not.toContainEqual(currentAlert);
    await cleanup.runPromise(CleanupStore.use((store) => store.recover(first.id)));
    const [last] = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    if (!last) throw new Error('Expected final recovered claim');
    await cleanup.runPromise(CleanupStore.use((store) => store.completed(last)));
    expect(
      (await pool.query('SELECT due_at FROM source_cleanup WHERE id=$1', [first.id])).rows
    ).toEqual([{ due_at: new Date('2000-01-01T00:00:00Z') }]);
  } finally {
    await cleanup.dispose();
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('atomically schedules terminal Source evidence and cancelled reservations without resetting recorded expiry', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({ ...options(), revision: 'cleanup-1' })
  );
  const sources = ManagedRuntime.make(sourcePostgresLayer(options()));
  const cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
  try {
    const command = {
      revision: 'cleanup-1',
      applicationId: 'wallpaper',
      canonical: 'terminal',
      correlation: { commandId: crypto.randomUUID(), applicationReference: '' },
      decision: {
        kind: 'create' as const,
        assetType: 'wallpaper',
        owner: { namespace: 'clerk', subject: 'terminal' },
      },
      context: { occurrence: { source: 'https://test/wallpaper', id: 'terminal-create' } },
    };
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) => store.accept(command))
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const assetId = created.assetId;
    const sourceId = `source_${crypto.randomUUID()}`,
      orphan = `source_${crypto.randomUUID()}`,
      candidateId = crypto.randomUUID();
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
        store.transact(assetId, null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [{ sourceId, facts, layout: 'asset-layout-1' }];
          state.candidates = [
            {
              candidateId,
              sourceId: orphan,
              idempotencyKey: 'late',
              operation: 'add',
              expectedSourceSetRevision: '0',
              status: 'ready',
              facts,
              layout: 'asset-layout-1',
              expiresAt: '2099-01-01T00:00:00Z',
              orphanExpiresAt: '2099-01-01T00:00:00Z',
            },
          ];
          state.nonterminalCandidateCount = 1;
          return { state, result: undefined };
        })
      )
    );
    const deletion = {
      ...command,
      canonical: 'delete-terminal',
      correlation: { ...command.correlation, commandId: crypto.randomUUID() },
      decision: { kind: 'delete' as const, assetId, evidenceRetentionMsByType: { wallpaper: 0 } },
    };
    expect(
      await lifecycle.runPromise(LifecycleStore.use((store) => store.accept(deletion)))
    ).toMatchObject({ outcome: 'deleted' });
    const recorded = (
      await pool.query('SELECT due_at FROM source_cleanup WHERE asset_id=$1 ORDER BY id', [assetId])
    ).rows;
    expect(
      await lifecycle.runPromise(LifecycleStore.use((store) => store.accept(deletion)))
    ).toMatchObject({ outcome: 'deleted' });
    expect(
      (
        await pool.query('SELECT due_at FROM source_cleanup WHERE asset_id=$1 ORDER BY id', [
          assetId,
        ])
      ).rows
    ).toEqual(recorded);
    const work = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    expect(work.map((item) => item.target)).toEqual(
      expect.arrayContaining([
        { kind: 'candidate', candidateId },
        { kind: 'source', assetId, sourceId },
        { kind: 'source', assetId, sourceId: orphan },
      ])
    );
    expect(work).toHaveLength(3);
    for (const item of work)
      await cleanup.runPromise(CleanupStore.use((store) => store.completed(item)));
    expect(
      (await pool.query('SELECT deleted_at FROM owned_assets WHERE id=$1', [assetId])).rows[0]
        .deleted_at
    ).toBeInstanceOf(Date);
    expect(
      (await pool.query('SELECT cleanup_pending FROM asset_deletions WHERE asset_id=$1', [assetId]))
        .rows
    ).toEqual([{ cleanup_pending: false }]);
    expect(
      (await pool.query('SELECT state FROM asset_source_state WHERE asset_id=$1', [assetId])).rows
    ).toEqual([]);
    expect(
      await lifecycle.runPromise(LifecycleStore.use((store) => store.accept(command)))
    ).toMatchObject({ outcome: 'created', assetId });
    expect(
      await lifecycle.runPromise(LifecycleStore.use((store) => store.find(assetId)))
    ).toBeNull();
  } finally {
    await cleanup.dispose();
    await sources.dispose();
    await lifecycle.dispose();
  }
});

it('serializes accepted read protection with membership and releases it without restoring retired eligibility', async () => {
  const lifecycle = ManagedRuntime.make(
    lifecyclePostgresLayer({ ...options(), revision: 'cleanup-1' })
  );
  const sources = ManagedRuntime.make(sourcePostgresLayer(options()));
  const cleanup = ManagedRuntime.make(cleanupPostgresLayer(options()));
  try {
    const created = await lifecycle.runPromise(
      LifecycleStore.use((store) =>
        store.accept({
          revision: 'cleanup-1',
          applicationId: 'wallpaper',
          canonical: 'read',
          correlation: { commandId: crypto.randomUUID(), applicationReference: 'read' },
          decision: {
            kind: 'create',
            assetType: 'wallpaper',
            owner: { namespace: 'clerk', subject: 'reader' },
          },
          context: { occurrence: { source: 'https://test/wallpaper', id: 'read-create' } },
        })
      )
    );
    if (created.outcome !== 'created') throw new Error('Expected Asset');
    const assetId = created.assetId;
    const sourceId = `source_${crypto.randomUUID()}`;
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
        store.transact(assetId, null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [{ sourceId, facts, layout: 'asset-layout-1' }];
          return { state, result: undefined };
        })
      )
    );
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(assetId, null, (state) => ({
          state,
          result: undefined,
          readProtection: { readId: 'active-read', sourceId, expiresAt: '2099-01-01T00:00:00Z' },
        }))
      )
    );
    await sources.runPromise(
      SourceStore.use((store) =>
        store.transact(assetId, null, (state) => {
          if (!state) throw new Error('Expected Asset');
          state.sources = [];
          return {
            state,
            result: undefined,
            retirement: { sourceId, evidenceExpiresAt: '2000-01-01T00:00:00Z' },
          };
        })
      )
    );
    expect(await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)))).toEqual([]);
    await sources.runPromise(SourceStore.use((store) => store.releaseRead('active-read')));
    const work = await cleanup.runPromise(CleanupStore.use((store) => store.claim(100)));
    expect(work.map((item) => item.target)).toEqual([{ kind: 'source', assetId, sourceId }]);
    await cleanup.runPromise(CleanupStore.use((store) => store.completed(work[0]!)));
    expect(
      (await pool.query('SELECT id FROM immutable_sources WHERE id = $1', [sourceId])).rows
    ).toEqual([]);
    expect(
      (
        await pool.query('SELECT command_id FROM asset_commands WHERE application_id = $1', [
          'wallpaper',
        ])
      ).rows.length
    ).toBeGreaterThan(0);
  } finally {
    await cleanup.dispose();
    await sources.dispose();
    await lifecycle.dispose();
  }
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
    const retained = await pool.query(
      'SELECT due_at, status FROM source_cleanup WHERE asset_id=$1 ORDER BY id',
      [assetId]
    );
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
