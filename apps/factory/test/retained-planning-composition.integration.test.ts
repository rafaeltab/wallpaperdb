import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { protocol } from './fixtures/setup.js';

it('plans and admits eligible work while owning-thread observation is held, retaining the occupied slot', async () => {
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const issues = [576, 578].map((number) => ({
    number,
    title: `Issue ${number}`,
    body: 'Only this issue',
    state: 'OPEN',
    url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
    author: { login: 'rafaeltab' },
    labels: [{ name: 'ready-for-agent' }],
    comments: [],
  }));
  const settings = {
    lost: false,
    parallel: true,
    holdImplementation: true,
    base: host.base,
    planning: { candidates: [], issues },
  };
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save(settings);
    await Effect.runPromise(
      fileScheduleStore(`${host.directory}/state`).save({
        revision: 0,
        concurrency: 2,
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
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/job', payload: { issue: 576 } }))
        .statusCode
    ).toBe(202);
    const app = running.app;
    await vi.waitFor(
      async () => expect((await app.inject('/api/job')).json().execution.kind).toBe('found'),
      { timeout: 10000 }
    );
    await host.save({
      ...settings,
      delayObserve: true,
      planning: { candidates: [578], issues },
      planner: {
        proposal: {
          selected: [
            {
              issue: 578,
              reason: 'Free capacity while the first worker remains owned',
              includeCodeFromIssues: [],
            },
          ],
          deferred: [],
        },
      },
    });
    await vi.waitFor(
      async () => {
        const calls = await host.calls();
        expect(
          calls.filter(
            (call) =>
              (call.args[0] === 'thread' &&
                call.args[1] === 'start' &&
                call.args[3]?.includes('/issues/578')) ||
              (call.args[1] === 't3_thread_launch' &&
                JSON.parse(call.args[2]).message.includes('/issues/578'))
          )
        ).toHaveLength(1);
      },
      { timeout: 15000 }
    );
    expect(
      JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).requestId
    ).toBeTruthy();
    expect(await readFile(`${host.directory}/observing-websocket`, 'utf8')).toBe('held');
    const state = await Effect.runPromise(fileScheduleStore(`${host.directory}/state`).read());
    expect(state.admissions.map((item) => item.issue).sort()).toEqual([576, 578]);
    expect(state.allowance).toBe(2);
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
