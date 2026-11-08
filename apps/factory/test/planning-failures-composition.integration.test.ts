import { Effect } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';

it('pauses after three distinct automatic model deadlines and retains their durations after restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 8, 12));
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  const configuration = {
    ...host.mcpEnvironment,
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: '0',
  };
  const starts = async () =>
    (await host.calls()).filter(
      (call) => call.args[1] === 'start' && !call.args.includes('--help')
    );
  try {
    await host.save({
      holds: ['planning-read'],
      planning: {
        issues: [
          {
            number: 581,
            title: 'Repair planning',
            body: 'Implement the bounded planning behavior',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
      },
      planner: {
        status: 'running',
        interruptCompletes: true,
        proposal: { selected: [], deferred: [] },
      },
    });
    await Effect.runPromise(
      fileScheduleStore(configuration.FACTORY_STATE).save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: false,
        admissions: [],
      })
    );
    running = await startFactory(configuration);
    await vi.waitFor(
      async () =>
        expect(await readFile(`${host.directory}/held-planning-read`, 'utf8')).toBe(
          'planning-read'
        ),
      { timeout: 5000, interval: 20 }
    );
    vi.setSystemTime(Date.now() + 3 * 60_000);
    await writeFile(`${host.directory}/release-planning-read`, 'continue discovery');
    const elapsed = [11 * 60_000, 12 * 60_000, 10.5 * 60_000];
    for (let index = 0; index < 3; index++) {
      await vi.waitFor(async () => expect(await starts()).toHaveLength(index + 1), {
        timeout: 6000,
        interval: 20,
      });
      // Each provider run gets a different actual elapsed interval. A fixed ten-minute
      // duration, or discovery time charged to model execution, fails these assertions.
      vi.setSystemTime(Date.now() + elapsed[index]);
    }
    await vi.waitFor(
      async () =>
        expect((await running!.app.inject('/api/scheduler')).json().state.paused).toBe(true),
      { timeout: 6000, interval: 20 }
    );
    await vi.waitFor(
      async () => {
        const current = (await running!.app.inject('/api/v2/board')).json();
        expect(current.meta.factory).toMatchObject({
          paused: true,
          planning: { consecutiveModelDeadlineFailures: 3 },
        });
      },
      { timeout: 5000, interval: 20 }
    );
    const board = (await running.app.inject('/api/v2/board')).json();
    expect(board.meta.factory.planning).toMatchObject({
      maximumAttempts: 3,
      consecutiveModelDeadlineFailures: 3,
      pendingNoticeCount: 1,
      notice: { acknowledgedAt: null },
    });
    const notice = board.meta.factory.planning.notice;
    expect(notice.failures).toHaveLength(3);
    expect(
      new Set(notice.failures.map((failure: { attemptId: string }) => failure.attemptId)).size
    ).toBe(3);
    for (const [index, failure] of notice.failures.entries()) {
      expect(failure).toMatchObject({ code: 'model-deadline', runId: 'planner-run' });
      expect(failure.modelElapsedMs).toBeGreaterThanOrEqual(elapsed[index]);
      expect(failure.modelElapsedMs).toBeLessThan(elapsed[index] + 6000);
      expect(failure.attemptElapsedMs).toBeGreaterThanOrEqual(failure.modelElapsedMs);
    }
    expect(
      notice.failures[0].attemptElapsedMs - notice.failures[0].modelElapsedMs
    ).toBeGreaterThanOrEqual(3 * 60_000);
    expect(await starts()).toHaveLength(3);
    await running.close();
    running = undefined;
    vi.setSystemTime(Date.now() + 5 * 60_000);
    running = await startFactory(configuration);
    const reopened = (await running.app.inject('/api/v2/board')).json();
    expect(reopened.meta.factory.paused).toBe(true);
    expect(reopened.meta.factory.planning.notice).toEqual(notice);
    expect(await starts()).toHaveLength(3);
  } finally {
    await writeFile(`${host.directory}/release-planning-read`, 'cleanup');
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
