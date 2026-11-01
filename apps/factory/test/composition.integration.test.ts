import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
it('validates host configuration before serving and composes the real driving and storage adapters', async () => {
  const host = await protocol();
  const configuration = {
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: host.directory + '/state',
    FACTORY_PORT: '0',
  };
  try {
    await expect(startFactory({ ...configuration, FACTORY_HOST: '0.0.0.0' })).rejects.toThrow();
    await expect(
      startFactory({ ...configuration, FACTORY_HOST: '100.97.invalid.test' })
    ).rejects.toThrow();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    try {
      const running = await startFactory({ ...configuration, FACTORY_HOST: '127.0.0.1' });
      try {
        const second = await startFactory({ ...configuration, FACTORY_HOST: '127.0.0.1' });
        try {
          expect((await running.app.inject('/api/job')).json()).toEqual({ kind: 'empty' });
          expect(running.app.server.address()).not.toEqual(second.app.server.address());
        } finally {
          await second.close();
        }
      } finally {
        await running.close();
      }
    } finally {
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
    }
  } finally {
    await host.cleanup();
  }
});
it('continues admitted work through publication without an operations-page observer', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  await host.save({ complete: true, base: host.base });
  const running = await startFactory({
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: host.directory + '/state',
    FACTORY_PORT: '0',
  });
  try {
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/job', payload: { issue: 577 } }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(
      async () => {
        expect(
          (await host.calls()).filter(
            (call) =>
              call.binary === 't3' && call.args[1] === 'send' && !call.args.includes('--help')
          )
        ).toHaveLength(2);
      },
      { timeout: 10000, interval: 30 }
    );
    expect((await running.app.inject('/api/job')).json()).toMatchObject({
      delivery: { stage: 'ci', ready: true, landed: false },
    });
    // Discovery must derive the prerequisite assertion from this completed job.
    // Missing issue evidence still prevents a child launch.
    await host.save({
      complete: true,
      base: host.base,
      blockers: [{ number: 577, state: 'open' }],
      prHead: host.base,
    });
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/job', payload: { issue: 578 } }))
        .statusCode
    ).toBe(422);
    expect(
      (await host.calls()).some(
        (call) =>
          call.binary === 'gh' &&
          call.args[0] === 'pr' &&
          call.args[1] === 'view' &&
          call.args[2] === '999'
      )
    ).toBe(true);
    const pr = JSON.parse(await readFile(join(host.directory, 'pr.json'), 'utf8'));
    pr.statusCheckRollup[0].conclusion = 'FAILURE';
    await host.save({
      complete: true,
      base: host.base,
      prs: [pr],
      waitingForGithub: true,
      overrides: { status: 'completed' },
    });
    await vi.waitFor(
      async () => {
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          delivery: { activity: 'waiting-for-github' },
        });
      },
      { timeout: 10000, interval: 30 }
    );
    // A normal watcher wake is a new run for the same persisted delivery.
    pr.statusCheckRollup[0].conclusion = 'SUCCESS';
    await host.save({
      complete: true,
      base: host.base,
      prs: [pr],
      overrides: { status: 'completed', runCount: 5, latestRunId: 'watcher-5' },
    });
    expect((await running.app.inject('/api/job')).json()).toMatchObject({
      delivery: { stage: 'review', ready: false },
    });
    await host.save({
      complete: true,
      base: host.base,
      prs: [pr],
      overrides: { status: 'completed' },
    });
    await vi.waitFor(
      async () => {
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          delivery: { stage: 'ci', ready: true, landed: false },
        });
      },
      { timeout: 10000, interval: 30 }
    );
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'send' && !call.args.includes('--help')
      )
    ).toHaveLength(5);
  } finally {
    await running.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('continuously admits a validated semantic plan through production adapters without page traffic', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const candidate = {
    number: 581,
    title: 'Scheduler',
    body: 'Implement scheduler',
    state: 'OPEN',
    url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
    author: { login: 'rafaeltab' },
    labels: [{ name: 'ready-for-agent' }],
    comments: [],
  };
  await host.save({
    planning: { issues: [candidate] },
    planner: {
      proposal: {
        selected: [
          { issue: 581, reason: 'Thin end-to-end experiment', dependsOn: [], conflicts: [] },
        ],
        deferred: [],
      },
    },
  });
  try {
    const running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    try {
      await vi.waitFor(
        async () =>
          expect(
            (await host.calls()).filter(
              (c) => c.args[1] === 'start' && c.args.includes('--worktree')
            )
          ).toHaveLength(1),
        { timeout: 10000, interval: 30 }
      );
      const status = (await running.app.inject('/api/scheduler')).json();
      expect(status).toMatchObject({
        state: { concurrency: 1, allowance: 1, paused: false, admissions: [{ issue: 581 }] },
        jobs: [{ kind: 'job', execution: { kind: 'found', threadId: 'thread-live' } }],
      });
      const plannerInput = JSON.parse(await readFile(join(host.directory, 'planner.json'), 'utf8'));
      expect(JSON.stringify(plannerInput)).toContain('Implement scheduler');
    } finally {
      await running.close();
    }
  } finally {
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
