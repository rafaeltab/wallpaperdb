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
const selection = { issue: 580, reason: 'User-facing bug', includeCodeFromIssues: [] };
const proposal: Proposal = {
  selected: [{ issue: 580, reason: 'User-facing bug', includeCodeFromIssues: [] }],
  deferred: [],
};
async function preview(
  issues = [issue],
  proposed = proposal,
  changed = false,
  job: PlanningInput['job'] = { kind: 'empty' },
  verify: PlanningSource['verify'] = () => Effect.succeed(undefined)
) {
  let reads = 0;
  const input: PlanningInput = {
    issues,
    job,
    capacity: { concurrency: issues.length, admission: issues.length },
  };
  const runtime = ManagedRuntime.make(
    PlanLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(PlanningSource, {
            verify,
            read: () => Effect.sync(() => ({ ...input, issues: changed && reads++ ? [] : issues })),
          }),
          Layer.succeed(IPlanner, {
            ownership: () => Effect.succeed(undefined),
            propose: () => Effect.succeed(proposed),
          })
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

it('keeps inferred API blockers and unselected work visible', async () => {
  const result = await preview([issue, { ...issue, number: 579 }], {
    selected: [],
    deferred: [{ issue: 580, reason: 'API contract unsettled with active work' }],
  });
  expect(result.selected).toEqual([]);
  expect(result.rejected).toEqual([
    { issue: 580, reason: 'API contract unsettled with active work' },
    { issue: 579, reason: 'Not selected by semantic planner' },
  ]);
});
it('does not propose an already parked job as fresh work', async () => {
  const job: PlanningInput['job'] = {
    kind: 'job',
    intent: {
      id: 'existing',
      issue: 580,
      issueUrl: issue.url,
      base: 'a'.repeat(40),
      context: '',
      branch: 'factory/existing',
      createdAt: 0,
      expectedStage: 'implementation',
    },
    execution: { kind: 'absent' },
    elapsedMs: 100,
    resume: { index: 0, questionId: 'q' },
  };
  const result = await preview([issue], proposal, false, job);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Already active or parked' });
});

it('rejects a proposal that both selects and defers the same issue', async () => {
  const result = await preview([issue], {
    selected: proposal.selected,
    deferred: [{ issue: 580, reason: 'API contract unsettled' }],
  });
  expect(result.selected).toEqual([]);
});

it('validates shared acyclic prerequisite context without blocking preview', async () => {
  const issues = Array.from({ length: 42 }, (_, index) => ({
    ...issue,
    number: 580 + index,
    open: index === 0,
    blockers: [581 + index, 582 + index].filter((number) => number < 622),
  }));
  const started = performance.now();
  const result = await preview(issues);
  expect(result.selected).toEqual(proposal.selected);
  expect(performance.now() - started).toBeLessThan(1000);
});

it('rejects a cycle behind shared prerequisites without rejecting an independent issue', async () => {
  const result = await preview(
    [
      { ...issue, blockers: [581, 582] },
      { ...issue, number: 581, blockers: [583] },
      { ...issue, number: 582, blockers: [583] },
      { ...issue, number: 583, blockers: [581] },
      { ...issue, number: 584 },
    ],
    {
      selected: [
        { ...selection, includeCodeFromIssues: [581, 582] },
        { ...selection, issue: 584 },
      ],
      deferred: [],
    }
  );
  expect(result.selected).toEqual([{ ...selection, issue: 584 }]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Cyclic explicit dependencies' });
});

it('rejects a context-only issue even when it otherwise passes every candidate policy', async () => {
  const context = {
    ...issue,
    metadata: {
      number: issue.number,
      url: issue.url,
      title: issue.title,
      open: true,
      candidate: false,
      labels: issue.labels,
      assignees: [],
      projectStatus: null,
      projectPriority: null,
      projectSize: null,
      commentCount: 0,
      blockers: [],
      parents: [],
      pullRequests: [],
    },
  };
  const result = await preview([context]);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({ issue: 580, reason: 'Context-only issue' });
  const candidate = { ...context, metadata: { ...context.metadata, candidate: true } };
  expect((await preview([candidate])).selected).toEqual(proposal.selected);
});

it.each([
  [3, 2, 2],
  [-1, 2, 2],
  [3, -1, 3],
  [-1, -1, 4],
  [0, 2, 0],
])(
  'bounds model selection by available concurrency %s and admissions %s',
  async (concurrency, admission, expected) => {
    const inputs: PlanningInput[] = [];
    const input: PlanningInput = {
      issues: [580, 581, 582, 583].map((number) => ({ ...issue, number })),
      job: { kind: 'empty' },
      capacity: { concurrency, admission },
    };
    const runtime = ManagedRuntime.make(
      PlanLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(PlanningSource, {
              verify: () => Effect.succeed(undefined),
              read: () => Effect.succeed(input),
            }),
            Layer.succeed(IPlanner, {
              ownership: () => Effect.succeed(undefined),
              propose: (value) =>
                Effect.sync(() => {
                  inputs.push(value);
                  return { selected: [], deferred: [] };
                }),
            })
          )
        )
      )
    );
    try {
      await runtime.runPromise(Effect.flatMap(Plan, (plan) => plan.preview()));
      if (expected === 0) expect(inputs).toEqual([]);
      else expect(inputs[0]).toHaveProperty('maximumSelections', expected);
    } finally {
      await runtime.dispose();
    }
  }
);

it('rejects inclusion of its own unfinished code', async () => {
  expect(
    (
      await preview([issue], {
        selected: [{ ...selection, includeCodeFromIssues: [580] }],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
});
it('rejects inclusion of another new implementation in the same batch', async () => {
  expect(
    (
      await preview([issue, { ...issue, number: 579 }], {
        selected: [selection, { ...selection, issue: 579, includeCodeFromIssues: [580] }],
        deferred: [],
      })
    ).selected
  ).toEqual([]);
});

it('invalidates a response omitting a mandatory open prerequisite', async () => {
  const result = await preview([
    { ...issue, blockers: [579] },
    { ...issue, number: 579, open: true, labels: [] },
  ]);
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({
    issue: 580,
    reason: 'Mandatory prerequisite omitted from inclusion list',
  });
});
it('does not veto independent selected work because an overlapping backlog item is unselected', async () => {
  const result = await preview([issue, { ...issue, number: 579, title: 'Another browse repair' }]);
  expect(result.selected).toEqual(proposal.selected);
});

it('requires verification of every inclusion and retains no executable subset of an unverifiable batch', async () => {
  const result = await preview(
    [issue, { ...issue, number: 579 }],
    {
      selected: [selection, { ...selection, issue: 579 }],
      deferred: [],
    },
    false,
    { kind: 'empty' },
    (selected) =>
      Effect.succeed(
        selected.issue === 579 ? 'Included PR is not independently reviewed' : undefined
      )
  );
  expect(result.selected).toEqual([]);
  expect(result.rejected).toContainEqual({
    issue: 579,
    reason: 'Included PR is not independently reviewed',
  });
});
