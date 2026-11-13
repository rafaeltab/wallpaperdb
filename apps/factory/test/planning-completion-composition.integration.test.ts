import { readFile, writeFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { protocol } from './fixtures/setup.js';

it('admits an automatic proposal after discovery outlasts the model time allowance', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({
      hold: 'planning-discovery',
      planning: {
        issues: [
          {
            number: 581,
            title: 'Scheduler',
            body: 'Implement scheduler',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
      },
      planner: {
        proposal: {
          selected: [
            { issue: 581, reason: 'Bounded user-facing repair', includeCodeFromIssues: [] },
          ],
          deferred: [],
        },
      },
    });
    await Effect.runPromise(
      fileScheduleStore(`${host.directory}/state`).save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: false,
        admissions: [],
      })
    );
    running = await startFactory({
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    await vi.waitFor(
      async () => {
        expect(await readFile(`${host.directory}/held`, 'utf8')).toBe('planning-discovery');
      },
      { timeout: 5000, interval: 20 }
    );
    // Model time cannot be consumed while quota-paced discovery is still held.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await writeFile(`${host.directory}/release`, 'release discovery');
    await vi.waitFor(
      async () => {
        expect((await running!.app.inject('/api/scheduler')).json()).toMatchObject({
          state: { allowance: 2, concurrency: 1, admissions: [{ issue: 581 }] },
        });
      },
      // Git verification and worker startup are real processes; the fake clock
      // controls the model allowance, independently of this wall-clock wait.
      { timeout: 15000, interval: 20 }
    );
    await vi.waitFor(
      async () =>
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'start' && call.args.includes('--worktree')
          )
        ).toHaveLength(1),
      { timeout: 15000, interval: 20 }
    );
    const starts = (await host.calls()).filter(
      (call) => call.binary === 't3' && call.args[1] === 'start' && !call.args.includes('--help')
    );
    expect(starts.filter((call) => !call.args.includes('--worktree'))).toHaveLength(1);
    expect(starts.find((call) => !call.args.includes('--worktree'))?.args).toContainEqual(
      expect.stringContaining('Factory automatic plan ')
    );
    expect(starts.filter((call) => call.args.includes('--worktree'))).toHaveLength(1);
  } finally {
    await writeFile(`${host.directory}/release`, 'cleanup');
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('keeps discovery and freshness outside the bound model deadline across restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol({ origin: true });
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
  const boundaries = ['planning-discovery', 'planner-observation', 'planning-freshness'];
  const held = async (boundary: string) =>
    vi.waitFor(
      async () => {
        expect(await readFile(`${host.directory}/held-${boundary}`, 'utf8')).toBe(boundary);
      },
      { timeout: 5000, interval: 20 }
    );
  const release = (boundary: string) =>
    writeFile(`${host.directory}/release-${boundary}`, 'continue');
  try {
    await host.save({
      holds: boundaries,
      planning: {
        issues: [
          {
            number: 581,
            title: 'Lifecycle repair',
            body: 'Authorized repair',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
      },
      planner: { proposal: { selected: [], deferred: [] } },
    });
    await Effect.runPromise(
      fileScheduleStore(`${host.directory}/state`).save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: true,
        admissions: [],
      })
    );
    running = await startFactory(configuration);
    const submitted = await running.app.inject({ method: 'POST', url: '/api/plan', payload: {} });
    expect(submitted.statusCode).toBe(202);
    const id = submitted.json().id;
    const details = async () => (await running!.app.inject(`/api/plan/${id}`)).json();
    await held('planning-discovery');
    expect(await details()).toMatchObject({ phase: 'discovery', deadline: null });
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json();
        expect(board.entities.plans[`plan:${id}`]).toMatchObject({
          deadline: null,
          phase: 'discovery',
        });
      },
      { timeout: 5000, interval: 20 }
    );
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const handoffStart = Date.now();
    await release('planning-discovery');
    await held('planner-observation');
    const deadline = (await details()).deadline;
    expect(deadline).toBeGreaterThanOrEqual(handoffStart + 600_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 600_000);
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await release('planner-observation');
    await held('planning-freshness');
    expect(await details()).toMatchObject({ phase: 'freshness', deadline });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await release('planning-freshness');
    await vi.waitFor(
      async () => {
        expect(await details()).toMatchObject({
          phase: 'succeeded',
          deadline,
          result: { kind: 'preview' },
        });
      },
      { timeout: 5000, interval: 20 }
    );
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json();
        expect(board.entities.plans[`plan:${id}`]).toMatchObject({
          deadline: new Date(deadline).toISOString(),
          phase: 'succeeded',
        });
      },
      { timeout: 5000, interval: 20 }
    );
    expect((await running.app.inject('/api/scheduler')).json().state.admissions).toEqual([]);
    await running.close();
    running = await startFactory(configuration);
    expect(await details()).toMatchObject({ phase: 'succeeded', deadline });
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'start' && !call.args.includes('--help')
      )
    ).toHaveLength(1);
  } finally {
    await Promise.all(boundaries.map(release));
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
