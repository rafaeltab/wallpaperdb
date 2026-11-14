import { Effect } from 'effect';
import { controlledStore } from './fixtures/store.js';
import { handbackContract } from './fixtures/handback-contract.js';
import { it } from 'vitest';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
import { scheduleContract } from './fixtures/schedule-contract.js';
it('controlled schedule journal satisfies durable reservation contract', async () => {
  const store = controlledScheduleStore();
  await scheduleContract(store, () => store);
});

it.each([false, true])(
  'guards allowance release with the current owning job revision and cancellation: %s',
  async (cancelled) => {
    const job = controlledStore();
    const schedule = controlledScheduleStore((issue, generation) => {
      const intent = Effect.runSync(job.read());
      const control = Effect.runSync(job.readControl());
      return intent && intent.issue === issue && (intent.generation ?? 0) === generation
        ? { jobId: intent.id, revision: control.revision, cancelled: control.cancelled }
        : undefined;
    });
    await handbackContract(schedule, job, () => schedule, cancelled);
  }
);
