import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createVitest, parseCLI } from 'vitest/node';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test.each([
  { service: 'gateway', fast: 'test/catalogue.test.ts', slow: 'test/opensearch.test.ts' },
  { service: 'media', fast: 'test/delivery.test.ts', slow: 'test/health.test.ts' },
  {
    service: 'user',
    fast: 'test/profile-capability.test.ts',
    slow: 'test/profile.integration.test.ts',
  },
  { service: 'ingestor', fast: 'test/ingestion.test.ts', slow: 'test/composition.test.ts' },
])('$service CI selections own every test file once and keep infrastructure setup out of fast tests', async ({
  service,
  fast,
  slow,
}) => {
  const root = path.join(repository, 'apps', service);
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const owned: string[] = [];
  const coveragePolicies = [];
  for (const selection of ['unit', 'integration']) {
    expect(manifest.scripts[`test:${selection}`]).toBeTypeOf('string');
    const { options } = parseCLI(manifest.scripts[`test:${selection}`]);
    const runner = await createVitest({ ...options, root, watch: false });
    try {
      const specifications = await runner.globTestSpecifications();
      const files = specifications.map((specification) =>
        path.relative(root, specification.moduleId)
      );
      expect(files.length).toBeGreaterThan(0);
      if (selection === 'unit') {
        expect(files).toContain(fast);
        expect(files).not.toContain(slow);
        for (const project of runner.projects) expect(project.config.globalSetup).toEqual([]);
        expect(path.resolve(root, runner.config.coverage.reportsDirectory)).toBe(
          path.join(root, 'coverage/unit')
        );
      } else {
        expect(files).toContain(slow);
        expect(path.resolve(root, runner.config.coverage.reportsDirectory)).toBe(
          path.join(root, 'coverage/integration')
        );
      }
      expect(runner.config.coverage.include).toEqual(['src/**/*.ts']);
      coveragePolicies.push({
        include: runner.config.coverage.include,
        exclude: runner.config.coverage.exclude,
        thresholds: runner.config.coverage.thresholds,
        reporter: runner.config.coverage.reporter,
      });
      owned.push(...files);
    } finally {
      await runner.close();
    }
  }
  const files = (
    await Promise.all(
      ['src', 'test'].map(async (directory) =>
        (
          await readdir(path.join(root, directory), { recursive: true })
        )
          .filter((file) => file.endsWith('.test.ts'))
          .map((file) => path.join(directory, file))
      )
    )
  ).flat();
  expect(owned.sort()).toEqual(files.sort());
  expect(coveragePolicies[0]).toEqual(coveragePolicies[1]);
  const full = await createVitest({
    ...parseCLI(manifest.scripts.test).options,
    root,
    watch: false,
  });
  try {
    const specifications = await full.globTestSpecifications();
    expect(
      specifications.map((specification) => path.relative(root, specification.moduleId)).sort()
    ).toEqual(files.sort());
  } finally {
    await full.close();
  }
});
