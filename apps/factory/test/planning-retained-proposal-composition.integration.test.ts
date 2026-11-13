import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { format } from 'node:util';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import type { FactoryV2Snapshot } from '../src/http/index.js';
import { protocol } from './fixtures/setup.js';

it('processes a retained selection even when its input matches an older deferred plan', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 9, 12));
  const host = await protocol();
  execFileSync('git', ['-C', host.repository, 'remote', 'add', 'origin', host.repository]);
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  let database: DatabaseSync | undefined;
  const output = vi.spyOn(console, 'log');
  const planning = {
    issues: [
      {
        number: 581,
        title: 'Retain an actionable proposal',
        body: 'Implement this issue',
        updatedAt: '2026-11-09T10:00:00Z',
        state: 'OPEN',
        url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
        author: { login: 'rafaeltab' },
        labels: [{ name: 'ready-for-agent' }],
        comments: [],
      },
    ],
    projectItems: [
      {
        project: { id: 'project', title: 'WallpaperDB', number: 7, owner: { login: 'rafaeltab' } },
        priority: { name: 'P2', optionId: 'priority-P2' },
        size: null,
        fieldValueByName: null,
      },
    ],
  };
  const deferred = {
    selected: [],
    deferred: [{ issue: 581, reason: 'First model defers this input' }],
  };
  try {
    await host.save({ planning, planner: { status: 'running', proposal: deferred } });
    const original = `${host.directory}/commands/original-protocol.mjs`;
    await writeFile(original, await readFile(`${host.directory}/commands/gh.mjs`, 'utf8'));
    const phaseFile = `${host.directory}/priority-phase`;
    // Project choices can change independently of issue.updatedAt. The next poll
    // sees P0, while both subsequent independent planning reads see P2 again.
    await host.nodeCommand(
      'gh',
      `
      import { readFileSync, writeFileSync, existsSync } from 'node:fs';
      import { runProtocol } from ${JSON.stringify(pathToFileURL(original).href)};
      const args = process.argv.slice(2);
      const phaseFile = ${JSON.stringify(phaseFile)};
      if (args[0] === 'issue' && args[1] === 'list' && existsSync(phaseFile)) {
        const phase = Number(readFileSync(phaseFile, 'utf8'));
        const config = JSON.parse(readFileSync(process.env.FACTORY_FIXTURE, 'utf8'));
        config.planning.projectItems[0].priority = phase === 0
          ? { name: 'P0', optionId: 'priority-P0' }
          : { name: 'P2', optionId: 'priority-P2' };
        writeFileSync(process.env.FACTORY_FIXTURE, JSON.stringify(config));
        writeFileSync(phaseFile, String(phase + 1));
      }
      process.exitCode = await runProtocol(process.env, [process.argv[0], 'gh', ...args], console);
    `,
      { module: true }
    );
    running = await startFactory({
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: `${host.directory}/state`,
      FACTORY_PORT: '0',
    });
    database = new DatabaseSync(`${host.directory}/state/factory.sqlite`);
    database.exec(`
      CREATE TABLE successful_write_marker (confirmed INTEGER);
      CREATE TRIGGER observe_success_write AFTER INSERT ON records
      WHEN NEW.name LIKE 'planning-accepted-%'
      BEGIN INSERT INTO successful_write_marker VALUES (1); END;
    `);
    const starts = async () =>
      (await host.calls()).filter(
        (call) => call.args[1] === 'start' && !call.args.includes('--help')
      );
    const board = async () =>
      (await running!.app.inject('/api/v2/board')).json<FactoryV2Snapshot>();
    await vi.waitFor(async () => expect(await starts()).toHaveLength(1), {
      timeout: 6000,
      interval: 20,
    });
    await host.save({ planning, planner: { status: 'completed', proposal: deferred } });
    // The test-owned marker coordinates the committed first transaction only.
    await vi.waitFor(
      () =>
        expect(database!.prepare('SELECT * FROM successful_write_marker').all()).toHaveLength(1),
      { timeout: 6000, interval: 20 }
    );
    expect((await board()).meta.factory.admission.consumed).toBe(0);
    database.exec(`CREATE TRIGGER reject_retained_success BEFORE INSERT ON records
      WHEN NEW.name LIKE 'planning-accepted-%'
      BEGIN SELECT RAISE(FAIL, 'Controlled retained success write failure'); END;`);
    await host.save({
      planning,
      planner: {
        status: 'completed',
        proposal: {
          selected: [
            {
              issue: 581,
              reason: 'The new model selects the restored input',
              includeCodeFromIssues: [],
            },
          ],
          deferred: [],
        },
      },
    });
    await writeFile(phaseFile, '0');
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await vi.waitFor(
      () =>
        expect(
          output.mock.calls.some((args) =>
            format(...args).includes('Controlled retained success write failure')
          )
        ).toBe(true),
      { timeout: 6000, interval: 20 }
    );
    expect((await starts()).filter((call) => !call.args.includes('--worktree'))).toHaveLength(2);
    database.exec('DROP TRIGGER reject_retained_success');
    await vi.waitFor(async () => expect((await board()).meta.factory.admission.consumed).toBe(1), {
      timeout: 10000,
      interval: 20,
    });
    await vi.waitFor(
      async () =>
        expect((await starts()).filter((call) => call.args.includes('--worktree'))).toHaveLength(1),
      { timeout: 6000, interval: 20 }
    );
    expect((await starts()).filter((call) => !call.args.includes('--worktree'))).toHaveLength(2);
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
});
