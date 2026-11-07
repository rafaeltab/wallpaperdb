import { Effect } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { t3Planner } from '../src/adapters/t3/index.js';
import { protocol } from './fixtures/setup.js';

it('settles its completed model thread without treating cleanup as another plan', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  try {
    await host.save({ planner: { proposal: { selected: [], deferred: [] } } });
    const planner = t3Planner({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      stateDirectory: `${host.directory}/planner-state`,
    });
    await expect(
      Effect.runPromise(
        planner.propose({
          issues: [],
          job: { kind: 'empty' },
          capacity: { concurrency: 1, admission: 2 },
        })
      )
    ).resolves.toEqual({ selected: [], deferred: [] });
    const cleanups = (await host.calls()).filter(
      (call) => call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_organize'
    );
    expect(cleanups).toHaveLength(1);
    expect(JSON.parse(cleanups[0].args[2])).toEqual({
      action: 'settle',
      threadId: 'planner-thread',
    });
  } finally {
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('retains a timely model result across failed cleanup, reopen and an expired model deadline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const proposal = { selected: [], deferred: [] };
  const input = {
    issues: [],
    job: { kind: 'empty' as const },
    capacity: { concurrency: 1, admission: 2 },
  };
  const configuration = {
    ...host.mcp,
    binary: host.binary,
    project: host.repository,
    projectId: 'project-id',
    stateDirectory: `${host.directory}/planner-state`,
  };
  try {
    await host.save({ planner: { proposal, settleFails: true } });
    const planner = t3Planner(configuration);
    await expect(
      Effect.runPromise(planner.propose(input, { requestId: 'same-attempt' }))
    ).rejects.toMatchObject({ operation: 'planner-proposal' });
    const ownership = await Effect.runPromise(planner.ownership(false));
    expect(ownership).toMatchObject({
      retired: false,
      phase: 'succeeded',
      run: { threadId: 'planner-thread' },
    });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await host.save({ planner: { proposal } });
    const reopened = t3Planner(configuration);
    await expect(
      Effect.runPromise(reopened.propose(input, { requestId: 'same-attempt' }))
    ).resolves.toEqual(proposal);
    expect(await Effect.runPromise(reopened.ownership(false))).toMatchObject({
      retired: true,
      deadline: ownership?.deadline,
    });
    expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it.each([false, true])(
  'uses exact completion evidence when a model is observed after its deadline, timely=%s',
  async (timely) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
    const host = await protocol();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    let pending: Promise<unknown> | undefined;
    try {
      await host.save({
        holds: ['planner-observation'],
        planner: { proposal: { selected: [], deferred: [] } },
      });
      const planner = t3Planner({
        ...host.mcp,
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
        stateDirectory: `${host.directory}/planner-state`,
      });
      const work = Effect.runPromise(
        planner.propose({
          issues: [],
          job: { kind: 'empty' },
          capacity: { concurrency: 1, admission: 2 },
        })
      );
      const result = work.then(
        (value) => ({ kind: 'success', value }),
        (error) => ({ kind: 'failure', error })
      );
      pending = result;
      await vi.waitFor(
        async () =>
          expect(await readFile(`${host.directory}/held-planner-observation`, 'utf8')).toBe(
            'planner-observation'
          ),
        { timeout: 5000, interval: 20 }
      );
      const ownership = await Effect.runPromise(planner.ownership(false));
      if (ownership?.deadline === undefined) throw new Error('Expected a bound model deadline');
      if (timely)
        await host.save({
          planner: {
            proposal: { selected: [], deferred: [] },
            completedAt: new Date(ownership.deadline - 1).toISOString(),
          },
        });
      vi.setSystemTime(ownership.deadline + 1);
      await writeFile(`${host.directory}/release-planner-observation`, 'late completion');
      const outcome = await result;
      if (timely)
        expect(outcome).toEqual({ kind: 'success', value: { selected: [], deferred: [] } });
      else
        expect(outcome).toMatchObject({ kind: 'failure', error: { operation: 'model-deadline' } });
      expect(await Effect.runPromise(planner.ownership(false))).toMatchObject({
        retired: true,
        deadline: ownership.deadline,
      });
      expect(
        (await host.calls()).filter((call) => call.args[1] === 't3_thread_organize')
      ).toHaveLength(1);
    } finally {
      await writeFile(`${host.directory}/release-planner-observation`, 'cleanup');
      await pending;
      vi.useRealTimers();
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
      await host.cleanup();
    }
  }
);
