import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  Creation,
  creationLayer,
  WorkflowStore,
  WorkflowDelivery,
  type Wallpaper,
  type WorkflowPublication,
} from '../src/capabilities/creation/index.js';
import { workflowPostgresLayer } from '../src/adapters/workflow/index.js';
import { decodeConfirmation, recoverConfirmation } from '../src/adapters/asset-workflow/index.js';
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
beforeEach(async () => {
  await pool.query(
    'TRUNCATE wallpaper_workflow_quarantine, wallpaper_workflow_outbox, wallpaper_intents'
  );
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
    expect(alerts).toEqual([
      { id: first.id, scope: 'outbox', reason: 'exhausted', quarantineId: expect.any(String) },
    ]);
    expect(
      await runtime.runPromise(WorkflowStore.use((s) => s.begin(wallpaper.owner, wallpaper.key)))
    ).toMatchObject({ attentionRequired: true });
    const [alert] = alerts;
    if (!alert) throw new Error('Expected outbox notice');
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(alert)));
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

it('preserves pure transition defects after rollback and keeps database failures typed', async () => {
  const runtime = recoveryRuntime();
  const defect = new Error('unique-wallpaper-transition-defect');
  const owner = { namespace: 'authors', subject: 'defect-owner' };
  try {
    const wallpaper = await runtime.runPromise(WorkflowStore.use((s) => s.begin(owner, 'defect')));
    const exit = await runtime.runPromiseExit(
      WorkflowStore.use((s) =>
        s.change({ kind: 'wallpaper', id: wallpaper.id }, (current) => {
          if (!current) throw new Error('Missing Wallpaper');
          current.assetId = 'must-not-commit';
          throw defect;
        })
      )
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error('Expected transition defect');
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.squash(exit.cause)).toBe(defect);
    expect(await runtime.runPromise(WorkflowStore.use((s) => s.list(owner)))).toEqual([wallpaper]);
    const pending = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
    expect(pending.map((p) => p.id)).toEqual([wallpaper.creationEventId]);

    await pool.query(
      'ALTER TABLE wallpaper_intents ADD CONSTRAINT reject_test_asset CHECK (asset_id IS NULL)'
    );
    try {
      const failure = await runtime.runPromise(
        WorkflowStore.use((s) =>
          s.change({ kind: 'wallpaper', id: wallpaper.id }, (current) => {
            if (!current) throw new Error('Missing Wallpaper');
            return { wallpaper: { ...current, assetId: 'rejected-by-database' }, result: true };
          })
        ).pipe(Effect.flip)
      );
      expect(failure).toMatchObject({ _tag: 'WorkflowFailure', operation: 'transition' });
      expect(await runtime.runPromise(WorkflowStore.use((s) => s.list(owner)))).toEqual([
        wallpaper,
      ]);
      expect(await pool.query('SELECT id FROM wallpaper_workflow_outbox')).toMatchObject({
        rows: [{ id: wallpaper.creationEventId }],
      });
    } finally {
      await pool.query('ALTER TABLE wallpaper_intents DROP CONSTRAINT reject_test_asset');
    }
  } finally {
    await runtime.dispose();
  }
});

function recoveryRuntime(maxAttempts = 1) {
  return ManagedRuntime.make(
    creationLayer('authors').pipe(
      Layer.provideMerge(
        workflowPostgresLayer({
          databaseUrl: databaseUrl(),
          maxAttempts,
          retryDelayMs: 0,
          leaseMs: 60_000,
        })
      )
    )
  );
}
it.each([
  'transition',
  'complete',
  'cancellation',
])('owns a checked-out client through %s and continues on a fresh client', async (operation) => {
  const url = new URL(databaseUrl());
  const application = `wallpaper-disconnect-${operation}`;
  url.searchParams.set('application_name', application);
  const runtime = ManagedRuntime.make(
    workflowPostgresLayer({
      databaseUrl: url.toString(),
      maxAttempts: 3,
      retryDelayMs: 0,
      leaseMs: 60_000,
    })
  );
  const owner = { namespace: 'authors', subject: application };
  const blocker = await pool.connect();
  const cancellation = new AbortController();
  let pending: ReturnType<typeof runtime.runPromiseExit> | undefined;
  try {
    const wallpaper = await runtime.runPromise(WorkflowStore.use((s) => s.begin(owner, 'loss')));
    const publication = await claim(runtime);
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM wallpaper_intents WHERE id=$1 FOR UPDATE', [wallpaper.id]);
    pending = runtime.runPromiseExit(
      operation !== 'complete'
        ? WorkflowStore.use((s) =>
            s.change({ kind: 'wallpaper', id: wallpaper.id }, (current) => {
              if (!current) throw new Error('Expected Wallpaper');
              return { wallpaper: { ...current, assetId: 'must-not-commit' }, result: undefined };
            })
          )
        : WorkflowDelivery.use((s) => s.complete(publication)),
      { signal: cancellation.signal }
    );
    let pid: number | undefined;
    await expect
      .poll(async () => {
        const result = await pool.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [application]
        );
        pid = result.rows[0]?.pid;
        return pid !== undefined;
      })
      .toBe(true);
    if (pid === undefined) throw new Error('Expected blocked Wallpaper backend');
    if (operation === 'cancellation') cancellation.abort();
    else
      expect(
        (await pool.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows
      ).toEqual([{ terminated: true }]);
    const result = await pending;
    expect(Exit.isFailure(result)).toBe(true);
    if (!Exit.isFailure(result)) throw new Error('Expected connection failure');
    expect(Cause.hasDies(result.cause)).toBe(false);
    if (operation === 'cancellation') expect(Cause.hasInterrupts(result.cause)).toBe(true);
    else expect(Cause.squash(result.cause)).toMatchObject({ _tag: 'WorkflowFailure', operation });
    // The server can observe the closed socket once the blocked query resumes.
    await blocker.query('ROLLBACK');
    await expect
      .poll(
        async () => (await pool.query('SELECT pid FROM pg_stat_activity WHERE pid=$1', [pid])).rows
      )
      .toEqual([]);
    expect(await runtime.runPromise(WorkflowStore.use((s) => s.list(owner)))).toEqual([wallpaper]);
    expect(
      (await pool.query('SELECT id, status, lease_id FROM wallpaper_workflow_outbox')).rows
    ).toEqual([{ id: publication.id, status: 'leased', lease_id: publication.leaseId }]);
    await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.change({ kind: 'wallpaper', id: wallpaper.id }, (current) => {
          if (!current) throw new Error('Expected Wallpaper');
          return { wallpaper: { ...current, assetId: 'fresh-client' }, result: undefined };
        })
      )
    );
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(publication)));
    expect(await runtime.runPromise(WorkflowStore.use((s) => s.list(owner)))).toEqual([
      { ...wallpaper, assetId: 'fresh-client', attentionRequired: false },
    ]);
    expect((await pool.query('SELECT id, status FROM wallpaper_workflow_outbox')).rows).toEqual([
      { id: publication.id, status: 'published' },
    ]);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
    await runtime.dispose();
  }
});
function resultEvent(w: Wallpaper) {
  return {
    specversion: '1.0',
    id: `result:${w.id}`,
    source: 'https://wallpaperdb/asset',
    type: 'asset.command.result',
    time: w.createdAt,
    datacontenttype: 'application/json',
    causationsource: 'https://wallpaperdb/wallpaper',
    causationid: w.creationEventId,
    correlationid: w.id,
    traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    data: {
      commandId: w.commandId,
      applicationReference: w.id,
      outcome: 'created',
      assetId: `asset:${w.id}`,
    },
  };
}
function sourceEvent(w: Wallpaper) {
  return {
    ...resultEvent(w),
    id: `source:${w.id}`,
    type: 'asset.source.accepted',
    causationsource: 'https://wallpaperdb/asset/authors',
    causationid: 'accept-command',
    correlationid: 'intent',
    data: {
      assetId: `asset:${w.id}`,
      assetType: 'wallpaper',
      candidateId: 'candidate',
      sourceId: 'source',
      defaultSourceId: 'source',
      initialAnalysisSourceId: 'source',
      sourceSetRevision: '1',
      deliveryRevision: '1',
    },
  };
}
const quarantineId = (id: string) => createHash('sha256').update(id).digest('hex');
it('fences stale notification acknowledgement across deliberate recovery and renewed exhaustion', async () => {
  let runtime = recoveryRuntime();
  try {
    const wallpaper = await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.begin({ namespace: 'authors', subject: 'stale-notice' }, 'request')
      )
    );
    const first = await claim(runtime);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(first)));
    const [alert] = await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()));
    if (!alert || alert.scope !== 'outbox') throw new Error('Expected first outbox notice');
    expect(
      await runtime.runPromise(WorkflowStore.use((s) => s.begin(wallpaper.owner, wallpaper.key)))
    ).toMatchObject({ attentionRequired: true });
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([alert]);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(first.id)))).toBe(true);
    const occurrence = (
      await pool.query('SELECT quarantine_id FROM wallpaper_workflow_outbox WHERE id=$1', [
        first.id,
      ])
    ).rows[0]?.quarantine_id;
    expect(occurrence).not.toBe(alert.quarantineId);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(first.id)))).toBe(false);
    expect(
      (
        await pool.query('SELECT quarantine_id FROM wallpaper_workflow_outbox WHERE id=$1', [
          first.id,
        ])
      ).rows[0]?.quarantine_id
    ).toBe(occurrence);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(alert)));
    expect(
      (
        await pool.query('SELECT notified_at FROM wallpaper_workflow_outbox WHERE id=$1', [
          first.id,
        ])
      ).rows[0]?.notified_at
    ).toBeNull();
    const renewed = await claim(runtime);
    expect(renewed).toMatchObject({ id: first.id, event: first.event, attempts: 0 });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(renewed)));
    const [later] = await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()));
    expect(later).toEqual({ ...alert, quarantineId: occurrence });
    if (!later) throw new Error('Expected renewed outbox notice');
    await runtime.dispose();
    runtime = recoveryRuntime();
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([later]);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(alert)));
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([later]);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(later)));
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([]);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(first.id)))).toBe(true);
    const completed = await claim(runtime);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(completed)));
    await runtime.runPromise(WorkflowDelivery.use((s) => s.alerted(later)));
    expect(
      (
        await pool.query('SELECT status, notified_at FROM wallpaper_workflow_outbox WHERE id=$1', [
          first.id,
        ])
      ).rows
    ).toEqual([{ status: 'published', notified_at: null }]);
  } finally {
    await runtime.dispose();
  }
});
async function claim<R>(runtime: ManagedRuntime.ManagedRuntime<R | WorkflowDelivery, never>) {
  let publications: readonly WorkflowPublication[] = [];
  await expect
    .poll(
      async () => {
        publications = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
        return publications.length;
      },
      { timeout: 1000 }
    )
    .toBe(1);
  const [p] = publications;
  if (!p) throw new Error('Expected publication claim');
  return p;
}
async function read(runtime: ReturnType<typeof recoveryRuntime>, w: Wallpaper) {
  return (await runtime.runPromise(Creation.use((c) => c.list(w.owner)))).find(
    (item) => item.id === w.id
  );
}
async function attach(runtime: ReturnType<typeof recoveryRuntime>, w: Wallpaper) {
  await runtime.runPromise(
    Creation.use((c) =>
      c.assetResult({
        wallpaperId: w.id,
        commandId: w.commandId,
        creationEventId: w.creationEventId,
        outcome: 'created',
        assetId: `asset:${w.id}`,
      })
    )
  );
}
async function publish(runtime: ReturnType<typeof recoveryRuntime>, w: Wallpaper) {
  await attach(runtime, w);
  await runtime.runPromise(
    Creation.use((c) =>
      c.expectSource(w.owner, w.id, { candidateId: 'candidate', intentId: 'intent' })
    )
  );
  await runtime.runPromise(
    Creation.use((c) =>
      c.sourceAccepted({
        assetId: `asset:${w.id}`,
        candidateId: 'candidate',
        intentId: 'intent',
        sourceId: 'source',
        defaultSourceId: 'source',
        initialAnalysisSourceId: 'source',
        occurrenceId: `source:${w.id}`,
      })
    )
  );
}
it('closes completed confirmation recovery without reopening recovered redelivery or losing other obligations', async () => {
  const runtime = recoveryRuntime();
  try {
    const w = await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.begin({ namespace: 'authors', subject: 'completed-confirmations' }, 'request')
      )
    );
    const command = await claim(runtime);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(command)));
    await publish(runtime, w);
    const published = await claim(runtime);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(published)));
    const events = [resultEvent(w), sourceEvent(w)];
    for (const event of events)
      await runtime.runPromise(
        WorkflowDelivery.use((s) =>
          s.quarantine(event.id, JSON.stringify(event), 'confirmation-exhausted', {
            kind: 'wallpaper',
            id: w.id,
          })
        )
      );
    expect(await read(runtime, w)).toMatchObject({ state: 'published', attentionRequired: true });
    expect(await runtime.runPromise(recoverConfirmation(quarantineId(events[0].id)))).toBe(true);
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    expect(await runtime.runPromise(recoverConfirmation(quarantineId(events[1].id)))).toBe(true);
    expect(await read(runtime, w)).toMatchObject({
      state: 'published',
      sourceId: 'source',
      initialAnalysisSourceId: 'source',
      attentionRequired: false,
    });
    for (const event of events)
      await runtime.runPromise(
        WorkflowDelivery.use((s) =>
          s.quarantine(event.id, JSON.stringify(event), 'confirmation-exhausted', {
            kind: 'wallpaper',
            id: w.id,
          })
        )
      );
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: false });
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([]);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()))).toEqual([]);
  } finally {
    await runtime.dispose();
  }
});

it.each([
  'asset-create',
  'publication',
])('reconciles recovered %s completion only for the current lease', async (destination) => {
  const runtime = recoveryRuntime();
  try {
    const w = await runtime.runPromise(
      WorkflowStore.use((s) =>
        s.begin({ namespace: 'authors', subject: destination }, 'request', {
          traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
        })
      )
    );
    let original = await claim(runtime);
    if (destination === 'publication') {
      await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(original)));
      await publish(runtime, w);
      original = await claim(runtime);
    } else await attach(runtime, w); // Asset applied a command whose acknowledgement was lost.
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(original)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(original.id)))).toBe(
      true
    );
    const recovered = await claim(runtime);
    expect(recovered).toMatchObject({
      id: original.id,
      event: original.event,
      destination: original.destination,
    });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(original)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(recovered)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: false });
  } finally {
    await runtime.dispose();
  }
});
it('counts abandoned claims across restart, fences stale leases and recovers the original occurrence', async () => {
  let runtime = recoveryRuntime(2);
  try {
    const w = await runtime.runPromise(
      WorkflowStore.use((s) => s.begin({ namespace: 'authors', subject: 'abandoned' }, 'request'))
    );
    const first = await claim(runtime);
    await runtime.dispose();
    await pool.query('UPDATE wallpaper_workflow_outbox SET available_at=$1 WHERE id=$2', [
      new Date(0),
      first.id,
    ]);
    runtime = recoveryRuntime(2);
    const second = await claim(runtime);
    expect(second).toMatchObject({ id: first.id, event: first.event, attempts: 1 });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(first)));
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(first)));
    await runtime.dispose();
    await pool.query('UPDATE wallpaper_workflow_outbox SET available_at=$1 WHERE id=$2', [
      new Date(0),
      first.id,
    ]);
    runtime = recoveryRuntime(2);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()))).toEqual([]);
    expect(await runtime.runPromise(WorkflowDelivery.use((s) => s.alerts()))).toEqual([
      { id: first.id, scope: 'outbox', reason: 'exhausted', quarantineId: expect.any(String) },
    ]);
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(first.id)));
    const recovered = await claim(runtime);
    expect(recovered).toMatchObject({ id: first.id, event: first.event, attempts: 0 });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(second)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(recovered)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: false });
  } finally {
    await runtime.dispose();
  }
});

it('preserves quarantined and recovered unfinished outbox obligations while closing confirmations', async () => {
  const runtime = recoveryRuntime();
  try {
    const w = await runtime.runPromise(
      WorkflowStore.use((s) => s.begin({ namespace: 'authors', subject: 'other-duty' }, 'request'))
    );
    const original = await claim(runtime);
    await attach(runtime, w);
    await runtime.runPromise(WorkflowDelivery.use((s) => s.failed(original)));
    const event = resultEvent(w);
    await runtime.runPromise(
      WorkflowDelivery.use((s) =>
        s.quarantine(event.id, JSON.stringify(event), 'confirmation-exhausted', {
          kind: 'wallpaper',
          id: w.id,
        })
      )
    );
    await runtime.runPromise(recoverConfirmation(quarantineId(event.id)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.recover(original.id)));
    const recovered = await claim(runtime);
    const other = { ...event, id: 'other-result' };
    await runtime.runPromise(
      WorkflowDelivery.use((s) =>
        s.quarantine(other.id, JSON.stringify(other), 'confirmation-exhausted', {
          kind: 'wallpaper',
          id: w.id,
        })
      )
    );
    await runtime.runPromise(recoverConfirmation(quarantineId(other.id)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: true });
    await runtime.runPromise(WorkflowDelivery.use((s) => s.complete(recovered)));
    expect(await read(runtime, w)).toMatchObject({ attentionRequired: false });
  } finally {
    await runtime.dispose();
  }
});
it('skips an independently locked Wallpaper while claiming another Wallpaper', async () => {
  const runtime = recoveryRuntime();
  const holder = await pool.connect();
  try {
    const owner = { namespace: 'authors', subject: 'locking' };
    const first = await runtime.runPromise(WorkflowStore.use((s) => s.begin(owner, 'one')));
    const second = await runtime.runPromise(WorkflowStore.use((s) => s.begin(owner, 'two')));
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM wallpaper_intents WHERE id=$1 FOR UPDATE', [first.id]);
    const claims = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
    expect(claims.map((p) => p.wallpaperId)).toEqual([second.id]);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
    await runtime.dispose();
  }
});

it('retains concurrent first-Source registrations across restart and atomically publishes the confirmed first Default once', async () => {
  const layer = () =>
    creationLayer('authors').pipe(
      Layer.provideMerge(
        workflowPostgresLayer({
          databaseUrl: databaseUrl(),
          maxAttempts: 3,
          retryDelayMs: 1,
          leaseMs: 20,
        })
      )
    );
  let runtime = ManagedRuntime.make(layer());
  const owner = { namespace: 'authors', subject: 'concurrent-initial-owner' };
  try {
    const result = await runtime.runPromise(
      Creation.use((c) => c.begin(owner, 'concurrent-initial'))
    );
    if (result.kind !== 'wallpaper') throw new Error('Expected Wallpaper');
    const w = result.wallpaper;
    await runtime.runPromise(
      Creation.use((c) =>
        c.assetResult({
          wallpaperId: w.id,
          commandId: w.commandId,
          creationEventId: w.creationEventId,
          outcome: 'created',
          assetId: 'asset-concurrent-initial',
        })
      )
    );
    await Promise.all(
      ['one', 'two'].map((id) =>
        runtime.runPromise(
          Creation.use((c) =>
            c.expectSource(owner, w.id, {
              candidateId: `candidate-${id}`,
              intentId: `intent-${id}`,
            })
          )
        )
      )
    );
    await runtime.dispose();
    runtime = ManagedRuntime.make(layer());
    const raw = {
      specversion: '1.0',
      id: 'accepted-first-default',
      source: 'https://wallpaperdb/asset',
      type: 'asset.source.accepted',
      time: '2026-10-23T00:00:00Z',
      datacontenttype: 'application/json',
      causationsource: 'https://wallpaperdb/asset/authors',
      causationid: 'author-accept',
      correlationid: 'intent-one',
      data: {
        assetId: 'asset-concurrent-initial',
        assetType: 'wallpaper',
        candidateId: 'candidate-one',
        sourceId: 'source-one',
        defaultSourceId: 'source-one',
        initialAnalysisSourceId: 'source-one',
        sourceSetRevision: '1',
        deliveryRevision: '1',
      },
    };
    const decoded = decodeConfirmation(new TextEncoder().encode(JSON.stringify(raw)));
    if (decoded.kind !== 'source') throw new Error('Invalid protected confirmation');
    expect(
      (
        await Promise.all(
          [1, 2, 3].map(() =>
            runtime.runPromise(Creation.use((c) => c.sourceAccepted(decoded.confirmation)))
          )
        )
      ).sort()
    ).toEqual(['applied', 'ignored', 'ignored']);
    expect(await runtime.runPromise(Creation.use((c) => c.get(owner, w.id)))).toMatchObject({
      wallpaper: {
        state: 'published',
        assetId: 'asset-concurrent-initial',
        sourceId: 'source-one',
      },
    });
    const publications = await runtime.runPromise(WorkflowDelivery.use((d) => d.claim()));
    expect(
      publications.filter((p) => p.wallpaperId === w.id && p.destination === 'publication')
    ).toHaveLength(1);
  } finally {
    await runtime.dispose();
  }
});
