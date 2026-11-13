import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
import { sqliteObservations } from '../src/adapters/store/index.js';
it('validates host configuration before serving and composes the real driving and storage adapters', async () => {
  const host = await protocol({ origin: true });
  const configuration = {
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: '0',
  };
  try {
    await expect(startFactory({ ...configuration, FACTORY_HOST: '0.0.0.0' })).rejects.toThrow();
    await expect(
      startFactory({ ...configuration, FACTORY_HOST: '100.97.invalid.test' })
    ).rejects.toThrow();
    const previous = process.env.FACTORY_FIXTURE;
    const previousPath = process.env.PATH;
    process.env.PATH = host.directory + ':' + previousPath;
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
      process.env.PATH = previousPath;
      if (previous === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous;
    }
  } finally {
    await host.cleanup();
  }
});
it('continues admitted work through publication without an operations-page observer', async () => {
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  await host.save({ complete: true, base: host.base });
  const running = await startFactory({
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: '0',
  });
  try {
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/job', payload: { issue: 577 } }))
        .statusCode
    ).toBe(202);
    await host.save({
      complete: true,
      base: host.base,
      blockers: [{ number: 400, state: 'closed' }],
    });
    // Relationship refresh is independently verified below. HTTP no longer fetches it.
    expect((await running.app.inject('/api/scheduler')).statusCode).toBe(200);
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
    await vi.waitFor(
      async () =>
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          delivery: { stage: 'ci', ready: true, landed: false },
        }),
      { timeout: 10000, interval: 30 }
    );
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
    await vi.waitFor(
      async () =>
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          delivery: { stage: 'review', ready: false },
        }),
      { timeout: 10000, interval: 30 }
    );
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
  const host = await protocol({ origin: true });
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
        selected: [{ issue: 581, reason: 'Thin end-to-end experiment', includeCodeFromIssues: [] }],
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
      ...host.mcpEnvironment,
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
      await vi.waitFor(
        async () =>
          expect((await running.app.inject('/api/scheduler')).json()).toMatchObject({
            state: { concurrency: 1, allowance: 1, paused: false, admissions: [{ issue: 581 }] },
            jobs: [{ kind: 'job', execution: { kind: 'found', threadId: 'thread-live' } }],
          }),
        { timeout: 10000, interval: 30 }
      );
      const plannerInput = JSON.parse(await readFile(join(host.directory, 'planner.json'), 'utf8'));
      expect(plannerInput.prompt).toContain('# Candidate issues\n\n## open 581 - Scheduler');
      expect(plannerInput.prompt).not.toContain(candidate.body);
      const { plannerState } = await import('../src/adapters/t3/index.js');
      const retained = await plannerState(`${host.directory}/state/planner`).read();
      expect(retained?.input).toContain(candidate.body);
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

it('refreshes on API demand while keeping idle metadata quiet and HTTP local', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 7, 12, 58));
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const issue = (number: number, body: string) => ({
    number,
    url: `https://github.com/rafaeltab/wallpaperdb/issues/${number}`,
    title: `Observed ${number}`,
    body,
    state: 'OPEN',
    author: { login: 'rafaeltab' },
    labels: [{ name: 'ready-for-agent' }],
    comments: [],
  });
  await host.save({
    planning: { candidates: [577], issues: [issue(577, 'Blocked by: #400'), issue(400, '')] },
  });
  const { fileScheduleStore } = await import('../src/adapters/store/index.js');
  const { Effect } = await import('effect');
  await Effect.runPromise(
    fileScheduleStore(host.directory + '/state').save({
      revision: 0,
      concurrency: 1,
      allowance: 1,
      paused: true,
      admissions: [],
    })
  );
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const running = await startFactory({
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: '0',
  });
  try {
    await vi.advanceTimersByTimeAsync(300_000);
    expect((await running.app.inject('/health')).statusCode).toBe(200);
    expect((await running.app.inject('/')).statusCode).toBe(200);
    expect((await host.calls()).filter((c) => c.binary === 'gh')).toHaveLength(0);
    expect(
      (await host.calls()).filter((c) => c.binary === 't3' && !c.args.includes('--help'))
    ).toHaveLength(0);
    expect((await running.app.inject('/api/v2/board')).json().meta.dataMode).toBe('live');
    await vi.waitFor(
      async () =>
        expect(
          (
            await Effect.runPromise(sqliteObservations(`${host.directory}/state`).read())
          ).facts?.issues.map((i) => i.number)
        ).toEqual([400, 577]),
      { timeout: 10000, interval: 30 }
    );
    const count = (await host.calls()).filter((c) => c.binary === 'gh').length;
    expect(count).toBeGreaterThan(0);
    expect(
      (await running.app.inject('/api/v2/board')).json().entities.sources['source:github']
        .nextAttemptAt
    ).toBeNull();
    for (const url of ['/', '/api/job', '/api/scheduler', '/api/observations'])
      expect((await running.app.inject(url)).statusCode).toBe(200);
    expect((await host.calls()).filter((c) => c.binary === 'gh').length).toBe(count);
  } finally {
    await running.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('serves the live v2 producer and executes durable control commands on the existing origin', async () => {
  const host = await protocol({ origin: true });
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = host.directory + ':' + previous.path;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  try {
    running = await startFactory({
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: host.directory + '/state',
      FACTORY_PORT: '0',
    });
    const board = (await running.app.inject('/api/v2/board')).json();
    expect(board.meta.dataMode).toBe('live');
    const action = Object.values(board.entities.actions).find(
      (a: unknown) => typeof a === 'object' && a !== null && 'kind' in a && a.kind === 'configure'
    );
    if (!action || typeof action !== 'object' || !('id' in action) || !('availability' in action))
      throw new Error('Configure missing');
    const availability = action.availability;
    if (!availability || typeof availability !== 'object' || !('precondition' in availability))
      throw new Error('Configure disabled');
    const request = {
      commandId: '00000000-0000-4000-8000-000000000007',
      actionId: action.id,
      precondition: availability.precondition,
      kind: 'configure',
      payload: {
        paused: true,
        concurrency: { kind: 'limited', maximum: 2 },
        admissionAllowance: { kind: 'limited', maximum: 4 },
      },
    };
    expect(
      (
        await running.app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: request,
          headers: { origin: 'https://untrusted.invalid' },
        })
      ).statusCode
    ).toBe(403);
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(
      async () =>
        expect(
          (await running!.app.inject(`/api/v2/commands/${request.commandId}`)).json()
        ).toMatchObject({ state: 'succeeded' }),
      { timeout: 5000, interval: 20 }
    );
    expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
      paused: true,
      concurrency: 2,
      allowance: 4,
    });
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it.each(['accept', 'accept-committed', 'claim', 'claim-committed', 'finish'] as const)(
  'recovers durable control responsibility after a SQLite %s failure without repeating effects',
  async (boundary) => {
    const host = await protocol({ origin: true });
    const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
    process.env.PATH = `${host.directory}:${previous.path}`;
    process.env.FACTORY_FIXTURE = host.configFile;
    let running: Awaited<ReturnType<typeof startFactory>> | undefined;
    let database: DatabaseSync | undefined;
    try {
      running = await startFactory({
        FACTORY_PROJECT: host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: host.base,
        FACTORY_T3_BINARY: host.binary,
        FACTORY_STATE: `${host.directory}/state`,
        FACTORY_PORT: '0',
      });
      const before = (await running.app.inject('/api/scheduler')).json().state.revision;
      const board = (await running.app.inject('/api/v2/board')).json();
      const action = Object.values(board.entities.actions).find(
        (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          'kind' in value &&
          value.kind === 'configure'
      );
      if (!action || typeof action !== 'object' || !('id' in action) || !('availability' in action))
        throw new Error('Missing configure action');
      const availability = action.availability;
      if (!availability || typeof availability !== 'object' || !('precondition' in availability))
        throw new Error('Configure unavailable');
      database = new DatabaseSync(`${host.directory}/state/factory.sqlite`);
      const accepting = boundary === 'accept' || boundary === 'accept-committed';
      database.exec(`
        CREATE TABLE injected_command_faults (attempt INTEGER);
        CREATE TRIGGER injected_command_failure ${boundary.endsWith('-committed') ? 'AFTER' : 'BEFORE'} ${accepting ? 'INSERT' : 'UPDATE OF receipt'} ON v2_commands
        WHEN json_extract(NEW.receipt, '$.state') = '${accepting ? 'accepted' : boundary === 'finish' ? 'succeeded' : 'running'}'
        BEGIN
          INSERT INTO injected_command_faults VALUES (1);
          SELECT RAISE(FAIL, 'Controlled command storage failure');
        END;
      `);
      const request = {
        commandId: randomUUID(),
        actionId: action.id,
        precondition: availability.precondition,
        kind: 'configure',
        payload: {
          paused: true,
          concurrency: { kind: 'limited', maximum: 2 },
          admissionAllowance: { kind: 'limited', maximum: 4 },
        },
      };
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(accepting ? 503 : 202);
      // The real SQLite trigger proves the failure happened before recovery is allowed.
      await vi.waitFor(
        () =>
          expect(
            database!.prepare('SELECT * FROM injected_command_faults').all().length
          ).toBeGreaterThan(0),
        { timeout: 5000, interval: 20 }
      );
      const receipt = await running.app.inject(`/api/v2/commands/${request.commandId}`);
      if (boundary === 'accept') expect(receipt.statusCode).toBe(404);
      else if (!accepting)
        expect(receipt.json()).toMatchObject({
          state: boundary === 'claim' ? 'accepted' : 'running',
        });
      database.exec('DROP TRIGGER injected_command_failure');
      if (boundary === 'accept')
        expect(
          (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
            .statusCode
        ).toBe(202);
      await vi.waitFor(
        async () =>
          expect(
            (await running!.app.inject(`/api/v2/commands/${request.commandId}`)).json()
          ).toMatchObject({
            state: boundary === 'claim-committed' ? 'uncertain' : 'succeeded',
          }),
        { timeout: 10000, interval: 30 }
      );
      expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
        revision: before + (boundary === 'claim-committed' ? 0 : 1),
        ...(boundary === 'claim-committed' ? {} : { paused: true, concurrency: 2, allowance: 4 }),
      });
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(200);
      expect((await running.app.inject('/api/scheduler')).json().state.revision).toBe(
        before + (boundary === 'claim-committed' ? 0 : 1)
      );
    } finally {
      database?.close();
      await running?.close();
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    }
  }
);
