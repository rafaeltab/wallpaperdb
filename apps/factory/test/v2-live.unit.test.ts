import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { operationsServer, type FactoryV2Snapshot } from '../src/http/index.js';
import { liveBoard } from '../src/capabilities/board/index.js';
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
