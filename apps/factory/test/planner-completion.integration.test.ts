import { Effect } from 'effect';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { t3Planner } from '../src/adapters/t3/index.js';
import { protocol } from './fixtures/setup.js';
import type { AutomaticDeadlineFailure } from '../src/capabilities/plan/index.js';

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

it.each(['settleFails', 'settleUnconfirmed'])(
  'retains a timely model result across %s, reopen and an expired model deadline',
  async (failure) => {
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
      await host.save({ planner: { proposal, [failure]: true } });
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
  }
);

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

it.each([false, true])(
  'interrupts the exact model at its deadline and retains ownership until terminal, lost response=%s',
  async (interruptFails) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
    const host = await protocol();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    let pending: Promise<unknown> | undefined;
    const proposal = { selected: [], deferred: [] };
    try {
      await host.save({
        holds: ['planner-observation'],
        planner: { status: 'running', proposal, interruptFails },
      });
      const planner = t3Planner({
        ...host.mcp,
        binary: host.binary,
        project: host.repository,
        projectId: 'project-id',
        stateDirectory: `${host.directory}/planner-state`,
      });
      const result = Effect.runPromise(
        planner.propose({
          issues: [],
          job: { kind: 'empty' },
          capacity: { concurrency: 1, admission: 2 },
        })
      ).then(
        (value) => ({ value }),
        (error) => ({ error })
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
      if (ownership?.deadline === undefined) throw new Error('Expected a bound deadline');
      vi.setSystemTime(ownership.deadline + 1);
      await writeFile(`${host.directory}/release-planner-observation`, 'expire model');
      expect(await result).toMatchObject({ error: { operation: 'model-deadline' } });
      const interrupts = (await host.calls()).filter(
        (call) => call.args[1] === 't3_thread_interrupt'
      );
      expect(interrupts).toHaveLength(1);
      expect(JSON.parse(interrupts[0].args[2])).toMatchObject({
        threadId: 'planner-thread',
        runId: 'planner-run',
      });
      expect((await Effect.runPromise(planner.ownership(false)))?.retired).not.toBe(true);
      await host.save({ planner: { status: 'interrupted', proposal } });
      expect(await Effect.runPromise(planner.ownership())).toMatchObject({
        retired: true,
        phase: 'failed',
        deadline: ownership.deadline,
      });
      expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
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

it('enforces the saved automatic model deadline after its observing process is lost', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12));
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
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
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
    const original = t3Planner(configuration);
    pending = Effect.runPromise(original.propose(input, { automatic: true }), {
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(
      async () => expect((await host.calls()).some((call) => call.args[1] === 'show')).toBe(true),
      { timeout: 5000, interval: 20 }
    );
    controller.abort();
    await pending;
    const ownership = await Effect.runPromise(original.ownership(false));
    if (ownership?.deadline === undefined) throw new Error('Expected a durable deadline');
    vi.setSystemTime(ownership.deadline + 1);
    const reopened = t3Planner(configuration);
    await expect(
      Effect.runPromise(reopened.propose(input, { automatic: true }))
    ).rejects.toMatchObject({ operation: 'model-deadline' });
    const calls = await host.calls();
    const interrupts = calls.filter((call) => call.args[1] === 't3_thread_interrupt');
    expect(interrupts).toHaveLength(1);
    expect(JSON.parse(interrupts[0].args[2])).toMatchObject({
      threadId: 'planner-thread',
      runId: 'planner-run',
    });
    expect(calls.filter((call) => call.args[1] === 'start')).toHaveLength(1);
    expect(await Effect.runPromise(reopened.ownership(false))).toMatchObject({
      deadline: ownership.deadline,
      run: ownership.run,
    });
    expect((await Effect.runPromise(reopened.ownership(false)))?.retired).not.toBe(true);
  } finally {
    controller.abort();
    await pending;
    vi.useRealTimers();
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it('requests interruption at the model deadline while thread observation is blocked', async () => {
  const host = await protocol();
  const previous = process.env.FACTORY_FIXTURE;
  process.env.FACTORY_FIXTURE = host.configFile;
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  try {
    await host.save({
      holds: ['planner-observation'],
      planner: { status: 'running', proposal: { selected: [], deferred: [] } },
    });
    const planner = t3Planner({
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      stateDirectory: `${host.directory}/planner-state`,
    });
    pending = Effect.runPromise(
      planner.propose(
        { issues: [], job: { kind: 'empty' }, capacity: { concurrency: 1, admission: 2 } },
        { deadline: Date.now() + 1500 }
      ),
      { signal: controller.signal }
    ).catch(() => undefined);
    await vi.waitFor(
      async () =>
        expect(await readFile(`${host.directory}/held-planner-observation`, 'utf8')).toBe(
          'planner-observation'
        ),
      { timeout: 5000, interval: 20 }
    );
    await vi.waitFor(
      async () => {
        const interrupts = (await host.calls()).filter(
          (call) => call.args[1] === 't3_thread_interrupt'
        );
        expect(interrupts).toHaveLength(1);
        expect(JSON.parse(interrupts[0].args[2])).toMatchObject({
          threadId: 'planner-thread',
          runId: 'planner-run',
        });
      },
      { timeout: 4000, interval: 20 }
    );
    expect((await Effect.runPromise(planner.ownership(false)))?.retired).not.toBe(true);
  } finally {
    controller.abort();
    await writeFile(`${host.directory}/release-planner-observation`, 'cleanup');
    await pending;
    if (previous === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous;
    await host.cleanup();
  }
});

it.each([
  { status: 'failed', timely: true },
  { status: 'cancelled', timely: true },
  { status: 'failed', timely: false },
  { status: 'cancelled', timely: false },
])(
  'classifies recovered $status using exact terminal timing, timely=$timely',
  async ({ status, timely }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 9, 12));
    const host = await protocol();
    const previous = process.env.FACTORY_FIXTURE;
    process.env.FACTORY_FIXTURE = host.configFile;
    const controller = new AbortController();
    let pending: Promise<unknown> | undefined;
    const failures: AutomaticDeadlineFailure[] = [];
    const configuration = {
      ...host.mcp,
      binary: host.binary,
      project: host.repository,
      projectId: 'project-id',
      stateDirectory: `${host.directory}/planner-state`,
      automaticPolicy: {
        mayLaunch: async () => true,
        failed: async (failure: AutomaticDeadlineFailure) => {
          failures.push(failure);
        },
      },
    };
    try {
      await host.save({ planner: { status: 'running', proposal: { selected: [], deferred: [] } } });
      const original = t3Planner(configuration);
      pending = Effect.runPromise(
        original.propose(
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
      const ownership = await Effect.runPromise(original.ownership(false));
      if (ownership?.deadline === undefined) throw new Error('Missing durable model deadline');
      await host.save({
        planner: {
          status,
          completedAt: new Date(ownership.deadline + (timely ? -1 : 1)).toISOString(),
          proposal: { selected: [], deferred: [] },
        },
      });
      vi.setSystemTime(ownership.deadline + 10000);
      const reopened = t3Planner(configuration);
      await Effect.runPromise(reopened.reconcile());
      expect(await Effect.runPromise(reopened.ownership(false))).toMatchObject({
        phase: 'failed',
        retired: true,
        deadline: ownership.deadline,
        run: ownership.run,
      });
      expect(failures).toHaveLength(timely ? 0 : 1);
      if (!timely)
        expect(failures[0]).toMatchObject({
          deadline: ownership.deadline,
          runId: 'planner-run',
          threadId: 'planner-thread',
        });
      await Effect.runPromise(t3Planner(configuration).reconcile());
      expect(failures).toHaveLength(timely ? 0 : 1);
      expect((await host.calls()).filter((call) => call.args[1] === 'start')).toHaveLength(1);
    } finally {
      controller.abort();
      await pending;
      vi.useRealTimers();
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
      await host.cleanup();
    }
  }
);
