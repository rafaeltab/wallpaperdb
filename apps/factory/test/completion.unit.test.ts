import { Deferred, Effect } from 'effect';
import { expect, it } from 'vitest';
import { completionFixture as fixture } from './fixtures/completion.js';
import { controlledStore } from './fixtures/store.js';

it('reconciles a failed idle state in the same job and spends a durable budget across stages', async () => {
  const f = await fixture(2);
  try {
    expect(f.sends).toHaveLength(0);
    f.state({ idle: true });
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]).toMatchObject({
      threadId: 'owner',
      stage: 'implementation',
      reconciliation: 'state',
    });
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(1);
    f.state({ accepted: true, idle: true });
    await f.status();
    expect(f.sends.at(-1)?.stage).toBe('review');
    f.state({ idle: true });
    await f.status();
    await f.status();
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(2);
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({
      delivery: {
        active: false,
        activity: 'manual-recovery',
        progress: expect.stringContaining('limit reached'),
      },
    });
  } finally {
    await f.close();
  }
});
it('migrates obsolete responses once without consuming reconciliation attempts', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, migrationRequired: true });
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]?.reconciliation).toBe('migration');
    expect((await Effect.runPromise(f.store.readControl())).reconciliation).toMatchObject({
      attempts: 0,
      migrated: true,
    });
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({
      delivery: {
        activity: 'manual-recovery',
        progress: expect.stringContaining('migration failed'),
      },
    });
    await f.status();
    expect(f.sends).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('accepts a freshly checked and reviewed publication head while hosted CI remains independent', async () => {
  const f = await fixture();
  try {
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true, commit: 'c'.repeat(40), prCommit: 'c'.repeat(40) });
    expect(await f.status()).toMatchObject({
      delivery: { stage: 'ci', commit: 'c'.repeat(40), ready: false },
    });
    f.state({ ready: true });
    expect(await f.status()).toMatchObject({ delivery: { ready: true } });
  } finally {
    await f.close();
  }
});
it('rejects a different PR head and asks the same agent to reconcile', async () => {
  const f = await fixture();
  try {
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true, commit: 'c'.repeat(40) });
    expect(await f.status()).toMatchObject({
      delivery: { ready: false, activity: 'continuation-pending' },
    });
    f.state({ accepted: false });
    await f.status();
    expect(f.sends.at(-1)).toMatchObject({
      stage: 'publication',
      reconciliation: 'state',
      threadId: 'owner',
    });
  } finally {
    await f.close();
  }
});
it('requires explicit revision-checked reset after budget exhaustion and preserves cancellation', async () => {
  const f = await fixture(1);
  try {
    f.state({ idle: true });
    await f.status();
    await f.status();
    f.state({ idle: true });
    const exhausted = await f.status();
    if (exhausted.kind !== 'job') throw new Error('Missing job');
    const control = await Effect.runPromise(f.store.readControl());
    const request = {
      jobId: exhausted.intent.id,
      index: exhausted.stageIndex!,
      runId: 'run-2',
      revision: control.revision,
      resetReconciliation: true,
    };
    expect(await f.resume({ ...request, revision: control.revision - 1 })).toEqual({
      kind: 'rejected',
    });
    await f.resume(request);
    await f.status();
    expect(f.sends).toHaveLength(2);
    f.state({ idle: true });
    await f.status();
    await f.cancel(exhausted.intent.id);
    const cancelled = await Effect.runPromise(f.store.readControl());
    expect(
      await f.resume({ ...request, index: f.sends.at(-1)!.index, revision: cancelled.revision })
    ).toEqual({ kind: 'rejected' });
    expect(f.sends).toHaveLength(2);
  } finally {
    await f.close();
  }
});
it('does not reconcile unverified or busy work even when checks failed', async () => {
  const f = await fixture();
  try {
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(0);
    expect((await Effect.runPromise(f.store.readControl())).reconciliation).toBeUndefined();
  } finally {
    await f.close();
  }
});
it('retains a lost reconciliation send claim without counting transport recovery again', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true });
    await f.status();
    f.state({ lost: true });
    await expect(f.status()).rejects.toMatchObject({ operation: 'deliver-stage-uncertain' });
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(1);
  } finally {
    await f.close();
  }
});
it('honors cancellation after authorizing reconciliation and before its send', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true });
    const status = await f.status();
    if (status.kind !== 'job') throw new Error('Missing job');
    await f.cancel(status.intent.id);
    await f.status();
    expect(f.sends).toHaveLength(0);
    expect(await f.status()).toMatchObject({ delivery: { activity: 'cancelled' } });
  } finally {
    await f.close();
  }
});
it('uses fresh completed stage evidence instead of reconciling an earlier running observation', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, accepted: true, observationStatus: 'running' });
    expect(await f.status()).toMatchObject({ delivery: { stage: 'review' } });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]?.reconciliation).toBeUndefined();
    expect((await Effect.runPromise(f.store.readControl())).reconciliation).toBeUndefined();
  } finally {
    await f.close();
  }
});
it('does not turn a dependency response into readiness through failed-babysitter recovery', async () => {
  const f = await fixture();
  try {
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true });
    await f.status();
    f.state({ accepted: true, idle: true });
    await f.status();
    await Effect.runPromise(
      f.store.saveStage({
        index: 4,
        stage: 'babysitting',
        threadId: 'owner',
        commit: 'b'.repeat(40),
        previousRunId: 'run-3',
        ordinal: 4,
      })
    );
    await Effect.runPromise(f.store.claimStage(4));
    f.state({
      accepted: false,
      idle: true,
      observationStatus: 'failed',
      run: 4,
      dependencies: ['758'],
      ready: true,
    });
    expect(await f.status()).toMatchObject({ delivery: { ready: false } });
  } finally {
    await f.close();
  }
});

it.each([
  { status: 'failed', attempts: 0 },
  { status: 'interrupted', attempts: 0 },
  { status: 'failed', attempts: 2 },
  { status: 'interrupted', attempts: 2 },
])(
  'observes successful CI before idle $status reconciliation with $attempts attempts spent',
  async ({ status, attempts }) => {
    const f = await fixture(2);
    try {
      for (let stage = 0; stage < 3; stage++) {
        f.state({ accepted: true, idle: true });
        await f.status();
      }
      await Effect.runPromise(
        f.store.saveStage({
          index: 4,
          stage: 'babysitting',
          threadId: 'owner',
          commit: 'b'.repeat(40),
          previousRunId: 'run-3',
          ordinal: 4,
        })
      );
      await Effect.runPromise(f.store.claimStage(4));
      const control = await Effect.runPromise(f.store.readControl());
      await Effect.runPromise(
        f.store.saveControl({
          ...control,
          revision: control.revision + 1,
          reconciliation: { attempts, migrated: false },
        })
      );
      f.state({ accepted: false, idle: true, observationStatus: status, run: 4, ready: true });
      const sends = f.sends.length;
      for (let observation = 0; observation < 2; observation++)
        expect(await f.status()).toMatchObject({
          resume: undefined,
          delivery: { stage: 'ci', ready: true, active: false },
        });
      expect(f.sends).toHaveLength(sends);
      expect((await Effect.runPromise(f.store.readControl())).reconciliation).toEqual({
        attempts,
        migrated: false,
      });
      expect(await Effect.runPromise(f.store.readStage(5))).toBeNull();
    } finally {
      await f.close();
    }
  }
);

it('charges one reconciliation when overlapping observations authorize the same instruction', async () => {
  const store = controlledStore();
  const associated = await Effect.runPromise(Deferred.make<void>());
  const authorized = await Effect.runPromise(Deferred.make<void>());
  let bindings = 0;
  let overlapping = false;
  const f = await fixture(2, {
    ...store,
    bindRun: (request, runId, ordinal) =>
      Effect.gen(function* () {
        const bound = yield* store.bindRun(request, runId, ordinal);
        if (!overlapping || request.index !== 0) return bound;
        bindings++;
        if (bindings === 1) yield* Deferred.await(associated);
        else {
          yield* Deferred.succeed(associated, undefined);
          yield* Deferred.await(authorized);
        }
        return bound;
      }),
    saveControl: (control) =>
      store
        .saveControl(control)
        .pipe(
          Effect.tap((saved) =>
            saved && control.reconciliation?.pending
              ? Deferred.succeed(authorized, undefined)
              : Effect.void
          )
        ),
  });
  try {
    overlapping = true;
    f.state({ idle: true });
    await Promise.all([f.status(), f.status()]);
    expect((await Effect.runPromise(store.readControl())).reconciliation?.attempts).toBe(1);
    await f.status();
    expect(f.sends).toHaveLength(1);
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({ delivery: { activity: 'continuation-pending' } });
    expect((await Effect.runPromise(store.readControl())).reconciliation?.attempts).toBe(2);
    await f.status();
    expect(f.sends).toHaveLength(2);
  } finally {
    await f.close();
  }
});
it.each([undefined, true])(
  'requires intervention after a migration without a supported response: %s',
  async (migrationRequired) => {
    const f = await fixture();
    try {
      f.state({ idle: true, migrationRequired: true });
      await f.status();
      await f.status();
      f.state({ idle: true, migrationRequired });
      expect(await f.status()).toMatchObject({
        delivery: {
          activity: 'manual-recovery',
          active: false,
          progress: expect.stringContaining('migration failed'),
        },
      });
      await f.status();
      expect(f.sends).toHaveLength(1);
      expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(0);
    } finally {
      await f.close();
    }
  }
);
it('reconciles a supported negative state after migration using the ordinary budget', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, migrationRequired: true });
    await f.status();
    await f.status();
    f.state({ idle: true, migrationRequired: false });
    expect(await f.status()).toMatchObject({ delivery: { activity: 'continuation-pending' } });
    await f.status();
    expect(f.sends.map((request) => request.reconciliation)).toEqual(['migration', 'state']);
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(1);
  } finally {
    await f.close();
  }
});
