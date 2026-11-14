import { Effect } from 'effect';
import { expect } from 'vitest';
import type { JobStore } from '../../src/capabilities/job/index.js';
import type { ScheduleStore } from '../../src/capabilities/plan/index.js';

export async function handbackContract(
  schedule: ScheduleStore,
  job: JobStore,
  reopen: () => ScheduleStore,
  cancelled: boolean
) {
  const admission = { issue: 758, generation: 1, base: 'a'.repeat(40), context: 'Agreed scope' };
  await Effect.runPromise(
    job.reserve({
      ...admission,
      id: 'owned',
      branch: 'factory/owned',
      createdAt: 1,
      expectedStage: 'implementation',
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/758',
    })
  );
  await Effect.runPromise(job.saveControl({ revision: 0, cancelled: false, claimed: [] }));
  const initial = {
    revision: 0,
    concurrency: 1,
    allowance: 1,
    paused: false,
    admissions: [admission],
  };
  expect(await Effect.runPromise(schedule.save(initial))).toBe(true);
  const released = {
    ...initial,
    revision: 1,
    admissions: [],
    released: [{ admission, jobId: 'owned' }],
  };
  const guard = { issue: 758, generation: 1, jobId: 'owned', controlRevision: 0 };
  expect(await Effect.runPromise(schedule.save(released, [guard, guard]))).toBe(false);
  expect(await Effect.runPromise(schedule.save(released, [{ ...guard, jobId: 'unrelated' }]))).toBe(
    false
  );
  expect(await Effect.runPromise(schedule.save(released, [{ ...guard, generation: 0 }]))).toBe(
    false
  );
  await Effect.runPromise(job.saveControl({ revision: 1, cancelled, claimed: [] }));
  expect(await Effect.runPromise(schedule.save(released, [guard]))).toBe(false);
  expect(await Effect.runPromise(reopen().read())).toEqual(initial);
  expect(await Effect.runPromise(schedule.save(released, [{ ...guard, controlRevision: 1 }]))).toBe(
    !cancelled
  );
  expect(await Effect.runPromise(reopen().read())).toEqual(cancelled ? initial : released);
  expect(await Effect.runPromise(reopen().save(released, [guard]))).toBe(false);
  if (!cancelled) {
    const terminal = await Effect.runPromise(job.readControl());
    expect(terminal.released).toBe(true);
    expect(
      await Effect.runPromise(
        job.saveControl({
          ...terminal,
          revision: terminal.revision + 1,
          reconciliation: { attempts: 0, migrated: false },
        })
      )
    ).toBe(false);
    expect(await Effect.runPromise(job.claimStage(20))).toBe(false);
  }
}
