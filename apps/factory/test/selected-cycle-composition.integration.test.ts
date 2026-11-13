import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { expect, it, vi } from 'vitest';
import { startFactory } from '../src/composition/index.js';
import { fileScheduleStore } from '../src/adapters/store/index.js';
import { protocol } from './fixtures/setup.js';

it('composes capacity, explicit code inclusion, base verification and automatic implementer launch', async () => {
  const host = await protocol();
  const previous = { path: process.env.PATH, fixture: process.env.FACTORY_FIXTURE };
  process.env.PATH = `${host.directory}:${previous.path}`;
  process.env.FACTORY_FIXTURE = host.configFile;
  let running: Awaited<ReturnType<typeof startFactory>> | undefined;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', host.repository, ...args], { encoding: 'utf8' }).trim();
  try {
    git('remote', 'add', 'origin', host.repository);
    git('switch', '-c', 'verified-code');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'verified issue code'
    );
    const code = git('rev-parse', 'HEAD');
    await host.save({
      lost: false,
      prerequisiteHeads: { 591: code },
      planning: {
        candidates: [581],
        issues: [
          {
            number: 581,
            title: 'Use existing verified code',
            body: 'Implement the bounded repair',
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/581',
            author: { login: 'rafaeltab' },
            labels: [{ name: 'ready-for-agent' }],
            comments: [],
          },
          {
            number: 573,
            title: 'Verified prerequisite',
            body: `https://github.com/rafaeltab/wallpaperdb/pull/591 ${code}`,
            state: 'OPEN',
            url: 'https://github.com/rafaeltab/wallpaperdb/issues/573',
            author: { login: 'rafaeltab' },
            labels: [],
            comments: [],
          },
        ],
      },
      planner: {
        proposal: {
          selected: [
            {
              issue: 581,
              reason: 'Requires the already verified issue code',
              includeCodeFromIssues: [573],
            },
          ],
          deferred: [],
        },
      },
    });
    const state = `${host.directory}/state`;
    running = await startFactory({
      ...host.mcpEnvironment,
      FACTORY_PROJECT: host.repository,
      FACTORY_T3_PROJECT_ID: 'project-id',
      FACTORY_BASE: host.base,
      FACTORY_T3_BINARY: host.binary,
      FACTORY_STATE: state,
      FACTORY_PORT: '0',
      FACTORY_PREREQUISITES: JSON.stringify([{ issue: 573, pr: 591, commit: code }]),
    });
    await vi.waitFor(
      async () => {
        expect(
          (await host.calls()).filter(
            (call) => call.args[1] === 'start' && call.args.includes('--worktree')
          )
        ).toHaveLength(1);
      },
      { timeout: 10000, interval: 20 }
    );
    const scheduled = await Effect.runPromise(fileScheduleStore(state).read());
    expect(scheduled.admissions).toMatchObject([
      {
        issue: 581,
        includeCodeFromIssues: [573],
        selectionBase: host.base,
        base: code,
        prBase: 'factory/pr-591',
      },
    ]);
    const prompt = JSON.parse(await readFile(`${host.directory}/planner.json`, 'utf8')).prompt;
    expect(prompt).toContain('"maximumSelections":1');
    const starts = (await host.calls()).filter(
      (call) => call.args[1] === 'start' && !call.args.includes('--help')
    );
    expect(starts).toHaveLength(2);
    process.stdout.write(
      `Selected execution: ${JSON.stringify({ maximumSelections: 1, issue: 581, includeCodeFromIssues: [573], base: code, prBase: 'factory/pr-591', plannerLaunches: 1, implementerLaunches: 1 })}\n`
    );
  } finally {
    await running?.close();
    process.env.PATH = previous.path;
    if (previous.fixture === undefined) delete process.env.FACTORY_FIXTURE;
    else process.env.FACTORY_FIXTURE = previous.fixture;
    await host.cleanup();
  }
});
