import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { expect, it } from 'vitest';
import { githubObservations } from '../src/adapters/github/index.js';

const connection = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false } });
const issueUrl = (number: number) => `https://github.com/rafaeltab/wallpaperdb/issues/${number}`;
const timestamp = '2026-11-13T12:00:00Z';
type Reference = { number: number; url: string };
type ProjectEntry = {
  project: { id: string; title: string; number: number; owner: { login: string } };
  priority: { name: string; optionId: string } | null;
  size: null;
  fieldValueByName: null;
};

function issueFixture(number = 1) {
  return {
    number,
    url: issueUrl(number),
    title: 'First requirements',
    updatedAt: timestamp,
    body: 'Requirements',
    state: 'OPEN',
    author: { login: 'rafaeltab' },
    parent: null,
    labels: connection([{ name: 'ready-for-agent' }]),
    assignees: connection([]),
    comments: { totalCount: 0 },
    projectItems: connection<ProjectEntry>([]),
    closedByPullRequestsReferences: connection([]),
    timelineItems: connection([]),
    blockedBy: connection<Reference>([]),
  };
}

function pullFixture() {
  const head = 'a'.repeat(40);
  return {
    __typename: 'PullRequest',
    number: 3,
    url: 'https://github.com/rafaeltab/wallpaperdb/pull/3',
    title: 'Published work',
    isDraft: false,
    updatedAt: timestamp,
    labels: connection([]),
    closingIssuesReferences: connection<Reference>([]),
    mergeable: 'MERGEABLE',
    reviewRequests: connection([]),
    state: 'OPEN',
    headRefOid: head,
    headRefName: 'issue-3',
    baseRefOid: 'b'.repeat(40),
    baseRefName: 'main',
    reviewDecision: 'REVIEW_REQUIRED',
    reviews: connection<{ state: string; commit: { oid: string } }>([]),
    commits: { nodes: [{ commit: { oid: head, statusCheckRollup: { state: 'PENDING' } } }] },
  };
}

function projectMember(value: ReturnType<typeof issueFixture> | ReturnType<typeof pullFixture>) {
  const kind = value.url.includes('/pull/') ? 'PullRequest' : 'Issue';
  return {
    id: `${kind}-${value.number}`,
    updatedAt: value.updatedAt,
    isArchived: false,
    content: {
      __typename: kind,
      number: value.number,
      url: value.url,
      state: value.state,
      updatedAt: value.updatedAt,
    },
  };
}

async function withSource(test: (fixture: ReturnType<typeof githubFixture>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'factory-project-sync-'));
  try {
    await test(githubFixture(directory));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function githubFixture(directory: string) {
  const first = issueFixture();
  const filters: string[] = [];
  const delta: { members?: ReturnType<typeof projectMember>[] } = {};
  const fixture = {
    issues: new Map([[first.number, first]]),
    pulls: new Map<number, ReturnType<typeof pullFixture>>(),
    members: [projectMember(first)],
    delta,
    filters,
    now: Date.parse('2026-11-13T12:01:00Z'),
    details: 0,
    failDetails: false,
    failRelationships: false,
    pagination: 'complete',
    sync: () => Effect.runPromise(source().read()),
  };
  const read = async (args: string[]) => {
    const query = args.join(' ');
    if (query.includes('projectV2(number:7)')) {
      const filter = /query:("(?:[^"\\]|\\.)*")/.exec(query)?.[1];
      if (filter === undefined) throw new Error('Missing project filter');
      const decoded: string = JSON.parse(filter);
      filters.push(decoded);
      const nodes = decoded ? (delta.members ?? fixture.members) : fixture.members;
      const page = (hasNextPage: boolean, endCursor: string | null) => ({
        data: {
          user: { projectV2: { id: 'P7', items: { nodes, pageInfo: { hasNextPage, endCursor } } } },
        },
      });
      if (fixture.pagination === 'truncated') return [page(true, 'next')];
      if (fixture.pagination === 'broken-chain') return [page(false, null), page(false, null)];
      return [page(false, null)];
    }
    const entries: [string, unknown][] = [];
    for (const match of query.matchAll(/([ip])(\d+):(?:issue|pullRequest)\(number:(\d+)\)/g)) {
      const number = Number(match[3]);
      if (match[1] === 'i') {
        const value = fixture.issues.get(number);
        if (!value) throw new Error(`Missing controlled issue ${number}`);
        if (query.includes('body state')) {
          fixture.details++;
          if (fixture.failDetails) throw new Error('Detail collection failed');
          entries.push([`i${number}`, value]);
        } else if (query.includes('blockedBy')) {
          if (fixture.failRelationships) throw new Error('Relationship collection failed');
          entries.push([
            `i${number}`,
            {
              number,
              url: value.url,
              parent: value.parent,
              comments: value.comments,
              blockedBy: value.blockedBy,
              timelineItems: value.timelineItems,
              closedByPullRequestsReferences: value.closedByPullRequestsReferences,
              ...(query.includes('projectItems(')
                ? {
                    author: value.author,
                    labels: value.labels,
                    assignees: value.assignees,
                    projectItems: value.projectItems,
                  }
                : {}),
            },
          ]);
        } else
          entries.push([
            `i${number}`,
            {
              number,
              url: value.url,
              author: value.author,
              parent: value.parent,
              labels: value.labels,
              assignees: value.assignees,
              comments: value.comments,
              projectItems: value.projectItems,
            },
          ]);
      } else {
        const value = fixture.pulls.get(number);
        if (!value) throw new Error(`Missing controlled PR ${number}`);
        const { title, isDraft, updatedAt, ...runtime } = value;
        entries.push([
          `p${number}`,
          query.includes('title isDraft')
            ? {
                number,
                url: value.url,
                __typename: value.__typename,
                title,
                isDraft,
                updatedAt,
              }
            : runtime,
        ]);
      }
    }
    if (entries.length) return { data: { repository: Object.fromEntries(entries) } };
    throw new Error(`Unexpected GitHub request ${query}`);
  };
  const source = () =>
    githubObservations('/repository', () => Effect.succeed([]), undefined, read, {
      directory,
      now: () => fixture.now,
    });
  return fixture;
}

it('rejects an unknown project content state instead of silently removing an issue from discovery', async () => {
  await withSource(async (fixture) => {
    fixture.members[0].content.state = 'UNRECOGNIZED';
    await expect(fixture.sync()).rejects.toMatchObject({ _tag: 'Unavailable' });
  });
});

it('refreshes markerless shared presentation changes for cached closed dependency context after reopen', async () => {
  await withSource(async (fixture) => {
    fixture.issues.set(1, {
      ...issueFixture(),
      blockedBy: connection([{ number: 2, url: issueUrl(2) }]),
    });
    const closed = {
      ...issueFixture(2),
      state: 'CLOSED',
      labels: connection([{ id: 'L2', name: 'original-label', color: 'aaaaaa' }]),
      projectItems: connection([
        {
          project: { id: 'P7', title: 'WallpaperDB', number: 7, owner: { login: 'rafaeltab' } },
          priority: { name: 'P1', optionId: 'priority-1' },
          size: null,
          fieldValueByName: null,
        },
      ]),
    };
    fixture.issues.set(2, closed);
    fixture.members.push(projectMember(closed));
    expect((await fixture.sync()).issues.find((value) => value.number === 2)).toMatchObject({
      open: false,
      labelDetails: [{ name: 'original-label', color: 'aaaaaa' }],
      projectPriority: 'P1',
    });
    fixture.issues.set(2, {
      ...closed,
      labels: connection([{ id: 'L2', name: 'renamed-label', color: 'bbbbbb' }]),
      projectItems: connection([
        { ...closed.projectItems.nodes[0], priority: { name: 'P2', optionId: 'priority-1' } },
      ]),
    });
    fixture.now += 300_001;
    expect((await fixture.sync()).issues.find((value) => value.number === 2)).toMatchObject({
      open: false,
      labelDetails: [{ name: 'renamed-label', color: 'bbbbbb' }],
      projectPriority: 'P2',
    });
  });
});

it('reuses unchanged details across SQLite reopen and refreshes content changes independently of the project timestamp', async () => {
  await withSource(async (fixture) => {
    expect((await fixture.sync()).issues[0]?.title).toBe('First requirements');
    expect((await fixture.sync()).issues[0]?.title).toBe('First requirements');
    expect(fixture.details).toBe(1);
    const changed = {
      ...issueFixture(),
      title: 'Changed requirements',
      updatedAt: '2026-11-13T12:00:10Z',
    };
    fixture.issues.set(1, changed);
    fixture.members[0] = { ...projectMember(changed), updatedAt: timestamp };
    expect((await fixture.sync()).issues[0]?.title).toBe('Changed requirements');
    expect(fixture.details).toBe(2);
  });
});

it('refreshes project fields when only the item timestamp changes', async () => {
  await withSource(async (fixture) => {
    expect((await fixture.sync()).issues[0]?.projectPriority).toBeNull();
    fixture.issues.set(1, {
      ...issueFixture(),
      projectItems: connection([
        {
          project: { id: 'P7', title: 'WallpaperDB', number: 7, owner: { login: 'rafaeltab' } },
          priority: { name: 'P1', optionId: 'priority-1' },
          size: null,
          fieldValueByName: null,
        },
      ]),
    });
    fixture.members[0] = { ...projectMember(issueFixture()), updatedAt: '2026-11-13T12:00:10Z' };
    expect((await fixture.sync()).issues[0]?.projectPriority).toBe('P1');
    expect(fixture.details).toBe(2);
  });
});

it('refreshes shared label and project presentation when neither update timestamp changes', async () => {
  await withSource(async (fixture) => {
    await fixture.sync();
    fixture.issues.set(1, {
      ...issueFixture(),
      labels: connection([{ name: 'agent-queue' }]),
      projectItems: connection([
        {
          project: { id: 'P7', title: 'WallpaperDB', number: 7, owner: { login: 'rafaeltab' } },
          priority: { name: 'P2', optionId: 'priority-2' },
          size: null,
          fieldValueByName: null,
        },
      ]),
    });
    expect((await fixture.sync()).issues[0]).toMatchObject({
      candidate: false,
      labels: ['agent-queue'],
      projectPriority: 'P2',
    });
    expect(fixture.details).toBe(1);
  });
});

it('rechecks details captured before timestamps settle even when both markers stay unchanged', async () => {
  await withSource(async (fixture) => {
    fixture.now = Date.parse(timestamp) + 1000;
    expect((await fixture.sync()).issues[0]?.title).toBe('First requirements');
    fixture.issues.set(1, {
      ...issueFixture(),
      title: 'Changed within the same timestamp',
      body: 'Requirements changed before the update marker settled',
    });
    fixture.now += 300_001;
    expect((await fixture.sync()).issues[0]?.title).toBe('Changed within the same timestamp');
  });
});

it('keeps the successful checkpoint and details when hydration fails across a UTC day boundary', async () => {
  await withSource(async (fixture) => {
    fixture.now = Date.parse('2026-11-13T23:59:00Z');
    await fixture.sync();
    const changed = {
      ...issueFixture(),
      title: 'Updated scope',
      updatedAt: '2026-11-14T00:00:00Z',
    };
    fixture.issues.set(1, changed);
    fixture.members = [projectMember(changed)];
    fixture.now = Date.parse('2026-11-14T00:01:00Z');
    fixture.failDetails = true;
    await expect(fixture.sync()).rejects.toMatchObject({ _tag: 'Unavailable' });
    fixture.failDetails = false;
    fixture.now = Date.parse('2026-11-14T00:02:00Z');
    expect((await fixture.sync()).issues[0]?.title).toBe('Updated scope');
    expect(fixture.filters).toEqual(['', 'updated:>=2026-11-12', 'updated:>=2026-11-12']);
    expect(fixture.details).toBe(3);
  });
});

it('does not publish hydrated details if later relationship collection fails', async () => {
  await withSource(async (fixture) => {
    await fixture.sync();
    const changed = {
      ...issueFixture(),
      title: 'Updated scope',
      updatedAt: '2026-11-13T12:00:10Z',
    };
    fixture.issues.set(1, changed);
    fixture.members = [projectMember(changed)];
    fixture.failRelationships = true;
    await expect(fixture.sync()).rejects.toMatchObject({ _tag: 'Unavailable' });
    fixture.failRelationships = false;
    expect((await fixture.sync()).issues[0]?.title).toBe('Updated scope');
    expect(fixture.details).toBe(3);
  });
});

it.each(['truncated', 'broken-chain'])(
  'rejects %s pagination without losing the last successful checkpoint',
  async (pagination) => {
    await withSource(async (fixture) => {
      fixture.now = Date.parse('2026-11-13T23:59:00Z');
      await fixture.sync();
      fixture.now = Date.parse('2026-11-14T00:01:00Z');
      fixture.pagination = pagination;
      await expect(fixture.sync()).rejects.toMatchObject({ _tag: 'Unavailable' });
      fixture.pagination = 'complete';
      expect((await fixture.sync()).issues[0]?.number).toBe(1);
      expect(fixture.filters).toEqual(['', 'updated:>=2026-11-12', 'updated:>=2026-11-12']);
      expect(fixture.details).toBe(1);
    });
  }
);

it('keeps missing delta members until a complete membership reconciliation removes them', async () => {
  await withSource(async (fixture) => {
    expect((await fixture.sync()).issues.map((item) => item.number)).toEqual([1]);
    fixture.members = [];
    fixture.delta.members = [];
    fixture.now += 60_000;
    expect((await fixture.sync()).issues.map((item) => item.number)).toEqual([1]);
    fixture.now += 5 * 60_000;
    expect((await fixture.sync()).issues).toEqual([]);
    expect(fixture.filters).toEqual(['', 'updated:>=2026-11-12', '']);
  });
});

it('observes readiness-label removal and closure through changed members', async () => {
  await withSource(async (fixture) => {
    expect((await fixture.sync()).issues[0]?.candidate).toBe(true);
    const noLabel = {
      ...issueFixture(),
      labels: connection<{ name: string }>([]),
      updatedAt: '2026-11-13T12:00:10Z',
    };
    fixture.issues.set(1, noLabel);
    fixture.members = [projectMember(noLabel)];
    expect((await fixture.sync()).issues[0]).toMatchObject({
      open: true,
      candidate: false,
      labels: [],
    });
    const closed = { ...noLabel, state: 'CLOSED', updatedAt: '2026-11-13T12:00:20Z' };
    fixture.issues.set(1, closed);
    fixture.members = [projectMember(closed)];
    expect((await fixture.sync()).issues).toEqual([]);
  });
});

it('refreshes native blockers even when neither update timestamp changes', async () => {
  await withSource(async (fixture) => {
    expect((await fixture.sync()).issues[0]?.nativeBlockers).toEqual([]);
    fixture.issues.set(2, {
      ...issueFixture(2),
      state: 'CLOSED',
      labels: connection<{ name: string }>([]),
    });
    fixture.issues.set(1, {
      ...issueFixture(),
      blockedBy: connection([{ number: 2, url: issueUrl(2) }]),
    });
    expect((await fixture.sync()).issues.find((item) => item.number === 1)).toMatchObject({
      nativeBlockers: [2],
      blockers: [2],
    });
    fixture.issues.set(1, issueFixture());
    expect((await fixture.sync()).issues.find((item) => item.number === 1)?.nativeBlockers).toEqual(
      []
    );
  });
});

it('refreshes PR reviews, mergeability and CI independently of unchanged metadata markers', async () => {
  await withSource(async (fixture) => {
    const initial = pullFixture();
    fixture.pulls.set(3, initial);
    fixture.members.push(projectMember(initial));
    expect((await fixture.sync()).pullRequests[0]).toMatchObject({
      title: 'Published work',
      review: 'REVIEW_REQUIRED',
      ci: 'PENDING',
      mergeability: 'MERGEABLE',
    });
    fixture.pulls.set(3, {
      ...initial,
      mergeable: 'CONFLICTING',
      reviewDecision: 'CHANGES_REQUESTED',
      commits: {
        nodes: [{ commit: { oid: initial.headRefOid, statusCheckRollup: { state: 'FAILURE' } } }],
      },
    });
    expect((await fixture.sync()).pullRequests[0]).toMatchObject({
      title: 'Published work',
      review: 'CHANGES_REQUESTED',
      ci: 'FAILURE',
      mergeability: 'CONFLICTING',
    });
  });
});
