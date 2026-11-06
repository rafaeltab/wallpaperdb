import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer, type FactoryV2Snapshot } from '../src/http/index.js';
import {
  makeBoard,
  BoardStore,
  BoardCommands,
  type BoardRecord,
  type CommandRecord,
} from '../src/capabilities/board/index.js';
import { Time } from '../src/capabilities/job/index.js';
import { liveV2Data } from '../src/http/index.js';
import type { ScheduleSnapshot } from '../src/capabilities/observe/index.js';

const initial: ScheduleSnapshot = {
  state: { revision: -1, paused: true, concurrency: 1, allowance: 3, admissions: [] },
  jobs: [],
  localWork: [],
  observations: { state: 'initial', stale: false },
};
const job = {
  status: () => Effect.succeed({ kind: 'empty' as const }),
  start: () => Effect.succeed({ kind: 'rejected' as const }),
  resume: () => Effect.succeed({ kind: 'rejected' as const }),
  cancel: () => Effect.succeed({ kind: 'rejected' as const }),
};
it('serves a stable live board with explicit unavailable provider evidence without provider calls on reads', async () => {
  const board = await liveBoard({ scopeId: 'test', initial, now: () => 1000 });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const first = await app.inject('/api/v2/board');
    expect(first.statusCode).toBe(200);
    const snapshot = first.json<FactoryV2Snapshot>();
    expect(snapshot.meta).toMatchObject({
      dataMode: 'live',
      coverage: { state: 'unavailable' },
      factory: { paused: true, admission: { consumed: 0 } },
    });
    expect(snapshot.entities.sources['source:github']).toMatchObject({
      observedAt: null,
      refresh: 'unavailable',
    });
    expect((await app.inject('/api/v2/board')).body).toBe(first.body);
    expect(
      (await app.inject({ url: '/api/v2/board', headers: { 'if-none-match': first.headers.etag } }))
        .statusCode
    ).toBe(304);
    expect(
      (
        await app.inject(`/api/v2/board/changes?after=${encodeURIComponent(snapshot.cursor)}`)
      ).json()
    ).toEqual({ kind: 'unchanged', cursor: snapshot.cursor });
    expect((await app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
  } finally {
    await app.close();
  }
});

it('publishes real issue and PR facts atomically with stable card identities and explicit head-only evidence', async () => {
  const board = await liveBoard({ scopeId: 'test', initial, now: () => 1000 });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await board.publish({
      ...initial,
      observations: {
        state: 'current',
        stale: false,
        observedAt: 2000,
        facts: {
          issues: [
            {
              number: 1,
              url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
              title: 'Implement board',
              open: true,
              candidate: true,
              labels: ['ready-for-agent'],
              assignees: [],
              projectStatus: 'Planned',
              projectPriority: 'P0',
              projectSize: 'S',
              commentCount: 0,
              blockers: [2],
              parents: [9],
              pullRequests: [],
              updatedAt: '2026-11-06T12:00:00Z',
              labelDetails: [{ id: 'L1', name: 'ready-for-agent', color: 'abcdef' }],
              assigneeDetails: [],
              projectDetails: {
                projectId: 'P1',
                status: { id: 'S1', name: 'Planned', rank: null },
                priority: { id: 'O1', name: 'P0', rank: 0 },
                size: { id: 'O2', name: 'S', rank: 1 },
              },
              nativeBlockers: [2],
              nativeParent: 9,
            },
          ],
          pullRequests: [
            {
              number: 42,
              url: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
              state: 'OPEN',
              head: 'a'.repeat(40),
              headBranch: 'feature',
              base: 'b'.repeat(40),
              baseBranch: 'main',
              linkedIssues: [1],
              crossReferencedIssues: [],
              review: 'REVIEW_REQUIRED',
              ci: 'SUCCESS',
              evidenceHead: 'a'.repeat(40),
              title: 'Board API',
              draft: false,
              updatedAt: '2026-11-06T12:00:00Z',
              mergeability: 'MERGEABLE',
              labelDetails: [],
              checkRuns: [
                {
                  id: 'C1',
                  name: 'typecheck',
                  state: 'passed',
                  url: null,
                  head: 'a'.repeat(40),
                  startedAt: null,
                  completedAt: null,
                },
              ],
              reviewers: [],
            },
          ],
        },
      },
    });
    const after = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(after.entities.issues['issue:rafaeltab/wallpaperdb/1'].metadata).toMatchObject({
      state: 'known',
      value: { title: 'Implement board', labelIds: ['label:L1'] },
    });
    expect(after.entities.issues['issue:rafaeltab/wallpaperdb/2'].metadata.state).toBe('unknown');
    const pr = after.entities.pullRequests['pr:rafaeltab/wallpaperdb/42'];
    expect(pr.metadata).toMatchObject({
      state: 'known',
      value: { title: 'Board API', draft: false },
    });
    expect(pr.checks).toMatchObject({
      state: 'known',
      value: {
        comparison: { headOid: 'a'.repeat(40), baseOid: null },
        groups: [{ name: 'typecheck', requirement: 'unknown' }],
      },
    });
    expect(pr.readiness.state).toBe('unknown');
    const cards = Object.values(after.entities.items);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      section: 'in-review',
      attention: { state: 'required' },
      subject: { kind: 'pull-request', metadataIssueId: 'issue:rafaeltab/wallpaperdb/1' },
    });
    const delta = (
      await app.inject(`/api/v2/board/changes?after=${encodeURIComponent(before.cursor)}`)
    ).json();
    expect(delta).toMatchObject({
      kind: 'changes',
      batches: [{ fromCursor: before.cursor, toCursor: after.cursor }],
    });
    expect(after.meta.coverage.state).toBe('partial');
  } finally {
    await app.close();
  }
});

it('retains the projection across restart and durably deduplicates commands before checking stale preconditions', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { sqliteBoard } = await import('../src/adapters/store/index.js');
  const directory = await mkdtemp(join(tmpdir(), 'factory-v2-'));
  let configured = 0;
  const store = sqliteBoard(directory);
  const commands = {
    execute: () =>
      Effect.sync(() => {
        configured++;
        return { state: 'succeeded' as const, result: null, reasons: [] };
      }),
  };
  const create = async () => {
    const board = await liveBoard({
      scopeId: 'test',
      initial,
      store,
      commands,
      now: () => 1000,
      run: Effect.runPromise,
    });
    return {
      board,
      app: operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board }),
    };
  };
  try {
    const first = await create();
    const snapshot = (await first.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const configure = Object.values(snapshot.entities.actions).find((a) => a.kind === 'configure');
    if (configure?.availability.state !== 'available') throw new Error('Configure unavailable');
    const command = {
      commandId: '00000000-0000-4000-8000-000000000001',
      actionId: configure.id,
      precondition: configure.availability.precondition,
      kind: 'configure',
      payload: {
        paused: false,
        concurrency: { kind: 'limited', maximum: 1 },
        admissionAllowance: { kind: 'limited', maximum: 3 },
      },
    };
    const accepted = await first.app.inject({
      method: 'POST',
      url: '/api/v2/commands',
      payload: command,
    });
    expect(accepted.statusCode).toBe(202);
    await first.board.idle();
    expect((await first.app.inject(`/api/v2/commands/${command.commandId}`)).json()).toMatchObject({
      state: 'succeeded',
    });
    await first.app.close();
    const second = await create();
    try {
      expect((await second.app.inject('/api/v2/board')).json().cursor).toBe(snapshot.cursor);
      expect(
        (await second.app.inject({ method: 'POST', url: '/api/v2/commands', payload: command }))
          .statusCode
      ).toBe(200);
      expect(configured).toBe(1);
      expect(
        (
          await second.app.inject({
            method: 'POST',
            url: '/api/v2/commands',
            payload: { ...command, payload: { ...command.payload, paused: true } },
          })
        ).json()
      ).toMatchObject({ code: 'id-reused' });
      expect(
        (
          await second.app.inject({
            method: 'POST',
            url: '/api/v2/commands',
            payload: {
              ...command,
              commandId: '00000000-0000-4000-8000-000000000002',
              precondition: 'old',
            },
          })
        ).json()
      ).toMatchObject({ code: 'stale-action' });
    } finally {
      await second.app.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function liveBoard(config: {
  scopeId: string;
  initial: ScheduleSnapshot;
  now?: () => number;
  store?: BoardStore;
  commands?: BoardCommands;
  run?: typeof Effect.runPromise;
}) {
  let saved: BoardRecord | undefined;
  const records = new Map<string, CommandRecord>();
  const store = config.store ?? {
    read: () => Effect.succeed(saved),
    save: (record: BoardRecord) =>
      Effect.sync(() => {
        saved = record;
      }),
    command: (id: string) => Effect.succeed(records.get(id)),
    accept: (record: CommandRecord) =>
      Effect.sync(() => {
        if (records.has(record.request.commandId)) return false;
        records.set(record.request.commandId, record);
        return true;
      }),
    finish: (record: CommandRecord) =>
      Effect.sync(() => {
        records.set(record.request.commandId, record);
      }),
    commands: () => Effect.succeed([...records.values()]),
  };
  const board = await Effect.runPromise(
    makeBoard(config).pipe(
      Effect.provideService(BoardStore, store),
      Effect.provideService(
        BoardCommands,
        config.commands ?? {
          execute: () => Effect.succeed({ state: 'rejected', result: null, reasons: [] }),
        }
      ),
      Effect.provideService(Time, { now: () => Effect.succeed(config.now?.() ?? 1000) })
    )
  );
  let pending: Promise<void> | undefined;
  const data = liveV2Data(board, Effect.runPromise, () => {
    pending ??= Effect.runPromise(board.processPending()).finally(() => {
      pending = undefined;
    });
  });
  return {
    ...data,
    publish: (input: ScheduleSnapshot) => Effect.runPromise(board.publish(input)),
    idle: () => pending ?? Promise.resolve(),
  };
}
