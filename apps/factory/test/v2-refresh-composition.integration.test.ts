import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
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

it('coalesces empty automatic discovery while continuing scheduler reconciliation', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol(),
    previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({ planning: { candidates: [], issues: [], openPulls: [] } });
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
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
    for (let tick = 0; tick < 3; tick++) {
      const target = Date.now() + 1000;
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(
        async () => {
          const snapshot = (await running!.app.inject('/api/scheduler')).json();
          expect(snapshot.observations.jobsObservedAt).toBeGreaterThanOrEqual(target);
          expect(snapshot.state.admissions).toEqual([]);
        },
        { timeout: 5000, interval: 20 }
      );
    }
    expect(await discoveries()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300_000);
    await vi.waitFor(async () => expect(await discoveries()).toHaveLength(2), {
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
