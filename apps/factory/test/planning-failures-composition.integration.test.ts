import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { startFactory } from '../src/composition/index.js';
import { protocol } from './fixtures/setup.js';
import type { BoardSnapshot } from '../src/capabilities/board/index.js';

it('pauses after three distinct automatic model deadlines and retains their durations after restart', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 8, 12));
  const host = await protocol();
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
  const starts = async () =>
    (await host.calls()).filter(
      (call) => call.args[1] === 'start' && !call.args.includes('--help')
    );
  try {
    await host.save({
      holds: ['planning-read'],
      planning: {
        issues: [
          {
            number: 581,
            title: 'Repair planning',
            body: 'Implement the bounded planning behavior',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
        ],
      },
      planner: {
        status: 'running',
        interruptCompletes: true,
        proposal: { selected: [], deferred: [] },
      },
    });
    await Effect.runPromise(
      fileScheduleStore(configuration.FACTORY_STATE).save({
        revision: 0,
        concurrency: 1,
        allowance: 2,
        paused: false,
        admissions: [],
      })
    );
    running = await startFactory(configuration);
    await vi.waitFor(
      async () =>
        expect(await readFile(`${host.directory}/held-planning-read`, 'utf8')).toBe(
          'planning-read'
        ),
      { timeout: 5000, interval: 20 }
    );
    vi.setSystemTime(Date.now() + 3 * 60_000);
    await writeFile(`${host.directory}/release-planning-read`, 'continue discovery');
    const elapsed = [11 * 60_000, 12 * 60_000, 10.5 * 60_000];
    for (let index = 0; index < 3; index++) {
      await vi.waitFor(async () => expect(await starts()).toHaveLength(index + 1), {
        timeout: 6000,
        interval: 20,
      });
      // Each provider run gets a different actual elapsed interval. A fixed ten-minute
      // duration, or discovery time charged to model execution, fails these assertions.
      vi.setSystemTime(Date.now() + elapsed[index]);
      if (index === 0) {
        await vi.waitFor(
          async () =>
            expect(
              (await running!.app.inject('/api/v2/board')).json().meta.factory.planning
                .consecutiveModelDeadlineFailures
            ).toBe(1),
          { timeout: 5000, interval: 20 }
        );
        const first = (await running.app.inject('/api/v2/board')).json<BoardSnapshot>();
        const acknowledge = Object.values(first.entities.actions).find(
          (a) => a.kind === 'acknowledge-planning-failures'
        );
        if (acknowledge?.availability.state !== 'available')
          throw new Error('Missing first failure action');
        expect(
          (
            await running.app.inject({
              method: 'POST',
              url: '/api/v2/commands',
              payload: {
                commandId: randomUUID(),
                actionId: acknowledge.id,
                precondition: acknowledge.availability.precondition,
                kind: 'acknowledge-planning-failures',
                payload: {},
              },
            })
          ).statusCode
        ).toBe(202);
        await vi.waitFor(
          async () =>
            expect(
              (await running!.app.inject('/api/v2/board')).json().meta.factory.planning
                .pendingNoticeCount
            ).toBe(0),
          { timeout: 5000, interval: 20 }
        );
      }
    }
    await vi.waitFor(
      async () =>
        expect((await running!.app.inject('/api/scheduler')).json().state.paused).toBe(true),
      { timeout: 6000, interval: 20 }
    );
    await vi.waitFor(
      async () => {
        const current = (await running!.app.inject('/api/v2/board')).json();
        expect(current.meta.factory).toMatchObject({
          paused: true,
          planning: { consecutiveModelDeadlineFailures: 3 },
        });
      },
      { timeout: 5000, interval: 20 }
    );
    const board = (await running.app.inject('/api/v2/board')).json();
    expect(board.meta.factory.planning).toMatchObject({
      maximumAttempts: 3,
      consecutiveModelDeadlineFailures: 3,
      pendingNoticeCount: 1,
      notice: { acknowledgedAt: null },
    });
    const notice = board.meta.factory.planning.notice;
    expect(notice.failures).toHaveLength(3);
    expect(
      new Set(notice.failures.map((failure: { attemptId: string }) => failure.attemptId)).size
    ).toBe(3);
    for (const [index, failure] of notice.failures.entries()) {
      expect(failure).toMatchObject({ code: 'model-deadline', runId: 'planner-run' });
      expect(failure.modelElapsedMs).toBeGreaterThanOrEqual(elapsed[index]);
      expect(failure.modelElapsedMs).toBeLessThan(elapsed[index] + 6000);
      expect(failure.attemptElapsedMs).toBeGreaterThanOrEqual(failure.modelElapsedMs);
    }
    expect(
      notice.failures[0].attemptElapsedMs - notice.failures[0].modelElapsedMs
    ).toBeGreaterThanOrEqual(3 * 60_000);
    expect(await starts()).toHaveLength(3);
    await running.close();
    running = undefined;
    vi.setSystemTime(Date.now() + 5 * 60_000);
    running = await startFactory(configuration);
    const reopened = (await running.app.inject('/api/v2/board')).json<BoardSnapshot>();
    expect(reopened.meta.factory.paused).toBe(true);
    expect(reopened.meta.factory.planning.notice).toEqual(notice);
    expect(await starts()).toHaveLength(3);
    const state = (await running.app.inject('/api/scheduler')).json().state;
    const prematureResume = await running.app.inject({
      method: 'POST',
      url: '/api/scheduler',
      payload: { revision: state.revision, paused: false, concurrency: 2, allowance: 3 },
    });
    expect(prematureResume.statusCode).toBe(422);
    expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
      paused: true,
      concurrency: 1,
      allowance: 2,
    });
    const configure = Object.values(reopened.entities.actions).find((a) => a.kind === 'configure');
    if (configure?.availability.state !== 'available')
      throw new Error('Configuration must remain available');
    const mixed = {
      commandId: randomUUID(),
      actionId: configure.id,
      precondition: configure.availability.precondition,
      kind: 'configure',
      payload: {
        paused: false,
        concurrency: { kind: 'limited', maximum: 2 },
        admissionAllowance: { kind: 'limited', maximum: 3 },
      },
    };
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: mixed }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(
      async () =>
        expect(
          (await running!.app.inject(`/api/v2/commands/${mixed.commandId}`)).json()
        ).toMatchObject({ state: 'rejected', reasons: [{ code: 'acknowledgement-required' }] }),
      { timeout: 5000, interval: 20 }
    );
    expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
      paused: true,
      concurrency: 1,
      allowance: 2,
    });
    const pausedEdit = {
      ...mixed,
      commandId: randomUUID(),
      payload: { ...mixed.payload, paused: true },
    };
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: pausedEdit }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(
      async () =>
        expect(
          (await running!.app.inject(`/api/v2/commands/${pausedEdit.commandId}`)).json().state
        ).toBe('succeeded'),
      { timeout: 5000, interval: 20 }
    );
    expect((await running.app.inject('/api/scheduler')).json().state).toMatchObject({
      paused: true,
      concurrency: 2,
      allowance: 3,
    });
    await vi.waitFor(
      async () =>
        expect(
          (await running!.app.inject('/api/v2/board')).json().meta.factory.planning
        ).toMatchObject({
          consecutiveModelDeadlineFailures: 3,
          pendingNoticeCount: 1,
          notice: { acknowledgedAt: null },
        }),
      { timeout: 5000, interval: 20 }
    );
    const action = Object.values(reopened.entities.actions).find(
      (value) => value.kind === 'acknowledge-planning-failures'
    );
    expect(action?.availability.state).toBe('available');
    if (!action || action.availability.state !== 'available')
      throw new Error('Missing acknowledgement');
    const request = {
      commandId: randomUUID(),
      actionId: action.id,
      precondition: action.availability.precondition,
      kind: 'acknowledge-planning-failures',
      payload: {},
    };
    const send = (payload: object) =>
      running!.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload,
      });
    expect((await send(request)).statusCode).toBe(202);
    await vi.waitFor(
      async () => {
        const receipt = (await running!.app.inject(`/api/v2/commands/${request.commandId}`)).json();
        expect(receipt).toMatchObject({ state: 'succeeded', result: null });
      },
      { timeout: 5000, interval: 20 }
    );
    await vi.waitFor(
      async () => {
        const seen = (await running!.app.inject('/api/v2/board')).json();
        expect(seen.meta.factory.planning.pendingNoticeCount).toBe(0);
        expect(seen.meta.factory.planning.notice.acknowledgedAt).not.toBeNull();
        expect(seen.meta.factory).toMatchObject({
          paused: true,
          planning: { consecutiveModelDeadlineFailures: 3 },
        });
      },
      { timeout: 5000, interval: 20 }
    );
    const receipt = (await running.app.inject(`/api/v2/commands/${request.commandId}`)).json();
    const resumeState = (await running.app.inject('/api/scheduler')).json().state;
    const resumed = await running.app.inject({
      method: 'POST',
      url: '/api/scheduler',
      payload: {
        revision: resumeState.revision,
        paused: false,
        concurrency: resumeState.concurrency,
        allowance: resumeState.allowance,
      },
    });
    expect(resumed.statusCode).toBe(200);
    await vi.waitFor(async () => expect(await starts()).toHaveLength(4), {
      timeout: 6000,
      interval: 20,
    });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await vi.waitFor(
      async () => {
        const next = (await running!.app.inject('/api/v2/board')).json();
        expect(next.meta.factory.planning.consecutiveModelDeadlineFailures).toBe(1);
        expect(next.meta.factory.planning.notice.id).not.toBe(notice.id);
      },
      { timeout: 6000, interval: 20 }
    );
    expect((await send(request)).json()).toEqual(receipt);
    expect((await send({ ...request, commandId: randomUUID() })).statusCode).toBe(412);
    expect(
      (await running.app.inject('/api/v2/board')).json().meta.factory.planning.notice.acknowledgedAt
    ).toBeNull();
    const unseen = (await running.app.inject('/api/v2/board')).json().meta.factory.planning.notice;
    await running.close();
    running = undefined;
    const saved = JSON.parse(await readFile(host.configFile, 'utf8'));
    await host.save({ ...saved, planner: { ...saved.planner, status: 'completed' } });
    running = await startFactory(configuration);
    await vi.waitFor(
      async () => {
        const planned = (await running!.app.inject('/api/v2/board')).json();
        expect(planned.meta.factory.planning.consecutiveModelDeadlineFailures).toBe(0);
        expect(planned.meta.factory.planning.notice).toEqual(unseen);
      },
      { timeout: 6000, interval: 20 }
    );
    await running.close();
    running = undefined;
    await host.save({ ...saved, githubQuotaReset: Math.ceil(Date.now() / 1000) + 3600 });
    const beforeNew = (await starts()).length;
    running = await startFactory(configuration);
    await vi.waitFor(async () => expect(await starts()).toHaveLength(beforeNew + 1), {
      timeout: 6000,
      interval: 20,
    });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await vi.waitFor(
      async () => {
        const next = (await running!.app.inject('/api/v2/board')).json();
        expect(next.meta.factory.planning).toMatchObject({
          consecutiveModelDeadlineFailures: 1,
          pendingNoticeCount: 2,
          notice: { id: unseen.id },
        });
      },
      { timeout: 6000, interval: 20 }
    );
    const pending = (await running.app.inject('/api/v2/board')).json<BoardSnapshot>();
    const nextAck = Object.values(pending.entities.actions).find(
      (a) => a.kind === 'acknowledge-planning-failures'
    );
    if (nextAck?.availability.state !== 'available')
      throw new Error('Missing retained notice action');
    expect(
      (
        await send({
          ...request,
          commandId: randomUUID(),
          actionId: nextAck.id,
          precondition: nextAck.availability.precondition,
        })
      ).statusCode
    ).toBe(202);
    await vi.waitFor(
      async () => {
        const next = (await running!.app.inject('/api/v2/board')).json();
        expect(next.meta.factory.planning.pendingNoticeCount).toBe(1);
        expect(next.meta.factory.planning.notice.id).not.toBe(unseen.id);
        expect(next.meta.factory.planning.notice.acknowledgedAt).toBeNull();
      },
      { timeout: 5000, interval: 20 }
    );
  } finally {
    await writeFile(`${host.directory}/release-planning-read`, 'cleanup');
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});

it('keeps a nonexhausted streak through manual previews, pause/resume and empty discovery', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 8, 12));
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const configuration = {
    ...host.mcpEnvironment,
    FACTORY_PROJECT: host.repository,
    FACTORY_T3_PROJECT_ID: 'project-id',
    FACTORY_BASE: host.base,
    FACTORY_T3_BINARY: host.binary,
    FACTORY_STATE: `${host.directory}/state`,
    FACTORY_PORT: '0',
  };
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  const planning = {
    issues: [
      {
        number: 581,
        title: 'Repair planning',
        body: 'Implement bounded planning',
        state: 'OPEN',
        url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
        author: { login: 'rafaeltab' },
        labels: [{ name: 'ready-for-agent' }],
        comments: [],
      },
    ],
  };
  const planner = {
    status: 'running',
    interruptCompletes: true,
    proposal: { selected: [], deferred: [] },
  };
  try {
    await host.save({ planning, planner });
    running = await startFactory(configuration);
    await vi.waitFor(
      async () =>
        expect(
          (await host.calls()).filter((c) => c.args[1] === 'start' && !c.args.includes('--help'))
        ).toHaveLength(1),
      { timeout: 6000, interval: 20 }
    );
    const controls = (await running.app.inject('/api/scheduler')).json().state;
    expect(
      (
        await running.app.inject({
          method: 'POST',
          url: '/api/scheduler',
          payload: {
            revision: controls.revision,
            concurrency: controls.concurrency,
            allowance: controls.allowance,
            paused: true,
          },
        })
      ).statusCode
    ).toBe(200);
    vi.setSystemTime(Date.now() + 11 * 60000);
    await vi.waitFor(
      async () =>
        expect(
          (await running!.app.inject('/api/v2/board')).json().meta.factory.planning
            .consecutiveModelDeadlineFailures
        ).toBe(1),
      { timeout: 6000, interval: 20 }
    );
    await host.save({ planning, planner: { ...planner, status: 'completed' } });
    const snapshot = (await running.app.inject('/api/v2/board')).json<BoardSnapshot>();
    const action = Object.values(snapshot.entities.actions).find((a) => a.kind === 'preview-plan');
    if (action?.availability.state !== 'available') throw new Error('Missing manual preview');
    const commandId = randomUUID();
    expect(
      (
        await running.app.inject({
          method: 'POST',
          url: '/api/v2/commands',
          payload: {
            commandId,
            actionId: action.id,
            precondition: action.availability.precondition,
            kind: 'preview-plan',
            payload: {},
          },
        })
      ).statusCode
    ).toBe(202);
    let planId = '';
    await vi.waitFor(
      async () => {
        const receipt = (await running!.app.inject(`/api/v2/commands/${commandId}`)).json();
        expect(receipt.state).toBe('succeeded');
        planId = receipt.result.planId;
        expect(
          (await running!.app.inject(`/api/v2/plans/${encodeURIComponent(planId)}`)).json().attempt
            .phase
        ).toBe('succeeded');
      },
      { timeout: 6000, interval: 20 }
    );
    expect(
      (await running.app.inject('/api/v2/board')).json().meta.factory.planning
        .consecutiveModelDeadlineFailures
    ).toBe(1);
    await host.save({ planning: { issues: [] }, planner });
    const paused = (await running.app.inject('/api/scheduler')).json().state;
    expect(
      (
        await running.app.inject({
          method: 'POST',
          url: '/api/scheduler',
          payload: {
            revision: paused.revision,
            concurrency: paused.concurrency,
            allowance: paused.allowance,
            paused: false,
          },
        })
      ).statusCode
    ).toBe(200);
    vi.setSystemTime(Date.now() + 5 * 60000);
    await vi.waitFor(
      async () => {
        const board = (await running!.app.inject('/api/v2/board')).json();
        expect(board.meta.factory.paused).toBe(false);
        expect(board.meta.factory.planning.consecutiveModelDeadlineFailures).toBe(1);
      },
      { timeout: 5000, interval: 20 }
    );
    expect(
      (await running.app.inject('/api/v2/board')).json().meta.factory.planning.notice?.id
    ).toBe(snapshot.meta.factory.planning.notice?.id);
  } finally {
    await running?.close();
    vi.useRealTimers();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
