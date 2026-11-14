import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import { completionFixture } from './fixtures/completion.js';

it('recovers the pending reconciliation once and retains exhaustion across fresh runtimes and stores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-completion-restart-'));
  let f = await completionFixture(1, fileStore(directory));
  try {
    f.state({ idle: true });
    const pending = await f.status();
    expect(pending).toMatchObject({ reconciliation: { attempts: 1, limit: 1 } });
    expect(f.sends).toHaveLength(0);
    await f.close();
    f = await completionFixture(1, fileStore(directory));
    f.state({ idle: true });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]).toMatchObject({
      stage: 'implementation',
      reconciliation: 'state',
      threadId: 'owner',
    });
    await f.close();
    f = await completionFixture(1, fileStore(directory));
    f.state({ idle: true, run: 2 });
    const exhausted = await f.status();
    expect(exhausted).toMatchObject({
      reconciliation: { attempts: 1, limit: 1 },
      delivery: { active: false, activity: 'manual-recovery' },
    });
    expect(f.sends).toHaveLength(0);
    const control = await Effect.runPromise(fileStore(directory).readControl());
    expect(control.reconciliation?.pending?.index).toBe(1);
    if (exhausted.kind !== 'job' || exhausted.stageIndex === undefined)
      throw new Error('Missing retained job');
    await f.resume({
      jobId: exhausted.intent.id,
      index: exhausted.stageIndex,
      runId: 'run-2',
      revision: control.revision,
      resetReconciliation: true,
    });
    await f.status();
    expect(f.sends).toHaveLength(1);
    expect(
      (await Effect.runPromise(fileStore(directory).readControl())).reconciliation?.attempts
    ).toBe(1);
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains handback responsibility through restart without resending the instruction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-handback-restart-'));
  let f = await completionFixture(3, fileStore(directory));
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    await f.status();
    expect(f.sends).toHaveLength(1);
    await f.close();
    f = await completionFixture(3, fileStore(directory));
    f.state({ idle: true, run: 2, dependencies: ['758'], handbackVerified: true });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'dependency-handback', active: false },
    });
    expect(f.sends).toHaveLength(0);
    expect(await Effect.runPromise(fileStore(directory).read())).toMatchObject({ issue: 757 });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('invalidates completed handback when a concurrent observation supersedes its verification revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-handback-supersede-'));
  const original = fileStore(directory);
  let interleave = false;
  let arm = false;
  let nested:
    | Awaited<ReturnType<Awaited<ReturnType<typeof completionFixture>>['status']>>
    | undefined;
  let owner: Awaited<ReturnType<typeof completionFixture>> | undefined;
  const store = {
    ...original,
    readControl: () =>
      Effect.gen(function* () {
        // A port read may capture a valid snapshot while another public operation
        // commits before that read returns. No private read-count assumption.
        const snapshot = yield* original.readControl();
        const currentOwner = owner;
        if (interleave && currentOwner) {
          interleave = false;
          currentOwner.state({ idle: true, dependencies: ['759'], handbackVerified: true });
          nested = yield* Effect.promise(() => currentOwner.status());
        }
        return snapshot;
      }),
  };
  const f = await completionFixture(3, store, () =>
    Effect.sync(() => {
      if (arm) {
        arm = false;
        interleave = true;
      }
    })
  );
  owner = f;
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    await f.status();
    arm = true;
    f.state({ idle: true, handbackVerified: true });
    const outer = await f.status();
    expect(nested).toMatchObject({ delivery: { activity: 'continuation-pending' } });
    expect(f.sends.map((request) => request.handback)).toEqual([['758'], ['759']]);
    expect(outer).not.toMatchObject({ delivery: { activity: 'dependency-handback' } });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('retires the old Job with its refund so later observations cannot deliver another handback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-handback-retired-'));
  const f = await completionFixture(3, fileStore(directory));
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    await f.status();
    f.state({ idle: true, handbackVerified: true });
    const completed = await f.status();
    if (completed.kind !== 'job' || completed.delivery?.handbackRevision === undefined)
      throw new Error('Missing verified handback authority');
    const schedule = fileScheduleStore(directory);
    const admission = {
      issue: completed.intent.issue,
      base: completed.intent.base,
      context: completed.intent.context,
    };
    const initial = {
      revision: 0,
      concurrency: 1,
      allowance: 1,
      paused: false,
      admissions: [admission],
    };
    expect(await Effect.runPromise(schedule.save(initial))).toBe(true);
    expect(
      await Effect.runPromise(
        schedule.save(
          {
            ...initial,
            revision: 1,
            admissions: [],
            released: [{ admission, jobId: completed.intent.id }],
          },
          [
            {
              issue: completed.intent.issue,
              jobId: completed.intent.id,
              controlRevision: completed.delivery.handbackRevision,
            },
          ]
        )
      )
    ).toBe(true);
    f.state({ idle: true, dependencies: ['759'] });
    expect(await f.status()).toMatchObject({
      delivery: { activity: 'dependency-handback', active: false },
    });
    expect(f.sends.map((request) => request.handback)).toEqual([['758']]);
    expect(await f.cancel(completed.intent.id)).toEqual({ kind: 'rejected' });
    expect(await Effect.runPromise(f.store.read())).toMatchObject({
      id: completed.intent.id,
      context: admission.context,
    });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects old handback evidence when association completion overlaps a newer instruction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-handback-association-'));
  const original = fileStore(directory);
  let armed = false;
  let owner: Awaited<ReturnType<typeof completionFixture>> | undefined;
  let nested:
    | Awaited<ReturnType<Awaited<ReturnType<typeof completionFixture>>['status']>>
    | undefined;
  const store = {
    ...original,
    bindRun: (
      request: import('../src/capabilities/job/index.js').StageRequest,
      runId: string,
      ordinal?: number
    ) =>
      Effect.gen(function* () {
        const bound = yield* original.bindRun(request, runId, ordinal);
        const currentOwner = owner;
        if (bound && armed && currentOwner) {
          armed = false;
          currentOwner.state({ idle: true, dependencies: ['759'], handbackVerified: true });
          nested = yield* Effect.promise(() => currentOwner.status());
        }
        return bound;
      }),
  };
  const f = await completionFixture(3, store);
  owner = f;
  try {
    f.state({ idle: true, dependencies: ['758'] });
    await f.status();
    await f.status();
    f.state({ idle: true, handbackVerified: true });
    armed = true;
    const outer = await f.status();
    expect(nested).toMatchObject({ delivery: { activity: 'continuation-pending', active: true } });
    expect(f.sends.map((request) => request.handback)).toEqual([['758'], ['759']]);
    expect(outer).not.toMatchObject({ delivery: { activity: 'dependency-handback' } });
  } finally {
    await f.close();
    await rm(directory, { recursive: true, force: true });
  }
});
