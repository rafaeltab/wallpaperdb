import { Effect } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { githubIssues, githubObservations, githubRequests } from '../src/adapters/github/index.js';
import { protocol } from './fixtures/setup.js';

async function withGithub(
  work: (host: Awaited<ReturnType<typeof protocol>>, stop: AbortController) => Promise<void>
) {
  const host = await protocol(),
    stop = new AbortController();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await work(host, stop);
  } finally {
    stop.abort();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
}

it.each([false, true])(
  'retains issue translation with an unrelated unavailable quota=%s',
  async (unavailableResource) =>
    withGithub(async (host, stop) => {
      await host.save({ githubRate: { unavailableResource } });
      const requests = githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: stop.signal,
      });
      const issues = githubIssues(
        { project: host.repository, base: host.base, prerequisites: [] },
        requests
      );
      expect(await Effect.runPromise(issues.inspect(577))).toMatchObject({
        open: true,
        title: 'Controlled issue',
        blockers: [],
        blockersReady: true,
      });
      expect(await host.calls()).toContainEqual(
        expect.objectContaining({
          binary: 'gh',
          args: expect.arrayContaining(['issue', 'view', '577']),
        })
      );
    })
);

it('backs off exponentially for CLI GraphQL throttling reported with HTTP 200', async () =>
  withGithub(async (host, stop) => {
    const startedAt = Date.now();
    let now = startedAt;
    const clock = {
      now: () => now,
      wait: async (milliseconds: number, signal: AbortSignal) => {
        signal.throwIfAborted();
        now += milliseconds;
      },
    };
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: stop.signal,
        clock,
      })
    );
    await host.save({ githubRate: { limited: true } });
    await expect(Effect.runPromise(issues.inspect(577))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await expect(Effect.runPromise(issues.inspect(577))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    await host.save({ githubRate: { limited: false } });
    expect(await Effect.runPromise(issues.inspect(577))).toMatchObject({ open: true });
    expect(clock.now() - startedAt).toBe(180_000);
  }));

it.each([429, 503])(
  'waits for the provider %s retry deadline before another request arrives',
  async (status) =>
    withGithub(async (host, stop) => {
      await host.save({ githubRate: { status, retryAfter: '2' } });
      const requests = githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: stop.signal,
      });
      const issues = githubIssues(
        { project: host.repository, base: host.base, prerequisites: [] },
        requests
      );
      await expect(Effect.runPromise(issues.inspect(577))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
      await host.save({ githubRate: { status: 200 } });
      expect(await Effect.runPromise(issues.inspect(577))).toMatchObject({
        open: true,
        blockersReady: true,
      });
      const received = await host.githubRequests();
      expect(received[1].at - received[0].at).toBeGreaterThanOrEqual(2000);
    })
);

it.each([
  { resetSeconds: 2, retrySeconds: 120 },
  { resetSeconds: 120, retrySeconds: 2 },
])(
  'retains the later exhausted-quota or retry deadline across reopen: %j',
  async ({ resetSeconds, retrySeconds }) =>
    withGithub(async (host, stop) => {
      const startedAt = Date.UTC(2026, 10, 7, 12);
      let now = startedAt;
      const clock = {
        now: () => now,
        wait: async (delay: number, signal: AbortSignal) => {
          signal.throwIfAborted();
          now += delay;
        },
      };
      const reopen = () =>
        githubIssues(
          { project: host.repository, base: host.base, prerequisites: [] },
          githubRequests({
            project: host.repository,
            directory: host.directory + '/state',
            signal: stop.signal,
            clock,
          })
        );
      await host.save({
        githubRate: {
          status: 429,
          retryAfter: String(retrySeconds),
          limit: 7200,
          remaining: 0,
          reset: startedAt / 1000 + resetSeconds,
        },
      });
      await expect(Effect.runPromise(reopen().inspect(577))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
      await host.save({
        githubRate: { limit: 7200, remaining: 7199, reset: startedAt / 1000 + 3600 },
      });
      expect(await Effect.runPromise(reopen().inspect(577))).toMatchObject({ open: true });
      expect(clock.now() - startedAt).toBeGreaterThanOrEqual(120_000);
    })
);

it('cancels a queued GitHub read during provider backoff without dispatching it', async () =>
  withGithub(async (host, stop) => {
    const now = Date.UTC(2026, 10, 7);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    await host.save({ githubRate: { status: 429, retryAfter: '2' } });
    const requests = githubRequests({
      project: host.repository,
      directory: host.directory + '/state',
      signal: stop.signal,
    });
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      requests
    );
    await expect(Effect.runPromise(issues.inspect(577))).rejects.toMatchObject({
      _tag: 'Unavailable',
    });
    const count = (await host.calls()).filter((call) => call.binary === 'gh').length;
    await host.save({ githubRate: { status: 200 } });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(now);
    let settled = false;
    const pending = Effect.runPromise(issues.inspect(577));
    const observed = pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    expect((await host.calls()).filter((call) => call.binary === 'gh')).toHaveLength(count);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ _tag: 'Unavailable' });
    await observed;
  }));

it.each([
  { name: 'half of the reported quota', remaining: 7199, gap: 2000 },
  { name: 'additional shared-account pressure', remaining: 3600, gap: 4000 },
])('paces issue observations for $name', async ({ remaining, gap }) =>
  withGithub(async (host, stop) => {
    await host.save({
      githubRate: {
        limit: 7200,
        remaining,
        reset: Math.ceil((Date.now() + 3_600_000) / 1000),
      },
    });
    const requests = githubRequests({
      project: host.repository,
      directory: host.directory + '/state',
      signal: stop.signal,
    });
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      requests
    );
    await Effect.runPromise(issues.inspect(577));
    await Effect.runPromise(issues.inspect(578));
    const views = (await host.githubRequests()).filter(
      (call) => call.args[0] === 'issue' && call.args[1] === 'view'
    );
    expect(views).toHaveLength(2);
    expect(views[1].at - views[0].at).toBeGreaterThanOrEqual(gap);
  })
);

it('retains provider backoff when the GitHub request owner is reopened', async () =>
  withGithub(async (host, stop) => {
    const firstStop = new AbortController();
    await host.save({ githubRate: { status: 429, retryAfter: '2' } });
    const first = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: firstStop.signal,
      })
    );
    try {
      await expect(Effect.runPromise(first.inspect(577))).rejects.toMatchObject({
        _tag: 'Unavailable',
      });
    } finally {
      firstStop.abort();
    }
    await host.save({ githubRate: { status: 200 } });
    const reopened = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: stop.signal,
      })
    );
    expect(await Effect.runPromise(reopened.inspect(577))).toMatchObject({ open: true });
    const received = await host.githubRequests();
    expect(received[1].at - received[0].at).toBeGreaterThanOrEqual(2000);
  }));

it('accounts for explicit GraphQL costs on every page across metadata and issue observations', async () =>
  withGithub(async (host, stop) => {
    const startedAt = Date.now();
    let now = startedAt;
    const clock = {
      now: () => now,
      wait: async (delay: number, signal: AbortSignal) => {
        signal.throwIfAborted();
        now += delay;
      },
    };
    await host.save({
      githubRate: {
        limit: 7200,
        remaining: 7199,
        reset: Math.ceil((startedAt + 3_600_000) / 1000),
        cost: 3,
      },
      planning: {
        candidates: [],
        issues: [
          {
            number: 577,
            title: 'Controlled issue',
            body: '',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
            author: { login: 'rafaeltab' },
            labels: [],
            comments: [],
          },
        ],
        openPullPages: [
          {
            data: {
              repository: {
                pullRequests: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
              },
            },
          },
          {
            data: {
              repository: {
                pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
              },
            },
          },
        ],
      },
    });
    const requests = githubRequests({
      project: host.repository,
      directory: host.directory + '/state',
      signal: stop.signal,
      clock,
    });
    const source = githubObservations(
      host.repository,
      () => Effect.succeed([]),
      undefined,
      requests
    );
    expect(await Effect.runPromise(source.read())).toMatchObject({
      issues: [{ number: 577 }],
      pullRequests: [],
    });
    const afterMetadata = clock.now() - startedAt;
    expect(afterMetadata).toBeGreaterThanOrEqual(3000);
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      requests
    );
    expect(await Effect.runPromise(issues.inspect(577))).toMatchObject({ open: true });
    expect(clock.now() - startedAt - afterMetadata).toBeGreaterThanOrEqual(6000);
  }));

it('waits through primary exhaustion and obtains usable quota after the reset', async () =>
  withGithub(async (host, stop) => {
    const startedAt = Date.now(),
      reset = Math.ceil(startedAt / 1000) + 2;
    let now = startedAt;
    const clock = {
      now: () => now,
      wait: async (delay: number, signal: AbortSignal) => {
        signal.throwIfAborted();
        now += delay;
        if (now >= reset * 1000)
          await host.save({
            githubRate: {
              limit: 7200,
              remaining: 7199,
              reset: Math.ceil((now + 3_600_000) / 1000),
            },
          });
      },
    };
    await host.save({ githubRate: { limit: 7200, remaining: 0, reset } });
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      githubRequests({
        project: host.repository,
        directory: host.directory + '/state',
        signal: stop.signal,
        clock,
      })
    );
    expect(await Effect.runPromise(issues.inspect(577))).toMatchObject({ open: true });
    expect(clock.now()).toBeGreaterThanOrEqual(reset * 1000 + 1000);
  }));

it('serves admitted-work observations before already queued background collections', async () =>
  withGithub(async (host, stop) => {
    await host.save({
      hold: 'github-bootstrap',
      planning: {
        candidates: [],
        issues: [
          {
            number: 577,
            title: 'Controlled issue',
            body: '',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
            author: { login: 'rafaeltab' },
            labels: [],
            comments: [],
          },
        ],
        openPulls: [],
      },
    });
    const requests = githubRequests({
      project: host.repository,
      directory: host.directory + '/state',
      signal: stop.signal,
    });
    const metadata = (args: string[], signal?: AbortSignal) => requests(args, signal, 'background');
    const source = githubObservations(
      host.repository,
      () => Effect.succeed([]),
      undefined,
      metadata
    );
    const first = Effect.runPromise(source.read());
    void first.catch(() => undefined);
    await vi.waitFor(
      async () => expect(await readFile(host.directory + '/held', 'utf8')).toBe('github-bootstrap'),
      { timeout: 5000, interval: 20 }
    );
    const second = Effect.runPromise(source.read());
    void second.catch(() => undefined);
    const issues = githubIssues(
      { project: host.repository, base: host.base, prerequisites: [] },
      requests
    );
    const work = Effect.runPromise(issues.inspect(577));
    void work.catch(() => undefined);
    await writeFile(host.directory + '/release', 'continue');
    const [, , result] = await Promise.all([first, second, work]);
    expect(result).toMatchObject({ open: true });
    const received = await host.githubRequests();
    const issueView = received.findIndex(
      (call) => call.args[0] === 'issue' && call.args[1] === 'view'
    );
    const indexes = received.flatMap((call, index) =>
      call.args[0] === 'api' &&
      call.args[1] === 'graphql' &&
      call.args.some((a: string) => a.includes('issues('))
        ? [index]
        : []
    );
    expect(indexes).toHaveLength(2);
    expect(issueView).toBeGreaterThan(indexes[0]);
    expect(issueView).toBeLessThan(indexes[1]);
  }));

it('creates fresh shared prerequisite evidence once per metadata collection', async () =>
  withGithub(async (host) => {
    await host.save({
      planning: {
        candidates: [577, 578],
        issues: [577, 578].map((number) => ({
          number,
          title: `Issue ${number}`,
          body: '',
          state: 'OPEN',
          url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
          author: { login: 'rafaeltab' },
          labels: [{ name: 'ready-for-agent' }],
          comments: [],
        })),
        openPulls: [],
      },
    });
    let proofsRead = 0;
    const evaluation = Effect.gen(function* () {
      const proof = yield* Effect.cached(Effect.sync(() => ++proofsRead));
      return (_number: number) =>
        Effect.map(proof, (verifiedAt) => ({ allowed: true, blockersReady: true, verifiedAt }));
    });
    const source = githubObservations(host.repository, () => Effect.succeed([]), evaluation);
    const first = await Effect.runPromise(source.read());
    expect(first.issues.map((issue) => issue.evaluation?.verifiedAt)).toEqual([1, 1]);
    const second = await Effect.runPromise(source.read());
    expect(second.issues.map((issue) => issue.evaluation?.verifiedAt)).toEqual([2, 2]);
    expect(proofsRead).toBe(2);
  }));
