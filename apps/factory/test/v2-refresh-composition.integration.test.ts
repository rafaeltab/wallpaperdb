import { Effect } from 'effect';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore, fileStore } from '../src/adapters/store/index.js';
import type { FactoryV2Snapshot } from '../src/http/index.js';
import { protocol } from './fixtures/setup.js';

it('keeps cached reads and durable controls usable while GitHub requests are backing off', async () => {
  const host = await protocol(),
    previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({
      planning: { candidates: [], issues: [], openPulls: [] },
      githubRate: { status: 503, retryAfter: '2' },
    });
    await Effect.runPromise(
      fileScheduleStore(host.directory + '/state').save({
        revision: 0,
        concurrency: 1,
        allowance: 1,
        paused: true,
        admissions: [],
      })
    );
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
        expect(board.entities.sources['source:github'].failure?.code).toBe('provider-unavailable');
      },
      { timeout: 5000, interval: 20 }
    );
    const board = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(board.entities.sources['source:github'].observedAt).toBeNull();
    expect(board.meta.activity?.items).toEqual([]);
    expect(board.meta.activity?.admissionReasons).toContainEqual({
      code: 'paused',
      message: 'Admissions paused',
    });
    expect(board.meta.activity).not.toHaveProperty('status');
    for (let i = 0; i < 5; i++) {
      expect((await running.app.inject('/api/v2/board')).statusCode).toBe(200);
      expect((await running.app.inject('/health')).statusCode).toBe(200);
    }
    const configure = Object.values(board.entities.actions).find(
      (action) => action.kind === 'configure'
    );
    if (!configure || configure.availability.state !== 'available')
      throw new Error('Expected available controls');
    const commandId = '10000000-0000-4000-8000-000000000697';
    expect(
      (
        await running.app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: {
            commandId,
            kind: 'configure',
            actionId: configure.id,
            precondition: configure.availability.precondition,
            payload: {
              paused: true,
              concurrency: { kind: 'limited', maximum: 2 },
              admissionAllowance: { kind: 'limited', maximum: 1 },
            },
          },
        })
      ).statusCode
    ).toBe(202);
    await vi.waitFor(
      async () => {
        expect((await running!.app.inject(`/api/v2/commands/${commandId}`)).json()).toMatchObject({
          state: 'succeeded',
        });
      },
      { timeout: 3000, interval: 20 }
    );
    expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
      paused: true,
      concurrency: 2,
      admissions: [],
    });
    expect(await host.githubRequests()).toHaveLength(1);
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('gives automatic work a turn when recurring metadata wins cycle readiness', async () => {
  const nativeTimeout = globalThis.setTimeout;
  const pause = (milliseconds: number) =>
    new Promise<void>((resolve) => nativeTimeout(resolve, milliseconds));
  // Child I/O must settle without advancing the clock that controls this race.
  const waitForIO = async (check: () => Promise<void>) => {
    let failure: unknown;
    for (let attempt = 0; attempt < 250; attempt++) {
      try {
        await check();
        return;
      } catch (error) {
        failure = error;
      }
      await pause(20);
    }
    throw failure;
  };
  const startedAt = Math.floor(Date.now() / 1000) * 1000;
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(startedAt);
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({
      githubRate: { limit: 7200, remaining: 7200, reset: startedAt / 1000 + 3600, cost: 300 },
      planning: {
        candidates: [580],
        issues: [
          {
            number: 580,
            title: 'Ready work',
            body: 'Only this issue',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
        projectPages: [
          {
            data: {
              user: {
                projectV2: {
                  id: 'P7',
                  items: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                },
              },
            },
          },
        ],
      },
      planner: { proposal: { selected: [], deferred: [] } },
    });
    running = await startFactory({
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    const snapshot = async () => (await running!.app.inject('/api/scheduler')).json();
    const settled = () =>
      waitForIO(async () => {
        const value = await snapshot();
        expect(value.threads.observedAt).toBe(Date.now());
        if (value.observations.startedAt === Date.now())
          expect(value.observations.observedAt).toBe(Date.now());
      });
    await vi.advanceTimersByTimeAsync(500);
    await running.app.inject('/api/v2/board');
    await vi.advanceTimersByTimeAsync(0);
    await settled();
    expect((await snapshot()).observations.observedAt).toBe(startedAt + 500);
    for (let second = 0; second < 300; second++) {
      await vi.advanceTimersByTimeAsync(500);
      await pause(5);
      await vi.advanceTimersByTimeAsync(500);
      await pause(5);
      if (second % 20 === 0) await running.app.inject('/api/v2/board');
    }
    await settled();
    await vi.advanceTimersByTimeAsync(500);
    await waitForIO(async () =>
      expect(
        (await host.calls()).filter(
          (call) => call.binary === 'gh' && call.args[0] === 'issue' && call.args[1] === 'list'
        ).length
      ).toBeGreaterThan(0)
    );
  } finally {
    vi.useRealTimers();
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('plans with free capacity after retained CI observation has incurred quota cost', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    const state = host.directory + '/state';
    const intent = {
      id: 'retained-ci',
      issue: 579,
      issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/579',
      base: host.base,
      branch: 'factory/retained-ci',
      context: 'Retained work',
      createdAt: Date.now(),
      expectedStage: 'implementation' as const,
    };
    const store = fileStore(state);
    await Effect.runPromise(store.reserve(intent));
    await Effect.runPromise(store.claimLaunch());
    for (const [index, stage] of (
      ['implementation', 'review', 'publication', 'ci'] as const
    ).entries())
      await Effect.runPromise(
        store.saveStage({
          index,
          stage,
          threadId: 'thread-retained',
          commit: host.base,
          previousRunId: index ? 'run-1' : null,
        })
      );
    await Effect.runPromise(
      fileScheduleStore(state).save({
        revision: 0,
        concurrency: 3,
        allowance: 15,
        paused: false,
        admissions: [{ issue: intent.issue, base: intent.base, context: intent.context }],
      })
    );
    const worktree = host.directory + '/retained-worktree';
    execFileSync('git', ['worktree', 'add', '-b', intent.branch, worktree, host.base], {
      cwd: host.repository,
    });
    await writeFile(
      host.directory + '/resource.json',
      JSON.stringify({
        threadId: 'thread-retained',
        projectId: 'project-id',
        title: 'Factory retained-ci',
        providerInstanceId: 'codex',
        model: 'gpt-6.1-sol',
        branch: intent.branch,
        worktreePath: worktree,
        status: 'running',
        latestRunId: 'run-1',
        runCount: 1,
        pendingRequestCount: 0,
      })
    );
    await host.save({
      githubRate: { limit: 1000, remaining: 1000, reset: Date.now() / 1000 + 3600 },
      planning: {
        candidates: [580],
        issues: [
          {
            number: 579,
            title: 'Retained CI work',
            body: intent.context,
            state: 'OPEN',
            url: intent.issueUrl,
            author: { login: 'rafaeltab' },
            labels: [],
            comments: [],
          },
          {
            number: 580,
            title: 'Available work',
            body: 'Only this issue',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/580',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
      },
      planner: { proposal: { selected: [], deferred: [] } },
    });
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: state,
      FACTORY_PORT: '0',
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(
      async () =>
        expect(JSON.parse(await readFile(host.directory + '/planner.json', 'utf8'))).toHaveProperty(
          'prompt'
        ),
      { timeout: 8000, interval: 20 }
    );
    const snapshot = (await running.app.inject('/api/scheduler')).json();
    expect(snapshot.state.concurrency).toBe(3);
    expect(snapshot.state.admissions).toHaveLength(1);
  } finally {
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('paces whole automatic ticks by cycle cost', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol(),
    previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({
      githubRate: { limit: 1000, remaining: 1000, reset: Date.now() / 1000 + 3600 },
      planning: { candidates: [], issues: [], openPulls: [] },
    });
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    const discoveries = async () =>
      (await host.calls()).filter(
        (call) => call.binary === 'gh' && call.args[0] === 'issue' && call.args[1] === 'list'
      );
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(async () => expect(await discoveries()).toHaveLength(1), {
      timeout: 5000,
      interval: 20,
    });
    await vi.waitFor(async () =>
      expect(
        (await running!.app.inject('/api/scheduler')).json().observations.jobsObservedAt
      ).toBeDefined()
    );
    const observedAt = (await running.app.inject('/api/scheduler')).json().observations
      .jobsObservedAt;
    for (let tick = 0; tick < 3; tick++) {
      await vi.advanceTimersByTimeAsync(1000);
      const snapshot = (await running.app.inject('/api/scheduler')).json();
      expect(snapshot.observations.jobsObservedAt).toBe(observedAt);
      expect(snapshot.state.admissions).toEqual([]);
    }
    expect(await discoveries()).toHaveLength(1);
    // The next collection follows its actual quota cost, without a fixed
    // five-minute scheduler delay. It must not run on every one-second tick.
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(async () => expect((await discoveries()).length).toBeGreaterThan(1), {
      timeout: 5000,
      interval: 20,
    });
    expect(
      (await host.calls()).filter(
        (call) => call.binary === 't3' && call.args.includes('--worktree')
      )
    ).toHaveLength(0);
  } finally {
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('keeps metadata demand for an open event stream and releases it after disconnect', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12, 58));
  const host = await protocol(),
    previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  const connection = new AbortController();
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  let draining: Promise<void> | undefined;
  try {
    await host.save({ planning: { candidates: [], issues: [], openPulls: [] } });
    await Effect.runPromise(
      fileScheduleStore(host.directory + '/state').save({
        revision: 0,
        concurrency: 1,
        allowance: 1,
        paused: true,
        admissions: [],
      })
    );
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    const read = async () => (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await vi.waitFor(
      async () => {
        const source = (await read()).entities.sources['source:github'];
        expect(source.refresh).toBe('idle');
        expect(source.observedAt).not.toBeNull();
      },
      { timeout: 10000, interval: 20 }
    );
    const first = await read(),
      source = first.entities.sources['source:github'];
    const address = running.app.server.address();
    if (!address || typeof address === 'string' || !source.lastAttemptAt)
      throw new Error('Missing live stream address or observation');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v2/board/events?after=${encodeURIComponent(first.cursor)}`,
      { signal: connection.signal }
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing event stream');
    draining = (async () => {
      while (!(await reader.read()).done) {
        /* Drain the live consumer. */
      }
    })().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(
      Math.max(0, Date.parse(source.lastAttemptAt) + 300_000 - Date.now())
    );
    await vi.waitFor(
      async () => {
        const current = (await read()).entities.sources['source:github'];
        expect(current.refresh).toBe('idle');
        expect(current.lastAttemptAt).not.toBe(source.lastAttemptAt);
      },
      { timeout: 10000, interval: 20 }
    );
    const second = (await read()).entities.sources['source:github'];
    if (!second.lastAttemptAt) throw new Error('Missing second observation');
    await reader.cancel();
    await draining;
    connection.abort();
    await vi.advanceTimersByTimeAsync(
      Math.max(0, Date.parse(second.lastAttemptAt) + 301_001 - Date.now())
    );
    // This cached read precedes its newly signalled demand. Idle publication did not refresh.
    expect((await read()).entities.sources['source:github'].lastAttemptAt).toBe(
      second.lastAttemptAt
    );
  } finally {
    connection.abort();
    await draining;
    if (running) {
      let closed = false;
      const closing = running.close().finally(() => {
        closed = true;
      });
      await vi.waitFor(() => expect(closed).toBe(true), { timeout: 5000, interval: 20 });
      await closing;
    }
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('exposes acknowledged delivery through local HTTP while the provider observation remains blocked', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    await host.save({ lost: false, delayObserve: true, base: host.base });
    const service = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    running = service;
    pending = service.app
      .inject({ method: 'POST', url: '/api/job', payload: { issue: 577 } })
      .then((response) => response.statusCode);
    await vi.waitFor(
      async () => {
        expect((await service.app.inject('/api/job')).json()).toMatchObject({
          acknowledgement: { stage: 'implementation' },
          execution: { kind: 'ambiguous' },
          delivery: { stage: 'implementation', ready: false },
        });
      },
      { timeout: 5000, interval: 20 }
    );
    const { readFile } = await import('node:fs/promises');
    await vi.waitFor(
      async () => {
        expect(await readFile(`${host.directory}/observing.pid`, 'utf8')).toMatch(/^[0-9]+$/);
      },
      { timeout: 3000, interval: 20 }
    );
    expect((await service.app.inject('/health')).statusCode).toBe(200);
    expect(
      (await host.calls()).filter(
        (call) => call.binary === 't3' && call.args[1] === 'start' && !call.args.includes('--help')
      )
    ).toHaveLength(1);
  } finally {
    await running?.close();
    await pending;
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('publishes the real routine GitHub refresh lifetime while local reads remain independent', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({
      planning: { candidates: [], issues: [], openPulls: [] },
      hold: 'github-observation',
    });
    await Effect.runPromise(
      fileScheduleStore(host.directory + '/state').save({
        revision: 0,
        concurrency: 1,
        allowance: 1,
        paused: true,
        admissions: [],
      })
    );
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      ...host.mcpEnvironment,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
        expect(board.meta.activity?.items).toMatchObject([
          { category: 'refreshing-github', lifecycle: 'current' },
        ]);
        expect(await readFile(host.directory + '/held', 'utf8')).toBe('github-observation');
      },
      { timeout: 5000, interval: 20 }
    );
    const before = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    expect(before.meta.activity?.items[0].startedAt).toBe(
      before.entities.sources['source:github'].lastAttemptAt
    );
    const requests = await host.githubRequests();
    for (let i = 0; i < 5; i++)
      expect((await running.app.inject('/api/v2/board')).statusCode).toBe(200);
    expect(await host.githubRequests()).toEqual(requests);
    await writeFile(host.directory + '/release', 'release');
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
        expect(board.entities.sources['source:github'].observedAt).not.toBeNull();
        expect(board.meta.activity?.items).toEqual([]);
      },
      { timeout: 5000, interval: 20 }
    );
  } finally {
    await writeFile(host.directory + '/release', 'release');
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
