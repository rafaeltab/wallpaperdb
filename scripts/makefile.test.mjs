import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  assert.doesNotMatch(output('check-types'), /crap:check-types/);
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

function withCleanWebWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'wallpaperdb-web-clean-checkout-'));
  const web = join(workspace, 'apps/web');
  const markdown = join(workspace, 'packages/profile-markdown');
  try {
    mkdirSync(join(web, 'node_modules'), { recursive: true });
    mkdirSync(markdown, { recursive: true });
    for (const file of ['Makefile', 'package.json', 'pnpm-workspace.yaml']) {
      copyFileSync(file, join(workspace, file));
    }
    // Copy the real application and configuration, never local build output,
    // credentials, or the route tree that a prior dev server may have generated.
    for (const file of [
      'src', 'test', 'public', 'scripts', 'index.html', 'package.json',
      'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts',
      'tsr.config.json',
    ]) {
      const source = join('apps/web', file);
      if (!existsSync(source)) continue;
      cpSync(source, join(web, file), {
        recursive: true,
        filter: (path) => path !== join('apps/web', 'src/routeTree.gen.ts'),
      });
    }
    // Vite imports this workspace through dist/index.js. Start without its
    // output so an earlier local build cannot hide a fresh-checkout failure.
    for (const file of ['src', 'package.json']) {
      cpSync(join('packages/profile-markdown', file), join(markdown, file), { recursive: true });
    }
    symlinkSync(realpathSync('packages/profile-markdown/node_modules'),
      join(markdown, 'node_modules'), 'dir');
    assert.equal(existsSync(join(markdown, 'dist/index.js')), false);
    // Use the installed real compiler and external declarations, but keep source
    // files and TypeScript's node_modules/.tmp build state private to this run.
    symlinkSync(realpathSync('node_modules'), join(workspace, 'node_modules'), 'dir');
    for (const dependency of readdirSync('apps/web/node_modules')) {
      if (dependency.startsWith('.') && dependency !== '.bin') continue;
      if (dependency === '@wallpaperdb') {
        mkdirSync(join(web, 'node_modules', dependency));
        for (const name of readdirSync(join('apps/web/node_modules', dependency))) {
          symlinkSync(name === 'profile-markdown' ? markdown :
            realpathSync(join('apps/web/node_modules', dependency, name)),
          join(web, 'node_modules', dependency, name), 'dir');
        }
        continue;
      }
      symlinkSync(realpathSync(join('apps/web/node_modules', dependency)),
        join(web, 'node_modules', dependency), 'dir');
    }
    const dependencyBuild = spawnSync('make', [
      '--no-print-directory', 'run', 'PACKAGE=profile-markdown', 'SCRIPT=build',
    ], { encoding: 'utf8', env, cwd: workspace, timeout: 60_000 });
    assert.equal(dependencyBuild.status, 0, dependencyBuild.stdout + dependencyBuild.stderr);
    assert.equal(existsSync(join(markdown, 'dist/index.js')), true);
    return run({ workspace, web });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

for (const script of ['check-types', 'build']) {
  test(`web ${script} generates routes from a clean checkout and rejects application, test, and Vite errors`, () => {
    withCleanWebWorkspace(({ workspace, web }) => {
      const fixtures = ['src/typecheck-probe.ts', 'test/typecheck-probe.ts', 'vite.config.ts'];
      const originalViteConfig = readFileSync(join(web, 'vite.config.ts'), 'utf8');
      const check = () => spawnSync('make', [
        '--no-print-directory', 'run', 'PACKAGE=web', `SCRIPT=${script}`,
      ], { encoding: 'utf8', env, cwd: workspace, timeout: 120_000 });
      const writeFixtures = (value) => {
        for (const fixture of fixtures) {
          const prefix = fixture === 'vite.config.ts' ? originalViteConfig : '';
          writeFileSync(join(web, fixture),
            `${prefix}\nexport const typecheckProbe: number = ${value};\n`);
        }
      };

      assert.equal(existsSync(join(web, 'src/routeTree.gen.ts')), false);
      writeFixtures('1');
      const initial = check();
      assert.equal(initial.status, 0, initial.stdout + initial.stderr);
      assert.equal(existsSync(join(web, 'src/routeTree.gen.ts')), true);
      if (script === 'build') assert.equal(existsSync(join(web, 'dist/index.html')), true);

      writeFixtures("'invalid'");
      const result = check();
      assert.notEqual(result.status, 0, 'the real command must reject invalid TypeScript');
      const diagnostics = result.stdout + result.stderr;
      for (const fixture of fixtures) {
        assert.match(diagnostics, new RegExp(`${fixture.replaceAll('.', '\\.')}\\(\\d+,14\\): error TS2322`),
          `missing type error for ${fixture}: ${diagnostics}`);
      }

      writeFixtures('1');
      const clean = check();
      assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    });
  });
}

test('root workspace checks use the shared Turbo commands', () => {
  assert.match(output('test-integration', 'PACKAGE=root'), /run test:integration .*--filter=\/\/.*--concurrency=1/);
  assert.match(output('check-types', 'PACKAGE=root'), /run check-types .*--filter=\/\//);
  const ci = output('ci');
  assert.doesNotMatch(ci, /test-crap|crap-check-types|crap:check-types/);
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
  const scopedCi = output('ci', 'PACKAGE=web');
  assert.doesNotMatch(scopedCi, /run (build lint check-types test:unit test:integration|test:e2e)[^\n]*--filter=/);
  assert.doesNotMatch(scopedCi, /run build --filter=@wallpaperdb\/vitest-config/);
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
