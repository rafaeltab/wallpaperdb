import { it } from 'vitest';
import { controlledScheduleStore } from './fixtures/schedule-store.js';
import { scheduleContract } from './fixtures/schedule-contract.js';
it('controlled schedule journal satisfies durable reservation contract', async () => {
  const store = controlledScheduleStore();
  await scheduleContract(store, () => store);
});
