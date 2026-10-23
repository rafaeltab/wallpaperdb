import { Effect, Layer, ManagedRuntime } from 'effect';
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
} from '../src/capabilities/creation/index.js';
import { workflowPostgresLayer } from '../src/adapters/workflow/index.js';
import { recoverConfirmation } from '../src/adapters/asset-workflow/index.js';
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
async function claim(runtime: ReturnType<typeof recoveryRuntime>) {
  const [p] = await runtime.runPromise(WorkflowDelivery.use((s) => s.claim()));
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
      { id: first.id, scope: 'outbox', reason: 'exhausted' },
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
