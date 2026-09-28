import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { defaults } from '@wallpaperdb/vitest-config/defaults';
import {
  coverageForMethods,
  parseCoverageReport,
  parseFileMethods,
} from '@wallpaperdb/crap-typescript-core';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = path.join(repository, 'test/fixtures/crap');
const run = promisify(execFile);
const gatewayRequire = createRequire(path.join(repository, 'apps/gateway/package.json'));
const effect = gatewayRequire.resolve('effect/Effect');

type Analysis = Awaited<ReturnType<typeof analyzeProvider>>;

async function analyzeProvider(directory: string) {
  const installation = repository;
  await mkdir(directory);
  await symlink(path.join(installation, 'node_modules'), path.join(directory, 'node_modules'));
  for (const file of ['callbacks.ts', 'callbacks.test.ts']) {
    await copyFile(path.join(fixtures, file), path.join(directory, file));
  }
  const config = {
    resolve: { alias: { 'effect/Effect': effect } },
    test: {
      include: ['callbacks.test.ts'],
      fileParallelism: false,
      maxWorkers: 1,
      coverage: {
        ...defaults.test.coverage,
        enabled: true,
        provider: 'v8',
        include: ['callbacks.ts'],
        reporter: ['json'],
        reportsDirectory: 'coverage',
      },
    },
  };
  await writeFile(path.join(directory, 'vitest.config.mjs'), `export default ${JSON.stringify(config)};\n`);
  await run(process.execPath, [path.join(installation, 'node_modules/vitest/vitest.mjs'), 'run'], {
    cwd: directory,
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
  });
  const source = path.join(directory, 'callbacks.ts');
  const methods = await parseFileMethods(source);
  const report = await parseCoverageReport(path.join(directory, 'coverage/coverage-final.json'), directory);
  const attribution = coverageForMethods(methods, report.get(source.replaceAll('\\', '/').toLowerCase()));
  return {
    source: await readFile(source, 'utf8'),
    methods: methods.map((method, index) => ({ ...method, ...attribution[index] })),
  };
}

function functionsAt(analysis: Analysis, marker: string) {
  const position = analysis.source.indexOf(marker);
  expect(position, `Missing fixture marker: ${marker}`).toBeGreaterThanOrEqual(0);
  const line = analysis.source.slice(0, position).split('\n').length;
  return analysis.methods.filter((method) => method.startLine === line);
}

function functionAt(analysis: Analysis, marker: string) {
  const methods = functionsAt(analysis, marker);
  expect(methods, `Expected one function at: ${marker}`).toHaveLength(1);
  return methods[0];
}

describe('Vitest 5 provider coverage', () => {
  let temporaryDirectory: string;
  let analysis: Analysis;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-crap-provider-'));
    analysis = await analyzeProvider(path.join(temporaryDirectory, 'vitest-5'));
  }, 60_000);

  afterAll(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('uncalled callbacks remain uncovered after their wrappers and parents execute', () => {
    for (const marker of ['export const uncalled =', 'const branched =', 'const branchless =']) {
      const method = functionAt(analysis, marker);
      expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
      expect(method.coverage).toMatchObject({ status: 'measured', percent: 0 });
    }
    const branched = functionAt(analysis, 'const branched =');
    expect(branched.branchCoverage).toMatchObject({ status: 'measured', percent: 0 });
  });

  test('same-line callbacks attribute execution only to the called outer body', () => {
    const methods = functionsAt(analysis, 'export const sameLine =');
    expect(methods).toHaveLength(2);
    const outer = methods.find((method) => !method.expectsBranchCoverage)!;
    const inner = methods.find((method) => method.expectsBranchCoverage)!;
    expect(outer.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
    expect(inner.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
    expect(inner.branchCoverage).toMatchObject({ status: 'measured', percent: 0 });
  });

  test('Effect construction leaves its body uncovered while execution measures its paths', () => {
    const constructed = functionAt(analysis, 'export const constructedEffect =');
    expect(constructed.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
    expect(constructed.coverage).toMatchObject({ status: 'measured', percent: 0 });

    const executed = functionAt(analysis, 'export const calledEffect =');
    expect(executed.statementCoverage).toMatchObject({ status: 'measured', percent: 75 });
    expect(executed.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
  });

  test('generator coverage distinguishes iterator creation, partial execution, and completion', () => {
    const idle = functionAt(analysis, 'export const idleGenerator =');
    // V8 reports the first yield as hit before .next(), although the fixture
    // confirms its side effect did not run. Invocation counts cannot resolve this.
    expect(idle.statementCoverage.status).toBe('measured');
    expect(idle.statementCoverage.percent).toBeLessThan(100);
    expect(idle.branchCoverage).toMatchObject({ status: 'measured', percent: 0 });
    expect(idle.coverage).toMatchObject({ status: 'measured', percent: 0 });

    const partial = functionAt(analysis, 'export const partialGenerator =');
    expect(partial.statementCoverage.status).toBe('measured');
    expect(partial.statementCoverage.percent).toBeGreaterThan(0);
    expect(partial.statementCoverage.percent).toBeLessThan(100);
    expect(partial.branchCoverage).toMatchObject({ status: 'measured', percent: 0 });

    const completed = functionAt(analysis, 'export const completedGenerator =');
    expect(completed.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
    expect(completed.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
  });

  test('source decisions retain uncovered paths without counting synthetic function entries', () => {
    const branchless = functionAt(analysis, 'export const called =');
    expect(branchless.branchCoverage.status).toBe('structural_na');
    expect(branchless.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });

    const decision = functionAt(analysis, 'export function namedDecision(');
    expect(decision.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
    expect(decision.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
  });
});
