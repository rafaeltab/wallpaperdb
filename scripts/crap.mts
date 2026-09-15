import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateCrapScore,
  coverageForMethods,
  expandExplicitPaths,
  filterSourceFiles,
  parseCoverageReport,
  parseFileMethods,
} from '@barney-media/crap-typescript-core';
import istanbul from 'istanbul-lib-coverage';
import type { MethodDescriptor } from '@barney-media/crap-typescript-core';
import type { FileCoverageData, Range } from 'istanbul-lib-coverage';
import config from '../crap.config.mts';

interface Workspace {
  directory: string;
  name: string;
  tasks: { task: string; output: string }[];
}

type Coverage = Awaited<ReturnType<typeof parseCoverageReport>>;
type MethodCoverage = ReturnType<typeof coverageForMethods>[number];

const root = fileURLToPath(new URL('../', import.meta.url));

function readThreshold() {
  const [mode, ...extra] = process.argv.slice(2);
  assert(
    extra.length === 0 && ['report', 'check'].includes(mode),
    'Usage: make crap | make check-crap CRAP_THRESHOLD=<finite non-negative number>',
  );
  if (mode === 'report') return null;
  const value = process.env.CRAP_THRESHOLD?.trim();
  const threshold = Number(value);
  assert(
    value && Number.isFinite(threshold) && threshold >= 0,
    'Usage: make check-crap CRAP_THRESHOLD=<finite non-negative number> (an explicit threshold is required)',
  );
  return threshold;
}

async function discoverWorkspaces(): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  for (const parent of config.workspaceRoots) {
    for (const entry of await readdir(path.join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${parent}/${entry.name}`;
      if (config.excludedWorkspaces.includes(directory)) continue;
      const manifest: unknown = JSON.parse(
        await readFile(path.join(root, directory, 'package.json'), 'utf8'),
      );
      assert(isRecord(manifest), `Invalid package manifest: ${directory}`);
      assert(typeof manifest.name === 'string', `Missing package name: ${directory}`);
      const scripts = manifest.scripts ?? {};
      assert(isRecord(scripts), `Invalid package scripts: ${directory}`);
      const tasks = Object.entries(config.coverageTasks)
        .filter(([task]) => typeof scripts[task] === 'string')
        .map(([task, output]) => ({ task, output: path.join(root, directory, output) }));
      workspaces.push({ directory, name: manifest.name, tasks });
    }
  }
  assert(workspaces.length > 0, 'No application or package workspaces found');
  return workspaces.sort((a, b) => a.directory.localeCompare(b.directory));
}

async function sourceFiles(workspaces: Workspace[]) {
  const sourceRoots = [];
  for (const workspace of workspaces) {
    const directory = path.join(root, workspace.directory, config.sourceDirectory);
    try {
      if ((await stat(directory)).isDirectory()) sourceRoots.push(directory);
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    }
  }
  const candidates = await expandExplicitPaths(root, sourceRoots);
  const { files } = await filterSourceFiles(root, candidates, config.sourceExclusions);
  assert(files.length > 0, 'No in-scope source files found');
  return files;
}

async function produceCoverage(workspaces: Workspace[]) {
  const participants = workspaces.filter(({ tasks }) => tasks.length > 0);
  assert(participants.length > 0, 'No unit or integration coverage tasks found');
  // Removing only declared tier outputs forces this invocation to obtain them
  // from successful execution or a current Turbo cache restoration.
  for (const { tasks } of participants) {
    for (const { output } of tasks) await rm(output, { recursive: true, force: true });
  }
  console.error('Obtaining unit/integration coverage through Turbo (concurrency=1; E2E excluded).');
  for (const { name, tasks } of participants) {
    console.error(`  ${name}: ${tasks.map(({ task }) => task).join(', ')}`);
  }
  const args = [
    'run',
    ...Object.keys(config.coverageTasks),
    ...participants.map(({ name }) => `--filter=${name}`),
    '--concurrency=1',
    '--output-logs=errors-only',
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path.join(root, 'node_modules/.bin/turbo'), args, {
      cwd: root,
      // Keep stdout reserved for the ranking/violations, including in check mode.
      stdio: ['ignore', process.stderr, process.stderr],
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `Coverage tasks failed (${signal ?? `exit ${code}`}); no CRAP analysis performed`,
          ),
        );
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSpan(span: unknown): asserts span is Range {
  assert(isRecord(span) && isRecord(span.start) && isRecord(span.end), 'Invalid coverage span');
  for (const point of [span.start, span.end]) {
    assert(
      typeof point.line === 'number' && Number.isInteger(point.line) && point.line >= 1,
      'Invalid coverage line',
    );
    assert(
      typeof point.column === 'number' && Number.isInteger(point.column) && point.column >= 0,
      'Invalid coverage column',
    );
  }
  assert(
    typeof span.start.line === 'number' &&
      typeof span.end.line === 'number' &&
      typeof span.start.column === 'number' &&
      typeof span.end.column === 'number' &&
      (span.end.line > span.start.line ||
        (span.end.line === span.start.line && span.end.column >= span.start.column)),
    'Invalid coverage span',
  );
}

function isEmptyCoverage(file: Record<string, unknown>): boolean {
  const functions = isRecord(file.fnMap) ? Object.values(file.fnMap) : [];
  return (
    file.all === true &&
    functions.length === 1 &&
    isRecord(functions[0]) &&
    functions[0].name === '(empty-report)'
  );
}

function validateFileCoverage(
  file: unknown,
): asserts file is FileCoverageData & Record<string, unknown> {
  assert(
    isRecord(file) && typeof file.path === 'string' && file.path.length > 0,
    'Invalid coverage file',
  );
  const emptyReport = isEmptyCoverage(file);
  for (const [map, counts] of [
    ['statementMap', 's'],
    ['fnMap', 'f'],
    ['branchMap', 'b'],
  ]) {
    const mappings: unknown = file[map];
    const counters: unknown = file[counts];
    assert(isRecord(mappings) && isRecord(counters), `Missing ${map}/${counts}`);
    assert.deepEqual(
      Object.keys(mappings).sort(),
      Object.keys(counters).sort(),
      `Mismatched ${map}/${counts}`,
    );
    for (const [id, entry] of Object.entries(mappings)) {
      const hits: unknown = counts === 'b' ? counters[id] : [counters[id]];
      assert(
        Array.isArray(hits) &&
          hits.every(
            (hit: unknown) => typeof hit === 'number' && Number.isSafeInteger(hit) && hit >= 0,
          ),
        'Invalid coverage counters',
      );
      if (map === 'statementMap') validateSpan(entry);
      else {
        // Vitest 3's v8-to-istanbul emits synthetic whole-file function/branch
        // spans for unloaded modules, sometimes with negative remapped columns.
        // These are not function measurements; retain the source in the inventory
        // with missing coverage, as Istanbul also does when merging `all` reports.
        if (emptyReport) continue;
        assert(isRecord(entry), `Invalid ${map} entry`);
        validateSpan(entry.loc);
        if (map === 'fnMap') validateSpan(entry?.decl);
        if (map === 'branchMap') {
          assert(
            Array.isArray(entry.locations) && entry.locations.length === hits.length,
            'Invalid branch locations',
          );
          for (const location of entry.locations) validateSpan(location);
        }
      }
    }
  }
  if (emptyReport) {
    assert(
      isRecord(file.s) && Object.values(file.s).every((hits) => hits === 0),
      'Empty coverage report contains statement hits',
    );
  }
}

function currentSourcePath(filePath: string, directory: string) {
  // Istanbul embeds absolute paths. Valid caches may come from another checkout
  // or CI; rebase only this producing workspace's path, never by basename.
  const normalized = filePath.replaceAll('\\', '/');
  const marker = `/${directory}/`;
  const offset = normalized.lastIndexOf(marker);
  const resolved =
    offset >= 0
      ? path.join(root, normalized.slice(offset + 1))
      : normalized.startsWith(`${directory}/`)
        ? path.resolve(root, normalized)
        : path.resolve(root, directory, normalized);
  const relative = path.relative(path.join(root, directory), resolved);
  assert(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `Coverage path is outside its workspace: ${filePath}`,
  );
  return resolved;
}

async function combineCoverage(workspaces: Workspace[], temporaryDirectory: string) {
  const combined = istanbul.createCoverageMap({});
  for (const { directory, tasks } of workspaces) {
    for (const { output } of tasks) {
      const reportPath = path.join(output, 'coverage-final.json');
      try {
        const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
        assert(isRecord(report), 'Expected an Istanbul coverage object');
        for (const file of Object.values(report)) {
          // The core tolerates malformed entries. Fail here before it can silently
          // discard counters and present an apparently successful analysis.
          validateFileCoverage(file);
          if (isEmptyCoverage(file)) continue;
          combined.addFileCoverage({ ...file, path: currentSourcePath(file.path, directory) });
        }
      } catch (error) {
        throw new Error(
          `Cannot combine coverage from ${path.relative(root, reportPath)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  const combinedPath = path.join(temporaryDirectory, 'coverage-final.json');
  await writeFile(combinedPath, JSON.stringify(combined.toJSON()));
  return parseCoverageReport(combinedPath, root);
}

function effectiveCoverage(method: MethodDescriptor, attribution: MethodCoverage) {
  if (attribution.coverage.status === 'unknown') return 0;
  // V8 also emits function-entry blocks as branches. A function with no branch
  // syntax uses statements alone, regardless of those synthetic branch counters.
  const metrics = [attribution.statementCoverage];
  if (method.expectsBranchCoverage) metrics.push(attribution.branchCoverage);
  const applicable = metrics.filter(({ status }) => status !== 'structural_na');
  // Missing applicable measurements are zero, even if another metric is known.
  return applicable.length === 0 ? 0 : Math.min(...applicable.map(({ percent }) => percent ?? 0));
}

async function analyze(files: string[], coverage: Coverage) {
  const rows = [];
  for (const file of files) {
    const methods = await parseFileMethods(file);
    const attributed = coverageForMethods(methods, coverage.get(file));
    for (const [index, method] of methods.entries()) {
      const percent = effectiveCoverage(method, attributed[index]);
      const score = calculateCrapScore(method.complexity, percent);
      assert(
        score !== null && Number.isFinite(score),
        `Invalid score: ${file}:${method.startLine}`,
      );
      rows.push({
        location: `${path.relative(root, file)}:${method.startLine}`,
        name: method.displayName,
        complexity: method.complexity,
        percent,
        score,
      });
    }
  }
  assert(rows.length > 0, 'No in-scope functions found');
  return rows.sort(
    (a, b) =>
      b.score - a.score || a.location.localeCompare(b.location) || a.name.localeCompare(b.name),
  );
}

async function main() {
  const threshold = readThreshold();
  const workspaces = await discoverWorkspaces();
  const files = await sourceFiles(workspaces); // Validate scope before running tests.
  const lock = path.join(root, 'coverage/.crap-lock');
  await mkdir(path.dirname(lock), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error;
    throw new Error(
      'Another CRAP command is running. If it was killed, remove coverage/.crap-lock before retrying.',
    );
  }
  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'wallpaperdb-crap-'));
    await produceCoverage(workspaces);
    const coverage = await combineCoverage(workspaces, temporaryDirectory);
    const rows = await analyze(files, coverage);
    const selected = threshold === null ? rows : rows.filter(({ score }) => score > threshold);
    if (selected.length > 0) {
      console.log('CRAP\tComplexity\tCoverage\tLocation\tFunction');
      for (const row of selected) {
        console.log(
          `${row.score.toFixed(3)}\t${row.complexity}\t${row.percent.toFixed(2)}%\t${row.location}\t${row.name}`,
        );
      }
    }
    if (threshold !== null) {
      console.error(`CRAP: ${selected.length} of ${rows.length} functions exceed ${threshold}.`);
      if (selected.length > 0) process.exitCode = 1;
    }
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`CRAP error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
