#!/usr/bin/env -S tsx
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
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
} from '@wallpaperdb/crap-typescript-core';
import istanbul from 'istanbul-lib-coverage';
import type { MethodDescriptor } from '@wallpaperdb/crap-typescript-core';
import {isRecord,normalizeVitestCoverage,validateFileCoverage,isEmptyCoverage} from './lib/coverage-validation.js';
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
  const selected = process.env.PACKAGE?.trim();
  for (const parent of config.workspaceRoots) {
    for (const entry of await readdir(path.join(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = `${parent}/${entry.name}`;
      if (config.excludedWorkspaces.includes(directory)) continue;
      if (selected && entry.name !== selected) continue;
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
  assert(
    workspaces.length > 0,
    selected ? `No CRAP workspace matches PACKAGE=${selected}` : 'No application or package workspaces found',
  );
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
  const stdio: Array<'ignore' | number | NodeJS.WriteStream> = ['ignore', process.stderr, process.stderr];
  const fd = Number(process.env.WALLPAPERDB_DOCKER_LEASE_FD);
  try {
    if (fd >= 3 && await readlink(`/proc/self/fd/${fd}`) === process.env.WALLPAPERDB_DOCKER_LEASE_FILE) {
      while (stdio.length <= fd) stdio.push('ignore');
      stdio[fd] = fd;
    }
  } catch {}
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/coverage-runtime/command.mjs'), '--packages', participants.map(w => w.directory.split('/').at(-1)).join(',')], {
      cwd: root, stdio,
    });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Coverage tasks failed (${code}); no CRAP analysis performed`)));
  });
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
          normalizeVitestCoverage(file);
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
    // The core parser keys its map with normalized, case-insensitive paths.
    const attributed = coverageForMethods(
      methods,
      coverage.get(file.replaceAll('\\', '/').toLowerCase()),
    );
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
