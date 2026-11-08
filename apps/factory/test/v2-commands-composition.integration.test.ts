import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import type {
  FactoryV2Command,
  FactoryV2CommandReceipt,
  FactoryV2Snapshot,
} from '../src/http/index.js';
import { protocol } from './fixtures/setup.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { initializeState } from '../src/platform/index.js';

type Running = Awaited<ReturnType<typeof startFactory>>;
async function composed(
  check: (fixture: {
    running: Running;
    host: Awaited<ReturnType<typeof protocol>>;
    save: (patch: object) => Promise<void>;
    reopen: () => Promise<Running>;
  }) => Promise<void>,
  options: object = {},
  initialControl?: { paused: boolean }
) {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  const configuration = {
    lost: false,
    base: host.base,
    planning: {
      issues: [
        {
          number: 577,
          title: 'Selected v2 issue',
          body: 'Implement only this issue',
          state: 'OPEN',
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/577',
          author: { login: 'rafaeltab' },
          labels: [{ id: 'L1', name: 'ready-for-agent', color: 'abcdef' }],
          assignees: [],
          comments: [],
          updatedAt: '2026-11-06T12:00:00Z',
        },
      ],
    },
    planner: { proposal: { selected: [], deferred: [] } },
    ...options,
  };
  const save = (patch: object) => host.save({ ...configuration, ...patch });
  let running: Running | undefined;
  try {
    await save({});
    await writeFile(`${host.directory}/authorization`, 'Bearer controlled-protocol');
    if (initialControl) {
      initializeState(`${host.directory}/state`);
      expect(
        await Effect.runPromise(
          fileScheduleStore(`${host.directory}/state`).save({
            revision: 0,
            paused: initialControl.paused,
            concurrency: 1,
            allowance: 1,
            admissions: [],
          })
        )
      ).toBe(true);
    }
    const open = () =>
      startFactory({
        FACTORY_PROJECT: host.repository,
        FACTORY_T3_PROJECT_ID: 'project-id',
        FACTORY_BASE: host.base,
        FACTORY_T3_BINARY: host.binary,
        FACTORY_STATE: `${host.directory}/state`,
        FACTORY_PORT: '0',
        FACTORY_T3_MCP_ENDPOINT: 'http://127.0.0.1:1/mcp',
        FACTORY_T3_MCP_AUTHORIZATION_FILE: `${host.directory}/authorization`,
      });
    running = await open();
    await check({
      running,
      host,
      save,
      reopen: async () => {
        await running?.close();
        running = await open();
        return running;
      },
    });
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
}
async function action(running: Running, kind: FactoryV2Command['kind'], target?: string) {
  return vi.waitFor(
    async () => {
      const snapshot = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      const candidate = Object.values(snapshot.entities.actions).find(
        (a) => a.kind === kind && (!target || a.targetId === target)
      );
      if (candidate?.availability.state !== 'available')
        throw new Error(`${kind} is not available`);
      return { actionId: candidate.id, precondition: candidate.availability.precondition };
    },
    { timeout: 10000, interval: 40 }
  );
}
async function receipt(running: Running, id: string) {
  return vi.waitFor(
    async () => {
      const value = (
        await running.app.inject(`/api/v2/commands/${id}`)
      ).json<FactoryV2CommandReceipt>();
      expect(value).toMatchObject({ state: 'succeeded' });
      return value;
    },
    { timeout: 30000, interval: 40 }
  );
}
async function start(running: Running) {
  const request = {
    ...(await action(running, 'start', 'issue:rafaeltab/wallpaperdb/577')),
    commandId: '00000000-0000-4000-8000-000000000031',
    kind: 'start',
    payload: { context: 'Only issue 577. Keep the approved boundary.' },
  };
  expect(
    (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
      .statusCode
  ).toBe(202);
  const result = await receipt(running, request.commandId);
  expect(result.result).toEqual({ jobId: 'job:rafaeltab/wallpaperdb/577' });
  return { request, result };
}
async function stageMessages(host: Awaited<ReturnType<typeof protocol>>) {
  return (await host.calls()).flatMap((call) => {
    if (call.binary !== 't3') return [];
    if (call.args[0] === 'acp-mcp-call' && call.args[1] === 't3_thread_send') {
      const { message } = JSON.parse(call.args[2]);
      if (typeof message !== 'string') throw new Error('Missing stage message');
      return [message];
    }
    return call.args[1] === 'send' && !call.args.includes('--help') ? [String(call.args[3])] : [];
  });
}

it('requires attention and releases capacity when an implementation turn ends without success', () =>
  composed(async ({ running, save }) => {
    await start(running);
    await save({
      overrides: { status: 'completed' },
      messages: [
        {
          role: 'assistant',
          runId: 'run-1',
          text: 'Implementation incomplete. No repair established.',
        },
      ],
    });
    await vi.waitFor(
      async () => {
        const board = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
        expect(board.entities.jobs['job:rafaeltab/wallpaperdb/577']).toMatchObject({
          stage: 'implementation',
          activity: 'manual-recovery',
          execution: { state: 'known', value: { state: 'finished', runId: 'run-1' } },
          occupiesCapacity: false,
        });
        expect(board.entities.items['item:issue:rafaeltab/wallpaperdb/577']).toMatchObject({
          status: { code: 'manual-recovery', active: false },
          attention: { state: 'required' },
        });
        expect(board.meta.factory.concurrency.occupied).toBe(0);
        expect(board.meta.factory.admission.consumed).toBe(1);
      },
      { timeout: 8000, interval: 40 }
    );
  }));

it('manually retries incomplete implementation in a fresh original-base worktree without another admission', () =>
  composed(
    async ({ running, host, save }) => {
      await start(running);
      const launches = async () =>
        (await host.calls()).filter(
          (call) =>
            call.binary === 't3' && call.args[1] === 'start' && call.args.includes('--worktree')
        );
      const original = (await launches())[0];
      const branch = original.args[original.args.indexOf('--branch') + 1];
      const resourcePath = `${host.directory}/resource-${branch.replaceAll('/', '-')}.json`;
      const prior = JSON.parse(await readFile(resourcePath, 'utf8'));
      await writeFile(`${prior.worktreePath}/failed-attempt.txt`, 'Preserve this failed attempt');
      execFileSync('git', ['add', 'failed-attempt.txt'], { cwd: prior.worktreePath });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '-m',
          'Failed attempt',
        ],
        { cwd: prior.worktreePath }
      );
      const oldHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: prior.worktreePath,
        encoding: 'utf8',
      }).trim();
      await writeFile(`${prior.worktreePath}/unfinished.txt`, 'Uncommitted evidence');
      await writeFile(resourcePath, JSON.stringify({ ...prior, status: 'completed' }));
      await save({
        messages: [{ role: 'assistant', runId: 'run-1', text: 'Implementation incomplete.' }],
      });
      const request = {
        ...(await action(running, 'retry', 'job:rafaeltab/wallpaperdb/577')),
        commandId: '00000000-0000-4000-8000-000000000036',
        kind: 'retry',
        payload: {},
      };
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(202);
      const result = await receipt(running, request.commandId);
      expect(result.result).toEqual({ jobId: 'job:rafaeltab/wallpaperdb/577' });
      const calls = await launches();
      expect(calls).toHaveLength(2);
      const retried = calls[1];
      expect(retried.args[retried.args.indexOf('--worktree') + 1]).toBe(host.base);
      expect(retried.args[3]).toContain('Only issue 577. Keep the approved boundary.');
      const nextBranch = retried.args[retried.args.indexOf('--branch') + 1];
      expect(nextBranch).not.toBe(branch);
      const next = JSON.parse(
        await readFile(`${host.directory}/resource-${nextBranch.replaceAll('/', '-')}.json`, 'utf8')
      );
      expect(next.threadId).not.toBe(prior.threadId);
      expect(next.worktreePath).not.toBe(prior.worktreePath);
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: next.worktreePath,
          encoding: 'utf8',
        }).trim()
      ).toBe(host.base);
      await expect(
        readFile(`${next.worktreePath}/failed-attempt.txt`, 'utf8')
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(`${next.worktreePath}/unfinished.txt`, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await readFile(`${prior.worktreePath}/failed-attempt.txt`, 'utf8')).toBe(
        'Preserve this failed attempt'
      );
      expect(await readFile(`${prior.worktreePath}/unfinished.txt`, 'utf8')).toBe(
        'Uncommitted evidence'
      );
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: prior.worktreePath,
          encoding: 'utf8',
        }).trim()
      ).toBe(oldHead);
      await vi.waitFor(
        async () => {
          const board = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
          expect(board.meta.factory.admission.consumed).toBe(1);
          expect(board.meta.factory.concurrency.occupied).toBe(1);
          expect(board.entities.jobs['job:rafaeltab/wallpaperdb/577']).toMatchObject({
            stage: 'implementation',
            execution: { state: 'known', value: { state: 'running' } },
            occupiesCapacity: true,
          });
        },
        { timeout: 8000, interval: 40 }
      );
      const replay = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: request,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(result);
      const stale = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: { ...request, commandId: '00000000-0000-4000-8000-000000000037' },
      });
      expect(stale.statusCode).toBe(422);
      expect(stale.json()).toMatchObject({ code: 'command-rejected' });
      expect(await launches()).toHaveLength(2);
      await writeFile(
        `${host.directory}/resource-${nextBranch.replaceAll('/', '-')}.json`,
        JSON.stringify({ ...next, status: 'completed' })
      );
      await save({
        messages: [
          {
            role: 'assistant',
            runId: 'run-1',
            text: JSON.stringify({
              jobId: prior.title.match(/\[factory:(.*)\]$/)[1],
              stage: 'implementation',
              base: host.base,
              commit: oldHead,
              outcome: '<TASK>COMPLETE</TASK>',
              tests: true,
              coverage: true,
              crap: true,
              reviews: false,
            }),
          },
        ],
      });
      const nextAction = await action(running, 'retry', 'job:rafaeltab/wallpaperdb/577');
      expect(nextAction.precondition).not.toBe(request.precondition);
      expect(await stageMessages(host)).toHaveLength(0);
      const oldReceipt = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: request,
      });
      expect(oldReceipt.json()).toEqual(result);
      const oldToken = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: { ...request, commandId: '00000000-0000-4000-8000-000000000038' },
      });
      expect(oldToken.statusCode).toBe(412);
      expect(oldToken.json()).toMatchObject({ code: 'stale-action' });
      expect(await launches()).toHaveLength(2);
      const again = {
        ...request,
        ...nextAction,
        commandId: '00000000-0000-4000-8000-000000000040',
      };
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: again }))
          .statusCode
      ).toBe(202);
      await receipt(running, again.commandId);
      const finalLaunch = (await launches())[2];
      const finalBranch = finalLaunch.args[finalLaunch.args.indexOf('--branch') + 1];
      await save({ complete: true, overrides: { status: 'completed' } });
      await vi.waitFor(
        async () => {
          const status = (await running.app.inject('/api/scheduler')).json();
          expect(
            status.jobs.find(
              (job: { kind: string; intent?: { issue: number } }) => job.intent?.issue === 577
            )
          ).toMatchObject({
            intent: {
              id: prior.title.match(/\[factory:(.*)\]$/)[1],
              branch: finalBranch,
              base: host.base,
            },
            delivery: { stage: 'ci', ready: true, landed: false },
          });
        },
        { timeout: 10000, interval: 40 }
      );
      expect(await launches()).toHaveLength(3);
      expect(
        (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.factory.admission
          .consumed
      ).toBe(1);
    },
    { parallel: true }
  ));

it('retains an uncertain fresh retry and its admission across startup without launching again', () =>
  composed(
    async ({ running, host, save, reopen }) => {
      await start(running);
      const first = (await host.calls()).find(
        (c) => c.args[1] === 'start' && c.args.includes('--worktree')
      );
      const branch = first.args[first.args.indexOf('--branch') + 1];
      const path = `${host.directory}/resource-${branch.replaceAll('/', '-')}.json`;
      const old = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...old, status: 'completed' }));
      await save({
        unavailableStart: true,
        messages: [{ role: 'assistant', runId: 'run-1', text: 'Implementation incomplete.' }],
      });
      const request = {
        ...(await action(running, 'retry', 'job:rafaeltab/wallpaperdb/577')),
        commandId: '00000000-0000-4000-8000-000000000039',
        kind: 'retry',
        payload: {},
      };
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(202);
      const uncertain = await vi.waitFor(
        async () => {
          const value = (
            await running.app.inject(`/api/v2/commands/${request.commandId}`)
          ).json<FactoryV2CommandReceipt>();
          expect(value.state).toBe('uncertain');
          return value;
        },
        { timeout: 10000, interval: 40 }
      );
      await save({});
      const restored = await reopen();
      const replay = await restored.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: request,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(uncertain);
      const board = (await restored.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      expect(board.meta.factory.admission.consumed).toBe(1);
      expect(board.meta.factory.concurrency.occupied).toBe(1);
      expect(
        board.entities.actions['action:retry/job:rafaeltab/wallpaperdb/577'].availability.state
      ).toBe('disabled');
      expect(
        (await host.calls()).filter((c) => c.args[1] === 'start' && c.args.includes('--worktree'))
      ).toHaveLength(2);
      expect(await readFile(path, 'utf8')).toBe(JSON.stringify({ ...old, status: 'completed' }));
    },
    { parallel: true }
  ));

it('rejects fresh retry when the original issue is no longer eligible', () =>
  composed(async ({ running, host, save }) => {
    await start(running);
    await save({
      overrides: { status: 'completed' },
      messages: [{ role: 'assistant', runId: 'run-1', text: 'Implementation incomplete.' }],
    });
    const request = {
      ...(await action(running, 'retry', 'job:rafaeltab/wallpaperdb/577')),
      commandId: '00000000-0000-4000-8000-000000000041',
      kind: 'retry',
      payload: {},
    };
    const configuration = JSON.parse(await readFile(host.configFile, 'utf8'));
    await save({
      planning: {
        ...configuration.planning,
        issues: configuration.planning.issues.map((issue: { number: number }) => ({
          ...issue,
          state: 'CLOSED',
        })),
      },
      overrides: { status: 'completed' },
      messages: [{ role: 'assistant', runId: 'run-1', text: 'Implementation incomplete.' }],
    });
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
        .statusCode
    ).toBe(202);
    await vi.waitFor(
      async () =>
        expect(
          (await running.app.inject(`/api/v2/commands/${request.commandId}`)).json()
        ).toMatchObject({ state: 'rejected' }),
      { timeout: 10000, interval: 40 }
    );
    expect(
      (await host.calls()).filter((c) => c.args[1] === 'start' && c.args.includes('--worktree'))
    ).toHaveLength(1);
    expect(
      (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.factory.admission
        .consumed
    ).toBe(1);
  }));

it('submits one retained advisory preview through v2 while the composed factory is paused', () =>
  composed(
    async ({ running, host }) => {
      await vi.waitFor(
        async () =>
          expect(
            (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>().entities.issues[
              'issue:rafaeltab/wallpaperdb/577'
            ].metadata.state
          ).toBe('known'),
        { timeout: 10000, interval: 40 }
      );
      const request = {
        ...(await action(running, 'preview-plan')),
        commandId: '00000000-0000-4000-8000-000000000035',
        kind: 'preview-plan',
        payload: {},
      };
      const before = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(202);
      const result = await receipt(running, request.commandId);
      if (!result.result || !('planId' in result.result))
        throw new Error('Missing retained preview');
      const planId = result.result.planId;
      await vi.waitFor(
        async () =>
          expect(
            (await running.app.inject(`/api/v2/plans/${encodeURIComponent(planId)}`)).json()
          ).toMatchObject({
            attempt: {
              id: planId,
              phase: 'succeeded',
              basis: { controlVersion: before.meta.factory.version },
              result: { selected: [{ issueId: 'issue:rafaeltab/wallpaperdb/577' }] },
            },
          }),
        { timeout: 10000, interval: 40 }
      );
      const planner = JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8'));
      expect(planId).toBe(`plan:${planner.requestId}`);
      const replay = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: request,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(result);
      const calls = await host.calls();
      expect(
        calls.filter(
          (call) => call.binary === 'gh' && call.args[0] === 'issue' && call.args[1] === 'list'
        )
      ).toHaveLength(2);
      expect(
        calls.filter(
          (c) =>
            c.binary === 't3' &&
            c.args[1] === 'start' &&
            !c.args.includes('--help') &&
            !c.args.includes('--worktree')
        )
      ).toHaveLength(1);
      expect(
        calls.filter(
          (c) => c.binary === 't3' && c.args[1] === 'start' && c.args.includes('--worktree')
        )
      ).toHaveLength(0);
      expect(
        (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.factory
      ).toMatchObject({ paused: true, admission: { consumed: 0 } });
    },
    {
      planner: {
        proposal: {
          selected: [{ issue: 577, reason: 'Advisory selection', dependsOn: [], conflicts: [] }],
          deferred: [],
        },
      },
    },
    { paused: true }
  ));

it('resumes the parked question on the existing implementation job through v2', () =>
  composed(async ({ running, host, save }) => {
    await start(running);
    await save({
      activity: [
        {
          itemId: 'question-v2',
          runId: 'run-1',
          sourceThreadId: 'thread-live',
          visibility: 'local',
          type: 'user_input_request',
          status: 'waiting',
          text: 'Which approved behavior?',
        },
      ],
      overrides: { status: 'waiting', pendingRequestCount: 1 },
    });
    const selectors = await action(running, 'resume', 'job:rafaeltab/wallpaperdb/577');
    const owner = (await running.app.inject('/api/job')).json().intent;
    await vi.waitFor(
      async () =>
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          resume: { index: 0, questionId: 'question-v2' },
          delivery: { stage: 'implementation', activity: 'awaiting-answer' },
        }),
      { timeout: 5000, interval: 40 }
    );
    await save({ activity: [], overrides: { status: 'completed', pendingRequestCount: 0 } });
    const request = {
      ...selectors,
      commandId: '00000000-0000-4000-8000-000000000034',
      kind: 'resume',
      payload: {},
    };
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
        .statusCode
    ).toBe(202);
    const result = await receipt(running, request.commandId);
    await vi.waitFor(
      async () =>
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          intent: owner,
          delivery: { stage: 'implementation' },
          execution: { threadId: 'thread-live', run: { id: 'run-2', ordinal: 2 } },
        }),
      { timeout: 30000, interval: 40 }
    );
    expect(
      (await stageMessages(host)).filter(
        (message) => message.includes('Stage 1 of factory') && message.includes('$implement')
      )
    ).toHaveLength(1);
    const replay = await running.app.inject({
      method: 'POST',
      url: '/api/v2/commands',
      payload: request,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(result);
    expect(
      (await stageMessages(host)).filter(
        (message) => message.includes('Stage 1 of factory') && message.includes('$implement')
      )
    ).toHaveLength(1);
    expect(
      (await host.calls()).filter(
        (c) => c.binary === 't3' && c.args[1] === 'start' && c.args.includes('--worktree')
      )
    ).toHaveLength(1);
  }));
it('starts one real composed job with the v2 context and replays its UUID after admission', () =>
  composed(async ({ running, host }) => {
    const { request, result } = await start(running);
    await vi.waitFor(
      async () =>
        expect((await running.app.inject('/api/job')).json()).toMatchObject({
          intent: {
            issue: 577,
            base: host.base,
            context: 'Only issue 577. Keep the approved boundary.',
          },
          execution: { kind: 'found', threadId: 'thread-live' },
        }),
      { timeout: 5000, interval: 40 }
    );
    const calls = (await host.calls()).filter(
      (c) => c.binary === 't3' && c.args[1] === 'start' && c.args.includes('--worktree')
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args[3]).toContain('Only issue 577. Keep the approved boundary.');
    const replay = await running.app.inject({
      method: 'POST',
      url: '/api/v2/commands',
      payload: request,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(result);
    expect(
      (await host.calls()).filter(
        (c) => c.binary === 't3' && c.args[1] === 'start' && c.args.includes('--worktree')
      )
    ).toHaveLength(1);
    expect(
      (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>().meta.factory.admission
        .consumed
    ).toBe(1);
  }));

it('cancels the composed owning job without refunding its admission and replays cancellation', () =>
  composed(async ({ running, host }) => {
    await start(running);
    const request = {
      ...(await action(running, 'cancel', 'job:rafaeltab/wallpaperdb/577')),
      commandId: '00000000-0000-4000-8000-000000000032',
      kind: 'cancel',
      payload: {},
    };
    expect(
      (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
        .statusCode
    ).toBe(202);
    const result = await receipt(running, request.commandId);
    await vi.waitFor(
      async () => {
        const board = (await running.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
        expect(board.entities.jobs['job:rafaeltab/wallpaperdb/577']).toMatchObject({
          cancelled: true,
          occupiesCapacity: false,
        });
        expect(board.meta.factory.admission.consumed).toBe(1);
      },
      { timeout: 5000, interval: 40 }
    );
    const interrupts = (await host.calls()).filter(
      (c) =>
        c.binary === 't3' && c.args[0] === 'acp-mcp-call' && c.args[1] === 't3_thread_interrupt'
    );
    expect(interrupts.length).toBeGreaterThan(0);
    expect(interrupts.every((c) => JSON.parse(c.args[2]).threadId === 'thread-live')).toBe(true);
    const replay = await running.app.inject({
      method: 'POST',
      url: '/api/v2/commands',
      payload: request,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(result);
  }));

it('resumes the exact failed review run through v2 without starting another owning job', () =>
  composed(
    async ({ running, host, save }) => {
      await start(running);
      await vi.waitFor(
        async () =>
          expect((await running.app.inject('/api/job')).json()).toMatchObject({
            delivery: { stage: 'review' },
            execution: { run: { id: 'run-2', ordinal: 2 } },
          }),
        { timeout: 10000, interval: 40 }
      );
      const owner = (await running.app.inject('/api/job')).json().intent;
      await save({ overrides: { status: 'failed', pendingRequestCount: 0 } });
      const request = {
        ...(await action(running, 'resume', 'job:rafaeltab/wallpaperdb/577')),
        commandId: '00000000-0000-4000-8000-000000000033',
        kind: 'resume',
        payload: {},
      };
      expect(
        (await running.app.inject({ method: 'POST', url: '/api/v2/commands', payload: request }))
          .statusCode
      ).toBe(202);
      const result = await receipt(running, request.commandId);
      await vi.waitFor(
        async () =>
          expect((await running.app.inject('/api/job')).json()).toMatchObject({
            intent: owner,
            delivery: { stage: 'review' },
            execution: { threadId: 'thread-live', run: { id: 'run-3', ordinal: 3 } },
          }),
        { timeout: 30000, interval: 40 }
      );
      const messages = await stageMessages(host);
      expect(
        messages.filter(
          (message) => message.includes('Stage 2 of factory') && message.includes('$review-loop')
        )
      ).toHaveLength(1);
      const replay = await running.app.inject({
        method: 'POST',
        url: '/api/v2/commands',
        payload: request,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(result);
      expect(
        (await stageMessages(host)).filter(
          (message) => message.includes('Stage 2 of factory') && message.includes('$review-loop')
        )
      ).toHaveLength(1);
      expect(
        (await host.calls()).filter(
          (c) => c.binary === 't3' && c.args[1] === 'start' && c.args.includes('--worktree')
        )
      ).toHaveLength(1);
    },
    { complete: true, holdReview: true }
  ));
