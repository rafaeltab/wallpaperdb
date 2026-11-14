import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileStore, fileScheduleStore } from '../src/adapters/store/index.js';
import type { Intent } from '../src/capabilities/job/index.js';
import { protocol } from './fixtures/setup.js';

it('starts a new job and worktree from a fresh journal while retaining the abandoned intent across restart', async () => {
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const directory = `${host.directory}/state`;
  const old: Intent = {
    id: 'abandoned',
    issue: 577,
    issueUrl: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
    base: host.base,
    branch: 'factory/abandoned',
    context: 'Approved scope',
    createdAt: 1,
    expectedStage: 'implementation',
  };
  const admission = { issue: 577, base: host.base, context: old.context };
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    await host.save({ lost: false });
    await Effect.runPromise(fileStore(directory).reserve(old));
    await Effect.runPromise(fileStore(directory).claimLaunch());
    await Effect.runPromise(
      fileScheduleStore(directory).save({
        revision: 0,
        allowance: 1,
        concurrency: 1,
        paused: true,
        admissions: [{ ...admission, generation: 1 }],
        released: [{ admission, jobId: old.id }],
      })
    );
    const config = {
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: directory,
      FACTORY_PORT: '0',
    };
    running = await startFactory(config);
    await vi.waitFor(
      async () => {
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'start' && call.args.includes('--worktree')
          )
        ).toHaveLength(1);
      },
      { timeout: 15000, interval: 30 }
    );
    const status = (await running.app.inject('/api/scheduler')).json();
    expect(status.jobs[0].intent).toMatchObject({
      issue: 577,
      generation: 1,
      context: old.context,
    });
    expect(status.jobs[0].intent.id).not.toBe(old.id);
    expect(status.jobs[0].intent.branch).not.toBe(old.branch);
    expect(status.jobs[0].execution.worktree).not.toBe(host.repository);
    await running.close();
    running = await startFactory(config);
    expect((await running.app.inject('/api/scheduler')).json().jobs[0].intent.id).toBe(
      status.jobs[0].intent.id
    );
    expect(await Effect.runPromise(fileStore(directory).read())).toEqual(old);
    expect(
      (await host.calls()).filter(
        (call) => call.args[1] === 'start' && call.args.includes('--worktree')
      )
    ).toHaveLength(1);
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
