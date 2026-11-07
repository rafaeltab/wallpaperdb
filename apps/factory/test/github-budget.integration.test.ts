import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { githubIssues, githubRequests } from '../src/adapters/github/index.js';
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

it('retains normal issue translation through the shared budgeted GitHub adapter', async () =>
  withGithub(async (host, stop) => {
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
