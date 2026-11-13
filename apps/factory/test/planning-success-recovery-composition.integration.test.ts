import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { format } from 'node:util';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import type { FactoryV2Snapshot } from '../src/http/index.js';
import { protocol } from './fixtures/setup.js';

it.each([false, true])(
  'recovers a planning success write without reusing changed inputs, changed=%s',
  async (changed) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 9, 12));
    const host = await protocol();
    execFileSync('git', ['-C', host.repository, 'remote', 'add', 'origin', host.repository]);
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
    const planning = {
      issues: [
        {
          number: 581,
          title: 'Recover the accepted plan',
          body: 'Implement this eligible issue',
          state: 'OPEN',
          url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
          author: { login: 'rafaeltab' },
          labels: [{ name: 'ready-for-agent' }],
          comments: [],
        },
      ],
    };
    let running: Awaited<ReturnType<typeof startFactory>> | undefined;
    let database: DatabaseSync | undefined;
    const output = vi.spyOn(console, 'log');
    const board = async () =>
      (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    const configure = async (paused: boolean) => {
      const current = await board();
      const action = Object.values(current.entities.actions).find(
        (value) => value.kind === 'configure'
      );
      if (action?.availability.state !== 'available') throw new Error('Configure unavailable');
      const commandId = randomUUID();
      expect(
        (
          await running!.app.inject({
            method: 'POST',
            url: '/api/v2/commands',
            payload: {
              commandId,
              actionId: action.id,
              precondition: action.availability.precondition,
              kind: 'configure',
              payload: {
                paused,
                concurrency: { kind: 'limited', maximum: 1 },
                admissionAllowance: { kind: 'limited', maximum: 2 },
              },
            },
          })
        ).statusCode
      ).toBe(202);
      await vi.waitFor(
        async () =>
          expect((await running!.app.inject(`/api/v2/commands/${commandId}`)).json().state).toBe(
            'succeeded'
          ),
        { timeout: 6000, interval: 20 }
      );
    };
    const starts = async () =>
      (await host.calls()).filter(
        (call) => call.args[1] === 'start' && !call.args.includes('--help')
      );
    try {
      await host.save({
        planning,
        planner: {
          status: 'running',
          interruptCompletes: true,
          proposal: { selected: [], deferred: [] },
        },
      });
      running = await startFactory(configuration);
      await vi.waitFor(async () => expect(await starts()).toHaveLength(1), {
        timeout: 6000,
        interval: 20,
      });
      await configure(true);
      const failedAt = Date.now() + 11 * 60_000;
      await host.save({
        planning,
        planner: {
          status: 'running',
          interruptCompletes: true,
          completedAt: new Date(failedAt).toISOString(),
          proposal: { selected: [], deferred: [] },
        },
      });
      vi.setSystemTime(failedAt);
      await vi.waitFor(
        async () =>
          expect((await board()).meta.factory.planning.consecutiveModelDeadlineFailures).toBe(1),
        { timeout: 6000, interval: 20 }
      );
      const notice = (await board()).meta.factory.planning.notice;
      await running.close();
      running = undefined;
      await host.save({
        planning,
        planner: {
          status: 'completed',
          proposal: {
            selected: [
              {
                issue: 581,
                reason: 'Eligible bounded implementation',
                includeCodeFromIssues: [],
              },
            ],
            deferred: [],
          },
        },
      });
      database = new DatabaseSync(`${host.directory}/state/factory.sqlite`);
      database.exec(`CREATE TRIGGER reject_planning_success BEFORE INSERT ON records
      WHEN NEW.name LIKE 'planning-accepted-%'
      BEGIN SELECT RAISE(FAIL, 'Controlled planning acceptance write failure'); END;`);
      running = await startFactory(configuration);
      await configure(false);
      // A failed transaction rolls its SQL marker back too. The startup error output
      // coordinates release of the injected fault; domain assertions remain public.
      await vi.waitFor(
        () =>
          expect(
            output.mock.calls.some((args) =>
              format(...args).includes('Controlled planning acceptance write failure')
            )
          ).toBe(true),
        { timeout: 6000, interval: 20 }
      );
      expect((await board()).meta.factory.planning.consecutiveModelDeadlineFailures).toBe(1);
      expect((await board()).meta.factory.admission.consumed).toBe(0);
      const faultCount = () =>
        output.mock.calls.filter((args) =>
          format(...args).includes('Controlled planning acceptance write failure')
        ).length;
      const discoveryCount = async () =>
        (await host.calls()).filter(
          (call) => call.binary === 'gh' && call.args[0] === 'issue' && call.args[1] === 'list'
        ).length;
      const faults = faultCount(),
        discoveries = await discoveryCount();
      // The adapter and scheduler each log a failed transaction. Two additional
      // outputs establish another retry while the same storage fault remains active.
      await vi.waitFor(() => expect(faultCount()).toBeGreaterThanOrEqual(faults + 2), {
        timeout: 6000,
        interval: 20,
      });
      expect(await discoveryCount()).toBe(discoveries);
      expect(await starts()).toHaveLength(2);
      if (changed) {
        const saved = JSON.parse(await readFile(host.configFile, 'utf8'));
        await host.save({
          ...saved,
          planning: {
            issues: planning.issues.map((issue) => ({
              ...issue,
              body: 'Changed scope requires a different proposal',
            })),
          },
          planner: {
            status: 'completed',
            proposal: {
              selected: [],
              deferred: [{ issue: 581, reason: 'Changed scope is deferred' }],
            },
          },
        });
      }
      database.exec('DROP TRIGGER reject_planning_success');
      await vi.waitFor(
        async () =>
          expect((await board()).meta.factory).toMatchObject({
            paused: false,
            admission: { consumed: changed ? 0 : 1 },
            planning: {
              consecutiveModelDeadlineFailures: 0,
              pendingNoticeCount: 1,
              notice: { id: notice?.id },
            },
          }),
        { timeout: 10000, interval: 20 }
      );
      await vi.waitFor(async () => expect(await starts()).toHaveLength(3), {
        timeout: 6000,
        interval: 20,
      });
      expect((await starts()).filter((call) => call.args.includes('--worktree'))).toHaveLength(
        changed ? 0 : 1
      );
      if (changed)
        await vi.waitFor(
          async () =>
            expect(
              (await host.calls()).filter((call) => call.args[1] === 't3_thread_organize')
            ).toHaveLength(3),
          { timeout: 6000, interval: 20 }
        );
    } finally {
      database?.close();
      await running?.close();
      output.mockRestore();
      vi.useRealTimers();
      process.env.PATH = previous.path;
      if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
      else process.env.FACTORY_FIXTURE = previous.fixture;
      await host.cleanup();
    }
  }
);
