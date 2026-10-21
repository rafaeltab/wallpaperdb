import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createVitest, parseCLI } from 'vitest/node';

const repository = fileURLToPath(new URL('../../', import.meta.url));

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
