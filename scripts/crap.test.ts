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
  calculateCrapScore,
  coverageForMethods,
  parseCoverageReport,
  parseFileMethods,
} from './vendor/crap-typescript-core/src/index.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const fixtures = path.join(repository, 'scripts/fixtures/crap');
const run = promisify(execFile);
const gatewayRequire = createRequire(path.join(repository, 'apps/gateway/package.json'));
const effect = gatewayRequire.resolve('effect/Effect');

type Analysis = Awaited<ReturnType<typeof analyzeProvider>>;

async function analyzeProvider(directory: string, provider: string) {
  const installation = provider === 'vitest-5' ? path.join(repository, 'apps/gateway') : repository;
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
        ...(provider === 'vitest-3-defaults' ? defaults.test.coverage : {}),
        ...(provider === 'vitest-3-legacy' ? { experimentalAstAwareRemapping: false } : {}),
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

test('shared Vitest 3 defaults provide AST-aware callback coverage', () => {
  expect(defaults.test.coverage).toMatchObject({ experimentalAstAwareRemapping: true });
});

describe.each(['vitest-3-legacy', 'vitest-3-defaults', 'vitest-5'])('%s provider coverage', (provider) => {
  let temporaryDirectory: string;
  let analysis: Analysis;
  const astAware = provider !== 'vitest-3-legacy';

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-crap-provider-'));
    analysis = await analyzeProvider(path.join(temporaryDirectory, provider), provider);
  }, 60_000);

  afterAll(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('an uncalled wrapped callback retains complexity 7 and CRAP 56', () => {
    const method = functionAt(analysis, 'export const uncalled =');
    expect(method.complexity).toBe(7);
    expect(method.statementCoverage.percent ?? 0).toBe(0);
    expect(method.branchCoverage.percent ?? 0).toBe(0);
    expect(calculateCrapScore(method.complexity, method.coverage.percent ?? 0)).toBe(56);
    if (astAware) {
      expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
      expect(method.branchCoverage).toMatchObject({ status: 'measured', percent: 0 });
    }
  });

  test.each(['const branched =', 'const branchless ='])('calling a parent does not cover %s', (marker) => {
    const method = functionAt(analysis, marker);
    expect(method.statementCoverage.percent ?? 0).toBe(0);
    expect(method.coverage.percent ?? 0).toBe(0);
    if (astAware) expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
  });

  test('same-line callbacks keep separate identities and execution counts', () => {
    const methods = functionsAt(analysis, 'export const sameLine =');
    expect(methods).toHaveLength(2);
    expect(new Set(methods.map((method) => method.displayName)).size).toBe(2);
    const outer = methods.find((method) => !method.expectsBranchCoverage)!;
    const inner = methods.find((method) => method.expectsBranchCoverage)!;
    expect(outer.complexity).toBe(1);
    expect(inner.complexity).toBe(2);
    expect(inner.statementCoverage.percent ?? 0).toBe(0);
    if (astAware) {
      expect(outer.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
      expect(inner.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
    }
  });

  test('constructing an Effect does not execute its generator body', () => {
    const method = functionAt(analysis, 'export const constructedEffect =');
    expect(method.statementCoverage.percent ?? 0).toBe(0);
    expect(method.coverage.percent ?? 0).toBe(0);
    if (astAware) expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 0 });
  });

  test('creating a generator iterator cannot establish complete body coverage', () => {
    const method = functionAt(analysis, 'export const idleGenerator =');
    // V8 reports the first yield as hit before .next(), although the fixture
    // confirms its side effect did not run. Invocation counts cannot resolve this.
    expect(method.statementCoverage.percent ?? 0).toBeLessThan(100);
    expect(method.branchCoverage.percent ?? 0).toBe(0);
    expect(method.coverage.percent ?? 0).toBe(0);
  });

  test('executing an Effect.fn callback measures its body and uncovered false path', () => {
    const method = functionAt(analysis, 'export const calledEffect =');
    if (astAware) {
      expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 75 });
      expect(method.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
    } else {
      expect(method.branchCoverage.percent ?? 0).toBeLessThan(100);
    }
  });

  test('advancing a generator once cannot cover code after its first yield', () => {
    const method = functionAt(analysis, 'export const partialGenerator =');
    expect(method.statementCoverage.percent ?? 0).toBeLessThan(100);
    expect(method.branchCoverage.percent ?? 0).toBe(0);
    if (astAware) {
      expect(method.statementCoverage.status).toBe('measured');
      expect(method.statementCoverage.percent).toBeGreaterThan(0);
    }
  });

  test('a completed generator has statement coverage while its unchosen branch stays uncovered', () => {
    const method = functionAt(analysis, 'export const completedGenerator =');
    if (astAware) {
      expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
      expect(method.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
    } else {
      expect(method.branchCoverage.percent ?? 0).toBeLessThan(100);
    }
  });

  test('function-entry blocks do not become source branch coverage', () => {
    const method = functionAt(analysis, 'export const called =');
    expect(method.expectsBranchCoverage).toBe(false);
    expect(method.branchCoverage.status).toBe('structural_na');
    if (astAware) expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
  });

  test('an actual source decision retains its uncovered false path', () => {
    const method = functionAt(analysis, 'export function namedDecision(');
    expect(method.expectsBranchCoverage).toBe(true);
    if (astAware) {
      expect(method.statementCoverage).toMatchObject({ status: 'measured', percent: 100 });
      expect(method.branchCoverage).toMatchObject({ status: 'measured', percent: 50 });
    } else {
      expect(method.branchCoverage.percent ?? 0).toBeLessThan(100);
    }
  });
});
