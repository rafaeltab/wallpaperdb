import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createVitest } from 'vitest/node';
import { parseSourceVitestCommand } from './helpers/source-vitest-command.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('all ten independently containerized outage cases opt into bounded scheduling', async () => {
  const root = path.join(repository, 'apps/ingestor');
  const runner = await createVitest({
    root,
    project: ['ingestor-instrumentation'],
    watch: false,
    reporters: [],
  });
  try {
    const result = await runner.collect(
      ['test/instrumentation/telemetry-availability.integration.test.ts'],
      { staticParse: false }
    );
    expect(result.unhandledErrors).toEqual([]);
    const cases = result.testModules.flatMap((module) => [...module.children.allTests()]);
    expect(cases).toHaveLength(10);
    expect(cases.every((test) => test.options.concurrent)).toBe(true);
  } finally {
    await runner.close();
  }
});

test.each([
  { hosted: undefined, peak: 1 },
  { hosted: 'false', peak: 1 },
  { hosted: 'true', peak: 2 },
])('Ingestor outage scheduling has peak $peak with GITHUB_ACTIONS=$hosted', async ({
  hosted,
  peak,
}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-outage-scheduling-'));
  const previous = process.env.GITHUB_ACTIONS;
  const resultPath = path.join(root, 'scheduling.json');
  try {
    if (hosted === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = hosted;
    await mkdir(path.join(root, 'test/instrumentation'), { recursive: true });
    await writeFile(
      path.join(root, 'test/instrumentation/telemetry-availability.integration.test.ts'),
      `
      import { afterAll, it } from ${JSON.stringify(path.join(repository, 'node_modules/vitest/dist/index.js'))};
      import { writeFileSync } from 'node:fs';
      let active = 0;
      let peak = 0;
      let completed = 0;
      it.concurrent.for([1, 2, 3, 4])('owned case %s', async (_case, { expect }) => {
        active++;
        peak = Math.max(peak, active);
        try {
          expect(active).toBeLessThanOrEqual(${peak});
          await new Promise(resolve => setImmediate(resolve));
        }
        finally { active--; completed++; }
      });
      afterAll(() => writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ active, completed, peak })));
    `
    );
    const workspace = path.join(repository, 'apps/ingestor');
    const manifest = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
    const runner = await createVitest({
      ...parseSourceVitestCommand(manifest.scripts['test:integration']).options,
      root,
      config: path.join(workspace, 'vitest.config.ts'),
      watch: false,
      reporters: [],
    });
    try {
      await runner.start();
      expect(runner.state.getFiles().map((file) => file.result?.state)).toEqual(['pass']);
      expect(runner.state.getUnhandledErrors()).toEqual([]);
      expect(JSON.parse(await readFile(resultPath, 'utf8'))).toEqual({
        active: 0,
        completed: 4,
        peak,
      });
    } finally {
      await runner.close();
    }
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
    await rm(root, { recursive: true, force: true });
  }
});
