import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';

it('reconciles a retained automatic planner with changed requirements and replans after restart', async () => {
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
  const issue = {
    number: 581,
    title: 'Retain the planning operation',
    body: 'Original authorized repair',
    state: 'OPEN',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
    author: { login: 'rafaeltab' },
    labels: [{ name: 'ready-for-agent' }],
    comments: [],
  };
  const proposal = {
    selected: [{ issue: 581, reason: 'Bounded repair', includeCodeFromIssues: [] }],
    deferred: [],
  };
  const starts = async () =>
    (await host.calls()).filter(
      (call) => call.args[1] === 'start' && !call.args.includes('--help')
    );
  try {
    await host.save({
      lost: false,
      planning: { issues: [issue] },
      planner: { status: 'running', proposal },
    });
    const first = await startFactory(configuration);
    running = first;
    await vi.waitFor(async () => expect(await starts()).toHaveLength(1), {
      timeout: 10000,
      interval: 20,
    });
    const before = (await first.app.inject('/api/scheduler')).json();
    expect(before.state.cycle).toMatchObject({ requestId: expect.any(String) });
    expect(before.state.admissions).toEqual([]);
    await first.close();
    running = undefined;
    await host.save({
      lost: false,
      planning: {
        issues: [{ ...issue, body: 'Changed authorized repair requires fresh planning' }],
      },
      planner: { status: 'completed', proposal },
    });
    const second = await startFactory(configuration);
    running = second;
    await vi.waitFor(
      async () => {
        const calls = await starts();
        expect(calls.filter((call) => !call.args.includes('--worktree'))).toHaveLength(2);
        expect(calls.filter((call) => call.args.includes('--worktree'))).toHaveLength(1);
      },
      { timeout: 15000, interval: 20 }
    );
    expect((await second.app.inject('/api/scheduler')).json().state.admissions).toMatchObject([
      { issue: 581 },
    ]);
    const latest = JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8'));
    expect(latest.requestId).not.toBe(before.state.cycle.requestId);
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
