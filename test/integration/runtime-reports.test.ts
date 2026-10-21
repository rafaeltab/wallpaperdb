import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { createVitest, parseCLI } from 'vitest/node';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);

test.each(['gateway', 'ingestor'])('%s retains unit and integration profiling reports', async (service) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-runtime-reports-'));
  const previous = process.env.CI_RUNTIME_PROFILE;
  try {
    process.env.CI_RUNTIME_PROFILE = 'true';
    await mkdir(path.join(root, 'test'), { recursive: true });
    for (const selection of ['unit', 'integration']) {
      await writeFile(
        path.join(root, `test/evidence.${selection}.test.ts`),
        `import { it, expect } from ${JSON.stringify(path.join(repository, 'node_modules/vitest/dist/index.js'))};
        it('${service} ${selection} evidence', () => expect(true).toBe(true));`
      );
    }
    const workspace = path.join(repository, 'apps', service);
    const manifest = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
    for (const selection of ['unit', 'integration']) {
      const runner = await createVitest({
        ...parseCLI(manifest.scripts[`test:${selection}`]).options,
        root,
        config: path.join(workspace, 'vitest.config.ts'),
        watch: false,
        coverage: { enabled: false },
      });
      try {
        await runner.start();
        expect(runner.state.getFiles().map((file) => file.result?.state)).toEqual(['pass']);
        expect(runner.state.getUnhandledErrors()).toEqual([]);
      } finally {
        await runner.close();
      }
    }
    for (const [selection, filename] of [
      ['unit', 'ci-runtime-vitest-unit.json'],
      ['integration', 'ci-runtime-vitest.json'],
    ]) {
      const report = JSON.parse(await readFile(path.join(root, 'test-results', filename), 'utf8'));
      expect(report.numPassedTests).toBe(1);
      expect(report.testResults.flatMap((suite: { assertionResults: { fullName: string }[] }) =>
        suite.assertionResults.map((assertion) => assertion.fullName)
      )).toEqual([`${service} ${selection} evidence`]);
    }
  } finally {
    if (previous === undefined) delete process.env.CI_RUNTIME_PROFILE;
    else process.env.CI_RUNTIME_PROFILE = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('Gateway retains one visible phase-evidence warning for passing worker tests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-runtime-warning-'));
  const reportPath = path.join(root, 'reports/report.json');
  const blocker = 'existing phase-evidence blocker';
  const sentinel = 'CI_RUNTIME_CONSOLE_WARN_SENTINEL_441';
  const warning = 'ci-runtime: phase evidence could not be written; operation result is preserved.';
  try {
    await mkdir(path.join(root, 'test'), { recursive: true });
    await writeFile(
      path.join(root, 'test/phase-warning.unit.test.ts'),
      `import assert from 'node:assert/strict';
      import { readFileSync, writeFileSync } from 'node:fs';
      import { beforeAll, it } from ${JSON.stringify(path.join(repository, 'node_modules/vitest/dist/index.js'))};
      import { measureTestPhase } from ${JSON.stringify(path.join(repository, 'packages/test-logger/src/index.ts'))};
      beforeAll(() => {
        assert.equal(process.cwd(), ${JSON.stringify(root)});
        writeFileSync('test-results', ${JSON.stringify(blocker)});
      });
      it('preserves successful values when phase evidence cannot be written', async () => {
        console.warn(${JSON.stringify(sentinel)});
        const value = { retained: true };
        assert.equal(await measureTestPhase('warning.success.one', async () => value), value);
        assert.equal(await measureTestPhase('warning.success.two', async () => value), value);
      });
      it('preserves the original failure when phase evidence cannot be written', async () => {
        const failure = new Error('original operation failure');
        await assert.rejects(measureTestPhase('warning.failure', async () => { throw failure; }), error => error === failure);
        assert.equal(readFileSync('test-results', 'utf8'), ${JSON.stringify(blocker)});
      });`
    );
    const result = await run(
      process.execPath,
      [
        path.join(repository, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--root',
        root,
        '--config',
        path.join(repository, 'apps/gateway/vitest.config.ts'),
        '--project=gateway-unit',
        '--coverage.enabled=false',
        `--outputFile.json=${reportPath}`,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CI_RUNTIME_PROFILE: 'true',
          npm_lifecycle_event: 'test:unit',
        },
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      }
    );
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    expect(report.success).toBe(true);
    expect(report.numPassedTests).toBe(2);
    expect(report.numFailedTests).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(sentinel);
    expect(output.split(warning)).toHaveLength(2);
    expect(await readFile(path.join(root, 'test-results'), 'utf8')).toBe(blocker);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
