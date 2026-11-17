import { Deferred, Effect } from 'effect';
import { expect, it } from 'vitest';
import { completionFixture as fixture } from './fixtures/completion.js';
import { controlledStore } from './fixtures/store.js';
import { Unavailable } from '../src/capabilities/job/index.js';

it.each([false, true])(
  'interrupts cancelled work when provisional reporting fails %s',
  async (failed) => {
    let reportingFailed = false;
    const f = await fixture(3, controlledStore(), undefined, {
      begin: () => Effect.succeed(1),
      accepted: () => Effect.void,
      failed: () => Effect.void,
      observed: () =>
        reportingFailed
          ? Effect.fail(new Unavailable({ operation: 'report-observation', cause: 'buffer flush' }))
          : Effect.void,
    });
    try {
      const intent = await Effect.runPromise(f.store.read());
      if (!intent) throw new Error('Missing job');
      reportingFailed = failed;
      if (failed)
        await expect(f.cancel(intent.id)).rejects.toMatchObject({
          operation: 'report-observation',
        });
      else expect(await f.cancel(intent.id)).toMatchObject({ delivery: { activity: 'cancelled' } });
      expect(f.interrupts).toEqual(['owner']);
      expect(await Effect.runPromise(f.store.readControl())).toMatchObject({ cancelled: true });
    } finally {
      await f.close();
    }
  }
);

it.each([false, true])(
  'cancels during publication outage with retained PR %s',
  async (retained) => {
    const f = await fixture();
    try {
      for (let stage = 0; stage < 2; stage++) {
        f.state({ accepted: true, idle: true });
        await f.status();
      }
      const control = await Effect.runPromise(f.store.readControl());
      expect(control.ownership).not.toHaveProperty('prUrl', expect.anything());
      if (retained)
        await Effect.runPromise(
          f.store.saveControl({
            ...control,
            revision: control.revision + 1,
            ownership: {
              threadId: 'owner',
              prUrl: 'https://github.com/rafaeltab/wallpaperdb/pull/999',
            },
          })
        );
      const intent = await Effect.runPromise(f.store.read());
      if (!intent) throw new Error('Missing job');
      f.state({ publicationUnavailable: true });
      expect(await f.cancel(intent.id)).toMatchObject({ delivery: { activity: 'cancelled' } });
      expect(f.interrupts).toEqual(['owner']);
      expect(await Effect.runPromise(f.store.readControl())).toMatchObject({ cancelled: true });
    } finally {
      await f.close();
    }
  }
);

it('retains discovered publication ownership when receipt inspection fails', async () => {
  const f = await fixture();
  try {
    for (let stage = 0; stage < 2; stage++) {
      f.state({ accepted: true, idle: true });
      await f.status();
    }
    f.state({ inspectFailed: true, idle: true });
    await expect(f.status()).rejects.toMatchObject({ operation: 'inspect-stage' });
    expect(await Effect.runPromise(f.store.readControl())).toMatchObject({
      ownership: { threadId: 'owner', prUrl: 'https://github.com/rafaeltab/wallpaperdb/pull/999' },
    });
  } finally {
    await f.close();
  }
});

it('publishes observed terminal execution before receipt inspection fails', async () => {
  const observations: import('../src/capabilities/job/index.js').Status[] = [];
  const f = await fixture(3, controlledStore(), undefined, {
    begin: () => Effect.succeed(1),
    accepted: () => Effect.void,
    failed: () => Effect.void,
    observed: (_generation, status) =>
      Effect.sync(() => {
        observations.push(status);
      }),
  });
  try {
    observations.length = 0;
    f.state({ idle: true, inspectFailed: true });
    await expect(f.status()).rejects.toBeDefined();
    expect(observations).toContainEqual(
      expect.objectContaining({ execution: expect.objectContaining({ status: 'completed' }) })
    );
    expect(observations.every((s) => s.kind !== 'job' || !s.delivery?.ready)).toBe(true);
  } finally {
    await f.close();
  }
});

it('retains the exact incomplete checks in the owning implementation reconciliation without advancing to review', async () => {
  const f = await fixture();
  try {
    f.state({
      idle: true,
      rejection: { kind: 'checks-incomplete', checks: ['tests', 'coverage'] },
    });
    expect(await f.status()).toMatchObject({
      delivery: { progress: expect.stringContaining('tests, coverage') },
    });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]).toMatchObject({
      stage: 'implementation',
      reconciliationReason: { kind: 'checks-incomplete', checks: ['tests', 'coverage'] },
    });
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.pending).toMatchObject({
      reconciliationReason: { kind: 'checks-incomplete', checks: ['tests', 'coverage'] },
    });
    f.state({ accepted: true, idle: true, rejection: undefined });
    await f.status();
    expect(f.sends.at(-1)?.stage).toBe('review');
  } finally {
    await f.close();
  }
});

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
it.each([false, true])(
  'migrates retained legacy publication before evaluating current CI: failed=%s',
  async (failed) => {
    const f = await fixture();
    try {
      for (let stage = 0; stage < 3; stage++) {
        f.state({ accepted: true, idle: true });
        await f.status();
      }
      f.state({ accepted: false, idle: true, migrationRequired: true, ready: !failed, failed });
      expect(await f.status()).toMatchObject({
        delivery: { stage: 'publication', ready: false, activity: 'continuation-pending' },
      });
      await f.status();
      await f.status();
      expect(f.sends).toHaveLength(3);
      expect(f.sends.at(-1)).toMatchObject({
        index: 4,
        threadId: 'owner',
        stage: 'publication',
        reconciliation: 'migration',
      });
      expect((await Effect.runPromise(f.store.readControl())).reconciliation).toMatchObject({
        migrated: true,
        attempts: 0,
      });
      f.state({ accepted: true, idle: true, migrationRequired: false });
      expect(await f.status()).toMatchObject({
        delivery: { stage: failed ? 'babysitting' : 'ci', ready: !failed },
      });
    } finally {
      await f.close();
    }
  }
);
it('keeps retained CI migration unverified while busy and requires intervention after its single failed migration', async () => {
  const f = await fixture();
  try {
    for (let stage = 0; stage < 3; stage++) {
      f.state({ accepted: true, idle: true });
      await f.status();
    }
    f.state({ accepted: false, idle: false, migrationRequired: true, ready: true });
    expect(await f.status()).toMatchObject({ delivery: { stage: 'ci', ready: false } });
    expect(f.sends).toHaveLength(2);
    f.state({ idle: true });
    await f.status();
    await f.status();
    f.state({ idle: true });
    expect(await f.status()).toMatchObject({
      delivery: {
        activity: 'manual-recovery',
        progress: expect.stringContaining('migration failed'),
      },
    });
    await f.status();
    expect(f.sends).toHaveLength(3);
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(0);
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
    saveControl: (control, stage) =>
      store
        .saveControl(control, stage)
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

it('keeps the reconciliation slot when an overlapping authorization loses the control revision', async () => {
  const store = controlledStore();
  const gate = await Effect.runPromise(Deferred.make<void>());
  let armed = false;
  let arrivals = 0;
  const f = await fixture(2, {
    ...store,
    saveControl: (control, stage) =>
      Effect.gen(function* () {
        if (armed && control.reconciliation?.pending?.index === 1) {
          arrivals++;
          if (arrivals === 2) yield* Deferred.succeed(gate, undefined);
          yield* Deferred.await(gate);
        }
        return yield* store.saveControl(control, stage);
      }),
  });
  try {
    armed = true;
    f.state({ idle: true });
    const observations = await Promise.all([f.status(), f.status()]);
    for (const status of observations)
      expect(status).toMatchObject({
        delivery: { activity: 'continuation-pending', active: true },
      });
    expect((await Effect.runPromise(store.readControl())).reconciliation?.attempts).toBe(1);
    await f.status();
    expect(f.sends).toHaveLength(1);
  } finally {
    await f.close();
  }
});
it('reconciles a PR mismatch after migration with accepted local evidence and absent pending-format metadata', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, accepted: true });
    await f.status();
    f.state({ idle: true, accepted: true });
    await f.status();
    f.state({ idle: true, accepted: false, migrationRequired: true });
    await f.status();
    await f.status();
    f.state({ idle: true, accepted: true, migrationRequired: undefined, prCommit: 'c'.repeat(40) });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'continuation-pending', active: true },
    });
    expect((await Effect.runPromise(f.store.readControl())).reconciliation?.attempts).toBe(1);
    await f.status();
    expect(f.sends.at(-1)).toMatchObject({ stage: 'publication', reconciliation: 'state' });
  } finally {
    await f.close();
  }
});

it('does not spend a stale implementation attempt after a concurrent valid observation advances the stage', async () => {
  const store = controlledStore();
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  let armed = false;
  let gated = false;
  const f = await fixture(1, {
    ...store,
    saveControl: (control, stage) =>
      Effect.gen(function* () {
        if (armed && !gated && control.reconciliation?.pending?.index === 1) {
          gated = true;
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }
        return yield* store.saveControl(control, stage);
      }),
  });
  try {
    armed = true;
    f.state({ idle: true });
    const stale = f.status();
    await Effect.runPromise(Deferred.await(entered));
    f.state({ idle: true, accepted: true });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]?.stage).toBe('review');
    await Effect.runPromise(Deferred.succeed(release, undefined));
    expect(await stale).toMatchObject({
      delivery: { activity: 'continuation-pending', active: true },
    });
    expect((await Effect.runPromise(store.readControl())).reconciliation).toBeUndefined();
    expect(await Effect.runPromise(store.readStage(1))).toMatchObject({ stage: 'review' });
    f.state({ idle: true, accepted: false });
    expect(await f.status()).toMatchObject({
      reconciliation: { attempts: 1 },
      delivery: { activity: 'continuation-pending' },
    });
    await f.status();
    expect(f.sends).toHaveLength(2);
    expect(f.sends[1]).toMatchObject({ stage: 'review', reconciliation: 'state' });
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await f.close();
  }
});

it('carries the verified new comparison into review and publication without changing admission identity', async () => {
  const f = await fixture();
  try {
    const base = 'd'.repeat(40);
    f.state({ accepted: true, idle: true, base });
    await f.status();
    expect(f.sends.at(-1)).toMatchObject({ stage: 'review', acceptedBase: base });
    f.state({ accepted: true, idle: true });
    await f.status();
    expect(f.sends.at(-1)).toMatchObject({ stage: 'publication', acceptedBase: base });
    expect(await Effect.runPromise(f.store.read())).toMatchObject({ base: 'a'.repeat(40) });
  } finally {
    await f.close();
  }
});
it('withholds progression and reconciliation for an unexpected comparison', async () => {
  const f = await fixture();
  try {
    f.state({ idle: true, unexpectedBase: true });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'manual-recovery', active: false, ready: false },
    });
    expect(f.sends).toHaveLength(0);
  } finally {
    await f.close();
  }
});
