import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Do not inherit selectors or dry-run flags from the parent make invocation.
const env = { ...process.env, MAKEFLAGS: '', MFLAGS: '', MAKELEVEL: '0' };
for (const selector of ['PACKAGE', 'SERVICE', 'DB', 'SCRIPT', 'ARGS', 'FORCE']) {
  delete env[selector];
}

function make(...args) {
  return spawnSync('make', ['--no-print-directory', '-n', ...args], { encoding: 'utf8', env });
}
function output(...args) {
  const result = make(...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function plannedTask(target, workspace, taskName) {
  const result = spawnSync('make', [
    '--no-print-directory', target, `PACKAGE=${workspace}`,
    `TURBO_FLAGS=--filter=@wallpaperdb/${workspace} --dry=json`,
  ], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const task = plan.tasks.find((entry) => entry.taskId === `@wallpaperdb/${workspace}#${taskName}`);
  assert.ok(task, `${workspace} must plan ${taskName}`);
  return task;
}

test('workspace actions support optional package scoping', () => {
  assert.match(output('build'), /run build(?!.*--filter)/);
  assert.match(output('build', 'PACKAGE=web'), /run build .*--filter=@wallpaperdb\/web/);
  assert.match(output('check-types', 'PACKAGE=ingestor'), /run check-types .*--filter=@wallpaperdb\/ingestor/);
  assert.doesNotMatch(output('check-types', 'PACKAGE=ingestor'), /crap:check-types/);
  assert.match(output('check-types'), /crap:check-types/);
  for (const invalid of ['typo', 'web*', '%', 'web ingestor']) {
    assert.notEqual(make('build', `PACKAGE=${invalid}`).status, 0);
  }
});

test('test tiers preserve sequential container execution', () => {
  for (const tier of ['integration', 'e2e']) {
    assert.match(output(`test-${tier}`, 'PACKAGE=ingestor-e2e'), /--concurrency=1/);
  }
});

test('browser E2E always executes against the current deployed environment', () => {
  const task = plannedTask('test-e2e', 'web-e2e', 'test:e2e');
  assert.equal(task.resolvedTaskDefinition.cache, false,
    'source hashes cannot prove that the deployed application, infrastructure, and credentials are unchanged');
});

test('typecheck cache inputs include test files compiled by the workspace', () => {
  const task = plannedTask('check-types', 'media', 'check-types');
  const tsconfig = JSON.parse(readFileSync('apps/media/tsconfig.json', 'utf8'));
  assert.ok(tsconfig.include.includes('test/**/*'));
  assert.ok(Object.hasOwn(task.inputs, 'test/catalog-postgres.test.ts'),
    'test-only TypeScript errors must invalidate a cached successful typecheck');
});

test('CRAP commands pass the optional workspace selector to the shared analyzer', () => {
  for (const target of ['crap', 'check-crap']) {
    assert.match(output(target, 'PACKAGE=ingestor'), /PACKAGE="ingestor".*scripts\/crap\.mts/);
    assert.match(output(target), /PACKAGE="".*scripts\/crap\.mts/);
  }
});

test('focused tests select one workspace and serialize dependency builds and tests', () => {
  assert.notEqual(make('test-focused').status, 0);
  for (const [workspace, file] of [
    ['web', 'test/components/profile/public-profile-page.test.tsx'],
    ['gateway', 'test/catalogue.test.ts'],
  ]) {
    const focused = output('test-focused', `PACKAGE=${workspace}`, `ARGS=${file}`);
    assert.ok(focused.includes(`run build --filter="@wallpaperdb/${workspace}^..." --concurrency=1`));
    assert.ok(focused.includes(`pnpm --filter @wallpaperdb/${workspace} exec vitest run --maxWorkers=1 --no-file-parallelism ${file}`));
    assert.doesNotMatch(focused, /--minWorkers/, 'the shared command must support gateway Vitest 5');
  }
});

test('dev defaults to Compose and scopes workspace dev through Turbo', () => {
  assert.match(output('dev'), /docker compose .* watch/);
  assert.match(output('dev', 'PACKAGE=docs'), /run dev .*--filter=@wallpaperdb\/docs/);
});

test('database and Compose commands use explicit selectors', () => {
  assert.match(output('psql'), /psql -U wallpaperdb\s/);
  assert.match(output('psql', 'DB=media'), /-d wallpaperdb_media/);
  assert.match(output('apps-start', 'SERVICE=ingestor', 'COMPOSE_PROJECT_NAME=isolated'), /-p isolated .*up -d --build ingestor/);
  assert.match(output('apps-stop', 'SERVICE=ingestor'), /stop ingestor/);
  assert.doesNotMatch(output('apps-stop', 'SERVICE=ingestor'), / down/);
  assert.match(output('apps-stop'), / down/);
});

test('one-off scripts require a package and script', () => {
  assert.notEqual(make('run').status, 0);
  assert.notEqual(make('run', 'PACKAGE=web').status, 0);
  assert.match(output('run', 'PACKAGE=web', 'SCRIPT=preview'), /pnpm --filter @wallpaperdb\/web run preview/);
});

test('force applies to both CI phases and type checks', () => {
  const ci = output('ci', 'FORCE=1');
  assert.match(ci, /run build lint check-types test:unit test:integration .*--force/);
  assert.match(ci, /run test:e2e .*--force/);
  assert.match(ci, /run build lint check-types test:unit test:integration .*--concurrency=1/);
  assert.doesNotMatch(output('ci', 'PACKAGE=web'), /--filter=/);
  assert.match(output('check-types', 'FORCE=1'), /run check-types .*--force/);
});

test('default goal is help, even with worktree configuration', () => {
  const result = spawnSync('make', ['--no-print-directory'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PACKAGE=web/);
  assert.doesNotMatch(result.stdout, /ingestor-build/);
});

test('all public targets are documented, phony, and advertised', () => {
  const source = readFileSync('Makefile', 'utf8');
  const targets = [...source.matchAll(/^([a-z][a-z0-9-]*):.*$/gm)];
  const phony = source.replace(/\\\n/g, ' ').match(/^\.PHONY: (.*)$/m)[1].split(/\s+/);
  const help = spawnSync('make', ['--no-print-directory', 'help'], { encoding: 'utf8', env });
  assert.equal(help.status, 0, help.stderr);
  for (const [line, name] of targets) {
    assert.match(line, /## /, `${name} needs a help description`);
    assert.ok(phony.includes(name), `${name} must be phony`);
    assert.match(help.stdout, new RegExp(`^  ${name}\\s`, 'm'));
  }
});
