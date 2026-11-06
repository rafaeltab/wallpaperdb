import type { IssueObservation, PullObservation } from '../../src/capabilities/observe/index.js';
export function issueObservation(
  number: number,
  overrides: Partial<IssueObservation> = {}
): IssueObservation {
  return {
    number,
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
