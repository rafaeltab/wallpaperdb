import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { scheduleContract } from './fixtures/schedule-contract.js';
it('durably reserves and compares revisions across independent filesystem store instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-schedule-'));
  try {
    await scheduleContract(fileScheduleStore(directory), () => fileScheduleStore(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
