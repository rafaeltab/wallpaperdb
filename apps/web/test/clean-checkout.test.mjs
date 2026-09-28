import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const env = { ...process.env, MAKEFLAGS: '', MFLAGS: '', MAKELEVEL: '0' };
for (const selector of ['PACKAGE', 'SERVICE', 'DB', 'SCRIPT', 'ARGS', 'FORCE']) {
  delete env[selector];
}

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
