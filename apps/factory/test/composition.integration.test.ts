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
