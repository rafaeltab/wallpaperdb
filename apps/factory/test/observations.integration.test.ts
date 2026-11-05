import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { sqliteObservations } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';
it('migrates observation tables and retains last complete facts and dates on failure across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-observe-'));
  try {
    initializeState(directory);
    const store = sqliteObservations(directory);
    expect(await Effect.runPromise(store.read())).toEqual({});
    const facts = {
      issues: [
        {
          number: 1,
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
          title: 'Full title',
          open: true,
          candidate: true,
          labels: ['ready-for-agent'],
          assignees: ['rafaeltab'],
          projectStatus: null,
          commentCount: 2,
          blockers: [2],
          parents: [3],
          pullRequests: [],
        },
      ],
      pullRequests: [],
    };
    await Effect.runPromise(store.refresh({ startedAt: 10, observedAt: 20, facts }));
    await Effect.runPromise(
      store.refresh({ startedAt: 30, failedAt: 40, error: 'github-observations' })
    );
    expect(await Effect.runPromise(sqliteObservations(directory).read())).toMatchObject({
      startedAt: 30,
      observedAt: 20,
      failedAt: 40,
      error: 'github-observations',
      facts,
    });
    await Effect.runPromise(
      store.refresh({ startedAt: 50, observedAt: 60, facts: { issues: [], pullRequests: [] } })
    );
    expect(await Effect.runPromise(store.read())).toMatchObject({
      observedAt: 60,
      error: undefined,
      facts: { issues: [], pullRequests: [] },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
