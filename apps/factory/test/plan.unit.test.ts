import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import {
  Plan,
  PlanLive,
  PlanningSource,
  IPlanner,
  type PlanningInput,
  type PlanningIssue,
  type Proposal,
} from '../src/capabilities/plan/index.js';
const issue: PlanningIssue = {
  number: 580,
  url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
  title: 'Fix browse',
  body: 'Requirements',
  author: 'rafaeltab',
  open: true,
  labels: ['ready-for-agent'],
  comments: [],
  blockers: [],
  parents: [],
  blockersReady: true,
  prerequisiteEvidence: '',
};
const selection = { issue: 580, reason: 'User-facing bug', dependsOn: [], conflicts: [] };
const proposal: Proposal = {
  selected: [{ issue: 580, reason: 'User-facing bug', dependsOn: [], conflicts: [] }],
  deferred: [],
};
async function preview(issues = [issue], proposed = proposal, changed = false) {
  let reads = 0;
  const input: PlanningInput = {
    issues,
    job: { kind: 'empty' },
    capacity: { concurrency: 1, admission: 1 },
  };
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PlanningSource, {
            read: () => Effect.sync(() => ({ ...input, issues: changed && reads++ ? [] : issues })),
          }),
          Layer.succeed(IPlanner, { propose: () => Effect.succeed(proposed) })
        )
      )
    )
  );
  try {
    return await runtime.runPromise(Effect.flatMap(Plan, (p) => p.preview()));
  } finally {
    await runtime.dispose();
  }
}
it('shows a semantic proposal without dispatch', async () => {
  expect((await preview()).selected).toEqual(proposal.selected);
});

it.each([
  { ...issue, open: false },
  { ...issue, author: 'outsider' },
  { ...issue, labels: [] },
  { ...issue, labels: ['ready-for-agent', 'future-work'] },
  { ...issue, labels: ['ready-for-agent', 'spec'] },
  { ...issue, blockersReady: false },
  { ...issue, blockers: [580] },
])('rejects unsafe selection %#', async (candidate) => {
  const result = await preview([candidate]);
  expect(result.selected).toEqual([]);
  expect(result.rejected[0]?.reason).toBeTruthy();
});
it('rejects cycles even with claimed prerequisite readiness', async () => {
  expect(
    (
      await preview([
        { ...issue, blockers: [579] },
        { ...issue, number: 579, blockers: [580] },
      ])
    ).selected
  ).toEqual([]);
});
it.each([
  { ...selection, dependsOn: [579] },
  { ...selection, conflicts: [579] },
  { ...selection, issue: 999 },
  { ...selection, reason: '' },
])('retains semantic uncertainty %#', async (item) => {
  expect((await preview([issue], { selected: [item], deferred: [] })).selected).toEqual([]);
});
it('rejects duplicate and stale proposals', async () => {
  expect(
    (
      await preview([issue], {
        selected: [...proposal.selected, ...proposal.selected],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
  expect(await preview([issue], proposal, true)).toMatchObject({ kind: 'stale', selected: [] });
});
