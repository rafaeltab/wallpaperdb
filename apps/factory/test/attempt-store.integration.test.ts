import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { Attempts, AttemptsLive, AttemptStore, Plan, IPlanner } from '../src/capabilities/plan/index.js';
import { Time } from '../src/capabilities/job/index.js';
import { expect, it } from 'vitest';
import { sqliteAttemptStore } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
it('persists typed attempts across reopen, excludes competitors and preserves immutable identity and deadline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-attempts-'));
  try {
    initializeState(directory);
    const store = sqliteAttemptStore(directory);
    const attempt = {
      id: randomUUID(),
      revision: 0,
      startedAt: 10,
      deadline: 130,
      phase: 'discovery' as const,
    };
    expect(await Effect.runPromise(store.create(attempt))).toBe(true);
    expect(await Effect.runPromise(sqliteAttemptStore(directory).get(attempt.id))).toEqual(attempt);
    expect(await Effect.runPromise(store.create({ ...attempt, id: randomUUID() }))).toBe(false);
    expect(await Effect.runPromise(store.save({ ...attempt, revision: 1, deadline: 131 }))).toBe(
      false
    );
    const done = {
      ...attempt,
      revision: 1,
      phase: 'failed' as const,
      finishedAt: 120,
      detail: 'Dependency failed',
    };
    expect(await Effect.runPromise(store.save(done))).toBe(true);
    expect(await Effect.runPromise(store.save({ ...done, detail: 'overwrite' }))).toBe(false);
    expect(
      await Effect.runPromise(
        store.create({ ...attempt, id: randomUUID(), startedAt: 140, deadline: 260 })
      )
    ).toBe(true);
    expect(await Effect.runPromise(sqliteAttemptStore(directory).get(attempt.id))).toEqual(done);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([1000, 900])(
  'finds the active row directly when its clock is %s, regardless of terminal row UUID order',
  async (startedAt) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-attempt-pending-'));
    try {
      initializeState(directory);
      const store = sqliteAttemptStore(directory);
      const old = {
        id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        revision: 0,
        startedAt: 1000,
        deadline: 121000,
        phase: 'discovery' as const,
      };
      await Effect.runPromise(store.create(old));
      await Effect.runPromise(
        store.save({ ...old, revision: 1, phase: 'failed', finishedAt: 1000 })
      );
      const next = { ...old, id: '00000000-0000-4000-8000-000000000000', startedAt };
      expect(await Effect.runPromise(store.create(next))).toBe(true);
      const reopened = sqliteAttemptStore(directory);
    const runtime = ManagedRuntime.make(AttemptsLive.pipe(Layer.provide(Layer.mergeAll(
      Layer.succeed(AttemptStore, reopened), Layer.succeed(Plan, { preview: () => Effect.die('pending must not plan') }), Layer.succeed(IPlanner, { ownership: () => Effect.succeed(undefined), propose: () => Effect.die('pending must not launch') }), Layer.succeed(Time, { now: () => Effect.succeed(1000) })
    )))));
    try { expect(await runtime.runPromise(Effect.flatMap(Attempts, attempts => attempts.pending()))).toEqual(next); }
    finally { await runtime.dispose(); }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('SQLite attempt storage satisfies the shared application contract', async () => {
  const { attemptStoreContract } = await import('./fixtures/attempt-store-contract.js');
  const directory = await mkdtemp(join(tmpdir(), 'factory-attempt-contract-'));
  try {
    initializeState(directory);
    await attemptStoreContract(sqliteAttemptStore(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
