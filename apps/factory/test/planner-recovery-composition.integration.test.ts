import { Effect } from 'effect';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { t3Planner } from '../src/adapters/t3/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';

it.each(['expired-model', 'slow-settlement', 'blocked-discovery'])(
  'recovers %s independently of planning requests and discovery',
  async (scenario) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
    const host = await protocol();
    const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
    process.env.PATH = `${host.directory}:${previous.path}`;
    process.env.FACTORY_FIXTURE = host.configFile;
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    let running: Awaited<ReturnType<typeof startFactory>> | undefined;
    let heldPid: number | undefined;
    const configuration = {
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    };
    try {
      await Effect.runPromise(
        fileScheduleStore(configuration.FACTORY_STATE).save({
          revision: 0,
          concurrency: 1,
          allowance: 2,
          paused: true,
          admissions: [],
        })
      );
      // Startup owns initialization of the root database before its planner namespace.
      running = await startFactory(configuration);
      await running.close();
      running = undefined;
      await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
      const planner = t3Planner({
        ...host.mcp,
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
        stateDirectory: `${configuration.FACTORY_STATE}/planner`,
      });
      pending = Effect.runPromise(
        planner.propose(
          { issues: [], job: { kind: 'empty' }, capacity: { concurrency: 1, admission: 2 } },
          { automatic: true }
        ),
        { signal: controller.signal }
      ).catch(() => undefined);
      await vi.waitFor(
        async () => expect((await host.calls()).some((call) => call.args[1] === 'show')).toBe(true),
        { timeout: 5000, interval: 20 }
      );
      controller.abort();
      await pending;
      const ownership = await Effect.runPromise(planner.ownership(false));
      if (ownership?.deadline === undefined) throw new Error('Expected durable model deadline');
      if (scenario !== 'slow-settlement') {
        vi.setSystemTime(ownership.deadline + 1);
      } else {
        await host.save({
          planner: { proposal: { selected: [], deferred: [] }, settleDelayMs: 1500 },
        });
      }
      if (scenario === 'blocked-discovery') {
        await Effect.runPromise(
          fileScheduleStore(configuration.FACTORY_STATE).save({
            revision: 1,
            concurrency: 1,
            allowance: 2,
            paused: false,
            admissions: [],
          })
        );
        await host.save({
          holds: ['planning-read'],
          planning: { issues: [] },
          planner: { status: 'running', proposal: { selected: [], deferred: [] } },
        });
      }
      running = await startFactory(configuration);
      if (scenario === 'blocked-discovery') {
        await vi.waitFor(
          async () =>
            expect(await readFile(`${host.directory}/held-planning-read`, 'utf8')).toBe(
              'planning-read'
            ),
          { timeout: 5000, interval: 20 }
        );
        heldPid = Number(await readFile(`${host.directory}/held-planning-read.pid`, 'utf8'));
        expect(heldPid).toBeGreaterThan(0);
      }
      if (scenario !== 'slow-settlement') {
        await vi.waitFor(
          async () => {
            const interrupts = (await host.calls()).filter(
              (call) => call.args[1] === 't3_thread_interrupt'
            );
            expect(interrupts.length).toBeGreaterThan(0);
            expect(JSON.parse(interrupts[0].args[2])).toMatchObject({
              threadId: 'planner-thread',
              runId: 'planner-run',
            });
          },
          { timeout: 5000, interval: 20 }
        );
        expect((await Effect.runPromise(planner.ownership(false)))?.retired).not.toBe(true);
        await host.save({
          planner: { status: 'interrupted', proposal: { selected: [], deferred: [] } },
        });
      }
      await vi.waitFor(
        async () =>
          expect(await Effect.runPromise(planner.ownership(false))).toMatchObject({
            retired: true,
            settled: true,
            deadline: ownership.deadline,
          }),
        { timeout: 6000, interval: 20 }
      );
      expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
        paused: scenario !== 'blocked-discovery',
        allowance: 2,
        admissions: [],
      });
      expect(
        (await host.calls()).filter(
          (call) => call.args[1] === 'start' && !call.args.includes('--help')
        )
      ).toHaveLength(1);
      await running.close();
      running = undefined;
      if (heldPid) {
        const pid = heldPid;
        expect(() => process.kill(pid, 0)).toThrow();
      }
    } finally {
      controller.abort();
      await pending;
      await running?.close();
      vi.useRealTimers();
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    }
  }
);

it('allows supported terminal cleanup latency when submitting a preview after process loss', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
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
  try {
    await Effect.runPromise(
      fileScheduleStore(configuration.FACTORY_STATE).save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: true,
        admissions: [],
      })
    );
    running = await startFactory(configuration);
    await running.close();
    running = undefined;
    await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
    const planner = t3Planner({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      stateDirectory: `${configuration.FACTORY_STATE}/planner`,
    });
    pending = Effect.runPromise(
      planner.propose({
        issues: [],
        job: { kind: 'empty' },
        capacity: { concurrency: 1, admission: 2 },
      }),
      { signal: controller.signal }
    ).catch(() => undefined);
    await vi.waitFor(
      async () => expect((await host.calls()).some((call) => call.args[1] === 'show')).toBe(true),
      { timeout: 5000, interval: 20 }
    );
    controller.abort();
    await pending;
    const ownership = await Effect.runPromise(planner.ownership(false));
    await host.save({ planner: { proposal: { selected: [], deferred: [] }, settleDelayMs: 1500 } });
    running = await startFactory(configuration);
    const response = await running.app.inject({ method: 'POST', url: '/api/plan', payload: {} });
    expect(response.statusCode).toBe(202);
    expect(await Effect.runPromise(planner.ownership(false, ownership?.requestId))).toMatchObject({
      retired: true,
      settled: true,
      deadline: ownership?.deadline,
    });
    expect((await running.app.inject('/api/scheduler')).json().state.admissions).toEqual([]);
  } finally {
    controller.abort();
    await pending;
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
