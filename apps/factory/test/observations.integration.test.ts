import { observationStoreContract } from './fixtures/observation-contract.js';
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
          projectPriority: null,
          projectSize: null,
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

observationStoreContract('SQLite observations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-observe-contract-'));
  initializeState(directory);
  return {
    store: sqliteObservations(directory),
    close: () => rm(directory, { recursive: true, force: true }),
  };
});

it('reads a root intent retained after reader construction without a job runtime binding', async () => {
  const { sqliteLocalSnapshot, fileStore, fileScheduleStore } = await import(
    '../src/adapters/store/index.js'
  );
  const directory = await mkdtemp(join(tmpdir(), 'factory-local-snapshot-'));
  try {
    initializeState(directory);
    const reader = sqliteLocalSnapshot(directory);
    expect((await Effect.runPromise(reader.read())).entries).toEqual([]);
    const intent = {
      id: 'newly-retained',
      issue: 1,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
      base: 'a'.repeat(40),
      context: '',
      branch: 'worker',
      createdAt: 1,
      expectedStage: 'implementation' as const,
    };
    expect(await Effect.runPromise(fileStore(directory).reserve(intent))).toBe(true);
    expect(
      await Effect.runPromise(
        fileScheduleStore(directory).save({
          revision: 0,
          concurrency: 1,
          allowance: 1,
          paused: true,
          admissions: [{ issue: 1, base: intent.base, context: '' }],
        })
      )
    ).toBe(true);
    expect(await Effect.runPromise(reader.read())).toMatchObject({
      state: { admissions: [{ issue: 1 }] },
      entries: [{ intent, control: { cancelled: false } }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('publishes completed scheduler facts at their observation time without refreshing GitHub metadata', async () => {
  const { sqliteScheduleObservations } = await import('../src/adapters/store/index.js');
  const directory = await mkdtemp(join(tmpdir(), 'factory-schedule-observation-'));
  try {
    initializeState(directory);
    const store = sqliteObservations(directory);
    await Effect.runPromise(
      store.refresh({ startedAt: 10, failedAt: 20, error: 'github-offline' })
    );
    const publisher = sqliteScheduleObservations(directory, { now: () => Effect.succeed(30) });
    await Effect.runPromise(
      publisher.publish({
        state: { revision: 1, concurrency: 1, allowance: 1, paused: false, admissions: [] },
        jobs: [],
        recoveries: [
          {
            issue: 4,
            pr: 'https://github.com/rafaeltab/wallpaperdb/pull/104',
            progress: 'Awaiting answer',
            active: false,
            question: 'Approved scope?',
          },
        ],
      })
    );
    expect(await Effect.runPromise(store.read())).toMatchObject({
      failedAt: 20,
      error: 'github-offline',
      observedAt: undefined,
      facts: undefined,
      jobs: [],
      jobsObservedAt: 30,
      recoveries: [{ issue: 4, question: 'Approved scope?', active: false }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
