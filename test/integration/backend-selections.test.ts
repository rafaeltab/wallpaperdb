import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createVitest, parseCLI } from 'vitest/node';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test.each([
  {
    service: 'gateway',
    unit: 'test/catalogue.unit.test.ts',
    integration: 'test/search/opensearch.integration.test.ts',
  },
  {
    service: 'media',
    unit: 'test/delivery.unit.test.ts',
    integration: 'test/health.integration.test.ts',
  },
  {
    service: 'user',
    unit: 'test/profile-capability.test.ts',
    integration: 'test/profile.integration.test.ts',
  },
  { service: 'ingestor', unit: 'test/ingestion.test.ts', integration: 'test/composition.test.ts' },
])('$service CI selections own every test file once and keep infrastructure setup out of unit tests', async ({
  service,
  unit,
  integration,
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
        expect(files).toContain(unit);
        expect(files).not.toContain(integration);
        if (service === 'gateway' || service === 'media')
          expect(files.every((file) => file.endsWith('.unit.test.ts'))).toBe(true);
        for (const project of runner.projects) expect(project.config.globalSetup).toEqual([]);
        expect(path.resolve(root, runner.config.coverage.reportsDirectory)).toBe(
          path.join(root, 'coverage/unit')
        );
      } else {
        expect(files).toContain(integration);
        if (service === 'gateway' || service === 'media')
          expect(files.every((file) => file.endsWith('.integration.test.ts'))).toBe(true);
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

test.each([
  'gateway',
  'media',
])('%s selects new tests by type without a config edit', async (service) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-test-selection-'));
  try {
    await mkdir(path.join(root, 'test/new-capability'), { recursive: true });
    const unit = 'test/new-capability/behavior.unit.test.ts';
    const integration = 'test/new-capability/adapter.integration.test.ts';
    await writeFile(path.join(root, unit), '');
    await writeFile(path.join(root, integration), '');
    const workspace = path.join(repository, 'apps', service);
    const manifest = JSON.parse(await readFile(path.join(workspace, 'package.json'), 'utf8'));
    for (const [selection, expected] of [
      ['unit', unit],
      ['integration', integration],
    ]) {
      const runner = await createVitest({
        ...parseCLI(manifest.scripts[`test:${selection}`]).options,
        config: path.join(workspace, 'vitest.config.ts'),
        root,
        watch: false,
      });
      try {
        const specifications = await runner.globTestSpecifications();
        expect(
          specifications.map((specification) => path.relative(root, specification.moduleId))
        ).toEqual([expected]);
      } finally {
        await runner.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
