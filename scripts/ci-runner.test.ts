import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const makefile = readFileSync(new URL('../Makefile', import.meta.url), 'utf8');

function runCi(force: string, failingStage: string) {
  const directory = mkdtempSync(join(tmpdir(), 'wallpaperdb-ci-test-'));
  try {
    // Keep the real orchestration recipe; replace only its external checks.
    const prechecks = [
      'test-make',
      'crap-check-types',
      'worktree-env-test',
      'nats-stream-setup-test',
      'sandcastle-test',
      'sandcastle-check-types',
      'storage-infra-test',
      'ci-runner-test',
    ];
    writeFileSync(join(directory, 'Makefile'), `${makefile}\n${prechecks.join(' ')}:\n\t@true\n`);
    writeFileSync(join(directory, 'turbo'), `#!/bin/sh
stage=workspace
case "$*" in *test:e2e*) stage=e2e ;; esac
echo "$stage" >> "$CI_TEST_LOG"
test "$stage" != "$CI_TEST_FAILURE"
`, { mode: 0o700 });
    writeFileSync(join(directory, 'pnpm'), `#!/bin/sh
echo coverage >> "$CI_TEST_LOG"
test coverage != "$CI_TEST_FAILURE"
`, { mode: 0o700 });
    const log = join(directory, 'calls.log');
    writeFileSync(log, '');
    const result = spawnSync('make', ['--no-print-directory', 'ci', `FORCE=${force}`, `TURBO=${join(directory, 'turbo')}`], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        MAKEFLAGS: '',
        MFLAGS: '',
        CI_TEST_LOG: log,
        CI_TEST_FAILURE: failingStage,
      },
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls: readFileSync(log, 'utf8').trim().split('\n'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.each(['', '1'])('ci FORCE=%s failure propagation', (force) => {
  it.each([
    { stage: 'workspace', calls: ['workspace'] },
    { stage: 'e2e', calls: ['workspace', 'e2e'] },
    { stage: 'coverage', calls: ['workspace', 'e2e', 'coverage'] },
  ])('stops after $stage fails and does not report success', ({ stage, calls }) => {
    const result = runCi(force, stage);
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual(calls);
    expect(result.output).not.toContain('All CI checks passed');
    expect(result.output).not.toContain('Coverage report:');
  });

  it('reports success only after every stage succeeds', () => {
    const result = runCi(force, 'none');
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['workspace', 'e2e', 'coverage']);
    expect(result.output).toMatch(/All CI checks passed in \d+s/);
    expect(result.output).toContain('Coverage report: coverage/lcov.info');
  });
});
