import { Effect } from 'effect';
import { expect, it } from 'vitest';
import type {
  ObservationStore,
  ReportingStore,
  Facts,
} from '../../src/capabilities/observe/index.js';
const facts: Facts = {
  issues: [
    {
      number: 1,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
      title: 'Complete issue',
      open: true,
      candidate: true,
      labels: ['ready-for-agent'],
      assignees: ['rafaeltab'],
      projectStatus: 'Todo',
      projectPriority: 'P1',
      projectSize: 'S',
      commentCount: 4,
      blockers: [],
      parents: [],
      pullRequests: [],
    },
  ],
  pullRequests: [],
};
export function observationStoreContract(
  name: string,
  open: () => Promise<{ store: ObservationStore; close(): Promise<void> }>
) {
  it(`${name} starts with unknown external data`, async () => {
    const { store, close } = await open();
    try {
      expect(await Effect.runPromise(store.read())).toEqual({});
    } finally {
      await close();
    }
  });
  it(`${name} preserves useful facts and original dates on failed refresh, then clears failure on recovery`, async () => {
    const { store, close } = await open();
    try {
      await Effect.runPromise(store.refresh({ startedAt: 10, observedAt: 20, facts }));
      await Effect.runPromise(store.refresh({ startedAt: 30 }));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        startedAt: 30,
        observedAt: 20,
        facts,
      });
      await Effect.runPromise(store.refresh({ startedAt: 30, failedAt: 40, error: 'offline' }));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 20,
        failedAt: 40,
        error: 'offline',
        facts,
      });
      await Effect.runPromise(
        store.refresh({ startedAt: 50, observedAt: 60, facts: { issues: [], pullRequests: [] } })
      );
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 60,
        error: undefined,
        failedAt: undefined,
        facts: { issues: [], pullRequests: [] },
      });
    } finally {
      await close();
    }
  });
  it(`${name} dates worker observations independently of GitHub facts`, async () => {
    const { store, close } = await open();
    try {
      await Effect.runPromise(store.refresh({ startedAt: 10, observedAt: 20, facts }));
      await Effect.runPromise(store.jobs([{ kind: 'empty' }], 30, []));
      expect(await Effect.runPromise(store.read())).toMatchObject({
        observedAt: 20,
        jobsObservedAt: 30,
        jobs: [{ kind: 'empty' }],
        recoveries: [],
        facts,
      });
    } finally {
      await close();
    }
  });
}

export function reportingStoreContract(
  name: string,
  open: () => Promise<{ store: ObservationStore & ReportingStore; close(): Promise<void> }>
) {
  it(`${name} commits complete items independently, rejects delayed versions and retains success dates on failure`, async () => {
    const { store, close } = await open();
    try {
      const older = await Effect.runPromise(store.begin());
      const newer = await Effect.runPromise(store.begin());
      const issue = facts.issues[0];
      if (!issue) throw new Error('Missing issue fixture');
      await Effect.runPromise(
        store.publish(newer, [
          { kind: 'issue', value: { ...issue, title: 'New title' }, sequence: 1, at: 20 },
        ])
      );
      expect(await Effect.runPromise(store.read())).toMatchObject({
        facts: { issues: [{ title: 'New title' }] },
        items: { 'issue:1': { observedAt: 20 } },
      });
      await Effect.runPromise(
        store.publish(older, [{ kind: 'issue', value: issue, sequence: 99, at: 30 }])
      );
      await Effect.runPromise(
        store.publish(newer, [
          { kind: 'issue', value: { ...issue, number: 2 }, sequence: 2, at: 30 },
          { kind: 'failure', key: 'issue:1', error: 'offline', sequence: 2, at: 40 },
        ])
      );
      expect(await Effect.runPromise(store.read())).toMatchObject({
        facts: { issues: [{ title: 'New title' }, { number: 2 }] },
        items: {
          'issue:1': { observedAt: 20, failedAt: 40, error: 'offline' },
          'issue:2': { observedAt: 30 },
        },
      });
      await Effect.runPromise(
        store.publish(newer, [{ kind: 'issue', value: issue, sequence: 1, at: 50 }])
      );
      expect((await Effect.runPromise(store.read())).facts?.issues[0]?.title).toBe('New title');
    } finally {
      await close();
    }
  });
  it(`${name} requires authoritative completion for removal and rejects late items after membership replacement`, async () => {
    const { store, close } = await open();
    try {
      const older = await Effect.runPromise(store.begin());
      const newer = await Effect.runPromise(store.begin());
      const issue = facts.issues[0];
      if (!issue) throw new Error('Missing fixture');
      await Effect.runPromise(
        store.publish(newer, [
          { kind: 'issue', value: { ...issue, title: 'New' }, sequence: 1, at: 20 },
        ])
      );
      await Effect.runPromise(
        store.refresh({
          generation: older,
          observedAt: 30,
          facts: { issues: [], pullRequests: [] },
        })
      );
      expect((await Effect.runPromise(store.read())).facts?.issues).toMatchObject([
        { title: 'New' },
      ]);
      const latest = await Effect.runPromise(store.begin());
      await Effect.runPromise(
        store.refresh({
          generation: latest,
          observedAt: 40,
          facts: { issues: [], pullRequests: [] },
        })
      );
      await Effect.runPromise(store.begin());
      await Effect.runPromise(
        store.publish(newer, [{ kind: 'issue', value: issue, sequence: 3, at: 50 }])
      );
      expect((await Effect.runPromise(store.read())).facts?.issues).toEqual([]);
    } finally {
      await close();
    }
  });
  it(`${name} preserves newer acknowledged stages and relative run identity independently of collection completion order`, async () => {
    const { store, close } = await open();
    const intent = {
      id: 'job-one',
      issue: 1,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
      base: 'a'.repeat(40),
      branch: 'worker',
      context: '',
      createdAt: 0,
      expectedStage: 'implementation' as const,
    };
    const job = {
      kind: 'job' as const,
      intent,
      elapsedMs: 10,
      stageIndex: 1,
      execution: { kind: 'ambiguous' as const },
      acknowledgement: { index: 1, stage: 'review' as const, acceptedAt: 10 },
      delivery: { stage: 'review' as const, commit: intent.base, ready: false, landed: false },
    };
    try {
      const older = await Effect.runPromise(store.begin());
      const newer = await Effect.runPromise(store.begin());
      await Effect.runPromise(
        store.publish(newer, [{ kind: 'job', value: job, sequence: 1, at: 10 }])
      );
      await Effect.runPromise(
        store.publish(older, [
          { kind: 'job', value: { ...job, stageIndex: 0 }, sequence: 99, at: 20 },
        ])
      );
      const later = await Effect.runPromise(store.begin());
      await Effect.runPromise(
        store.publish(later, [
          { kind: 'job', value: { ...job, stageIndex: 0 }, sequence: 1, at: 20 },
        ])
      );
      expect((await Effect.runPromise(store.read())).jobs).toMatchObject([
        { stageIndex: 1, acknowledgement: { index: 1 } },
      ]);
      const execution = {
        kind: 'found' as const,
        threadId: 'thread',
        status: 'running',
        worktree: '/worker',
        branch: 'worker',
        model: 'gpt-6.1-sol',
        run: { id: 'run-8', ordinal: 8 },
      };
      await Effect.runPromise(
        store.publish(later, [{ kind: 'job', value: { ...job, execution }, sequence: 2, at: 30 }])
      );
      const latest = await Effect.runPromise(store.begin());
      for (const run of [
        { id: 'run-7', ordinal: 7 },
        { id: 'other-8', ordinal: 8 },
      ]) {
        await Effect.runPromise(
          store.publish(latest, [
            {
              kind: 'job',
              value: { ...job, execution: { ...execution, run } },
              sequence: 1,
              at: 40,
            },
          ])
        );
      }
      expect((await Effect.runPromise(store.read())).jobs).toMatchObject([
        { execution: { run: { id: 'run-8', ordinal: 8 } } },
      ]);
      await Effect.runPromise(store.jobs([], 50));
      expect((await Effect.runPromise(store.read())).jobs).toMatchObject([
        { intent: { id: 'job-one' } },
      ]);
    } finally {
      await close();
    }
  });
}
