import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createVitest, parseCLI } from 'vitest/node';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('Gateway CI selections own every test file once and keep search setup out of fast tests', async () => {
  const root = path.join(repository, 'apps/gateway');
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const owned: string[] = [];
  for (const selection of ['unit', 'integration']) {
    expect(manifest.scripts[`test:${selection}`]).toBeTypeOf('string');
    const { options } = parseCLI(manifest.scripts[`test:${selection}`]);
    const runner = await createVitest({ ...options, root, watch: false });
    try {
      const specifications = await runner.globTestSpecifications();
      const files = specifications.map((specification) => path.relative(root, specification.moduleId));
      expect(files.length).toBeGreaterThan(0);
      if (selection === 'unit') {
        expect(files).toContain('test/catalogue.test.ts');
        expect(files).not.toContain('test/opensearch.test.ts');
        for (const project of runner.projects) expect(project.config.globalSetup).toEqual([]);
        expect(path.resolve(root, runner.config.coverage.reportsDirectory)).toBe(path.join(root, 'coverage/unit'));
      } else {
        expect(files).toContain('test/opensearch.test.ts');
        expect(path.resolve(root, runner.config.coverage.reportsDirectory)).toBe(path.join(root, 'coverage/integration'));
      }
      expect(runner.config.coverage.include).toEqual(['src/**/*.ts']);
      owned.push(...files);
    } finally {
      await runner.close();
    }
  }
  const files = (await Promise.all(['src', 'test'].map(async (directory) =>
    (await readdir(path.join(root, directory), { recursive: true }))
      .filter((file) => file.endsWith('.test.ts'))
      .map((file) => path.join(directory, file))
  ))).flat();
  expect(owned.sort()).toEqual(files.sort());
});
