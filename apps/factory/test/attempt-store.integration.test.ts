import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import {
  Attempts,
  AttemptsLive,
  AttemptStore,
  Plan,
  IPlanner,
} from '../src/capabilities/plan/index.js';
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
      const runtime = ManagedRuntime.make(
        AttemptsLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(AttemptStore, reopened),
              Layer.succeed(Plan, { preview: () => Effect.die('pending must not plan') }),
              Layer.succeed(IPlanner, {
                ownership: () => Effect.succeed(undefined),
                propose: () => Effect.die('pending must not launch'),
              }),
              Layer.succeed(Time, { now: () => Effect.succeed(1000) })
            )
          )
        )
      );
      try {
        expect(
          await runtime.runPromise(Effect.flatMap(Attempts, (attempts) => attempts.pending()))
        ).toEqual(next);
      } finally {
        await runtime.dispose();
      }
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

it('persists a validated successful advisory result across reopen and refuses corrupt stored results without repairing them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-attempt-result-'));
  try {
    initializeState(directory);
    const store = sqliteAttemptStore(directory);
    const attempt = {
      id: randomUUID(),
      revision: 0,
      startedAt: 100,
      deadline: 120100,
      phase: 'discovery' as const,
    };
    await Effect.runPromise(store.create(attempt));
    const result = {
      kind: 'preview' as const,
      selected: [{ issue: 42, reason: 'Thin experiment', includeCodeFromIssues: [] }],
      rejected: [{ issue: 43, reason: 'Unsettled API' }],
      input: {
        issues: [
          {
            number: 42,
            title: 'Synthetic issue',
            blockers: [40],
            parents: [10],
            recovery: {
              progress: 'Parked',
              active: false,
              classification: 'SIMPLE' as const,
              threadId: 'synthetic-thread',
              question: 'Which interface?',
            },
          },
        ],
      },
    };
    const done = { ...attempt, revision: 1, phase: 'succeeded' as const, finishedAt: 500, result };
    expect(await Effect.runPromise(store.save(done))).toBe(true);
    expect(await Effect.runPromise(sqliteAttemptStore(directory).get(attempt.id))).toEqual(done);
    expect(await Effect.runPromise(store.pending())).toBeUndefined();
    const { default: Database } = await import('better-sqlite3');
    const client = new Database(join(directory, 'factory.sqlite'));
    const legacy = JSON.stringify({
      ...result,
      selected: [
        { issue: 42, reason: 'Original advisory choice', dependsOn: [40], conflicts: [43] },
      ],
    });
    client.prepare('UPDATE planning_attempts SET result = ? WHERE id = ?').run(legacy, attempt.id);
    const historical = await Effect.runPromise(sqliteAttemptStore(directory).get(attempt.id));
    expect(historical?.result?.selected).toEqual([]);
    expect(historical?.result?.rejected).toContainEqual({
      issue: 42,
      reason:
        'Historical advisory selection: Original advisory choice. Dependencies: 40. Conflicts: 43. No execution authority.',
    });
    expect(
      client.prepare('SELECT result FROM planning_attempts WHERE id = ?').get(attempt.id)
    ).toEqual({ result: legacy });
    const corrupt = JSON.stringify({
      ...result,
      selected: [{ issue: -1, reason: 'Invalid stored selection', includeCodeFromIssues: [] }],
    });
    try {
      client
        .prepare('UPDATE planning_attempts SET result = ? WHERE id = ?')
        .run(corrupt, attempt.id);
    } finally {
      client.close();
    }
    await expect(
      Effect.runPromise(sqliteAttemptStore(directory).get(attempt.id))
    ).rejects.toMatchObject({ _tag: 'Unavailable', operation: 'attempt-store' });
    const inspected = new Database(join(directory, 'factory.sqlite'));
    try {
      expect(
        inspected.prepare('SELECT result FROM planning_attempts WHERE id = ?').get(attempt.id)
      ).toEqual({ result: corrupt });
    } finally {
      inspected.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  { revision: 1, phase: 'discovery' as const },
  { revision: 0, phase: 'freshness' as const },
])(
  'rejects noninitial creation $phase/$revision without consuming the active slot',
  async (invalid) => {
    const directory = await mkdtemp(join(tmpdir(), 'factory-attempt-invalid-'));
    try {
      initializeState(directory);
      const store = sqliteAttemptStore(directory);
      const initial = {
        id: randomUUID(),
        revision: 0,
        startedAt: 100,
        deadline: 120100,
        phase: 'discovery' as const,
      };
      await expect(
        Effect.runPromise(store.create({ ...initial, ...invalid }))
      ).rejects.toMatchObject({ _tag: 'Unavailable', operation: 'attempt-store' });
      expect(await Effect.runPromise(store.pending())).toBeUndefined();
      expect(await Effect.runPromise(store.get(initial.id))).toBeUndefined();
      expect(await Effect.runPromise(store.create(initial))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
