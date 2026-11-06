import type {
  IssueObservation,
  PullObservation,
  ScheduleSnapshot,
} from '../../src/capabilities/observe/index.js';
export function issueObservation(
  number: number,
  overrides: Partial<IssueObservation> = {}
): IssueObservation {
  return {
    number,
    author: 'rafaeltab',
    url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
    title: `Issue ${number}`,
    updatedAt: '2026-11-06T12:00:00Z',
    open: true,
    candidate: true,
    labels: ['ready-for-agent'],
    assignees: [],
    projectStatus: 'Planned',
    projectPriority: null,
    projectSize: null,
    commentCount: 0,
    blockers: [],
    parents: [],
    pullRequests: [],
    labelDetails: [{ id: 'L1', name: 'ready-for-agent', color: 'abcdef' }],
    assigneeDetails: [],
    projectDetails: {
      projectId: 'P1',
      status: { id: 'S1', name: 'Planned', rank: null },
      priority: null,
      size: null,
    },
    nativeBlockers: [],
    nativeParent: null,
    ...overrides,
  };
}
export function pullObservation(
  number: number,
  overrides: Partial<PullObservation> = {}
): PullObservation {
  return {
    number,
    url: `https://github.com/rafaeltab/wallpaperdb/pull/${number}`,
    state: 'OPEN',
    title: `PR ${number}`,
    draft: false,
    updatedAt: '2026-11-06T12:00:00Z',
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    headBranch: `branch-${number}`,
    baseBranch: 'main',
    linkedIssues: [],
    crossReferencedIssues: [],
    review: 'UNKNOWN',
    ci: 'UNKNOWN',
    evidenceHead: 'a'.repeat(40),
    labelDetails: [],
    checkRuns: [],
    reviewers: [],
    mergeability: 'UNKNOWN',
    ...overrides,
  };
}

export function parkedSnapshot(pull: PullObservation, bound: boolean): ScheduleSnapshot {
  const intent = {
    id: 'parked-owner',
    issue: 1,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
    base: 'b'.repeat(40),
    context: '',
    branch: 'owner',
    createdAt: 1000,
    expectedStage: 'implementation' as const,
  };
  const question = { id: 'q1', text: 'Choose a behavior' };
  return {
    state: {
      revision: 0,
      paused: true,
      concurrency: 1,
      allowance: 3,
      admissions: [{ issue: 1, base: intent.base, context: '' }],
    },
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
          branch: 'owner',
          model: 'gpt-6.1-sol',
        },
        resume: { index: 0, questionId: question.id },
        delivery: {
          stage: 'implementation',
          commit: intent.base,
          ready: false,
          landed: false,
          active: false,
          question,
          pr: bound
            ? { kind: 'found', url: pull.url, commit: pull.head, ready: false, landed: false }
            : undefined,
        },
      },
    ],
    localWork: [
      {
        intent,
        control: { revision: 0, cancelled: false, claimed: [], parked: { index: 0, question } },
      },
    ],
    observations: {
      state: 'current',
      stale: false,
      observedAt: 2000,
      facts: { issues: [issueObservation(1)], pullRequests: [pull] },
    },
  };
}
