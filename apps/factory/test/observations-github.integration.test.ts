import { Effect, Layer, ManagedRuntime } from 'effect';
import { expect, it } from 'vitest';
import { githubObservations, githubPlanning } from '../src/adapters/github/index.js';
import {
  LocalSnapshot,
  Observations,
  ObservationsLive,
  ObservationSource,
  ObservationStore,
} from '../src/capabilities/observe/index.js';
import { Time } from '../src/capabilities/job/index.js';
import { controlledObservations } from './fixtures/observations.js';
import { protocol } from './fixtures/setup.js';
const connection = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false } });
const issue = {
  number: 1,
  url: 'https://github.com/rafaeltab/wallpaperdb/issues/1',
  title: 'Complete requirements',
  body: 'Full requirements',
  state: 'OPEN',
  author: { login: 'rafaeltab' },
  labels: [{ name: 'ready-for-agent' }],
  comments: [],
};
const pr = (number: number, state: 'OPEN' | 'CLOSED' | 'MERGED') => ({
  __typename: 'PullRequest',
  number,
  url: `https://github.com/rafaeltab/wallpaperdb/pull/${number}`,
  state,
  headRefOid: 'a'.repeat(40),
  baseRefOid: 'b'.repeat(40),
  headRefName: `branch-${number}`,
  baseRefName: 'main',
  reviewDecision: null,
  reviews: connection([]),
  closingIssuesReferences: connection([]),
  commits: { nodes: [] },
});
async function withGithub(work: (host: Awaited<ReturnType<typeof protocol>>) => Promise<void>) {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await work(host);
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
}
it('retains native merged PRs, open PRs without issues and owner-specific project fields in fresh planner input', async () =>
  withGithub(async (host) => {
    await host.save({
      planning: {
        candidates: [1],
        issues: [issue],
        openPulls: [pr(43, 'OPEN')],
        nativePulls: { 1: [pr(42, 'MERGED')] },
        projectItems: [
          {
            project: { title: 'WallpaperDB', number: 7, owner: { login: 'other-owner' } },
            fieldValueByName: { name: 'Wrong' },
            priority: { name: 'P0' },
            size: { name: 'XL' },
          },
          {
            project: { title: 'WallpaperDB', number: 7, owner: { login: 'rafaeltab' } },
            fieldValueByName: { name: 'Planned' },
            priority: { name: 'P2' },
            size: { name: 'M' },
          },
        ],
      },
    });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.issues).toMatchObject([
      { projectStatus: 'Planned', projectPriority: 'P2', projectSize: 'M', pullRequests: [42] },
    ]);
    expect(facts.pullRequests.find((p) => p.number === 42)).toMatchObject({
      state: 'MERGED',
      linkedIssues: [1],
      crossReferencedIssues: [],
    });
    expect(facts.pullRequests.find((p) => p.number === 43)).toMatchObject({
      state: 'OPEN',
      linkedIssues: [],
      crossReferencedIssues: [],
    });
    const job = {
      retry: () => Effect.die('Unexpected fresh retry in this fixture'),
      status: () => Effect.succeed({ kind: 'empty' as const }),
      start: () => Effect.succeed({ kind: 'rejected' as const }),
      resume: () => Effect.succeed({ kind: 'rejected' as const }),
      cancel: () => Effect.succeed({ kind: 'rejected' as const }),
    };
    const input = await Effect.runPromise(
      githubPlanning({ project: host.repository, base: host.base, prerequisites: [] }, job).read()
    );
    expect(input.issues[0]?.metadata).toMatchObject({
      projectPriority: 'P2',
      projectSize: 'M',
      pullRequests: [{ number: 42, state: 'MERGED' }],
    });
  }));
it('preserves last-known facts on partial metadata and refuses a fresh planner result', async () =>
  withGithub(async (host) => {
    const planning = { candidates: [1], issues: [issue] };
    await host.save({ planning });
    let now = 10;
    const store = controlledObservations();
    const source = githubObservations(host.repository, () => Effect.succeed([]));
    const runtime = ManagedRuntime.make(
      ObservationsLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Time, { now: () => Effect.succeed(now) }),
            Layer.succeed(ObservationStore, store),
            Layer.succeed(ObservationSource, source),
            Layer.succeed(LocalSnapshot, {
              read: () =>
                Effect.succeed({
                  state: {
                    revision: 0,
                    concurrency: 1,
                    allowance: 1,
                    paused: true,
                    admissions: [],
                  },
                  entries: [],
                }),
            })
          )
        )
      )
    );
    try {
      const observer = await runtime.runPromise(Observations);
      await runtime.runPromise(observer.refresh());
      expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
        state: 'current',
        observedAt: 10,
        facts: { issues: [{ number: 1 }] },
      });
      now = 20;
      await host.save({ planning: { ...planning, incompleteMetadata: true } });
      await runtime.runPromise(observer.refresh());
      expect(await runtime.runPromise(observer.snapshot())).toMatchObject({
        state: 'error',
        observedAt: 10,
        failedAt: 20,
        facts: { issues: [{ number: 1 }] },
      });
      const job = {
        retry: () => Effect.die('Unexpected fresh retry in this fixture'),
        status: () => Effect.succeed({ kind: 'empty' as const }),
        start: () => Effect.succeed({ kind: 'rejected' as const }),
        resume: () => Effect.succeed({ kind: 'rejected' as const }),
        cancel: () => Effect.succeed({ kind: 'rejected' as const }),
      };
      await expect(
        Effect.runPromise(
          githubPlanning(
            { project: host.repository, base: host.base, prerequisites: [] },
            job
          ).read()
        )
      ).rejects.toMatchObject({ _tag: 'Unavailable' });
    } finally {
      await runtime.dispose();
    }
  }));
it('collects all open PR pages and fails closed when the last page is incomplete', async () =>
  withGithub(async (host) => {
    const page = (number: number, hasNextPage: boolean) => ({
      data: {
        repository: {
          pullRequests: {
            nodes: [pr(number, 'OPEN')],
            pageInfo: { hasNextPage, endCursor: hasNextPage ? 'next' : null },
          },
        },
      },
    });
    const planning = {
      candidates: [],
      issues: [],
      openPullPages: [page(42, true), page(43, false)],
    };
    await host.save({ planning });
    const source = githubObservations(host.repository, () => Effect.succeed([]));
    expect((await Effect.runPromise(source.read())).pullRequests.map((p) => p.number)).toEqual([
      42, 43,
    ]);
    await host.save({ planning: { ...planning, openPullPages: [page(42, true)] } });
    await expect(Effect.runPromise(source.read())).rejects.toMatchObject({ _tag: 'Unavailable' });
  }));
it.each(['parent', 'blocker'])(
  'rejects a foreign native %s without remapping its number to this repository',
  async (kind) =>
    withGithub(async (host) => {
      await host.save({
        planning: {
          candidates: [1],
          issues: [issue],
          ...(kind === 'parent'
            ? {
                foreignParent: {
                  number: 2,
                  url: 'https://github.com/rafaeltab/other-repo/issues/2',
                },
              }
            : {
                blockers: [
                  { number: 2, html_url: 'https://github.com/rafaeltab/other-repo/issues/2' },
                ],
              }),
        },
      });
      await expect(
        Effect.runPromise(githubObservations(host.repository, () => Effect.succeed([])).read())
      ).rejects.toMatchObject({ _tag: 'Unavailable' });
    })
);

it.each(['wallpaperdb', 'other-repo'])(
  'validates the repository of a non-ready indexed issue parent in %s',
  async (repository) =>
    withGithub(async (host) => {
      await host.save({
        planning: {
          candidates: [],
          issues: [
            {
              ...issue,
              labels: [],
              parent: {
                number: 2,
                url: `https://github.com/rafaeltab/${repository}/issues/2`,
              },
            },
            {
              ...issue,
              number: 2,
              url: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
              labels: [],
            },
          ],
        },
      });
      const result = Effect.runPromise(
        githubObservations(host.repository, () => Effect.succeed([])).read()
      );
      if (repository === 'wallpaperdb') {
        expect((await result).issues.find((value) => value.number === 1)).toMatchObject({
          candidate: false,
          nativeParent: 2,
          parents: [2],
        });
      } else {
        await expect(result).rejects.toMatchObject({ _tag: 'Unavailable' });
      }
    })
);

it('collects comparison-bound PR titles, drafts, mergeability, checks and reviewer identities', async () =>
  withGithub(async (host) => {
    const pull = {
      ...pr(43, 'OPEN'),
      title: 'Public v2 board',
      isDraft: true,
      updatedAt: '2026-11-06T12:00:00Z',
      mergeable: 'CONFLICTING',
      labels: connection([{ id: 'L1', name: 'backend', color: 'abcdef' }]),
      reviewRequests: connection([
        {
          requestedReviewer: {
            __typename: 'User',
            id: 'U1',
            login: 'reviewer',
            name: null,
            avatarUrl: 'https://github.com/avatar.png',
            url: 'https://github.com/reviewer',
          },
        },
      ]),
      commits: {
        nodes: [
          {
            commit: {
              oid: 'a'.repeat(40),
              statusCheckRollup: {
                state: 'SUCCESS',
                contexts: connection([
                  {
                    __typename: 'CheckRun',
                    id: 'C1',
                    name: 'typecheck',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                    detailsUrl: 'https://github.com/check/1',
                    startedAt: '2026-11-06T11:00:00Z',
                    completedAt: '2026-11-06T11:01:00Z',
                  },
                ]),
              },
            },
          },
        ],
      },
    };
    await host.save({
      planning: { candidates: [], issues: [], openPulls: [pull], requiredChecks: { C1: true } },
    });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.pullRequests[0]).toMatchObject({
      title: 'Public v2 board',
      draft: true,
      mergeability: 'CONFLICTING',
      labelDetails: [{ id: 'L1', name: 'backend', color: 'abcdef' }],
      checkRuns: [
        {
          id: 'C1',
          name: 'typecheck',
          state: 'passed',
          head: 'a'.repeat(40),
          requirement: 'required',
        },
      ],
      reviewers: [{ user: { login: 'reviewer' }, state: 'requested', head: null }],
    });
  }));

it('indexes non-ready open issues locally without fetching per-issue context for them', async () =>
  withGithub(async (host) => {
    await host.save({
      planning: {
        candidates: [],
        issues: [
          {
            ...issue,
            number: 91,
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/91',
            labels: [],
            updatedAt: '2026-11-06T12:00:00Z',
          },
        ],
      },
    });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.issues).toMatchObject([
      { number: 91, candidate: false, title: 'Complete requirements' },
    ]);
    expect(
      (await host.calls()).filter(
        (c) => c.binary === 'gh' && c.args.join(' ').includes('issue(number:91)')
      )
    ).toHaveLength(0);
  }));

it('collects a shared related PR once without nesting check/review connections in each issue query', async () =>
  withGithub(async (host) => {
    const second = {
      ...issue,
      number: 2,
      url: 'https://github.com/rafaeltab/wallpaperdb/issues/2',
    };
    const related = {
      ...pr(42, 'MERGED'),
      title: 'Shared prerequisite',
      isDraft: false,
      updatedAt: '2026-11-06T12:00:00Z',
    };
    await host.save({
      planning: {
        candidates: [1, 2],
        issues: [issue, second],
        nativePulls: { 1: [related], 2: [related] },
        openPulls: [pr(42, 'OPEN')],
        hydratedPulls: { 42: related },
      },
    });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.pullRequests).toMatchObject([
      { number: 42, state: 'MERGED', linkedIssues: [1, 2], title: 'Shared prerequisite' },
    ]);
    const calls = (await host.calls()).filter((c) => c.binary === 'gh' && c.args[1] === 'graphql');
    expect(calls.filter((c) => c.args.join(' ').includes('pullRequest(number:42)'))).toHaveLength(
      1
    );
    expect(
      calls
        .filter((c) => /issue\(number:\d+\)/.test(c.args.join(' ')))
        .every((c) => !c.args.join(' ').includes('reviews(first:'))
    ).toBe(true);
  }));

it('reports incomplete reviewer identities when GitHub requests review from a team', async () =>
  withGithub(async (host) => {
    const pull = {
      ...pr(43, 'OPEN'),
      reviewRequests: connection([{ requestedReviewer: { __typename: 'Team', id: 'TEAM1' } }]),
    };
    await host.save({ planning: { candidates: [], issues: [], openPulls: [pull] } });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.pullRequests[0]).toMatchObject({ reviewers: [], reviewersComplete: false });
  }));

it('collects local closing issue context while ignoring foreign repository references', async () =>
  withGithub(async (host) => {
    await host.save({
      planning: {
        candidates: [],
        issues: [{ ...issue, labels: [] }],
        openPulls: [
          {
            ...pr(43, 'OPEN'),
            closingIssuesReferences: connection([
              { number: 1, url: issue.url },
              { number: 9999, url: 'https://github.com/another/repository/issues/9999' },
            ]),
          },
        ],
      },
    });
    const facts = await Effect.runPromise(
      githubObservations(host.repository, () => Effect.succeed([])).read()
    );
    expect(facts.pullRequests[0]?.linkedIssues).toEqual([1]);
    const calls = (await host.calls()).filter((c) => c.binary === 'gh');
    expect(calls.some((c) => c.args.join(' ').includes('issue(number:1)'))).toBe(true);
    expect(calls.some((c) => c.args.join(' ').includes('issue(number:9999)'))).toBe(false);
  }));
