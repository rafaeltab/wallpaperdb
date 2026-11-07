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
import { Time, Unavailable } from '../src/capabilities/job/index.js';
import { liveV2Data } from '../src/http/index.js';
import type { ScheduleSnapshot } from '../src/capabilities/observe/index.js';
import { AttemptStore, IPlanner, type PlanningAttempt } from '../src/capabilities/plan/index.js';

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
it('exposes T3 metadata with evidenced issue associations without turning independent threads into jobs', async () => {
  const board = await liveBoard({
    scopeId: 'test',
    initial: {
      ...initial,
      threads: {
        state: 'current',
        stale: false,
        observedAt: 1000,
        browserOrigin: 'https://t3.example.invalid',
        facts: {
          environmentId: 'environment-one',
          projectId: 'project-one',
          threads: [
            {
              threadId: 'owned-thread',
              title: 'Issue 461 implementation',
              createdAt: '2026-11-09T12:00:00Z',
              updatedAt: '2026-11-09T12:05:00Z',
              status: 'completed',
              branch: null,
              worktree: null,
              pullRequests: [],
              associationState: 'evidenced',
              associations: [{ issue: 461, evidence: 'factory-binding', observedAt: 1000 }],
            },
            {
              threadId: 'independent-thread',
              title: 'Discuss issue 461',
              createdAt: null,
              updatedAt: null,
              status: 'running',
              branch: null,
              worktree: null,
              pullRequests: [],
              associationState: 'absent',
            },
            {
              threadId: 'conflicting-thread',
              title: 'Conflicting context',
              createdAt: null,
              updatedAt: null,
              status: 'completed',
              branch: null,
              worktree: null,
              pullRequests: [],
              associationState: 'conflicting',
              associations: [
                { issue: 461, evidence: 'factory-binding', observedAt: 1000 },
                { issue: 250, evidence: 'github-closing-reference', observedAt: 1000 },
              ],
            },
          ],
        },
      },
    },
  });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const response = await app.inject('/api/v2/board');
    expect(response.statusCode).toBe(200);
    const snapshot = response.json<FactoryV2Snapshot>();
    expect(snapshot.entities.threads['thread:environment-one/owned-thread']).toMatchObject({
      metadata: {
        state: 'known',
        value: {
          title: 'Issue 461 implementation',
          createdAt: '2026-11-09T12:00:00Z',
          updatedAt: '2026-11-09T12:05:00Z',
          status: 'completed',
          environmentId: 'environment-one',
          threadId: 'owned-thread',
          webUrl: 'https://t3.example.invalid/environment-one/owned-thread',
          nativeUrl: 't3code://threads/environment-one/owned-thread',
        },
      },
      association: {
        state: 'confirmed',
        issueIds: ['issue:rafaeltab/wallpaperdb/461'],
        pullRequestIds: [],
        evidence: 'factory-binding',
      },
    });
    expect(
      snapshot.entities.threads['thread:environment-one/independent-thread'].association
    ).toEqual({
      state: 'absent',
      reasons: [],
    });
    expect(
      snapshot.entities.threads['thread:environment-one/conflicting-thread'].association
    ).toEqual({
      state: 'ambiguous',
      reasons: [],
    });
    expect(snapshot.entities.issues['issue:rafaeltab/wallpaperdb/461'].metadata.state).toBe(
      'unknown'
    );
    expect(snapshot.entities.jobs).toEqual({});
    expect(snapshot.meta.factory.admission.consumed).toBe(0);
  } finally {
    await app.close();
  }
});
it.each([
  { error: () => new Error('private-cause'), status: 500, type: 'generic-server' },
  {
    error: () => new Unavailable({ operation: 'private-operation', cause: 'private-cause' }),
    status: 503,
    type: 'factory-unavailable',
  },
])(
  'translates live read failure to $status $type without diagnostic disclosure',
  async (scenario) => {
    const board = await liveBoard({ scopeId: 'test', initial });
    let broken = false;
    const app = operationsServer({
      base: 'a'.repeat(40),
      run: Effect.runPromise,
      job,
      v2: {
        ...board,
        snapshot: (headers) => {
          if (broken) throw scenario.error();
          return board.snapshot(headers);
        },
      },
    });
    try {
      expect((await app.inject('/api/v2/board')).statusCode).toBe(200);
      broken = true;
      const response = await app.inject('/api/v2/board');
      expect(response.statusCode).toBe(scenario.status);
      expect(response.json()).toMatchObject({
        status: scenario.status,
        code: 'unavailable',
        type: `https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/${scenario.type}.md`,
      });
      expect(response.body).not.toContain('private');
    } finally {
      await app.close();
    }
  }
);
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

it.each([false, true])(
  'reports an in-flight metadata refresh with historical failure=%s',
  async (historical) => {
    const board = await liveBoard({
      scopeId: 'refresh-state',
      now: () => 300100,
      initial: {
        ...initial,
        observations: {
          state: 'loading',
          stale: historical,
          startedAt: 300000,
          ...(historical
            ? { observedAt: 1000, failedAt: 2000, error: 'historical-private-error' }
            : {}),
        },
      },
    });
    const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
    try {
      const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      expect(snapshot.entities.sources['source:github']).toMatchObject({
        refresh: 'refreshing',
        observedAt: historical ? new Date(1000).toISOString() : null,
        lastAttemptAt: new Date(300000).toISOString(),
        nextAttemptAt: null,
      });
      expect(snapshot.entities.sources['source:github'].failure?.code ?? null).toBe(
        historical ? 'provider-unavailable' : null
      );
      expect(JSON.stringify(snapshot)).not.toContain('historical-private-error');
    } finally {
      await app.close();
    }
  }
);

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
  autoExecute?: boolean;
  attempts?: AttemptStore;
  planner?: IPlanner;
  initialPlan?: import('../src/capabilities/board/index.js').BoardPlan;
}) {
  let saved: BoardRecord | undefined;
  const records = new Map<string, CommandRecord>();
  const store = config.store ?? {
    read: () => Effect.succeed(saved),
    save: (record: BoardRecord, expectedCursor: string | null) =>
      Effect.sync(() => {
        if ((saved?.snapshot.cursor ?? null) !== expectedCursor) return false;
        saved = record;
        return true;
      }),
    command: (id: string) => Effect.succeed(records.get(id)),
    accept: (record: CommandRecord) =>
      Effect.sync(() => {
        if (records.has(record.request.commandId)) return false;
        records.set(record.request.commandId, record);
        return true;
      }),
    claim: (record: CommandRecord) =>
      Effect.sync(() => {
        const prior = records.get(record.request.commandId);
        if (prior?.receipt.state !== 'accepted') return false;
        records.set(record.request.commandId, record);
        return true;
      }),
    finish: (record: CommandRecord) =>
      Effect.sync(() => {
        records.set(record.request.commandId, record);
      }),
    interruptPending: (reason) =>
      Effect.sync(() => {
        for (const [id, record] of records)
          if (record.receipt.state === 'accepted' || record.receipt.state === 'running')
            records.set(id, {
              ...record,
              receipt: {
                ...record.receipt,
                version: `${record.receipt.version}-restart`,
                state: 'uncertain',
                reasons: [reason],
              },
            });
      }),
    planBasis: (id) =>
      Effect.succeed(
        [...records.values()].find(
          (r) => r.receipt.result && 'planId' in r.receipt.result && r.receipt.result.planId === id
        )?.basis ?? undefined
      ),
  };
  const build = makeBoard({ ...config, epoch: 'test' }).pipe(
    Effect.provideService(BoardStore, store),
    Effect.provideService(
      BoardCommands,
      config.commands ?? {
        execute: () => Effect.succeed({ state: 'rejected', result: null, reasons: [] }),
      }
    ),
    Effect.provideService(Time, { now: () => Effect.succeed(config.now?.() ?? 1000) })
  );
  const withAttempts = config.attempts
    ? build.pipe(Effect.provideService(AttemptStore, config.attempts))
    : build;
  const board = await Effect.runPromise(
    config.planner
      ? withAttempts.pipe(Effect.provideService(IPlanner, config.planner))
      : withAttempts
  );
  let pending: Promise<void> | undefined;
  const data = liveV2Data(board, Effect.runPromise, () => {
    if (config.autoExecute === false) return;
    pending ??= Effect.runPromise(board.processPending()).finally(() => {
      pending = undefined;
    });
  });
  return {
    ...data,
    publish: (
      input: ScheduleSnapshot,
      plan?: import('../src/capabilities/board/index.js').BoardPlan
    ) => Effect.runPromise(board.publish(input, plan)),
    idle: () => pending ?? Promise.resolve(),
    execute: () => Effect.runPromise(board.processPending()),
  };
}

it('searches the local issue index with generation-bound pages and publishes advisory plan details', async () => {
  const { issueObservation } = await import('./fixtures/v2.js');
  const input = {
    ...initial,
    observations: {
      state: 'current' as const,
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [issueObservation(1), issueObservation(2, { candidate: false })],
        pullRequests: [],
      },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const page = (await app.inject('/api/v2/issues/search?q=Issue&limit=1')).json();
    expect(page.hits).toHaveLength(1);
    expect(page.nextPageToken).toBeTypeOf('string');
    const next = (
      await app.inject(
        `/api/v2/issues/search?q=Issue&limit=1&pageToken=${encodeURIComponent(page.nextPageToken)}`
      )
    ).json();
    expect(next.hits[0]).toMatchObject({
      issue: { number: 2 },
      startAction: { availability: { state: 'disabled' } },
    });
    await board.publish(input, {
      id: '00000000-0000-4000-8000-000000000008',
      revision: 1,
      startedAt: 3000,
      deadline: 6000,
      finishedAt: 4000,
      phase: 'succeeded',
      result: {
        kind: 'preview',
        selected: [{ issue: 1, reason: 'Next', dependsOn: [], conflicts: [] }],
        rejected: [{ issue: 2, reason: 'Not ready' }],
        input: {
          issues: [
            { number: 1, title: 'Issue 1', parents: [], blockers: [] },
            { number: 2, title: 'Issue 2', parents: [], blockers: [] },
          ],
        },
      },
    });
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(snapshot.meta.currentPlanId).toBe('plan:00000000-0000-4000-8000-000000000008');
    expect(
      Object.values(snapshot.entities.actions).find((a) => a.kind === 'preview-plan')?.availability
        .state
    ).toBe('available');
    const plan = (
      await app.inject('/api/v2/plans/plan%3A00000000-0000-4000-8000-000000000008')
    ).json();
    expect(plan.attempt).toMatchObject({
      phase: 'succeeded',
      result: {
        selected: [{ issueId: 'issue:rafaeltab/wallpaperdb/1' }],
        rejected: [{ issueId: 'issue:rafaeltab/wallpaperdb/2' }],
      },
    });
    expect(plan.entities.issues['issue:rafaeltab/wallpaperdb/1']).toBeDefined();
    await board.publish({ ...input, state: { ...input.state, revision: 1 } });
    expect(
      (
        await app.inject(
          `/api/v2/issues/search?q=Issue&limit=1&pageToken=${encodeURIComponent(page.nextPageToken)}`
        )
      ).json()
    ).toMatchObject({ code: 'stale-action' });
  } finally {
    await app.close();
  }
});

it('uses verified PR ancestry for linear stacks, stops at forks and retains cards after failed refresh', async () => {
  const { pullObservation } = await import('./fixtures/v2.js');
  const input = {
    ...initial,
    observations: {
      state: 'current' as const,
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [],
        pullRequests: [
          pullObservation(10),
          pullObservation(11),
          pullObservation(12),
          pullObservation(13),
        ],
        verifiedPrBases: [
          { base: 10, tip: 11 },
          { base: 11, tip: 12 },
          { base: 11, tip: 13 },
        ],
      },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(Object.values(before.entities.stacks).map((s) => s.pullRequestIdsBaseToTip)).toEqual([
      ['pr:rafaeltab/wallpaperdb/10', 'pr:rafaeltab/wallpaperdb/11'],
    ]);
    expect(Object.values(before.entities.items)).toHaveLength(4);
    await board.publish({
      ...input,
      observations: {
        ...input.observations,
        state: 'error',
        failedAt: 5000,
        error: 'provider timeout',
      },
    });
    const after = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(Object.keys(after.entities.items)).toEqual(Object.keys(before.entities.items));
    expect(after.entities.sources['source:github']).toMatchObject({
      refresh: 'failed',
      observedAt: new Date(2000).toISOString(),
    });
    expect(Object.keys(after.entities.stacks)).toEqual(Object.keys(before.entities.stacks));
  } finally {
    await app.close();
  }
});

it('projects factory-verified prerequisites as satisfied while retaining parent grouping and policy-blocked starts', async () => {
  const { issueObservation, pullObservation } = await import('./fixtures/v2.js');
  const input = {
    ...initial,
    state: { ...initial.state, paused: false },
    observations: {
      state: 'current' as const,
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [
          issueObservation(1, {
            blockers: [2],
            parents: [9],
            evaluation: {
              allowed: true,
              blockersReady: true,
              verifiedAt: 2000,
              prerequisites: [
                {
                  issue: 2,
                  pr: 42,
                  commit: 'a'.repeat(40),
                  parent: 'b'.repeat(40),
                  prBase: 'main',
                  basis: 'verified-unmerged',
                },
              ],
            },
          }),
          issueObservation(2),
          issueObservation(3, {
            evaluation: {
              allowed: false,
              blockersReady: true,
              verifiedAt: 2000,
              prerequisites: [],
            },
          }),
        ],
        pullRequests: [pullObservation(42, { linkedIssues: [2] })],
      },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(snapshot.entities.issues['issue:rafaeltab/wallpaperdb/1'].eligibility.state).toBe(
      'allowed'
    );
    expect(snapshot.entities.relationships['relationship:prerequisite/2/1']).toMatchObject({
      satisfaction: {
        state: 'satisfied',
        basis: 'verified-unmerged',
        pullRequestId: 'pr:rafaeltab/wallpaperdb/42',
        comparison: { headOid: 'a'.repeat(40), baseOid: 'b'.repeat(40), baseRef: 'main' },
      },
    });
    expect(
      snapshot.entities.actions['action:start/issue:rafaeltab/wallpaperdb/3'].availability.state
    ).toBe('disabled');
    expect(snapshot.entities.relationships['relationship:parent/9/1'].kind).toBe('parent');
  } finally {
    await app.close();
  }
});

it('counts parked questions and manual recovery once, keeps automatic recovery out of attention and omits private paths', async () => {
  const { issueObservation, pullObservation } = await import('./fixtures/v2.js');
  const intent = {
    id: 'owner-1',
    issue: 1,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
    base: 'b'.repeat(40),
    context: 'private prompt',
    branch: 'private-branch',
    createdAt: 1000,
    expectedStage: 'implementation' as const,
  };
  const input: ScheduleSnapshot = {
    ...initial,
    state: { ...initial.state, admissions: [{ issue: 1, base: intent.base, context: '' }] },
    jobs: [
      {
        kind: 'job',
        intent,
        elapsedMs: 100,
        execution: {
          kind: 'found',
          threadId: 't1',
          status: 'waiting',
          worktree: '/private/worktree',
          branch: 'private-branch',
          model: 'gpt-6.1-sol',
        },
        delivery: {
          stage: 'implementation',
          commit: intent.base,
          ready: false,
          landed: false,
          active: false,
          question: { id: 'q1', text: 'Choose a behavior' },
        },
      },
    ],
    localWork: [
      {
        intent,
        control: {
          revision: 0,
          cancelled: false,
          claimed: [],
          parked: { index: 0, question: { id: 'q1', text: 'Choose a behavior' } },
        },
      },
    ],
    observations: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [issueObservation(1)],
        pullRequests: [pullObservation(42), pullObservation(43)],
      },
    },
    recoveries: [
      {
        issue: 2,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
        progress: 'Conflict at /private/worktree',
        active: true,
        phase: 'resolving',
      },
      {
        issue: 3,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/43',
        progress: 'Reconcile /private/worktree',
        active: false,
        phase: 'manual-recovery',
      },
    ],
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: intent.base, run: Effect.runPromise, job, v2: board });
  try {
    const response = await app.inject('/api/v2/board');
    const snapshot = response.json<FactoryV2Snapshot>();
    expect(
      Object.values(snapshot.entities.items).filter((i) => i.attention.state === 'required')
    ).toHaveLength(2);
    expect(snapshot.entities.items['item:pr:rafaeltab/wallpaperdb/42'].attention.state).toBe(
      'none'
    );
    expect(snapshot.meta.factory).toMatchObject({
      concurrency: { occupied: 1 },
      admission: { consumed: 1 },
    });
    expect(response.body).not.toContain('/private/worktree');
    expect(response.body).not.toContain('private prompt');
    const card = Object.values(snapshot.entities.items).find(
      (i) => i.status.code === 'awaiting-answer'
    );
    if (!card) throw new Error('Parked card absent');
    expect(
      (
        await app.inject({
          url: `/api/v2/items/${encodeURIComponent(card.id)}`,
          headers: { 'if-match': `"${card.version}"` },
        })
      ).json()
    ).toMatchObject({ questions: [{ id: 'q1', text: 'Choose a behavior' }] });
  } finally {
    await app.close();
  }
});

it('keeps an interrupted accepted command uncertain and prevents its old worker from executing it', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { sqliteBoard } = await import('../src/adapters/store/index.js');
  const directory = await mkdtemp(join(tmpdir(), 'v2-command-claim-'));
  let executed = 0;
  const commands = {
    execute: () =>
      Effect.sync(() => {
        executed++;
        return { state: 'succeeded' as const, result: null, reasons: [] };
      }),
  };
  const store = sqliteBoard(directory);
  const first = await liveBoard({ scopeId: 'test', initial, store, commands, autoExecute: false });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: first });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const action = Object.values(snapshot.entities.actions).find((a) => a.kind === 'configure');
    if (action?.availability.state !== 'available') throw new Error('Configure missing');
    const command = {
      commandId: '00000000-0000-4000-8000-000000000009',
      actionId: action.id,
      precondition: action.availability.precondition,
      kind: 'configure',
      payload: {
        paused: false,
        concurrency: { kind: 'limited', maximum: 1 },
        admissionAllowance: { kind: 'limited', maximum: 3 },
      },
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/v2/commands', payload: command })).statusCode
    ).toBe(202);
    const reopened = await liveBoard({ scopeId: 'test', initial, store, commands });
    const second = operationsServer({
      base: 'a'.repeat(40),
      run: Effect.runPromise,
      job,
      v2: reopened,
    });
    try {
      expect(
        (await second.inject({ method: 'POST', url: '/api/v2/commands', payload: command })).json()
      ).toMatchObject({ state: 'uncertain' });
      await first.execute();
      await reopened.idle();
      expect(executed).toBe(0);
      const retained = await Effect.runPromise(store.command(command.commandId));
      if (!retained) throw new Error('Lost command responsibility');
      await Effect.runPromise(
        store.finish({
          ...retained,
          receipt: {
            ...retained.receipt,
            state: 'rejected',
            version: 'reconciled',
            completedAt: new Date(2000).toISOString(),
          },
        })
      );
      expect((await second.inject(`/api/v2/commands/${command.commandId}`)).json()).toMatchObject({
        state: 'rejected',
      });
    } finally {
      await second.close();
    }
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  { name: 'build' },
  { startedAt: '2026-11-06T12:01:00Z' },
  { completedAt: '2026-11-06T12:02:00Z' },
])(
  'invalidates item details when an individual check changes %j without changing the card status',
  async (change) => {
    const { pullObservation } = await import('./fixtures/v2.js');
    const pr = pullObservation(42, {
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
      ci: 'SUCCESS',
    });
    const input = {
      ...initial,
      observations: {
        state: 'current' as const,
        stale: false,
        observedAt: 2000,
        facts: { issues: [], pullRequests: [pr] },
      },
    };
    const board = await liveBoard({ scopeId: 'test', initial: input });
    const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
    try {
      const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      const card = Object.values(before.entities.items)[0];
      await board.publish({
        ...input,
        observations: {
          ...input.observations,
          facts: {
            issues: [],
            pullRequests: [{ ...pr, checkRuns: [{ ...pr.checkRuns![0], ...change }] }],
          },
        },
      });
      expect(
        (
          await app.inject({
            url: `/api/v2/items/${encodeURIComponent(card.id)}`,
            headers: { 'if-match': `"${card.version}"` },
          })
        ).statusCode
      ).toBe(412);
      const current = Object.values(
        (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items
      )[0];
      expect(
        (
          await app.inject({
            url: `/api/v2/items/${encodeURIComponent(card.id)}`,
            headers: { 'if-match': `"${current.version}"` },
          })
        ).json()
      ).toMatchObject({ checkRuns: { state: 'known', value: [change] } });
    } finally {
      await app.close();
    }
  }
);

it('keeps a parked owning job visible when its bound PR is closed', async () => {
  const { parkedSnapshot, pullObservation } = await import('./fixtures/v2.js');
  const input = parkedSnapshot(pullObservation(42, { state: 'CLOSED', linkedIssues: [1] }), true);
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const card = snapshot.entities.items['item:pr:rafaeltab/wallpaperdb/42'];
    expect(card).toMatchObject({
      attention: { state: 'required' },
      jobIds: ['job:rafaeltab/wallpaperdb/1'],
    });
    expect(card.actionIds).toContain('action:resume/job:rafaeltab/wallpaperdb/1');
    expect(
      (
        await app.inject({
          url: `/api/v2/items/${encodeURIComponent(card.id)}`,
          headers: { 'if-match': `"${card.version}"` },
        })
      ).json()
    ).toMatchObject({ questions: [{ id: 'q1', text: 'Choose a behavior' }] });
  } finally {
    await app.close();
  }
});

it('clears a cancelled job question from attention while retaining independent recovery obligations', async () => {
  const { parkedSnapshot, pullObservation } = await import('./fixtures/v2.js');
  const input = parkedSnapshot(pullObservation(42, { linkedIssues: [1] }), true);
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  const itemId = 'item:pr:rafaeltab/wallpaperdb/42';
  try {
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[itemId]
    ).toMatchObject({ status: { code: 'awaiting-answer' }, attention: { state: 'required' } });
    const cancelled = {
      ...input,
      localWork: input.localWork.map((work) => ({
        ...work,
        control: { ...work.control, cancelled: true },
      })),
    };
    await board.publish(cancelled);
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(snapshot.entities.jobs['job:rafaeltab/wallpaperdb/1']).toMatchObject({
      cancelled: true,
      question: { id: 'q1' },
    });
    expect(snapshot.entities.items[itemId]).toMatchObject({
      status: { code: 'cancelled' },
      attention: { state: 'none' },
    });
    await board.publish({
      ...cancelled,
      recoveries: [
        {
          issue: 2,
          pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
          progress: 'Independent recovery',
          active: false,
          phase: 'manual-recovery',
        },
      ],
    });
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[itemId]
    ).toMatchObject({ status: { code: 'manual-recovery' }, attention: { state: 'required' } });
  } finally {
    await app.close();
  }
});

it('shows an unbound parked job alongside another PR associated with its issue', async () => {
  const { parkedSnapshot, pullObservation } = await import('./fixtures/v2.js');
  const input = parkedSnapshot(pullObservation(42, { linkedIssues: [1] }), false);
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(snapshot.entities.items['item:issue:rafaeltab/wallpaperdb/1']).toMatchObject({
      section: 'working',
      attention: { state: 'required' },
      jobIds: ['job:rafaeltab/wallpaperdb/1'],
    });
    expect(snapshot.entities.items['item:pr:rafaeltab/wallpaperdb/42'].jobIds).toEqual([]);
    expect(
      Object.values(snapshot.entities.items).filter((i) =>
        i.jobIds.includes('job:rafaeltab/wallpaperdb/1')
      )
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});

it('keeps attention unknown for historical recovery without structured progress', async () => {
  const { pullObservation } = await import('./fixtures/v2.js');
  const input: ScheduleSnapshot = {
    ...initial,
    observations: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: { issues: [], pullRequests: [pullObservation(42)] },
    },
    recoveries: [
      {
        issue: 1,
        pr: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
        progress: 'Retained historical recovery',
        active: false,
      },
    ],
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[
        'item:pr:rafaeltab/wallpaperdb/42'
      ]
    ).toMatchObject({
      status: { code: 'unknown', active: false },
      attention: { state: 'unknown' },
    });
    await board.publish({
      ...input,
      recoveries: input.recoveries?.map((r) => ({ ...r, active: true, phase: 'resolving' })),
    });
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[
        'item:pr:rafaeltab/wallpaperdb/42'
      ]
    ).toMatchObject({
      status: { code: 'restacking', active: true },
      attention: { state: 'none' },
    });
  } finally {
    await app.close();
  }
});

it('distinguishes failed CI without an actor from an owned automatic repair', async () => {
  const { parkedSnapshot, pullObservation } = await import('./fixtures/v2.js');
  const pull = pullObservation(42, { ci: 'FAILURE' });
  const input: ScheduleSnapshot = {
    ...initial,
    observations: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: { issues: [], pullRequests: [pull] },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[
        'item:pr:rafaeltab/wallpaperdb/42'
      ]
    ).toMatchObject({
      status: { code: 'ci-failed' },
      attention: { state: 'unknown' },
    });
    const owned = parkedSnapshot(pull, true);
    await board.publish({
      ...owned,
      localWork: owned.localWork.map((w) => ({
        ...w,
        control: { ...w.control, parked: undefined },
      })),
      jobs: owned.jobs.map((j) =>
        j.kind === 'job'
          ? {
              ...j,
              delivery: {
                ...j.delivery!,
                question: undefined,
                active: true,
                activity: 'repairing',
              },
            }
          : j
      ),
    });
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items[
        'item:pr:rafaeltab/wallpaperdb/42'
      ]
    ).toMatchObject({
      status: { code: 'repairing-ci' },
      attention: { state: 'none' },
    });
  } finally {
    await app.close();
  }
});

it.each([
  { change: 'linked lifecycle', expected: 'stale' },
  { change: 'linked association', expected: 'stale' },
  { change: 'unrelated lifecycle', expected: 'current' },
] as const)(
  'qualifies preview applicability after $change changes',
  async ({ change, expected }) => {
    const { issueObservation, pullObservation } = await import('./fixtures/v2.js');
    const observed = issueObservation(1, { pullRequests: [8] }),
      linked = pullObservation(8, { linkedIssues: [1] }),
      other = pullObservation(9);
    const input: ScheduleSnapshot = {
      ...initial,
      observations: {
        state: 'current',
        stale: false,
        observedAt: 1000,
        facts: { issues: [observed], pullRequests: [linked, other] },
      },
    };
    const attempt: PlanningAttempt = {
      id: '00000000-0000-4000-8000-000000000081',
      revision: 1,
      startedAt: 1000,
      deadline: 5000,
      finishedAt: 2000,
      phase: 'succeeded',
    };
    const attempts: AttemptStore = {
      pending: () => Effect.succeed(undefined),
      get: (id) => Effect.succeed(id === attempt.id ? attempt : undefined),
      create: () => Effect.succeed(false),
      save: () => Effect.succeed(false),
    };
    const board = await liveBoard({
      scopeId: 'test',
      initial: input,
      attempts,
      commands: {
        execute: () =>
          Effect.succeed({
            state: 'succeeded',
            result: { planId: `plan:${attempt.id}` },
            reasons: [],
          }),
      },
    });
    const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
    try {
      const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      const preview = Object.values(before.entities.actions).find((a) => a.kind === 'preview-plan');
      if (preview?.availability.state !== 'available') throw new Error('Preview unavailable');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v2/commands',
            payload: {
              commandId: '00000000-0000-4000-8000-000000000082',
              actionId: preview.id,
              precondition: preview.availability.precondition,
              kind: 'preview-plan',
              payload: {},
            },
          })
        ).statusCode
      ).toBe(202);
      await board.idle();
      await board.publish(input, attempt);
      const url = `/api/v2/plans/${encodeURIComponent(`plan:${attempt.id}`)}`;
      const current = (await app.inject(url)).json();
      expect(current.attempt.applicability).toBe('current');
      await board.publish(
        {
          ...input,
          observations: {
            ...input.observations,
            observedAt: 2000,
            facts: {
              issues: [{ ...observed, pullRequests: change === 'linked association' ? [9] : [8] }],
              pullRequests: [
                { ...linked, state: change === 'linked lifecycle' ? 'MERGED' : 'OPEN' },
                { ...other, state: change === 'unrelated lifecycle' ? 'CLOSED' : 'OPEN' },
              ],
            },
          },
        },
        attempt
      );
      const after = (await app.inject(url)).json();
      expect(after.attempt.basis).toEqual(current.attempt.basis);
      expect(after.attempt.applicability).toBe(expected);
    } finally {
      await app.close();
    }
  }
);

it.each([
  { field: 'projectPriority', projectField: 'priority', next: 'P0' },
  { field: 'projectSize', projectField: 'size', next: 'XL' },
  { field: 'projectStatus', projectField: 'status', next: 'In Progress' },
] as const)(
  'retains a preview basis and invalidates changed $field before historical lookup',
  async (change) => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { sqliteBoard } = await import('../src/adapters/store/index.js');
    const directory = await mkdtemp(join(tmpdir(), 'v2-plan-basis-'));
    const { issueObservation } = await import('./fixtures/v2.js');
    const observed = issueObservation(1, {
      projectPriority: 'P2',
      projectSize: 'M',
      projectDetails: {
        projectId: 'P1',
        status: { id: 'planned', name: 'Planned', rank: null },
        priority: { id: 'P2', name: 'P2', rank: 2 },
        size: { id: 'M', name: 'M', rank: 2 },
      },
    });
    const input: ScheduleSnapshot = {
      ...initial,
      observations: {
        state: 'current',
        stale: false,
        observedAt: 1000,
        facts: { issues: [observed], pullRequests: [] },
      },
    };
    const old: PlanningAttempt = {
      id: '00000000-0000-4000-8000-000000000011',
      revision: 1,
      startedAt: 1000,
      deadline: 5000,
      finishedAt: 2000,
      phase: 'succeeded',
    };
    const attempts: AttemptStore = {
      pending: () => Effect.succeed(undefined),
      get: (id) => Effect.succeed(id === old.id ? old : undefined),
      create: () => Effect.succeed(false),
      save: () => Effect.succeed(false),
    };
    const board = await liveBoard({
      scopeId: 'test',
      initial: input,
      store: sqliteBoard(directory),
      attempts,
      commands: {
        execute: () =>
          Effect.succeed({ state: 'succeeded', result: { planId: `plan:${old.id}` }, reasons: [] }),
      },
    });
    const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
    try {
      const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      const preview = Object.values(before.entities.actions).find((a) => a.kind === 'preview-plan');
      if (preview?.availability.state !== 'available') throw new Error('Preview unavailable');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v2/commands',
            payload: {
              commandId: '00000000-0000-4000-8000-000000000012',
              actionId: preview.id,
              precondition: preview.availability.precondition,
              kind: 'preview-plan',
              payload: {},
            },
          })
        ).statusCode
      ).toBe(202);
      await board.idle();
      await board.publish(input, old);
      const url = `/api/v2/plans/${encodeURIComponent(`plan:${old.id}`)}`;
      const current = (await app.inject(url)).json();
      expect(current.attempt.basis).toMatchObject({
        boardCursor: before.cursor,
        controlVersion: before.meta.factory.version,
      });
      expect(current.attempt.applicability).toBe('current');
      await board.publish(
        {
          ...input,
          observations: {
            ...input.observations,
            observedAt: 2000,
            facts: {
              issues: [
                {
                  ...observed,
                  [change.field]: change.next,
                  projectDetails: {
                    ...observed.projectDetails!,
                    [change.projectField]: { id: change.next, name: change.next, rank: 0 },
                  },
                },
              ],
              pullRequests: [],
            },
          },
        },
        old
      );
      const project = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.issues[
        'issue:rafaeltab/wallpaperdb/1'
      ].project;
      if (project.state !== 'known') throw new Error('Project fields unavailable');
      expect(project.value[change.projectField]?.name).toBe(change.next);
      expect((await app.inject(url)).json().attempt.applicability).toBe('stale');
      await board.publish(
        { ...input, state: { ...input.state, revision: 1 } },
        { ...old, id: '00000000-0000-4000-8000-000000000013', startedAt: 3000 }
      );
      const historical = (await app.inject(url)).json();
      expect(historical.attempt.basis).toEqual(current.attempt.basis);
      expect(historical.attempt.applicability).toBe('stale');
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

it('bounds outstanding commands while replaying retries and admitting work after completion', async () => {
  const board = await liveBoard({ scopeId: 'test', initial, autoExecute: false });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const configure = Object.values(snapshot.entities.actions).find((a) => a.kind === 'configure');
    if (configure?.availability.state !== 'available') throw new Error('Configure unavailable');
    const precondition = configure.availability.precondition;
    const request = (number: number) => ({
      commandId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
      actionId: configure.id,
      precondition,
      kind: 'configure',
      payload: {
        paused: true,
        concurrency: { kind: 'limited', maximum: 1 },
        admissionAllowance: { kind: 'limited', maximum: 3 },
      },
    });
    for (let i = 1; i <= 64; i++)
      expect(
        (await app.inject({ method: 'POST', url: '/api/v2/commands', payload: request(i) }))
          .statusCode
      ).toBe(202);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v2/commands', payload: request(65) }))
        .statusCode
    ).toBe(503);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v2/commands', payload: request(1) }))
        .statusCode
    ).toBe(202);
    expect((await app.inject(`/api/v2/commands/${request(65).commandId}`)).statusCode).toBe(404);
    await board.execute();
    expect(
      (await app.inject({ method: 'POST', url: '/api/v2/commands', payload: request(65) }))
        .statusCode
    ).toBe(202);
  } finally {
    await app.close();
  }
});

it('preserves known historical plan threads through retained planner ownership', async () => {
  const old: PlanningAttempt = {
    id: '00000000-0000-4000-8000-000000000021',
    revision: 1,
    startedAt: 1000,
    deadline: 5000,
    finishedAt: 2000,
    phase: 'succeeded',
  };
  const legacy = { ...old, id: '00000000-0000-4000-8000-000000000022' };
  const launch = {
    requestId: old.id,
    revision: 1,
    deadline: 5000,
    phase: 'succeeded' as const,
    run: { threadId: 'planner-old', runId: 'run-old' },
    retired: true,
  };
  const input: ScheduleSnapshot = {
    ...initial,
    threads: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: {
        environmentId: 'e',
        projectId: 'p',
        threads: [
          {
            threadId: 'planner-old',
            title: 'Old preview',
            createdAt: null,
            updatedAt: null,
            status: 'completed',
            branch: null,
            worktree: null,
            pullRequests: [],
          },
        ],
      },
    },
  };
  const board = await liveBoard({
    scopeId: 'test',
    initial: input,
    now: () => 3000,
    attempts: {
      pending: () => Effect.succeed(undefined),
      get: (id) => Effect.succeed(id === old.id ? old : id === legacy.id ? legacy : undefined),
      create: () => Effect.succeed(false),
      save: () => Effect.succeed(false),
    },
    planner: {
      ownership: (_reconcile, id) => Effect.succeed(id === old.id ? launch : undefined),
      propose: () => Effect.die('Historical reads must not propose work'),
    },
  });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    await board.publish(input, { ...old, launch });
    const url = `/api/v2/plans/${encodeURIComponent(`plan:${old.id}`)}`;
    expect((await app.inject(url)).json().attempt.threadId).toBe('thread:e/planner-old');
    await board.publish(input, {
      ...old,
      id: '00000000-0000-4000-8000-000000000023',
      startedAt: 3000,
    });
    const historical = (await app.inject(url)).json();
    expect(historical.attempt.threadId).toBe('thread:e/planner-old');
    expect(historical.entities.threads['thread:e/planner-old'].metadata).toMatchObject({
      state: 'known',
      value: { title: 'Old preview' },
    });
    expect(
      (await app.inject(`/api/v2/plans/${encodeURIComponent(`plan:${legacy.id}`)}`)).json().attempt
        .threadId
    ).toBeNull();
  } finally {
    await app.close();
  }
});

it.each(['startup', 'publication'])(
  'qualifies unresolved plan context in board coverage during %s',
  async (phase) => {
    const { issueObservation } = await import('./fixtures/v2.js');
    const plan: PlanningAttempt = {
      id: '00000000-0000-4000-8000-000000000024',
      revision: 1,
      startedAt: 1000,
      deadline: 5000,
      finishedAt: 2000,
      phase: 'succeeded',
      result: {
        kind: 'preview',
        selected: [{ issue: 99, reason: 'Historical selection', dependsOn: [98], conflicts: [] }],
        rejected: [{ issue: 100, reason: 'Not ready' }],
        input: {
          issues: [98, 99, 100].map((number) => ({
            number,
            title: `Historical ${number}`,
            blockers: [],
            parents: [],
          })),
        },
      },
    };
    const input: ScheduleSnapshot = {
      ...initial,
      observations: {
        state: 'current',
        stale: false,
        observedAt: 2000,
        facts: { issues: [], pullRequests: [] },
      },
    };
    const board = await liveBoard({
      scopeId: 'test',
      initial: input,
      initialPlan: phase === 'startup' ? plan : undefined,
    });
    const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
    try {
      if (phase === 'publication') {
        expect(
          (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.coverage.state
        ).toBe('complete');
        await board.publish(input, plan);
      }
      const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      expect(snapshot.entities.issues['issue:rafaeltab/wallpaperdb/99'].metadata.state).toBe(
        'unknown'
      );
      expect(snapshot.meta.coverage.state).toBe('partial');
      expect(snapshot.meta.coverage.unresolvedIssueIds).toHaveLength(3);
      expect(snapshot.meta.coverage.unresolvedIssueIds).toEqual(
        expect.arrayContaining([
          'issue:rafaeltab/wallpaperdb/98',
          'issue:rafaeltab/wallpaperdb/99',
          'issue:rafaeltab/wallpaperdb/100',
        ])
      );
      await board.publish(
        {
          ...input,
          observations: {
            ...input.observations,
            facts: {
              issues: [issueObservation(98), issueObservation(99), issueObservation(100)],
              pullRequests: [],
            },
          },
        },
        plan
      );
      expect(
        (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.coverage
      ).toMatchObject({ state: 'complete', unresolvedIssueIds: [] });
    } finally {
      await app.close();
    }
  }
);

it('keeps shared replay history coherent when a second producer has a stale local revision', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { sqliteBoard } = await import('../src/adapters/store/index.js');
  const directory = await mkdtemp(join(tmpdir(), 'v2-shared-'));
  const store = sqliteBoard(directory);
  const first = await liveBoard({ scopeId: 'test', initial, store }),
    second = await liveBoard({ scopeId: 'test', initial, store });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: first });
  const other = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: second });
  try {
    const start = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await first.publish({ ...initial, state: { ...initial.state, revision: 0, concurrency: 2 } });
    const middle = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await second.publish({ ...initial, state: { ...initial.state, revision: 1, concurrency: 3 } });
    const replay = (
      await other.inject(`/api/v2/board/changes?after=${encodeURIComponent(middle.cursor)}`)
    ).json();
    expect(replay.kind).not.toBe('resync-required');
    const prior = (
      await other.inject(`/api/v2/board/changes?after=${encodeURIComponent(start.cursor)}`)
    ).json();
    expect(prior.batches[0]).toMatchObject({ fromCursor: start.cursor, toCursor: middle.cursor });
  } finally {
    await Promise.all([app.close(), other.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});

it('updates source freshness without rewriting unchanged issue and PR versions', async () => {
  const { issueObservation, pullObservation } = await import('./fixtures/v2.js');
  const input = {
    ...initial,
    observations: {
      state: 'current' as const,
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [issueObservation(1)],
        pullRequests: [pullObservation(42, { linkedIssues: [1] })],
      },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const before = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await board.publish({ ...input, observations: { ...input.observations, observedAt: 3000 } });
    const after = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(after.entities.issues['issue:rafaeltab/wallpaperdb/1'].version).toBe(
      before.entities.issues['issue:rafaeltab/wallpaperdb/1'].version
    );
    expect(after.entities.pullRequests['pr:rafaeltab/wallpaperdb/42'].version).toBe(
      before.entities.pullRequests['pr:rafaeltab/wallpaperdb/42'].version
    );
    expect(after.entities.sources['source:github'].observedAt).toBe(new Date(3000).toISOString());
  } finally {
    await app.close();
  }
});

it('does not turn a retained publication assertion into readiness after current verification fails', async () => {
  const { issueObservation, pullObservation } = await import('./fixtures/v2.js');
  const intent = {
    id: 'retained',
    issue: 1,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
    base: 'b'.repeat(40),
    context: '',
    branch: 'feature',
    createdAt: 1000,
    expectedStage: 'implementation' as const,
  };
  const proof = {
    url: 'https://github.com/rafaeltab/wallpaperdb/pull/42',
    commit: 'a'.repeat(40),
    parent: 'b'.repeat(40),
    base: 'main',
  };
  const input: ScheduleSnapshot = {
    ...initial,
    state: { ...initial.state, admissions: [{ issue: 1, base: intent.base, context: '' }] },
    jobs: [
      {
        kind: 'job',
        intent,
        elapsedMs: 0,
        prerequisite: proof,
        execution: { kind: 'ambiguous' },
        delivery: {
          stage: 'ci',
          commit: proof.commit,
          ready: false,
          landed: false,
          activity: 'manual-recovery',
        },
      },
    ],
    localWork: [
      { intent, control: { revision: 0, cancelled: false, claimed: [], prerequisite: proof } },
    ],
    observations: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: {
        issues: [issueObservation(1)],
        pullRequests: [pullObservation(42, { linkedIssues: [1] })],
      },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: intent.base, run: Effect.runPromise, job, v2: board });
  try {
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.pullRequests[
        'pr:rafaeltab/wallpaperdb/42'
      ].readiness.state
    ).not.toBe('ready');
    await board.publish({
      ...input,
      jobs: input.jobs.map((j) =>
        j.kind === 'job' && j.delivery
          ? { ...j, delivery: { ...j.delivery, ready: true, activity: undefined } }
          : j
      ),
    });
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.pullRequests[
        'pr:rafaeltab/wallpaperdb/42'
      ].readiness.state
    ).toBe('ready');
    expect(
      Object.values((await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.items)[0]
        .status.code
    ).toBe('ready');
  } finally {
    await app.close();
  }
});

it('accepts a bounded Unicode start context within the v2 body limit while preserving v1 limits', async () => {
  const { issueObservation } = await import('./fixtures/v2.js');
  const input = {
    ...initial,
    state: { ...initial.state, paused: false },
    observations: {
      state: 'current' as const,
      stale: false,
      observedAt: 2000,
      facts: { issues: [issueObservation(1)], pullRequests: [] },
    },
  };
  const board = await liveBoard({ scopeId: 'test', initial: input });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const snapshot = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const action = snapshot.entities.actions['action:start/issue:rafaeltab/wallpaperdb/1'];
    if (action.availability.state !== 'available') throw new Error('Start unavailable');
    const context = '界'.repeat(16000);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: {
            commandId: '00000000-0000-4000-8000-000000000010',
            actionId: action.id,
            precondition: action.availability.precondition,
            kind: 'start',
            payload: { context },
          },
        })
      ).statusCode
    ).toBe(202);
    await board.idle();
    expect(
      (await app.inject({ method: 'POST', url: '/api/job', payload: { issue: 1, context } }))
        .statusCode
    ).toBe(413);
  } finally {
    await app.close();
  }
});

it('distinguishes malformed, different-scope and expired live change cursors', async () => {
  const board = await liveBoard({ scopeId: 'test', initial });
  const other = await liveBoard({ scopeId: 'other', initial });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    const cursor = (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().cursor;
    expect((await app.inject('/api/v2/board/changes?after=malformed')).statusCode).toBe(400);
    expect(
      (
        await app.inject(
          `/api/v2/board/changes?after=${encodeURIComponent(other.snapshot().cursor)}`
        )
      ).json()
    ).toEqual({ kind: 'resync-required', reason: 'different-scope' });
    for (let revision = 0; revision < 65; revision++)
      await board.publish({ ...initial, state: { ...initial.state, revision } });
    expect(
      (await app.inject(`/api/v2/board/changes?after=${encodeURIComponent(cursor)}`)).json()
    ).toEqual({ kind: 'resync-required', reason: 'expired' });
  } finally {
    await app.close();
    other.close();
  }
});

it('does not date older rich metadata with a later legacy-only observation after rollback', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { eq } = await import('drizzle-orm');
  const { sqliteObservations } = await import('../src/adapters/store/index.js');
  const { stateConnection, observationRefresh } = await import('../src/platform/index.js');
  const { issueObservation } = await import('./fixtures/v2.js');
  const directory = await mkdtemp(join(tmpdir(), 'v2-legacy-observation-'));
  const store = sqliteObservations(directory);
  const facts = { issues: [issueObservation(1)], pullRequests: [] };
  await Effect.runPromise(store.refresh({ observedAt: 1000, facts }));
  const load = async () => ({
    ...initial,
    observations: {
      ...(await Effect.runPromise(store.read())),
      state: 'current' as const,
      stale: false,
    },
  });
  const board = await liveBoard({ scopeId: 'test', initial: await load() });
  const app = operationsServer({ base: 'a'.repeat(40), run: Effect.runPromise, job, v2: board });
  try {
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.issues[
        'issue:rafaeltab/wallpaperdb/1'
      ].metadata.state
    ).toBe('known');
    // A previous release updates the original observation tables, without the new rich cache.
    stateConnection(directory, (db) =>
      db
        .update(observationRefresh)
        .set({ observedAt: 2000 })
        .where(eq(observationRefresh.id, 1))
        .run()
    );
    await board.publish(await load());
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.issues[
        'issue:rafaeltab/wallpaperdb/1'
      ].metadata.state
    ).toBe('unknown');
    await Effect.runPromise(store.refresh({ observedAt: 3000, facts }));
    await board.publish(await load());
    expect(
      (await app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.issues[
        'issue:rafaeltab/wallpaperdb/1'
      ].metadata.state
    ).toBe('known');
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
