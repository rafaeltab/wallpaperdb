import type {
  Action,
  ActionId,
  Fact,
  FactoryV2Snapshot,
  Issue,
  IssueId,
  Job,
  JobId,
  PullRequest,
  PullRequestId,
  Relationship,
  SourceId,
  StatusCode,
  Thread,
  ThreadId,
  WorkItem,
} from './contract.js';

export const fakeScope = 'factory-v2-demo';
const repositoryId = 'repository:demo';
export const factorySource = 'source:factory';
const githubSource = 'source:github';
const t3Source = 'source:t3';
const sourceIds: readonly SourceId[] = [factorySource, githubSource, t3Source];
export function known<Value>(
  value: Value,
  at: string,
  sourceId: SourceId = factorySource
): Fact<Value> {
  return { state: 'known', value, sourceId, observedAt: at };
}
export function issueId(n: number): IssueId {
  return `issue:${n}`;
}
export function jobId(n: number): JobId {
  return `job:${n}`;
}
export function pullId(n: number): PullRequestId {
  return `pr:${n}`;
}
export function threadId(n: number): ThreadId {
  return `thread:${n}`;
}
export function startId(n: number): ActionId {
  return `action:start-${n}`;
}
export function cancelId(n: number): ActionId {
  return `action:cancel-${n}`;
}
export function resumeId(n: number): ActionId {
  return `action:resume-${n}`;
}

function issue(n: number, title: string, at: string): Issue {
  return {
    id: issueId(n),
    version: '1',
    repositoryId,
    number: n,
    metadata: known(
      {
        title,
        url: `https://example.invalid/factory/issues/${n}`,
        state: 'open',
        updatedAt: at,
        labelIds: ['label:infrastructure'],
        assigneeIds: ['user:demo'],
        commentCount: 2,
      },
      at,
      githubSource
    ),
    project: known(
      {
        projectId: 'demo-project',
        status: { id: 'planned', name: 'Planned', rank: null },
        priority: { id: 'p1', name: 'P1', rank: 1 },
        size: { id: 'small', name: 'S', rank: 1 },
      },
      at,
      githubSource
    ),
    eligibility: {
      state: n === 1001 ? 'allowed' : 'blocked',
      reasons:
        n === 1001
          ? []
          : [
              {
                code: 'demo-ineligible',
                message: 'This sample is context, already admitted, or blocked.',
              },
            ],
      sourceIds: [factorySource],
    },
  };
}
function pull(
  n: number,
  title: string,
  draft: boolean,
  conflict: boolean,
  at: string
): PullRequest {
  const comparison = {
    headOid: String(n).padStart(40, 'a'),
    baseOid: 'b'.repeat(40),
    baseRef: n === 2004 ? 'demo/pr-2003' : 'main',
  };
  return {
    id: pullId(n),
    version: '1',
    repositoryId,
    number: n,
    metadata: known(
      {
        title,
        url: `https://example.invalid/factory/pull/${n}`,
        state: 'open',
        draft,
        labelIds: ['label:infrastructure'],
        headRef: `demo/pr-${n}`,
        baseRef: comparison.baseRef,
        comparison,
        mergeability: conflict ? 'conflicting' : 'clean',
        updatedAt: at,
      },
      at,
      githubSource
    ),
    checks: known(
      {
        comparison,
        state: draft ? 'pending' : 'passed',
        complete: true,
        groups: ['CI', 'Browser E2E', 'Coverage', 'Type checking'].map((name, index) => ({
          id: `check-${n}-${index}`,
          name,
          state: draft && index === 0 ? 'running' : 'passed',
          requirement: 'required',
          total: 1,
          completed: draft && index === 0 ? 0 : 1,
          url: `https://example.invalid/checks/${n}/${index}`,
        })),
      },
      at,
      githubSource
    ),
    reviews: known(
      {
        comparison,
        state: 'required',
        complete: true,
        reviewers: [
          { userId: 'user:demo', state: 'requested', submittedAt: null, reviewedHeadOid: null },
        ],
      },
      at,
      githubSource
    ),
    readiness: {
      state: 'not-ready',
      reasons: [
        {
          code: conflict ? 'conflict' : draft ? 'ci-pending' : 'human-review',
          message: 'Simulated PR acceptance is pending.',
        },
      ],
      sourceIds: [factorySource],
    },
  };
}
export function fakeJob(n: number, at: string, active = true): Job {
  return {
    id: jobId(n),
    version: '1',
    issueId: issueId(n),
    pullRequestId: n === 1003 || n === 1006 ? pullId(n + 1000) : null,
    threadId: threadId(n),
    startedAt: at,
    stage: n === 1003 || n === 1006 ? 'ci' : 'implementation',
    activity: n === 1005 ? 'manual-recovery' : 'implementing',
    activityStartedAt: at,
    deadline: null,
    progress: 'Simulated execution. No worker is running.',
    execution: known(
      {
        runId: `demo-run-${n}`,
        state: n === 1005 ? 'interrupted' : active ? 'running' : 'finished',
      },
      at,
      t3Source
    ),
    occupiesCapacity: active,
    cancelled: false,
    question: null,
  };
}
export function fakeThread(n: number, at: string): Thread {
  return {
    id: threadId(n),
    version: '1',
    metadata: known(
      {
        title: `Demo thread for issue ${n}`,
        createdAt: at,
        updatedAt: at,
        status: 'simulated',
        environmentId: 'demo-environment',
        threadId: `demo-${n}`,
        webUrl: `https://t3.example.invalid/demo/${n}`,
        nativeUrl: null,
      },
      at,
      t3Source
    ),
    association: {
      state: 'confirmed',
      issueIds: [issueId(n)],
      pullRequestIds: n === 1003 || n === 1006 ? [pullId(n + 1000)] : [],
      evidence: 'factory-binding',
    },
  };
}
function item(n: number, code: StatusCode, at: string): WorkItem {
  const pr = [1003, 1004, 1006].includes(n);
  const jobs = [1002, 1003, 1005, 1006].includes(n);
  return {
    id: `item:${n}`,
    version: '1',
    subject: pr
      ? {
          kind: 'pull-request',
          pullRequestId: pullId(n + 1000),
          issueIds: [issueId(n)],
          metadataIssueId: issueId(n),
        }
      : { kind: 'issue', issueId: issueId(n) },
    section: pr ? 'in-review' : n === 1002 || n === 1005 ? 'working' : 'planned',
    status: {
      code,
      label: code.split('-').join(' '),
      active: ['implementing', 'ci-running', 'conflict'].includes(code),
      since: at,
    },
    attention:
      code === 'needs-review' || code === 'manual-recovery'
        ? {
            state: 'required',
            sourceIds: [factorySource],
            reasons: [
              {
                code,
                message: 'Simulated human-attention example.',
                actionIds: n === 1005 ? [resumeId(n)] : [],
              },
            ],
          }
        : { state: 'none', sourceIds: [factorySource] },
    jobIds: jobs ? [jobId(n)] : [],
    maintenanceIds: n === 1006 ? ['maintenance:1006'] : [],
    threadIds: jobs ? [threadId(n)] : [],
    actionIds:
      n === 1002 || n === 1005 ? [resumeId(n), cancelId(n)] : n === 1001 ? [startId(n)] : [],
  };
}
const disabled = {
  state: 'disabled',
  reasons: [{ code: 'demo-ineligible', message: 'Unavailable in this sample state.' }],
} as const;
export function fakeActions(
  snapshot: FactoryV2Snapshot,
  version: string
): FactoryV2Snapshot['entities']['actions'] {
  const actions: Record<ActionId, Action> = {};
  const capacity = snapshot.meta.factory.concurrency.limit;
  const allowance = snapshot.meta.factory.admission.limit;
  const space =
    (capacity.kind === 'unlimited' ||
      snapshot.meta.factory.concurrency.occupied < capacity.maximum) &&
    (allowance.kind === 'unlimited' ||
      snapshot.meta.factory.admission.consumed < allowance.maximum);
  const availability = (allowed: boolean): Action['availability'] =>
    allowed ? { state: 'available', precondition: `${version}:demo`, validUntil: null } : disabled;
  actions['action:configure'] = {
    id: 'action:configure',
    version,
    kind: 'configure',
    targetId: 'factory:demo',
    availability: availability(true),
  };
  actions['action:preview'] = {
    id: 'action:preview',
    version,
    kind: 'preview-plan',
    targetId: 'factory:demo',
    availability: availability(true),
  };
  for (const issue of Object.values(snapshot.entities.issues)) {
    const admitted = Object.values(snapshot.entities.jobs).some((job) => job.issueId === issue.id);
    const id = startId(issue.number);
    actions[id] = {
      id,
      version,
      kind: 'start',
      targetId: issue.id,
      availability: availability(
        issue.eligibility.state === 'allowed' && !admitted && !snapshot.meta.factory.paused && space
      ),
    };
  }
  for (const job of Object.values(snapshot.entities.jobs)) {
    const number = snapshot.entities.issues[job.issueId].number;
    const resume = resumeId(number),
      cancel = cancelId(number);
    const resumeSpace =
      job.occupiesCapacity ||
      capacity.kind === 'unlimited' ||
      snapshot.meta.factory.concurrency.occupied < capacity.maximum;
    actions[resume] = {
      id: resume,
      version,
      kind: 'resume',
      targetId: job.id,
      availability: availability(
        !job.cancelled && job.activity === 'manual-recovery' && resumeSpace
      ),
    };
    actions[cancel] = {
      id: cancel,
      version,
      kind: 'cancel',
      targetId: job.id,
      availability: availability(!job.cancelled && job.stage === 'implementation'),
    };
  }
  return actions;
}
export function fakeFixture(cursor: string, at: string): FactoryV2Snapshot {
  const issues = [
    issue(1000, 'Factory v2 sample parent', at),
    issue(1001, 'Add a searchable issue list', at),
    issue(1002, 'Implement the command centre', at),
    issue(1003, 'Review observation metadata', at),
    issue(1004, 'Wait for browser checks', at),
    issue(1005, 'Reconcile a paused worker', at),
    issue(1006, 'Recover a conflicting PR', at),
    issue(1007, 'Publish after prerequisites', at),
  ];
  const relationships: Relationship[] = issues
    .filter((entry) => entry.number !== 1000)
    .map((entry) => ({
      id: `relationship:parent-${entry.number}`,
      version: '1',
      kind: 'parent',
      parentIssueId: issueId(1000),
      childIssueId: entry.id,
      evidence: known('github-native', at, githubSource),
    }));
  relationships.push({
    id: 'relationship:blocker',
    version: '1',
    kind: 'prerequisite',
    prerequisiteIssueId: issueId(1002),
    dependantIssueId: issueId(1007),
    evidence: known('github-native', at, githubSource),
    satisfaction: {
      state: 'unsatisfied',
      reasons: [{ code: 'pending', message: 'The sample implementation is still running.' }],
    },
  });
  relationships.push({
    id: 'relationship:stack',
    version: '1',
    kind: 'pr-base',
    basePullRequestId: pullId(2003),
    tipPullRequestId: pullId(2004),
    evidence: known('factory-journal', at),
  });
  for (const n of [1003, 1004, 1006])
    relationships.push({
      id: `relationship:pr-${n}`,
      version: '1',
      kind: 'issue-pr',
      issueId: issueId(n),
      pullRequestId: pullId(n + 1000),
      evidence: known('factory-binding', at),
      ownership: 'confirmed',
    });
  const jobs = [
    fakeJob(1002, at),
    fakeJob(1003, at, false),
    fakeJob(1005, at, false),
    fakeJob(1006, at, false),
  ];
  const snapshot: FactoryV2Snapshot = {
    apiVersion: 2,
    scopeId: fakeScope,
    cursor,
    committedAt: at,
    meta: {
      dataMode: 'fake',
      coverage: { state: 'complete', reasons: [], unresolvedIssueIds: [] },
      diagnostics: [
        {
          code: 'fake-data',
          message:
            'In-memory sample data. No GitHub, T3, database or real factory commands are connected.',
        },
      ],
      factory: {
        id: 'factory:demo',
        planning: {
          maximumAttempts: 3,
          consecutiveModelDeadlineFailures: 0,
          pendingNoticeCount: 0,
          notice: null,
        },
        version: '1',
        paused: false,
        concurrency: { limit: { kind: 'limited', maximum: 4 }, occupied: 2 },
        admission: { limit: { kind: 'limited', maximum: 10 }, consumed: 4 },
        actionIds: ['action:configure', 'action:preview'],
      },
      currentPlanId: null,
      transport: { changes: true, events: true, suggestedPollMs: 1000 },
    },
    entities: {
      repositories: {
        [repositoryId]: {
          id: repositoryId,
          version: '1',
          owner: 'demo',
          name: 'factory',
          url: 'https://example.invalid/factory',
          defaultBranch: 'main',
        },
      },
      sources: Object.fromEntries(
        sourceIds.map((id) => [
          id,
          {
            id,
            version: '1',
            kind: id === factorySource ? 'factory' : id === githubSource ? 'github' : 't3',
            observedAt: at,
            staleAt: null,
            refresh: 'idle',
            lastAttemptAt: at,
            nextAttemptAt: null,
            failure: null,
          },
        ])
      ),
      users: {
        'user:demo': {
          id: 'user:demo',
          version: '1',
          login: 'demo-reviewer',
          name: 'Demo reviewer',
          avatarUrl: null,
          url: 'https://example.invalid/users/reviewer',
        },
      },
      labels: {
        'label:infrastructure': {
          id: 'label:infrastructure',
          version: '1',
          repositoryId,
          name: 'agent infrastructure',
          color: '056c3c',
        },
      },
      issues: Object.fromEntries(issues.map((entry) => [entry.id, entry])),
      pullRequests: Object.fromEntries(
        [
          pull(2003, 'Expose observation metadata', false, false, at),
          pull(2004, 'Add browser tests', true, false, at),
          pull(2006, 'Recover conflicts', false, true, at),
        ].map((entry) => [entry.id, entry])
      ),
      relationships: Object.fromEntries(relationships.map((entry) => [entry.id, entry])),
      stacks: {
        'stack:demo': {
          id: 'stack:demo',
          version: '1',
          pullRequestIdsBaseToTip: [pullId(2003), pullId(2004)],
          base: { ref: 'main', oid: 'b'.repeat(40) },
          evidence: known('factory-journal', at),
        },
      },
      threads: Object.fromEntries(
        jobs.map((entry) => {
          const value = fakeThread(snapshotNumber(entry.issueId), at);
          return [value.id, value];
        })
      ),
      jobs: Object.fromEntries(jobs.map((entry) => [entry.id, entry])),
      maintenance: {
        'maintenance:1006': {
          id: 'maintenance:1006',
          version: '1',
          issueId: issueId(1006),
          pullRequestId: pullId(2006),
          threadId: threadId(1006),
          phase: 'resolving',
          resolution: 'unknown',
          progress: 'Automatic conflict resolution, simulated.',
          startedAt: at,
          occupiesCapacity: true,
        },
      },
      items: Object.fromEntries(
        (
          [
            ['ready', 1001],
            ['implementing', 1002],
            ['needs-review', 1003],
            ['ci-running', 1004],
            ['manual-recovery', 1005],
            ['conflict', 1006],
            ['blocked', 1007],
          ] as const
        ).map(([status, n]) => {
          const value = item(n, status, at);
          return [value.id, value];
        })
      ),
      actions: {},
      plans: {},
    },
  };
  return { ...snapshot, entities: { ...snapshot.entities, actions: fakeActions(snapshot, '1') } };
}
function snapshotNumber(id: IssueId) {
  return Number(id.slice('issue:'.length));
}
