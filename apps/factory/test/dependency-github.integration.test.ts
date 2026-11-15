import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubIssues } from '../src/adapters/github/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
const intent: Intent = {
  id: 'job',
  issue: 758,
  issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/758',
  base: 'a'.repeat(40),
  context: '',
  branch: 'factory/job-job',
  createdAt: 1,
  expectedStage: 'implementation',
};
function projectItem(owner: string, number: number, status: string) {
  return {
    project: { owner: { login: owner }, number, title: 'WallpaperDB' },
    fieldValueByName: { name: status },
  };
}
function fixture() {
  let fallback = false;
  let status = 'Planned';
  let projects: ReturnType<typeof projectItem>[] | undefined;
  let prState = 'CLOSED';
  let prBranch = intent.branch;
  let prUrl = 'https://github.com/rafaeltab/wallpaperdb/pull/765';
  let wrongIssue = false;
  let projectRead: 'complete' | 'incomplete' | 'error' | 'wrong-issue' | 'wrong-repository' =
    'complete';
  const graph = new Map<number, number[]>([
    [758, [757]],
    [757, []],
  ]);
  const adapter = githubIssues(
    { project: '/unused', base: intent.base, prerequisites: [] },
    async (args) => {
      if (args[0] === 'api' && args[1] === 'graphql')
        return {
          ...(projectRead === 'error' ? { errors: [{ message: 'Unavailable project' }] } : {}),
          data: {
            repository: {
              issue: {
                number: projectRead === 'wrong-issue' ? 1 : intent.issue,
                url:
                  projectRead === 'wrong-repository'
                    ? 'https://github.com/other/wallpaperdb/issues/758'
                    : intent.issueUrl,
                projectItems: {
                  nodes: projects ?? [projectItem('rafaeltab', 7, status)],
                  pageInfo: { hasNextPage: projectRead === 'incomplete' },
                },
              },
            },
          },
        };
      if (args[0] === 'api') {
        if (fallback) throw new Error('HTTP 404');
        const number = Number(args[1]?.match(/issues\/(\d+)/)?.[1]);
        return [(graph.get(number) ?? []).map((number) => ({ number }))];
      }
      if (args[0] === 'pr')
        return [
          {
            url: prUrl,
            headRefName: prBranch,
            state: prState,
          },
        ];
      const number = Number(args[2]);
      if (!graph.has(number)) throw new Error('Could not resolve to an Issue');
      return {
        number: wrongIssue ? 1 : number,
        state: 'OPEN',
        url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
        body: fallback
          ? `Blocked by: ${(graph.get(number) ?? []).map((n) => `#${n}`).join(', ')}`
          : '',
      };
    }
  );
  return {
    adapter,
    graph,
    fallback: () => {
      fallback = true;
    },
    projects: (items: ReturnType<typeof projectItem>[]) => {
      projects = items;
    },
    status: (value: string) => {
      status = value;
    },
    pr: (value: string) => {
      prState = value;
    },
    prIdentity: (branch: string, url: string) => {
      prBranch = branch;
      prUrl = url;
    },
    projectRead: (value: typeof projectRead) => {
      projectRead = value;
    },
    wrongIssue: () => {
      wrongIssue = true;
    },
  };
}
it('validates unlabelled prerequisites and rejects nonexistent issues and cycles without writes', async () => {
  const f = fixture();
  if (!f.adapter.validateDependencies) throw new Error('Missing dependency contract');
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['757']))).toBe('valid');
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['999']))).toBe('invalid');
  f.graph.set(757, [758]);
  expect(await Effect.runPromise(f.adapter.validateDependencies(intent, ['757']))).toBe('cycle');
});
it.each([false, true])(
  'verifies native/fallback edges, open issue, owning PR closure and plan status: %s',
  async (fallback) => {
    const f = fixture();
    if (fallback) f.fallback();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(true);
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['759']))).toBe(false);
    f.pr('OPEN');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
    f.pr('CLOSED');
    f.status('In Progress');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
    f.status('Planned');
    f.wrongIssue();
    await expect(
      Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))
    ).rejects.toMatchObject({ operation: 'verify-dependency-handback' });
  }
);

it.each(['branch', 'repository'] as const)(
  'rejects unrelated closed PR evidence from the wrong %s',
  async (identity) => {
    const f = fixture();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(true);
    f.prIdentity(
      identity === 'branch' ? 'factory/unrelated' : intent.branch,
      identity === 'repository'
        ? 'https://github.com/other/wallpaperdb/pull/765'
        : 'https://github.com/rafaeltab/wallpaperdb/pull/765'
    );
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
  }
);

it.each([
  { owner: 'other-owner', number: 7 },
  { owner: 'rafaeltab', number: 8 },
])(
  'rejects a same-titled Planned project owned by $owner numbered $number',
  async ({ owner, number }) => {
    const f = fixture();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(true);
    f.projects([projectItem(owner, number, 'Planned')]);
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
  }
);
it.each([
  { owner: 'other-owner', number: 7 },
  { owner: 'rafaeltab', number: 8 },
])(
  'ignores another Planned project beside authoritative In Progress: $owner/$number',
  async ({ owner, number }) => {
    const f = fixture();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    f.projects([projectItem('rafaeltab', 7, 'In Progress'), projectItem(owner, number, 'Planned')]);
    expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
  }
);
it('requires membership in the authoritative project before accepting handback', async () => {
  const f = fixture();
  if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
  f.projects([]);
  expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(false);
});

it('accepts authoritative Planned membership beside an unrelated In Progress project', async () => {
  const f = fixture();
  if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
  f.projects([
    projectItem('other-owner', 7, 'In Progress'),
    projectItem('rafaeltab', 7, 'Planned'),
  ]);
  expect(await Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))).toBe(true);
});
it.each(['incomplete', 'error', 'wrong-issue', 'wrong-repository'] as const)(
  'withholds verification when project evidence is %s',
  async (value) => {
    const f = fixture();
    if (!f.adapter.verifyHandback) throw new Error('Missing verification contract');
    f.projectRead(value);
    await expect(
      Effect.runPromise(f.adapter.verifyHandback(intent, ['757']))
    ).rejects.toMatchObject({ operation: 'verify-dependency-handback' });
  }
);
